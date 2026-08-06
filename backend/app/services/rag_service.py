"""RAG orchestration: ingestion, retrieval-only search, and answer generation."""

from __future__ import annotations

import hashlib
import logging
import time
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.core.config import settings
from app.core.errors import KnowledgeBaseEmptyError, NotFoundError, ValidationError
from app.core.security import new_id
from app.db import repository as repo
from app.services import answer_cache, atlas, generation, retrieval, vector_store
from app.services.chunking import chunk_document
from app.services.embeddings import embed_query
from app.services.loaders import load_document

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class IngestionResult:
    document: dict[str, Any]
    chunks_indexed: int
    duplicate: bool = False
    elapsed_ms: int = 0


@dataclass(slots=True)
class AnswerResult:
    question: str
    answer: str
    citations: list[dict[str, Any]]
    follow_ups: list[str]
    confidence: dict[str, Any]
    retrieval_trace: dict[str, Any]
    candidates: list[dict[str, Any]]
    latency_ms: int
    tokens_used: int
    cost_xlm: float
    model: str
    metrics: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "question": self.question,
            "answer": self.answer,
            "citations": self.citations,
            "sources": sorted({c["document_title"] for c in self.citations}),
            "follow_ups": self.follow_ups,
            "confidence": self.confidence,
            "retrieval": self.retrieval_trace,
            "candidates": self.candidates,
            "latency_ms": self.latency_ms,
            "tokens_used": self.tokens_used,
            "cost_xlm": self.cost_xlm,
            "model": self.model,
            "metrics": self.metrics,
            "cached": False,
        }


def _checksum(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


class RAGService:
    # ── Ingestion ────────────────────────────────────────────────────────────

    def ingest_file(
        self, path: Path, *, original_filename: str | None = None
    ) -> IngestionResult:
        started = time.perf_counter()
        filename = original_filename or path.name
        size_bytes = path.stat().st_size
        if size_bytes == 0:
            raise ValidationError("The uploaded file is empty.")

        checksum = _checksum(path)
        existing = repo.find_document_by_checksum(checksum)
        if existing:
            logger.info("Skipping duplicate upload of %s", filename)
            return IngestionResult(
                document=existing,
                chunks_indexed=existing["chunk_count"],
                duplicate=True,
                elapsed_ms=int((time.perf_counter() - started) * 1000),
            )

        loaded = load_document(path)
        chunks = chunk_document(loaded)
        if not chunks:
            raise ValidationError("No indexable text could be extracted from this file.")

        document_id = new_id("doc")
        summary, topics = generation.summarise_document(loaded.title, loaded.full_text)

        indexed = vector_store.add_chunks(
            document_id,
            chunks,
            base_metadata={
                "title": loaded.title,
                "filename": filename,
                "media_type": loaded.media_type,
            },
        )

        document = repo.create_document(
            document_id=document_id,
            filename=filename,
            title=loaded.title,
            media_type=loaded.media_type,
            size_bytes=size_bytes,
            checksum=checksum,
            chunk_count=indexed,
            char_count=loaded.char_count,
            page_count=loaded.page_count,
            summary=summary,
            topics=topics,
        )

        self._on_corpus_change()

        elapsed_ms = int((time.perf_counter() - started) * 1000)
        logger.info(
            "Ingested %s: %d chunks in %d ms", filename, indexed, elapsed_ms
        )
        return IngestionResult(
            document=document, chunks_indexed=indexed, elapsed_ms=elapsed_ms
        )

    def delete_document(self, document_id: str) -> None:
        if not repo.get_document(document_id):
            raise NotFoundError(f"Document '{document_id}' does not exist.")
        vector_store.delete_document(document_id)
        repo.delete_document(document_id)
        self._on_corpus_change()

    @staticmethod
    def _on_corpus_change() -> None:
        """Anything derived from the corpus is now stale."""
        answer_cache.invalidate()
        atlas.invalidate()

    # ── Retrieval-only search (no LLM, no credit) ────────────────────────────

    def search(
        self, query: str, *, top_k: int | None = None, document_ids: list[str] | None = None
    ) -> dict[str, Any]:
        started = time.perf_counter()
        result = retrieval.retrieve(query, top_k=top_k, document_ids=document_ids)
        return {
            "query": query,
            "matches": [
                {
                    "chunk_id": chunk.chunk_id,
                    "document_id": chunk.document_id,
                    "document_title": chunk.document_title,
                    "locator": chunk.locator,
                    "page": chunk.page,
                    "section": chunk.section,
                    "score": round(chunk.score, 4),
                    "text": chunk.body[:800],
                }
                for chunk in result.chunks
            ],
            "retrieval": result.trace,
            "latency_ms": int((time.perf_counter() - started) * 1000),
        }

    # ── Semantic cache ───────────────────────────────────────────────────────

    def lookup_cached_answer(self, question: str) -> dict[str, Any] | None:
        """Check the cache *before* a credit is debited.

        A repeat question — however it is phrased — is not billed twice.
        """
        if vector_store.count() == 0:
            return None
        try:
            vector = embed_query(question)
        except Exception:  # a cache miss must never fail the request
            logger.warning("Cache lookup embedding failed", exc_info=True)
            return None

        hit = answer_cache.lookup(vector, vector_store.corpus_revision())
        return hit.payload() if hit else None

    def _remember_answer(self, question: str, payload: dict[str, Any]) -> None:
        try:
            answer_cache.store(
                question,
                embed_query(question),
                payload,
                vector_store.corpus_revision(),
            )
        except Exception:  # caching is best-effort
            logger.debug("Failed to cache answer", exc_info=True)

    # ── Generation ───────────────────────────────────────────────────────────

    def _prepare(
        self,
        question: str,
        document_ids: list[str] | None,
        top_k: int | None = None,
    ) -> tuple[retrieval.RetrievalResult, list[generation.Citation], str, str]:
        if vector_store.count() == 0:
            raise KnowledgeBaseEmptyError()

        result = retrieval.retrieve(question, top_k=top_k, document_ids=document_ids)
        if result.is_empty:
            raise KnowledgeBaseEmptyError(
                "Nothing in the knowledge base is relevant to that question. "
                "Try rephrasing, or upload a document that covers it."
            )
        citations = generation.build_citations(result.chunks)
        system, user = generation.build_prompt(question, citations, history=None)
        return result, citations, system, user

    def answer(
        self,
        question: str,
        *,
        history: list[dict[str, str]] | None = None,
        document_ids: list[str] | None = None,
        top_k: int | None = None,
        model: str | None = None,
        temperature: float | None = None,
    ) -> AnswerResult:
        started = time.perf_counter()
        result, citations, system, _ = self._prepare(question, document_ids, top_k)
        _, user = generation.build_prompt(question, citations, history=history)

        raw = generation.complete(system, user, model=model, temperature=temperature)
        answer, follow_ups = generation.split_answer(raw)
        generation.mark_used_citations(answer, citations)

        confidence = generation.score_confidence(
            answer,
            citations,
            top_score=result.top_score,
            mean_score=result.mean_score,
        )
        latency_ms = int((time.perf_counter() - started) * 1000)

        result_payload = AnswerResult(
            question=question,
            answer=answer,
            citations=[c.to_dict() for c in citations],
            follow_ups=follow_ups,
            confidence=confidence.to_dict(),
            retrieval_trace=result.trace,
            candidates=[c.to_dict() for c in result.candidates],
            latency_ms=latency_ms,
            tokens_used=generation.estimate_tokens(system, user, answer),
            cost_xlm=settings.x402_price_xlm,
            model=settings.gemini_model,
            metrics={
                "chunks_retrieved": len(citations),
                "chunks_cited": sum(1 for c in citations if c.used),
                "top_score": round(result.top_score, 4),
                "mean_score": round(result.mean_score, 4),
            },
        )
        self._remember_answer(question, result_payload.to_dict())
        return result_payload

    def stream_answer(
        self,
        question: str,
        *,
        history: list[dict[str, str]] | None = None,
        document_ids: list[str] | None = None,
        top_k: int | None = None,
        model: str | None = None,
        temperature: float | None = None,
    ) -> Iterator[tuple[str, dict[str, Any]]]:
        """Yield ``(event, payload)`` pairs for Server-Sent Events."""
        started = time.perf_counter()

        yield "status", {"stage": "retrieving", "message": "Searching the knowledge base"}
        result, citations, system, _ = self._prepare(question, document_ids, top_k)
        _, user = generation.build_prompt(question, citations, history=history)

        retrieval_ms = int((time.perf_counter() - started) * 1000)
        yield (
            "retrieval",
            {
                "citations": [c.to_dict() for c in citations],
                "trace": result.trace,
                "candidates": [c.to_dict() for c in result.candidates],
                "retrieval_ms": retrieval_ms,
            },
        )

        yield "status", {"stage": "generating", "message": "Composing a grounded answer"}

        splitter = generation.FollowUpSplitter()
        pieces: list[str] = []
        first_token_ms: int | None = None

        for delta in generation.stream_completion(
            system, user, model=model, temperature=temperature
        ):
            visible = splitter.push(delta)
            if visible:
                if first_token_ms is None:
                    first_token_ms = int((time.perf_counter() - started) * 1000)
                pieces.append(visible)
                yield "token", {"text": visible}

        tail = splitter.finish()
        if tail:
            pieces.append(tail)
            yield "token", {"text": tail}

        answer = "".join(pieces).strip()
        follow_ups = splitter.follow_ups
        if follow_ups:
            yield "follow_ups", {"questions": follow_ups}

        generation.mark_used_citations(answer, citations)
        confidence = generation.score_confidence(
            answer, citations, top_score=result.top_score, mean_score=result.mean_score
        )
        latency_ms = int((time.perf_counter() - started) * 1000)

        done_payload: dict[str, Any] = {
                "answer": answer,
                "citations": [c.to_dict() for c in citations],
                "sources": sorted({c.document_title for c in citations}),
                "follow_ups": follow_ups,
                "confidence": confidence.to_dict(),
                "latency_ms": latency_ms,
                "retrieval_ms": retrieval_ms,
                "first_token_ms": first_token_ms,
                "tokens_used": generation.estimate_tokens(system, user, answer),
                "cost_xlm": settings.x402_price_xlm,
                "model": model or settings.gemini_model,
                "metrics": {
                    "chunks_retrieved": len(citations),
                    "chunks_cited": sum(1 for c in citations if c.used),
                    "top_score": round(result.top_score, 4),
                    "mean_score": round(result.mean_score, 4),
                },
                "cached": False,
        }

        if answer:
            self._remember_answer(
                question,
                {
                    **done_payload,
                    "question": question,
                    "retrieval": result.trace,
                    "candidates": [c.to_dict() for c in result.candidates],
                },
            )

        yield "done", done_payload

    # ── Stats ────────────────────────────────────────────────────────────────

    def stats(self) -> dict[str, Any]:
        totals = repo.document_totals()
        return {
            **totals,
            "indexed_vectors": vector_store.count(),
            "collection": settings.chroma_collection,
            "embedding_model": settings.gemini_embedding_model,
            "generation_model": settings.gemini_model,
            "retrieval_strategy": "hybrid (dense + BM25 · RRF)"
            if settings.hybrid_search_enabled
            else "dense",
            "top_k": settings.retrieval_top_k,
            "chunk_size": settings.chunk_size,
            "chunk_overlap": settings.chunk_overlap,
            "gemini_configured": settings.gemini_enabled,
            "answer_cache": answer_cache.stats(),
        }


rag_service = RAGService()
