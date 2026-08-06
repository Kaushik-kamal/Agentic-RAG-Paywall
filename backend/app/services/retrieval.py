"""Hybrid retrieval: dense vectors + BM25 lexical, fused with RRF.

Dense search understands paraphrase but misses rare literal tokens (error
codes, product names, "XLM"). BM25 nails those and misses paraphrase.
Reciprocal Rank Fusion combines the two rankings without needing the scores
to be on a comparable scale.

Every stage emits a trace so the UI can *show* the retrieval, not just claim it.
"""

from __future__ import annotations

import logging
import math
import re
import threading
import time
from dataclasses import dataclass, field
from typing import Any

from app.core.config import settings
from app.services import vector_store
from app.services.vector_store import ScoredChunk

logger = logging.getLogger(__name__)

_TOKEN = re.compile(r"[a-z0-9]+")
_STOPWORDS = frozenset(
    ["a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "has", "have", "how", "i", "if", "in", "into", "is", "it", "its", "of", "on", "or", "that", "the", "their", "then", "there", "these", "they", "this", "to", "was", "were", "what", "when", "where", "which", "who", "why", "will", "with", "you", "your", "do", "does", "did", "can", "could", "should", "would", "about"]
)

_bm25_lock = threading.Lock()
_bm25_index: Any | None = None
_bm25_ids: list[str] = []
_bm25_signature: int = -1


def tokenize(text: str) -> list[str]:
    return [t for t in _TOKEN.findall(text.lower()) if t not in _STOPWORDS and len(t) > 1]


@dataclass(slots=True)
class RetrievalCandidate:
    chunk: ScoredChunk
    dense_rank: int | None = None
    dense_score: float = 0.0
    lexical_rank: int | None = None
    lexical_score: float = 0.0
    fused_score: float = 0.0
    selected: bool = False
    rejected_reason: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "chunk_id": self.chunk.chunk_id,
            "document_id": self.chunk.document_id,
            "document_title": self.chunk.document_title,
            "locator": self.chunk.locator,
            "page": self.chunk.page,
            "section": self.chunk.section,
            "preview": self.chunk.body[:240],
            "dense_rank": self.dense_rank,
            "dense_score": round(self.dense_score, 4),
            "lexical_rank": self.lexical_rank,
            "lexical_score": round(self.lexical_score, 4),
            "fused_score": round(self.fused_score, 4),
            "selected": self.selected,
            "rejected_reason": self.rejected_reason,
        }


@dataclass(slots=True)
class RetrievalResult:
    query: str
    chunks: list[ScoredChunk]
    candidates: list[RetrievalCandidate]
    trace: dict[str, Any] = field(default_factory=dict)

    @property
    def is_empty(self) -> bool:
        return not self.chunks

    @property
    def top_score(self) -> float:
        return self.chunks[0].score if self.chunks else 0.0

    @property
    def mean_score(self) -> float:
        if not self.chunks:
            return 0.0
        return sum(c.score for c in self.chunks) / len(self.chunks)


def _build_bm25() -> tuple[Any | None, list[str]]:
    """Rebuild the lexical index when the corpus has changed."""
    global _bm25_index, _bm25_ids, _bm25_signature

    corpus = vector_store.get_corpus()
    signature = hash(tuple(chunk_id for chunk_id, _, _ in corpus))

    with _bm25_lock:
        if signature == _bm25_signature and _bm25_index is not None:
            return _bm25_index, _bm25_ids
        if not corpus:
            _bm25_index, _bm25_ids, _bm25_signature = None, [], signature
            return None, []

        try:
            from rank_bm25 import BM25Okapi
        except ImportError:  # pragma: no cover - optional dependency
            logger.warning("rank-bm25 not installed; falling back to dense-only search")
            _bm25_index, _bm25_ids, _bm25_signature = None, [], signature
            return None, []

        started = time.perf_counter()
        _bm25_index = BM25Okapi([tokenize(text) for _, text, _ in corpus])
        _bm25_ids = [chunk_id for chunk_id, _, _ in corpus]
        _bm25_signature = signature
        logger.info(
            "BM25 index rebuilt: %d chunks in %.0f ms",
            len(corpus),
            (time.perf_counter() - started) * 1000,
        )
        return _bm25_index, _bm25_ids


def _lexical_search(query: str, k: int) -> list[tuple[str, float]]:
    index, ids = _build_bm25()
    tokens = tokenize(query)
    if index is None or not ids or not tokens:
        return []

    scores = index.get_scores(tokens)
    ranked = sorted(zip(ids, scores, strict=False), key=lambda pair: pair[1], reverse=True)
    best = ranked[0][1] if ranked else 0.0
    if best <= 0:
        return []
    # Normalise to 0–1 so the number means something in the UI.
    return [(cid, float(score) / best) for cid, score in ranked[:k] if score > 0]


def _shingles(text: str, size: int = 5) -> set[str]:
    tokens = tokenize(text)
    if len(tokens) < size:
        return {" ".join(tokens)} if tokens else set()
    return {" ".join(tokens[i : i + size]) for i in range(len(tokens) - size + 1)}


def _is_near_duplicate(text: str, kept: list[str], threshold: float = 0.72) -> bool:
    candidate = _shingles(text)
    if not candidate:
        return False
    for existing in kept:
        other = _shingles(existing)
        if not other:
            continue
        overlap = len(candidate & other) / len(candidate | other)
        if overlap >= threshold:
            return True
    return False


def retrieve(
    query: str,
    *,
    top_k: int | None = None,
    fetch_k: int | None = None,
    min_relevance: float | None = None,
    document_ids: list[str] | None = None,
) -> RetrievalResult:
    top_k = top_k or settings.retrieval_top_k
    fetch_k = max(fetch_k or settings.retrieval_fetch_k, top_k)
    floor = settings.retrieval_min_relevance if min_relevance is None else min_relevance

    timings: dict[str, float] = {}

    started = time.perf_counter()
    dense = vector_store.similarity_search(query, fetch_k)
    timings["dense_ms"] = (time.perf_counter() - started) * 1000

    if not dense:
        return RetrievalResult(
            query=query,
            chunks=[],
            candidates=[],
            trace={
                "strategy": "hybrid" if settings.hybrid_search_enabled else "dense",
                "timings_ms": {k: round(v, 1) for k, v in timings.items()},
                "dense_candidates": 0,
                "lexical_candidates": 0,
                "corpus_chunks": vector_store.count(),
            },
        )

    by_id: dict[str, RetrievalCandidate] = {}
    for rank, chunk in enumerate(dense):
        by_id[chunk.chunk_id] = RetrievalCandidate(
            chunk=chunk, dense_rank=rank, dense_score=chunk.score
        )

    lexical: list[tuple[str, float]] = []
    if settings.hybrid_search_enabled:
        started = time.perf_counter()
        lexical = _lexical_search(query, fetch_k)
        timings["lexical_ms"] = (time.perf_counter() - started) * 1000

        corpus_by_id = {cid: (text, meta) for cid, text, meta in vector_store.get_corpus()}
        for rank, (chunk_id, score) in enumerate(lexical):
            candidate = by_id.get(chunk_id)
            if candidate is None:
                entry = corpus_by_id.get(chunk_id)
                if entry is None:
                    continue
                text, metadata = entry
                candidate = RetrievalCandidate(
                    chunk=ScoredChunk(
                        chunk_id=chunk_id, text=text, score=0.0, metadata=metadata
                    )
                )
                by_id[chunk_id] = candidate
            candidate.lexical_rank = rank
            candidate.lexical_score = score

    # ── Reciprocal Rank Fusion ───────────────────────────────────────────────
    k_rrf = settings.rrf_k
    for candidate in by_id.values():
        fused = 0.0
        if candidate.dense_rank is not None:
            fused += 1.0 / (k_rrf + candidate.dense_rank + 1)
        if candidate.lexical_rank is not None:
            fused += 1.0 / (k_rrf + candidate.lexical_rank + 1)
        candidate.fused_score = fused

    ordered = sorted(
        by_id.values(),
        key=lambda c: (c.fused_score, c.dense_score, c.lexical_score),
        reverse=True,
    )

    # ── Filter, deduplicate, and cap per-document dominance ──────────────────
    selected: list[RetrievalCandidate] = []
    kept_texts: list[str] = []
    per_document: dict[str, int] = {}
    per_document_cap = max(2, math.ceil(top_k / 2))
    allowed = set(document_ids) if document_ids else None

    for candidate in ordered:
        if len(selected) >= top_k:
            candidate.rejected_reason = "below_cutoff"
            continue
        if allowed is not None and candidate.chunk.document_id not in allowed:
            candidate.rejected_reason = "filtered_by_document"
            continue
        # A lexical-only hit has no dense score; judge it on its BM25 strength.
        effective = max(candidate.dense_score, candidate.lexical_score * 0.8)
        if effective < floor:
            candidate.rejected_reason = "low_relevance"
            continue
        if _is_near_duplicate(candidate.chunk.text, kept_texts):
            candidate.rejected_reason = "near_duplicate"
            continue
        document_id = candidate.chunk.document_id
        if per_document.get(document_id, 0) >= per_document_cap and len(by_id) > top_k:
            candidate.rejected_reason = "document_diversity_cap"
            continue

        candidate.selected = True
        selected.append(candidate)
        kept_texts.append(candidate.chunk.text)
        per_document[document_id] = per_document.get(document_id, 0) + 1

    # Never return nothing when *something* matched — relax the floor once.
    if not selected and ordered:
        fallback = ordered[0]
        fallback.selected = True
        fallback.rejected_reason = None
        selected = [fallback]

    chunks = [
        ScoredChunk(
            chunk_id=c.chunk.chunk_id,
            text=c.chunk.text,
            score=max(c.dense_score, c.lexical_score),
            metadata=c.chunk.metadata,
        )
        for c in selected
    ]

    return RetrievalResult(
        query=query,
        chunks=chunks,
        candidates=ordered[: fetch_k * 2],
        trace={
            "strategy": "hybrid" if settings.hybrid_search_enabled else "dense",
            "timings_ms": {k: round(v, 1) for k, v in timings.items()},
            "dense_candidates": len(dense),
            "lexical_candidates": len(lexical),
            "fused_candidates": len(by_id),
            "selected": len(selected),
            "documents_represented": len(per_document),
            "corpus_chunks": vector_store.count(),
            "min_relevance": floor,
        },
    )
