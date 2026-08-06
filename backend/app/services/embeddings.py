"""Gemini embeddings with batching, task-type hints, and a query cache.

Google's embedding API distinguishes ``RETRIEVAL_DOCUMENT`` from
``RETRIEVAL_QUERY``. Using the right task type on each side measurably
improves recall, and costs nothing.
"""

from __future__ import annotations

import logging
import threading
from collections import OrderedDict

from app.core.config import settings
from app.core.errors import ServiceUnavailableError

logger = logging.getLogger(__name__)

_BATCH_SIZE = 64
_QUERY_CACHE_SIZE = 512

_lock = threading.Lock()
_document_embedder = None
_query_embedder = None
_query_cache: OrderedDict[str, list[float]] = OrderedDict()


def _build(task_type: str):
    from langchain_google_genai import GoogleGenerativeAIEmbeddings

    return GoogleGenerativeAIEmbeddings(
        model=settings.gemini_embedding_model,
        google_api_key=settings.gemini_api_key,
        task_type=task_type,
    )


def _require_key() -> None:
    if not settings.gemini_enabled:
        raise ServiceUnavailableError(
            "GEMINI_API_KEY is not configured. Add it to backend/.env to enable "
            "embeddings and answer generation.",
            details={"missing_env": "GEMINI_API_KEY"},
        )


def _get_document_embedder():
    global _document_embedder
    if _document_embedder is None:
        with _lock:
            if _document_embedder is None:
                _require_key()
                _document_embedder = _build("RETRIEVAL_DOCUMENT")
                logger.info(
                    "Embeddings ready (model=%s)", settings.gemini_embedding_model
                )
    return _document_embedder


def _get_query_embedder():
    global _query_embedder
    if _query_embedder is None:
        with _lock:
            if _query_embedder is None:
                _require_key()
                _query_embedder = _build("RETRIEVAL_QUERY")
    return _query_embedder


def embed_documents(texts: list[str]) -> list[list[float]]:
    """Embed chunk texts, batched to stay inside per-request payload limits."""
    if not texts:
        return []
    embedder = _get_document_embedder()
    vectors: list[list[float]] = []
    for start in range(0, len(texts), _BATCH_SIZE):
        batch = texts[start : start + _BATCH_SIZE]
        try:
            vectors.extend(embedder.embed_documents(batch))
        except Exception as exc:
            logger.exception("Embedding batch failed (offset=%d)", start)
            raise ServiceUnavailableError(
                "The embedding service rejected the request. "
                "Check your Gemini API key and quota."
            ) from exc
    return vectors


def embed_query(text: str) -> list[float]:
    """Embed a search query. Repeated questions are served from memory."""
    key = text.strip().lower()
    with _lock:
        cached = _query_cache.get(key)
        if cached is not None:
            _query_cache.move_to_end(key)
            return cached

    try:
        vector = _get_query_embedder().embed_query(text)
    except Exception as exc:
        logger.exception("Query embedding failed")
        raise ServiceUnavailableError(
            "The embedding service is unavailable. Please retry shortly."
        ) from exc

    with _lock:
        _query_cache[key] = vector
        while len(_query_cache) > _QUERY_CACHE_SIZE:
            _query_cache.popitem(last=False)
    return vector


def cache_stats() -> dict[str, int]:
    return {"query_cache_entries": len(_query_cache), "capacity": _QUERY_CACHE_SIZE}


def reset() -> None:
    """Test helper — drop memoised clients and cached vectors."""
    global _document_embedder, _query_embedder
    with _lock:
        _document_embedder = None
        _query_embedder = None
        _query_cache.clear()
