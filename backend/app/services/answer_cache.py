"""Semantic answer cache.

Two agents rarely phrase a question identically, so an exact-match cache never
fires. Comparing the *query embedding* does: "how fast does Stellar settle" and
"what is the ledger close time" are the same question, and the second one should
not cost a credit.

The entry is keyed by the corpus revision, so any ingest or delete invalidates
every answer that could have been affected.
"""

from __future__ import annotations

import logging
import math
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

#: Cosine similarity above which two questions are treated as the same question.
#: Tuned high: a false hit serves a wrong answer, which is far worse than a miss.
SIMILARITY_THRESHOLD = 0.94
MAX_ENTRIES = 256
TTL_SECONDS = 60 * 30


@dataclass(slots=True)
class CacheEntry:
    question: str
    vector: list[float]
    payload: dict[str, Any]
    corpus_revision: str
    created_at: float
    hits: int = 0


@dataclass(slots=True)
class CacheHit:
    entry: CacheEntry
    similarity: float
    age_seconds: float

    def payload(self) -> dict[str, Any]:
        """The stored answer, re-stamped as a cache hit."""
        return {
            **self.entry.payload,
            "cached": True,
            "cache": {
                "hit": True,
                "matched_question": self.entry.question,
                "similarity": round(self.similarity, 4),
                "age_seconds": round(self.age_seconds),
                "credits_charged": 0,
            },
            "cost_xlm": 0.0,
        }


@dataclass(slots=True)
class CacheStats:
    hits: int = 0
    misses: int = 0
    saved_credits: int = 0
    entries: int = 0
    evictions: int = 0
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def to_dict(self) -> dict[str, Any]:
        total = self.hits + self.misses
        return {
            "hits": self.hits,
            "misses": self.misses,
            "hit_rate": round(self.hits / total, 3) if total else 0.0,
            "credits_saved": self.saved_credits,
            "entries": self.entries,
            "evictions": self.evictions,
            "threshold": SIMILARITY_THRESHOLD,
        }


_lock = threading.Lock()
_entries: OrderedDict[str, CacheEntry] = OrderedDict()
_stats = CacheStats()


def _cosine(a: list[float], b: list[float]) -> float:
    dot = 0.0
    norm_a = 0.0
    norm_b = 0.0
    for x, y in zip(a, b, strict=False):
        dot += x * y
        norm_a += x * x
        norm_b += y * y
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (math.sqrt(norm_a) * math.sqrt(norm_b))


def lookup(vector: list[float], corpus_revision: str) -> CacheHit | None:
    """Return the closest entry above the threshold, or ``None``."""
    now = time.time()
    best: tuple[float, CacheEntry] | None = None

    with _lock:
        expired = [
            key
            for key, entry in _entries.items()
            if now - entry.created_at > TTL_SECONDS
            or entry.corpus_revision != corpus_revision
        ]
        for key in expired:
            _entries.pop(key, None)

        for entry in _entries.values():
            similarity = _cosine(vector, entry.vector)
            if similarity >= SIMILARITY_THRESHOLD and (
                best is None or similarity > best[0]
            ):
                best = (similarity, entry)

        if best is None:
            _stats.misses += 1
            _stats.entries = len(_entries)
            return None

        similarity, entry = best
        entry.hits += 1
        _entries.move_to_end(_key(entry.question))
        _stats.hits += 1
        _stats.saved_credits += 1
        _stats.entries = len(_entries)

    logger.info(
        "Answer cache hit (%.3f similarity): %r → %r",
        similarity,
        entry.question[:48],
        entry.question[:48],
    )
    return CacheHit(entry=entry, similarity=similarity, age_seconds=now - entry.created_at)


def store(
    question: str, vector: list[float], payload: dict[str, Any], corpus_revision: str
) -> None:
    key = _key(question)
    with _lock:
        _entries[key] = CacheEntry(
            question=question,
            vector=vector,
            payload=payload,
            corpus_revision=corpus_revision,
            created_at=time.time(),
        )
        _entries.move_to_end(key)
        while len(_entries) > MAX_ENTRIES:
            _entries.popitem(last=False)
            _stats.evictions += 1
        _stats.entries = len(_entries)


def invalidate() -> None:
    """Called whenever the corpus changes — a stale answer is worse than a miss."""
    with _lock:
        dropped = len(_entries)
        _entries.clear()
        _stats.entries = 0
    if dropped:
        logger.info("Answer cache cleared (%d entries) after a corpus change", dropped)


def stats() -> dict[str, Any]:
    with _lock:
        return _stats.to_dict()


def _key(question: str) -> str:
    return question.strip().lower()
