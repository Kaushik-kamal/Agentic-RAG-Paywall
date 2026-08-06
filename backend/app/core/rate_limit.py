"""In-process sliding-window rate limiter.

Deliberately dependency-free: a single-node hackathon deployment does not
need Redis, and the interface below is a drop-in seam for one later.
"""

from __future__ import annotations

import threading
import time
from collections import deque
from dataclasses import dataclass

from app.core.config import settings


@dataclass(frozen=True, slots=True)
class RateLimitResult:
    allowed: bool
    limit: int
    remaining: int
    reset_after: int


class SlidingWindowRateLimiter:
    def __init__(self, limit: int, window_seconds: int) -> None:
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def check(self, key: str, *, cost: int = 1) -> RateLimitResult:
        now = time.monotonic()
        cutoff = now - self.window

        with self._lock:
            bucket = self._hits.setdefault(key, deque())
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()

            if len(bucket) + cost > self.limit:
                reset_after = max(1, int(bucket[0] - cutoff)) if bucket else self.window
                return RateLimitResult(False, self.limit, 0, reset_after)

            for _ in range(cost):
                bucket.append(now)

            if len(self._hits) > 4096:  # bound memory on long-running processes
                self._evict(cutoff)

            return RateLimitResult(
                allowed=True,
                limit=self.limit,
                remaining=max(0, self.limit - len(bucket)),
                reset_after=self.window,
            )

    def _evict(self, cutoff: float) -> None:
        stale = [k for k, v in self._hits.items() if not v or v[-1] <= cutoff]
        for key in stale:
            self._hits.pop(key, None)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


global_limiter = SlidingWindowRateLimiter(
    settings.rate_limit_requests, settings.rate_limit_window_seconds
)

#: Generation is expensive (LLM + embeddings); it gets a tighter budget.
query_limiter = SlidingWindowRateLimiter(30, 60)

#: Uploads are the most expensive operation of all.
upload_limiter = SlidingWindowRateLimiter(10, 60)
