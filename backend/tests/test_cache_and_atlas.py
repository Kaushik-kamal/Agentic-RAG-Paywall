"""Semantic answer cache and the corpus atlas projection."""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.db import repository as repo
from app.services import answer_cache, atlas


@pytest.fixture
def fake_embeddings(monkeypatch: pytest.MonkeyPatch):
    """Deterministic 8-dimensional embeddings driven by token overlap.

    Real vectors would need network access; these preserve the only property
    the cache and the atlas care about — similar text, similar vector.
    """
    vocabulary = [
        "stellar",
        "ledger",
        "close",
        "memo",
        "payment",
        "replay",
        "credit",
        "chunk",
    ]

    def embed(text: str) -> list[float]:
        words = set(text.lower().replace("?", "").split())
        vector = np.array(
            [1.0 if term in words else 0.0 for term in vocabulary], dtype=np.float32
        )
        if not vector.any():
            vector = np.full(len(vocabulary), 0.1, dtype=np.float32)
        return (vector / np.linalg.norm(vector)).tolist()

    from app.services import embeddings as embeddings_module
    from app.services import rag_service as rag_module

    monkeypatch.setattr(embeddings_module, "embed_query", embed)
    monkeypatch.setattr(rag_module, "embed_query", embed)
    return embed


class TestAnswerCache:
    def test_paraphrase_hits_the_cache(self, fake_embeddings):
        payload = {"answer": "Roughly five seconds.", "citations": []}
        answer_cache.store(
            "How long does a Stellar ledger take to close?",
            fake_embeddings("how long does a stellar ledger close"),
            payload,
            "rev1",
        )

        hit = answer_cache.lookup(
            fake_embeddings("stellar ledger close time"), "rev1"
        )
        assert hit is not None
        assert hit.similarity >= answer_cache.SIMILARITY_THRESHOLD

        served = hit.payload()
        assert served["cached"] is True
        assert served["cache"]["credits_charged"] == 0
        assert served["cost_xlm"] == 0.0

    def test_unrelated_question_misses(self, fake_embeddings):
        answer_cache.store(
            "ledger close", fake_embeddings("stellar ledger close"), {"answer": "x"}, "rev1"
        )
        assert answer_cache.lookup(fake_embeddings("replay credit chunk"), "rev1") is None

    def test_corpus_change_invalidates_every_entry(self, fake_embeddings):
        vector = fake_embeddings("stellar ledger close")
        answer_cache.store("q", vector, {"answer": "x"}, "rev1")

        # Same question, different corpus revision — the answer could have changed.
        assert answer_cache.lookup(vector, "rev2") is None

    def test_explicit_invalidate_clears_everything(self, fake_embeddings):
        vector = fake_embeddings("stellar ledger close")
        answer_cache.store("q", vector, {"answer": "x"}, "rev1")
        answer_cache.invalidate()
        assert answer_cache.lookup(vector, "rev1") is None

    def test_entries_are_bounded(self, fake_embeddings):
        for index in range(answer_cache.MAX_ENTRIES + 20):
            answer_cache.store(
                f"question {index}",
                fake_embeddings(f"chunk {index}"),
                {"answer": str(index)},
                "rev1",
            )
        assert answer_cache.stats()["entries"] <= answer_cache.MAX_ENTRIES

    def test_cache_hit_costs_no_credit(
        self, client: TestClient, paid_agent, fake_store, fake_llm, fake_embeddings
    ):
        question = "How long does a Stellar ledger take to close?"
        headers = {"Authorization": f"Bearer {paid_agent['token']}"}

        first = client.post(
            "/api/v1/rag/query",
            json={"query": question, "agent_id": paid_agent["agent_id"]},
            headers=headers,
        )
        assert first.status_code == 200
        assert first.json()["cached"] is False
        after_first = repo.get_credits(paid_agent["agent_id"])

        second = client.post(
            "/api/v1/rag/query",
            json={
                "query": "stellar ledger close time",
                "agent_id": paid_agent["agent_id"],
            },
            headers=headers,
        )
        assert second.status_code == 200

        body = second.json()
        assert body["cached"] is True
        assert body["cache"]["credits_charged"] == 0
        # The balance is untouched: a repeat question is not billed twice.
        assert repo.get_credits(paid_agent["agent_id"]) == after_first


class TestAtlas:
    def test_reports_unavailable_when_the_corpus_is_tiny(self, client: TestClient):
        body = client.get("/api/v1/rag/atlas").json()
        assert body["available"] is False
        assert body["points"] == []
        assert "reason" in body

    def test_projection_is_deterministic_and_bounded(self, monkeypatch):
        ids = [f"c{i}" for i in range(12)]
        rng = np.random.default_rng(7)
        vectors = rng.normal(size=(12, 16)).astype(np.float32).tolist()
        metadatas = [
            {"document_id": "doc_a" if i < 6 else "doc_b", "title": "Doc", "_text": "t"}
            for i in range(12)
        ]

        from app.services import vector_store

        monkeypatch.setattr(
            vector_store, "get_embeddings", lambda: (ids, vectors, metadatas)
        )
        monkeypatch.setattr(vector_store, "corpus_revision", lambda: "rev-test")
        monkeypatch.setattr(vector_store, "count", lambda: len(ids))
        atlas.invalidate()

        first = atlas.build_atlas()
        atlas.invalidate()
        second = atlas.build_atlas()

        assert first["available"] is True
        assert len(first["points"]) == 12
        assert first["points"] == second["points"]  # PCA is deterministic
        assert all(-1.001 <= point["x"] <= 1.001 for point in first["points"])
        assert all(-1.001 <= point["y"] <= 1.001 for point in first["points"])
        assert 0 < first["total_variance_explained"] <= 1.0
        assert {d["document_id"] for d in first["documents"]} == {"doc_a", "doc_b"}

    def test_a_query_projects_into_the_same_basis(self, monkeypatch, fake_store):
        """A point near a cluster must land near that cluster, not anywhere."""
        ids = [f"c{i}" for i in range(10)]
        base = np.zeros((10, 8), dtype=np.float32)
        base[:5, 0] = 1.0  # one tight cluster on axis 0
        base[5:, 1] = 1.0  # another on axis 1
        vectors = base.tolist()
        metadatas = [{"document_id": "d", "title": "Doc", "_text": "t"} for _ in ids]

        from app.services import vector_store

        monkeypatch.setattr(
            vector_store, "get_embeddings", lambda: (ids, vectors, metadatas)
        )
        monkeypatch.setattr(vector_store, "corpus_revision", lambda: "rev-basis")
        monkeypatch.setattr(vector_store, "count", lambda: len(ids))
        atlas.invalidate()

        projection = atlas.get_projection()
        assert projection is not None

        cluster_a = projection.project(base[0].tolist())
        cluster_b = projection.project(base[9].tolist())
        # The two clusters must be separated along the principal component.
        assert abs(cluster_a[0] - cluster_b[0]) > 0.5

    def test_project_endpoint_is_free_and_needs_no_token(
        self, client: TestClient, fake_store
    ):
        before = repo.agent_totals()["total_agents"]
        response = client.post(
            "/api/v1/rag/atlas/project",
            json={"query": "consensus protocol", "top_k": 3},
        )
        assert response.status_code == 200
        assert repo.agent_totals()["total_agents"] == before
