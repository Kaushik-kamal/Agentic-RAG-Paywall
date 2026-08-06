"""Corpus atlas — a 2D map of the embedding space.

Embeddings are 3072-dimensional, which is unviewable. Principal component
analysis finds the two directions the corpus varies along most and projects
onto them. That is enough to show what a vector index actually *is*: passages
about the same idea land in the same neighbourhood, and a query lands next to
its answers.

PCA over numpy rather than t-SNE or UMAP is a deliberate trade:

* It is a **linear** projection, so a query can be projected into exactly the
  same basis later. Neighbour-embedding methods cannot place a new point
  without refitting, which would make the live query overlay a lie.
* Distances stay interpretable — nothing is warped to look clustered.
* It adds no dependency and fits in a few milliseconds at this corpus size.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from typing import Any

import numpy as np

from app.services import vector_store

logger = logging.getLogger(__name__)

#: Below this many chunks the projection is noise; the UI shows a hint instead.
MIN_CHUNKS = 3


@dataclass(slots=True)
class Projection:
    """A fitted PCA basis plus the projected corpus."""

    revision: str
    mean: np.ndarray
    components: np.ndarray  # (2, dimensions)
    scale: float
    points: list[dict[str, Any]]
    explained_variance: list[float]
    fitted_at: float

    def project(self, vector: list[float]) -> tuple[float, float]:
        centred = np.asarray(vector, dtype=np.float32) - self.mean
        x, y = self.components @ centred
        return float(x / self.scale), float(y / self.scale)


_lock = threading.Lock()
_cached: Projection | None = None


def _fit() -> Projection | None:
    ids, vectors, metadatas = vector_store.get_embeddings()
    if len(ids) < MIN_CHUNKS or not vectors:
        return None

    started = time.perf_counter()
    matrix = np.asarray(vectors, dtype=np.float32)
    mean = matrix.mean(axis=0)
    centred = matrix - mean

    # Economy SVD: for a 33x3072 matrix this is instant, and it avoids
    # materialising a 3072x3072 covariance matrix.
    _, singular_values, right = np.linalg.svd(centred, full_matrices=False)
    components = right[:2]
    coordinates = centred @ components.T

    # Normalise into roughly [-1, 1] so the frontend needs no magic numbers.
    scale = float(np.abs(coordinates).max()) or 1.0
    coordinates = coordinates / scale

    variance = singular_values**2
    total = float(variance.sum()) or 1.0
    explained = [round(float(v) / total, 4) for v in variance[:2]]

    points = [
        {
            "chunk_id": chunk_id,
            "document_id": str(metadata.get("document_id", "unknown")),
            "document_title": str(
                metadata.get("title") or metadata.get("filename") or "Untitled"
            ),
            "section": str(metadata.get("section") or ""),
            "page": int(metadata.get("page") or 0) or None,
            "preview": str(metadata.get("_text", ""))[:200],
            "x": round(float(coordinates[index][0]), 5),
            "y": round(float(coordinates[index][1]), 5),
        }
        for index, (chunk_id, metadata) in enumerate(zip(ids, metadatas, strict=False))
    ]

    logger.info(
        "Atlas fitted: %d chunks → 2D in %.0f ms (%.0f%% variance explained)",
        len(points),
        (time.perf_counter() - started) * 1000,
        sum(explained) * 100,
    )

    return Projection(
        revision=vector_store.corpus_revision(),
        mean=mean,
        components=components,
        scale=scale,
        points=points,
        explained_variance=explained,
        fitted_at=time.time(),
    )


def get_projection() -> Projection | None:
    """Fit lazily, refit only when the corpus changes."""
    global _cached
    revision = vector_store.corpus_revision()

    with _lock:
        if _cached is not None and _cached.revision == revision:
            return _cached
        _cached = _fit()
        return _cached


def invalidate() -> None:
    global _cached
    with _lock:
        _cached = None


def build_atlas() -> dict[str, Any]:
    projection = get_projection()
    if projection is None:
        return {
            "available": False,
            "reason": (
                f"The atlas needs at least {MIN_CHUNKS} indexed chunks. "
                "Upload a document or seed the demo corpus."
            ),
            "points": [],
            "documents": [],
            "explained_variance": [],
        }

    documents: dict[str, dict[str, Any]] = {}
    for point in projection.points:
        entry = documents.setdefault(
            point["document_id"],
            {
                "document_id": point["document_id"],
                "title": point["document_title"],
                "chunks": 0,
            },
        )
        entry["chunks"] += 1

    return {
        "available": True,
        "points": projection.points,
        "documents": sorted(documents.values(), key=lambda d: -d["chunks"]),
        "explained_variance": projection.explained_variance,
        "total_variance_explained": round(sum(projection.explained_variance), 4),
        "dimensions": int(projection.components.shape[1]),
        "method": "PCA (linear, so live queries project into the same basis)",
        "revision": projection.revision,
    }


def project_query(query: str, top_k: int = 6) -> dict[str, Any]:
    """Place a query in the atlas and mark what retrieval selected for it."""
    from app.services import retrieval
    from app.services.embeddings import embed_query

    projection = get_projection()
    if projection is None:
        return {"available": False, "query": query}

    started = time.perf_counter()
    x, y = projection.project(embed_query(query))
    result = retrieval.retrieve(query, top_k=top_k)

    scores = {chunk.chunk_id: round(chunk.score, 4) for chunk in result.chunks}
    considered = {
        candidate.chunk.chunk_id: round(candidate.fused_score, 5)
        for candidate in result.candidates
    }

    return {
        "available": True,
        "query": query,
        "x": round(x, 5),
        "y": round(y, 5),
        "retrieved": [
            {
                "chunk_id": chunk.chunk_id,
                "locator": chunk.locator,
                "score": scores[chunk.chunk_id],
                "preview": chunk.body[:220],
            }
            for chunk in result.chunks
        ],
        "considered": considered,
        "trace": result.trace,
        "latency_ms": int((time.perf_counter() - started) * 1000),
    }
