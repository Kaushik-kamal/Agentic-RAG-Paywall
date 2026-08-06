"""Retrieval, grounding, citations, and the billing behaviour around them."""

from __future__ import annotations

import json

from fastapi.testclient import TestClient

from app.db import repository as repo
from app.services import generation, retrieval
from app.services.chunking import chunk_document
from app.services.loaders import LoadedDocument, LoadedPage


class TestChunking:
    def _document(self, text: str) -> LoadedDocument:
        return LoadedDocument(
            title="Test", pages=[LoadedPage(page=1, text=text)], media_type="text/markdown"
        )

    def test_headings_become_breadcrumbs(self):
        chunks = chunk_document(
            self._document(
                "# Stellar\n\n## Consensus\n\nFederated Byzantine agreement.\n\n"
                "## Fees\n\nThe base fee is 100 stroops."
            )
        )
        sections = {chunk.section for chunk in chunks}
        assert "Stellar › Consensus" in sections
        assert "Stellar › Fees" in sections

    def test_breadcrumb_is_embedded_in_the_chunk_text(self):
        chunks = chunk_document(self._document("# Doc\n\n## Part\n\nBody text here."))
        assert chunks[0].text.startswith("Doc › Part")

    def test_oversized_paragraphs_split_on_sentences(self):
        sentence = "This sentence carries a complete thought about consensus. "
        chunks = chunk_document(
            self._document(f"# Long\n\n{sentence * 60}"), chunk_size=400, chunk_overlap=60
        )
        assert len(chunks) > 1
        # No chunk should end mid-word.
        for chunk in chunks:
            assert not chunk.text.rstrip().endswith(("consensu", "abou"))

    def test_empty_input_yields_no_chunks(self):
        assert chunk_document(self._document("")) == []


class TestRetrieval:
    def test_hybrid_search_returns_ranked_candidates(self, fake_store):
        result = retrieval.retrieve("memo binds payment to challenge", top_k=3)
        assert not result.is_empty
        assert result.chunks[0].score > 0
        assert result.trace["strategy"] == "hybrid"
        assert result.trace["dense_candidates"] > 0

    def test_every_candidate_is_traced(self, fake_store):
        result = retrieval.retrieve("replay protection transaction hash", top_k=2)
        assert len(result.candidates) >= len(result.chunks)
        selected = [c for c in result.candidates if c.selected]
        assert len(selected) == len(result.chunks)
        # Anything not selected must explain itself.
        for candidate in result.candidates:
            if not candidate.selected:
                assert candidate.rejected_reason

    def test_document_filter_is_honoured(self, fake_store):
        result = retrieval.retrieve("consensus ledger", top_k=5, document_ids=["doc_a"])
        assert {chunk.document_id for chunk in result.chunks} == {"doc_a"}

    def test_empty_index_returns_empty_result(self, fake_store):
        fake_store.seed([])
        result = retrieval.retrieve("anything")
        assert result.is_empty
        assert result.trace["corpus_chunks"] == 0


class TestGeneration:
    def _citations(self) -> list[generation.Citation]:
        return [
            generation.Citation(
                marker=index,
                chunk_id=f"c{index}",
                document_id="doc",
                document_title="Doc",
                locator=f"Doc › Section {index}",
                section=f"Section {index}",
                page=None,
                score=score,
                text="Full passage text used for the prompt.",
                snippet="Full passage text used for the prompt.",
            )
            for index, score in enumerate([0.9, 0.6, 0.4], start=1)
        ]

    def test_context_is_numbered_and_carries_full_text(self):
        context = generation.build_context(self._citations())
        assert "[1] SOURCE: Doc › Section 1" in context
        assert "Full passage text used for the prompt." in context

    def test_used_citations_are_detected(self):
        citations = self._citations()
        used = generation.mark_used_citations("A claim [1] and another [3].", citations)
        assert used == [1, 3]
        assert [c.used for c in citations] == [True, False, True]

    def test_follow_ups_are_split_from_the_answer(self):
        raw = (
            f"The answer body.\n{generation.FOLLOW_UP_SENTINEL}\n"
            "- First question?\n- Second question?\n- Third question?"
        )
        answer, follow_ups = generation.split_answer(raw)
        assert answer == "The answer body."
        assert len(follow_ups) == 3
        assert all(question.endswith("?") for question in follow_ups)

    def test_splitter_handles_a_sentinel_torn_across_chunks(self):
        splitter = generation.FollowUpSplitter()
        pieces = ["Answer text.", "<<<FOLL", "OW_UP>>>", "\n- A question?"]
        emitted = "".join(splitter.push(piece) for piece in pieces)
        assert emitted.strip() == "Answer text."
        assert splitter.follow_ups == ["A question?"]

    def test_refusal_collapses_confidence(self):
        confidence = generation.score_confidence(
            "The provided context does not contain information about that.",
            self._citations(),
            top_score=0.9,
            mean_score=0.7,
        )
        assert confidence.score < 0.2
        assert confidence.label == "No answer in sources"

    def test_well_cited_answer_scores_high(self):
        citations = self._citations()
        answer = "Claim one is supported [1]. Claim two follows from it [2]."
        generation.mark_used_citations(answer, citations)
        confidence = generation.score_confidence(
            answer, citations, top_score=0.92, mean_score=0.75
        )
        assert confidence.score > 0.7
        assert "High" in confidence.label

    def test_uncited_answer_is_penalised(self):
        citations = self._citations()
        answer = "This is a confident claim with no citation attached to it at all."
        generation.mark_used_citations(answer, citations)
        confidence = generation.score_confidence(
            answer, citations, top_score=0.9, mean_score=0.7
        )
        assert confidence.score < 0.55


class TestQueryEndpoint:
    def test_paid_query_returns_grounded_answer(
        self, client: TestClient, paid_agent, fake_store, fake_llm
    ):
        before = repo.get_credits(paid_agent["agent_id"])

        response = client.post(
            "/api/v1/rag/query",
            json={
                "query": "How long does a Stellar ledger take to close?",
                "agent_id": paid_agent["agent_id"],
            },
            headers={"Authorization": f"Bearer {paid_agent['token']}"},
        )
        assert response.status_code == 200

        body = response.json()
        assert body["answer"]
        assert body["citations"]
        assert body["confidence"]["percent"] > 0
        assert body["follow_ups"]
        assert body["credits_remaining"] == before - 1

    def test_streaming_emits_the_full_event_sequence(
        self, client: TestClient, paid_agent, fake_store, fake_llm
    ):
        with client.stream(
            "POST",
            "/api/v1/rag/stream",
            json={"query": "Why does the memo matter?", "agent_id": paid_agent["agent_id"]},
            headers={"Authorization": f"Bearer {paid_agent['token']}"},
        ) as response:
            assert response.status_code == 200
            events: list[str] = []
            payloads: dict[str, dict] = {}
            current = ""
            for line in response.iter_lines():
                if line.startswith("event:"):
                    current = line[6:].strip()
                    events.append(current)
                elif line.startswith("data:"):
                    payloads[current] = json.loads(line[5:].strip())

        assert events[0] == "start"
        assert "retrieval" in events
        assert "token" in events
        assert events[-1] == "done"
        assert payloads["done"]["answer"]
        assert payloads["done"]["citations"]

    def test_failed_generation_refunds_the_credit(
        self, client: TestClient, paid_agent, fake_store, monkeypatch
    ):
        from app.core.errors import ServiceUnavailableError

        def explode(system: str, user: str) -> str:
            raise ServiceUnavailableError("Model is down")

        monkeypatch.setattr(generation, "complete", explode)
        before = repo.get_credits(paid_agent["agent_id"])

        response = client.post(
            "/api/v1/rag/query",
            json={"query": "Anything at all", "agent_id": paid_agent["agent_id"]},
            headers={"Authorization": f"Bearer {paid_agent['token']}"},
        )
        assert response.status_code == 503
        assert repo.get_credits(paid_agent["agent_id"]) == before

    def test_empty_knowledge_base_returns_409_and_refunds(
        self, client: TestClient, paid_agent, fake_store, fake_llm
    ):
        fake_store.seed([])
        before = repo.get_credits(paid_agent["agent_id"])

        response = client.post(
            "/api/v1/rag/query",
            json={"query": "Anything at all", "agent_id": paid_agent["agent_id"]},
            headers={"Authorization": f"Bearer {paid_agent['token']}"},
        )
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "knowledge_base_empty"
        assert repo.get_credits(paid_agent["agent_id"]) == before

    def test_search_is_free_and_needs_no_token(self, client: TestClient, fake_store):
        before_agents = repo.agent_totals()["total_agents"]
        response = client.post(
            "/api/v1/rag/search", json={"query": "consensus protocol", "top_k": 2}
        )
        assert response.status_code == 200
        assert response.json()["matches"]
        assert repo.agent_totals()["total_agents"] == before_agents

    def test_blank_query_is_rejected_before_billing(
        self, client: TestClient, paid_agent
    ):
        before = repo.get_credits(paid_agent["agent_id"])
        response = client.post(
            "/api/v1/rag/query",
            json={"query": "   ", "agent_id": paid_agent["agent_id"]},
            headers={"Authorization": f"Bearer {paid_agent['token']}"},
        )
        assert response.status_code == 422
        assert repo.get_credits(paid_agent["agent_id"]) == before

    def test_conversation_history_is_persisted(
        self, client: TestClient, paid_agent, fake_store, fake_llm
    ):
        response = client.post(
            "/api/v1/rag/query",
            json={
                "query": "How long does a ledger take to close?",
                "agent_id": paid_agent["agent_id"],
                "remember": True,
            },
            headers={"Authorization": f"Bearer {paid_agent['token']}"},
        )
        conversation_id = response.json()["conversation_id"]
        assert conversation_id

        stored = client.get(f"/api/v1/conversations/{conversation_id}")
        assert stored.status_code == 200
        messages = stored.json()["messages"]
        assert [message["role"] for message in messages] == ["user", "assistant"]
        assert messages[1]["citations"]
