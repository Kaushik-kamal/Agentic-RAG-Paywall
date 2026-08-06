"""Test fixtures.

Every test runs against a throwaway SQLite file and a stubbed vector store /
LLM, so the suite is hermetic: no network, no API keys, no Gemini quota.
"""

from __future__ import annotations

import os
import sys
import tempfile
from collections.abc import Iterator
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

# Configure before any app module reads settings.
_TEMP_DIR = tempfile.mkdtemp(prefix="argp-tests-")
os.environ.update(
    {
        "ENVIRONMENT": "development",
        "SECRET_KEY": "test-secret-key-not-used-anywhere-real",
        "ADMIN_API_KEY": "test-admin-key",
        "DATABASE_URL": str(Path(_TEMP_DIR) / "test.db"),
        "CHROMA_PERSIST_DIR": str(Path(_TEMP_DIR) / "chroma"),
        "UPLOAD_DIR": str(Path(_TEMP_DIR) / "uploads"),
        "GEMINI_API_KEY": "test-key",
        "X402_SANDBOX_MODE": "true",
        "X402_FREE_CREDITS": "3",
        "X402_CREDITS_PER_PAYMENT": "10",
        "X402_PRICE_XLM": "0.01",
        "STELLAR_PUBLIC_KEY": "GTESTTREASURYACCOUNT00000000000000000000000000000000000",
        "RATE_LIMIT_ENABLED": "false",
        "LOG_LEVEL": "WARNING",
    }
)

from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.db import database
from app.main import app
from app.services import generation, vector_store
from app.services.vector_store import ScoredChunk

get_settings.cache_clear()


# ── Stubs ─────────────────────────────────────────────────────────────────────


class FakeVectorStore:
    """In-memory stand-in with the same surface as the Chroma wrapper."""

    def __init__(self) -> None:
        self.chunks: list[ScoredChunk] = []

    def seed(self, entries: list[tuple[str, str, dict]]) -> None:
        self.chunks = [
            ScoredChunk(chunk_id=cid, text=text, score=0.0, metadata=meta)
            for cid, text, meta in entries
        ]

    def count(self) -> int:
        return len(self.chunks)

    def similarity_search(self, query: str, k: int) -> list[ScoredChunk]:
        """Score by naive token overlap — deterministic and dependency-free."""
        terms = {t for t in query.lower().split() if len(t) > 2}
        scored: list[ScoredChunk] = []
        for chunk in self.chunks:
            words = set(chunk.text.lower().split())
            overlap = len(terms & words) / max(1, len(terms))
            scored.append(
                ScoredChunk(
                    chunk_id=chunk.chunk_id,
                    text=chunk.text,
                    score=min(0.99, 0.35 + overlap * 0.6),
                    metadata=chunk.metadata,
                )
            )
        scored.sort(key=lambda c: c.score, reverse=True)
        return scored[:k]

    def get_corpus(self) -> list[tuple[str, str, dict]]:
        return [(c.chunk_id, c.text, c.metadata) for c in self.chunks]


@pytest.fixture(scope="session", autouse=True)
def _database() -> Iterator[None]:
    database.init_db()
    yield
    database.close_db()


@pytest.fixture(autouse=True)
def _isolate_tables() -> Iterator[None]:
    """Truncate between tests so one test's payments cannot leak into another."""
    yield
    conn = database.get_connection()
    for table in (
        "credit_ledger",
        "payments",
        "challenges",
        "messages",
        "conversations",
        "query_log",
        "documents",
        "agents",
    ):
        conn.execute(f"DELETE FROM {table}")


@pytest.fixture
def fake_store(monkeypatch: pytest.MonkeyPatch) -> FakeVectorStore:
    store = FakeVectorStore()
    store.seed(
        [
            (
                "doc_a::0",
                "Stellar Consensus Protocol. Stellar uses federated Byzantine "
                "agreement. A new ledger closes approximately every 5 seconds and "
                "transactions are final immediately.",
                {"document_id": "doc_a", "title": "Stellar Network", "section": "Consensus", "page": 0},
            ),
            (
                "doc_b::0",
                "Why the memo matters. A unique memo binds a payment to its "
                "challenge so the server can attribute settlement to the right agent.",
                {"document_id": "doc_b", "title": "x402 Protocol", "section": "Memos", "page": 0},
            ),
            (
                "doc_b::1",
                "Replay protection. A transaction hash is public once it settles, so "
                "redeemed hashes must be recorded durably and rejected on reuse.",
                {"document_id": "doc_b", "title": "x402 Protocol", "section": "Replay", "page": 0},
            ),
        ]
    )

    for module in (vector_store,):
        monkeypatch.setattr(module, "count", store.count)
        monkeypatch.setattr(module, "similarity_search", store.similarity_search)
        monkeypatch.setattr(module, "get_corpus", store.get_corpus)

    from app.services import retrieval

    monkeypatch.setattr(retrieval.vector_store, "count", store.count)
    monkeypatch.setattr(retrieval.vector_store, "similarity_search", store.similarity_search)
    monkeypatch.setattr(retrieval.vector_store, "get_corpus", store.get_corpus)
    return store


@pytest.fixture
def fake_llm(monkeypatch: pytest.MonkeyPatch) -> None:
    """Deterministic generation that behaves like a well-behaved model."""
    answer = (
        "Stellar closes a ledger roughly every five seconds [1]. "
        "A memo binds the payment to its challenge [2].\n"
        f"{generation.FOLLOW_UP_SENTINEL}\n"
        "- What is a quorum slice?\n"
        "- How are replays prevented?\n"
        "- What does a ledger close mean?"
    )
    monkeypatch.setattr(generation, "complete", lambda system, user: answer)
    monkeypatch.setattr(
        generation,
        "stream_completion",
        lambda system, user: iter([answer[i : i + 12] for i in range(0, len(answer), 12)]),
    )


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def paid_agent(client: TestClient) -> dict[str, str]:
    """An agent that has settled a sandbox payment and holds a live token."""
    agent_id = "agent_test_paid"
    client.post("/api/v1/payments/challenge", json={"agent_id": agent_id})
    response = client.post(
        "/api/v1/payments/verify",
        json={"transaction_hash": "sandbox_test_00000001", "agent_id": agent_id},
    )
    assert response.status_code == 200, response.text
    return {"agent_id": agent_id, "token": response.json()["access_token"]}
