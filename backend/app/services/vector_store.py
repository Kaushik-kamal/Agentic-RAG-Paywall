"""ChromaDB wrapper.

We talk to Chroma directly rather than through a framework adapter so we can
control the distance metric, return per-chunk scores, and delete a document's
vectors precisely when it is removed from the library.
"""

from __future__ import annotations

import hashlib
import logging
import threading
from dataclasses import dataclass
from typing import Any

from app.core.config import settings
from app.services.chunking import Chunk
from app.services.embeddings import embed_documents, embed_query

logger = logging.getLogger(__name__)

# Reentrant: get_collection() and reset_collection() hold the lock while
# calling _get_client(), which acquires it again.
_lock = threading.RLock()
_client = None
_collection = None


@dataclass(slots=True)
class ScoredChunk:
    chunk_id: str
    text: str
    score: float
    metadata: dict[str, Any]

    @property
    def document_id(self) -> str:
        return str(self.metadata.get("document_id", "unknown"))

    @property
    def document_title(self) -> str:
        return str(self.metadata.get("title") or self.metadata.get("filename") or "Untitled")

    @property
    def page(self) -> int | None:
        page = self.metadata.get("page")
        return int(page) if isinstance(page, (int, float)) and page else None

    @property
    def section(self) -> str:
        return str(self.metadata.get("section") or "")

    @property
    def body(self) -> str:
        """Chunk text without the breadcrumb prefix added at index time.

        The prefix helps the embedding but is redundant on screen, where the
        locator is already shown above the passage.
        """
        if self.section and self.text.startswith(self.section):
            return self.text[len(self.section) :].lstrip("\n ")
        return self.text

    @property
    def locator(self) -> str:
        """Human-readable citation label: "Doc › Section › Subsection › p.4"."""
        parts = [self.document_title]
        # A document's H1 usually repeats its title; don't say it twice.
        crumbs = [c for c in self.section.split(" › ") if c.strip()]
        if crumbs and crumbs[0].strip().lower() == self.document_title.strip().lower():
            crumbs = crumbs[1:]
        parts.extend(crumbs)
        if self.page:
            parts.append(f"p.{self.page}")
        return " › ".join(parts)


def _get_client():
    global _client
    if _client is None:
        with _lock:
            if _client is None:
                import chromadb
                from chromadb.config import Settings as ChromaSettings

                path = settings.chroma_path
                path.mkdir(parents=True, exist_ok=True)
                _client = chromadb.PersistentClient(
                    path=str(path),
                    settings=ChromaSettings(anonymized_telemetry=False),
                )
                logger.info("ChromaDB ready at %s", path)
    return _client


def get_collection():
    global _collection
    if _collection is None:
        with _lock:
            if _collection is None:
                _collection = _get_client().get_or_create_collection(
                    name=settings.chroma_collection,
                    # Cosine matches how text embeddings are meant to be compared.
                    metadata={"hnsw:space": "cosine"},
                    # We always supply vectors ourselves. Leaving this unset makes
                    # Chroma instantiate its bundled ONNX model, which downloads
                    # ~80 MB on first use and stalls a cold start.
                    embedding_function=None,
                )
    return _collection


def count() -> int:
    try:
        return int(get_collection().count())
    except Exception:
        logger.warning("Vector store count failed", exc_info=True)
        return 0


def add_chunks(document_id: str, chunks: list[Chunk], base_metadata: dict[str, Any]) -> int:
    if not chunks:
        return 0

    vectors = embed_documents([c.text for c in chunks])
    ids = [f"{document_id}::{c.index}" for c in chunks]
    metadatas = [
        {
            **base_metadata,
            "document_id": document_id,
            "chunk_index": c.index,
            "page": c.page if c.page is not None else 0,
            "section": c.section,
            "char_start": c.char_start,
            "char_end": c.char_end,
        }
        for c in chunks
    ]

    get_collection().add(
        ids=ids,
        documents=[c.text for c in chunks],
        embeddings=vectors,
        metadatas=metadatas,
    )
    _invalidate_corpus_cache()
    logger.info("Indexed %d chunks for document %s", len(chunks), document_id)
    return len(chunks)


def delete_document(document_id: str) -> None:
    get_collection().delete(where={"document_id": document_id})
    _invalidate_corpus_cache()
    logger.info("Removed vectors for document %s", document_id)


def reset_collection() -> None:
    global _collection
    with _lock:
        try:
            _get_client().delete_collection(settings.chroma_collection)
        except Exception:
            logger.debug("Collection did not exist during reset", exc_info=True)
        _collection = None
    _invalidate_corpus_cache()


def similarity_search(query: str, k: int) -> list[ScoredChunk]:
    """Dense retrieval. Cosine distance is converted to a 0–1 relevance score."""
    total = count()
    if total == 0:
        return []

    result = get_collection().query(
        query_embeddings=[embed_query(query)],
        n_results=min(k, total),
        include=["documents", "metadatas", "distances"],
    )

    ids = (result.get("ids") or [[]])[0]
    documents = (result.get("documents") or [[]])[0]
    metadatas = (result.get("metadatas") or [[]])[0]
    distances = (result.get("distances") or [[]])[0]

    return [
        ScoredChunk(
            chunk_id=chunk_id,
            text=text or "",
            score=max(0.0, min(1.0, 1.0 - float(distance))),
            metadata=dict(metadata or {}),
        )
        for chunk_id, text, metadata, distance in zip(
            ids, documents, metadatas, distances, strict=False
        )
    ]


# ── Corpus snapshot (backs lexical search) ───────────────────────────────────

_corpus_cache: list[tuple[str, str, dict[str, Any]]] | None = None


def _invalidate_corpus_cache() -> None:
    global _corpus_cache
    _corpus_cache = None


def corpus_revision() -> str:
    """Stable fingerprint of the indexed set — changes on any ingest or delete.

    Cache entries are keyed by this so a document upload can never leave a
    stale answer behind.
    """
    ids = sorted(chunk_id for chunk_id, _, _ in get_corpus())
    return hashlib.sha256("|".join(ids).encode()).hexdigest()[:16]


def get_embeddings() -> tuple[list[str], list[list[float]], list[dict[str, Any]]]:
    """Every stored vector, for corpus-level analysis such as the atlas."""
    if count() == 0:
        return [], [], []

    payload = get_collection().get(include=["embeddings", "metadatas", "documents"])
    ids = list(payload.get("ids") or [])
    raw_vectors = payload.get("embeddings")
    vectors = [list(v) for v in raw_vectors] if raw_vectors is not None else []
    metadatas = [dict(m or {}) for m in (payload.get("metadatas") or [])]
    documents = list(payload.get("documents") or [])

    for metadata, text in zip(metadatas, documents, strict=False):
        metadata["_text"] = text or ""

    return ids, vectors, metadatas


def get_corpus() -> list[tuple[str, str, dict[str, Any]]]:
    """All ``(id, text, metadata)`` triples, cached until the next write.

    The corpus is small by design (a curated knowledge base, not the web),
    so holding it in memory for BM25 is cheaper than a second index.
    """
    global _corpus_cache
    if _corpus_cache is not None:
        return _corpus_cache

    if count() == 0:
        _corpus_cache = []
        return _corpus_cache

    payload = get_collection().get(include=["documents", "metadatas"])
    ids = payload.get("ids") or []
    documents = payload.get("documents") or []
    metadatas = payload.get("metadatas") or []
    _corpus_cache = [
        (chunk_id, text or "", dict(metadata or {}))
        for chunk_id, text, metadata in zip(ids, documents, metadatas, strict=False)
    ]
    return _corpus_cache


def health() -> dict[str, Any]:
    try:
        return {
            "status": "ok",
            "collection": settings.chroma_collection,
            "chunks": count(),
            "path": str(settings.chroma_path),
        }
    except Exception as exc:
        return {"status": "error", "detail": str(exc)}
