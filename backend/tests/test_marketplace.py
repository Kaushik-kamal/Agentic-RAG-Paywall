"""The Agent Discovery Network: registry, reputation, and routing."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.db import repository as repo
from app.services import registry, reputation, router_agent

#: Mentions the expert's distinctive phrase ("liability cap") *and* the token
#: both legal providers share ("contract"), so the expert must win on evidence
#: rather than on the query being trivially unambiguous.
CONTRACT_QUERY = "Can I limit exposure with a liability cap in this contract?"


@pytest.fixture
def network(monkeypatch: pytest.MonkeyPatch) -> list[dict]:
    """A three-provider network with deliberately conflicting incentives.

    ``budget`` is cheapest and fastest but knows nothing; ``expert`` is the most
    expensive and slowest but owns the domain. A correct router prefers the
    expert, which is the property most worth pinning down.
    """
    # Routing must not depend on the embedding API in tests.
    monkeypatch.setattr(router_agent, "warm_provider_vectors", lambda providers: None)
    monkeypatch.setattr(router_agent, "_provider_vector", lambda provider: None)
    monkeypatch.setattr(
        router_agent, "embed_query", lambda text: (_ for _ in ()).throw(RuntimeError())
    )

    registry.register_provider(
        slug="expert",
        name="Domain Expert AI",
        tagline="Deep in one field",
        description="Answers contract law questions.",
        category="Legal",
        capabilities=["contract-law"],
        keywords=["contract", "indemnity", "liability cap"],
        scope_documents=["doc_a"],
        price_xlm=0.05,
        credits_per_call=5,
        target_latency_ms=3000,
    )
    registry.register_provider(
        slug="budget",
        name="Budget Generalist AI",
        tagline="Cheap and quick",
        description="Answers general questions.",
        category="General",
        capabilities=["general"],
        keywords=["question", "help"],
        scope_documents=["doc_b"],
        price_xlm=0.001,
        credits_per_call=1,
        target_latency_ms=200,
    )
    registry.register_provider(
        slug="middling",
        name="Middling AI",
        tagline="Somewhere between",
        description="Answers some contract questions.",
        category="Legal",
        capabilities=["contract-law"],
        keywords=["contract", "agreement"],
        scope_documents=["doc_c"],
        price_xlm=0.02,
        credits_per_call=2,
        target_latency_ms=1500,
    )
    return registry.list_providers()


class TestRegistry:
    def test_registration_is_idempotent(self, network):
        before = len(registry.list_providers())
        registry.register_provider(
            slug="expert",
            name="Duplicate",
            tagline="x",
            description="y",
            category="Legal",
            capabilities=["a"],
            keywords=["b"],
            scope_documents=[],
            price_xlm=1,
            credits_per_call=1,
            target_latency_ms=100,
        )
        assert len(registry.list_providers()) == before

    def test_registry_is_open_to_new_services(self, client: TestClient):
        response = client.post(
            "/api/v1/marketplace/providers",
            headers={"X-Admin-Key": "test-admin-key"},
            json={
                "slug": "newcomer",
                "name": "Newcomer AI",
                "tagline": "Just listed",
                "description": "A third-party service joining the network.",
                "category": "Research",
                "capabilities": ["analysis"],
                "keywords": ["newcomer"],
                "scope_documents": [],
                "price_xlm": 0.02,
                "credits_per_call": 2,
                "target_latency_ms": 1500,
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body["slug"] == "newcomer"
        # Listed services are immediately rankable.
        assert body["reputation"]["observations"] == 0

    def test_registration_requires_admin(self, client: TestClient):
        response = client.post(
            "/api/v1/marketplace/providers",
            json={
                "slug": "sneaky",
                "name": "Sneaky AI",
                "tagline": "No key",
                "description": "Should be refused.",
                "category": "X",
                "capabilities": ["a"],
                "keywords": ["b"],
                "price_xlm": 0.01,
                "credits_per_call": 1,
                "target_latency_ms": 100,
            },
        )
        assert response.status_code == 403

    def test_outcomes_move_the_counters(self, network):
        provider = registry.get_provider("expert")
        registry.record_outcome(
            provider["provider_id"],
            agent_id="agent_x",
            query="q",
            status="success",
            latency_ms=1200,
            cost_xlm=0.05,
            confidence=0.9,
        )
        registry.record_outcome(
            provider["provider_id"],
            agent_id="agent_x",
            query="q",
            status="failed",
            latency_ms=800,
            cost_xlm=0.0,
            confidence=None,
        )
        refreshed = registry.get_provider("expert")["stats"]
        assert refreshed["total_requests"] == 2
        assert refreshed["successful"] == 1
        assert refreshed["failed"] == 1
        assert refreshed["reliability"] == 0.5
        assert refreshed["revenue_xlm"] == 0.05


class TestReputation:
    def test_a_single_success_does_not_imply_perfection(self, network):
        provider = registry.get_provider("expert")
        registry.record_outcome(
            provider["provider_id"],
            agent_id="a",
            query="q",
            status="success",
            latency_ms=1000,
            cost_xlm=0.05,
            confidence=0.9,
        )
        score = reputation.score_provider(registry.get_provider("expert"))
        assert score["components"]["reliability"] < 1.0
        assert score["unproven"] is True

    def test_reputation_rises_with_sustained_success(self, network):
        provider = registry.get_provider("expert")
        first = reputation.score_provider(provider)["trust"]
        for _ in range(12):
            registry.record_outcome(
                provider["provider_id"],
                agent_id="a",
                query="q",
                status="success",
                latency_ms=900,
                cost_xlm=0.05,
                confidence=0.9,
            )
        after = reputation.score_provider(registry.get_provider("expert"))["trust"]
        assert after > first
        assert reputation.score_provider(registry.get_provider("expert"))["unproven"] is False

    def test_failures_pull_reputation_down(self, network):
        provider = registry.get_provider("expert")
        for _ in range(6):
            registry.record_outcome(
                provider["provider_id"],
                agent_id="a",
                query="q",
                status="success",
                latency_ms=900,
                cost_xlm=0.05,
                confidence=0.9,
            )
        healthy = reputation.score_provider(registry.get_provider("expert"))["trust"]
        for _ in range(6):
            registry.record_outcome(
                provider["provider_id"],
                agent_id="a",
                query="q",
                status="failed",
                latency_ms=0,
                cost_xlm=0.0,
                confidence=None,
            )
        degraded = reputation.score_provider(registry.get_provider("expert"))["trust"]
        assert degraded < healthy

    def test_history_replays_the_ledger(self, network):
        provider = registry.get_provider("expert")
        for _ in range(5):
            registry.record_outcome(
                provider["provider_id"],
                agent_id="a",
                query="q",
                status="success",
                latency_ms=900,
                cost_xlm=0.05,
                confidence=0.85,
            )
        series = reputation.history(provider["provider_id"])
        assert len(series) == 5
        # The last point must equal the live score, or the chart lies.
        live = reputation.score_provider(registry.get_provider("expert"))["trust"]
        assert abs(series[-1]["trust"] - live) < 0.001


class TestRouting:
    def test_domain_expert_beats_cheap_generalist(self, network):
        decision = router_agent.discover(
            CONTRACT_QUERY, objective="balanced"
        )
        assert decision.chosen is not None
        # The cheapest, fastest provider must not win on price alone.
        assert decision.chosen.provider["slug"] == "expert"

    def test_capability_gate_excludes_the_unqualified(self, network):
        decision = router_agent.discover("Explain the indemnity clause")
        excluded = [c for c in decision.candidates if not c.eligible]
        assert any(c.provider["slug"] == "budget" for c in excluded)
        assert all(c.reason for c in excluded)

    def test_cheapest_objective_still_respects_capability(self, network):
        decision = router_agent.discover(
            CONTRACT_QUERY, objective="cheapest"
        )
        # 'budget' is 50x cheaper but cannot answer — it must stay excluded.
        assert decision.chosen is not None
        assert decision.chosen.provider["slug"] != "budget"

    def test_objective_changes_the_ranking(self, network):
        balanced = router_agent.discover("A contract question", objective="balanced")
        cheapest = router_agent.discover("A contract question", objective="cheapest")
        assert balanced.weights != cheapest.weights
        assert balanced.objective == "balanced"

    def test_rationale_matches_the_decision(self, network):
        decision = router_agent.discover(CONTRACT_QUERY)
        assert decision.chosen is not None
        assert decision.chosen.provider["name"] in decision.rationale
        assert decision.tradeoffs

    def test_no_capable_provider_declines_rather_than_guessing(self, network):
        decision = router_agent.discover(
            "zzz qqq xyzzy plugh frobnicate", objective="balanced"
        )
        # Nothing matches; the agent must not route to the closest guess.
        if decision.chosen is not None:
            assert decision.chosen.capability >= router_agent.CAPABILITY_FLOOR

    def test_decisions_are_recorded(self, network):
        router_agent.discover(CONTRACT_QUERY)
        recent = router_agent.recent_decisions(5)
        assert recent
        assert recent[0]["considered"] == 3


class TestMarketplaceApi:
    def test_provider_listing_carries_reputation(self, client: TestClient, network):
        body = client.get("/api/v1/marketplace/providers").json()
        assert body["total"] == 3
        assert all("reputation" in p for p in body["providers"])
        assert all("trust" in p["reputation"] for p in body["providers"])

    def test_discovery_is_free_and_unauthenticated(
        self, client: TestClient, network
    ):
        before = repo.agent_totals()["total_agents"]
        response = client.post(
            "/api/v1/marketplace/discover",
            json={"query": CONTRACT_QUERY, "objective": "balanced"},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["chosen"]["slug"] == "expert"
        assert body["considered"] == 3
        assert repo.agent_totals()["total_agents"] == before

    def test_network_stats_shape(self, client: TestClient, network):
        body = client.get("/api/v1/marketplace/stats").json()
        assert body["providers_total"] == 3
        assert body["providers_online"] == 3
        assert "leaderboard" in body
        assert set(body["leaderboard"]) >= {"most_trusted", "cheapest", "fastest"}

    def test_offline_providers_are_not_routed_to(
        self, client: TestClient, network
    ):
        client.post(
            "/api/v1/marketplace/providers/expert/status?status=offline",
            headers={"X-Admin-Key": "test-admin-key"},
        )
        decision = router_agent.discover(CONTRACT_QUERY)
        offline = next(
            c for c in decision.candidates if c.provider["slug"] == "expert"
        )
        assert offline.eligible is False
        assert offline.reason == "offline"

    def test_spending_power_reflects_provider_prices(
        self, client: TestClient, network
    ):
        body = client.get("/api/v1/marketplace/balance/agent_poor").json()
        # A fresh agent holds 3 trial credits, so the 5-credit expert is out of reach.
        assert body["credits"] == 3
        assert "expert" in body["locked_out"]
        assert "budget" in body["affordable_providers"]

    def test_unknown_provider_returns_404(self, client: TestClient):
        assert client.get("/api/v1/marketplace/providers/ghost").status_code == 404
