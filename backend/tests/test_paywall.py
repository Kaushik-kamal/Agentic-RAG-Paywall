"""The paywall is the product. These tests pin its economics down."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.core.security import create_access_token, decode_access_token
from app.db import repository as repo


class TestChallenge:
    def test_unpaid_query_returns_402_with_instructions(self, client: TestClient):
        response = client.post(
            "/api/v1/rag/query",
            json={"query": "How does consensus work?", "agent_id": "agent_anon_1"},
        )
        assert response.status_code == 402

        body = response.json()["error"]["details"]
        assert body["amount_xlm"] > 0
        assert body["memo"].startswith("x402-")
        assert body["challenge_id"]

        # Machine-readable in headers too, so an agent needn't parse the body.
        assert response.headers["X-Payment-Amount"] == str(body["amount_xlm"])
        assert response.headers["X-Payment-Memo"] == body["memo"]
        assert response.headers["X-Payment-Asset"] == "XLM"

    def test_challenge_is_reused_until_it_expires(self, client: TestClient):
        first = client.post(
            "/api/v1/payments/challenge", json={"agent_id": "agent_reuse"}
        ).json()
        second = client.post(
            "/api/v1/payments/challenge", json={"agent_id": "agent_reuse"}
        ).json()
        assert first["challenge_id"] == second["challenge_id"]

    def test_each_agent_gets_its_own_memo(self, client: TestClient):
        a = client.post("/api/v1/payments/challenge", json={"agent_id": "agent_a"}).json()
        b = client.post("/api/v1/payments/challenge", json={"agent_id": "agent_b"}).json()
        assert a["memo"] != b["memo"]


class TestVerification:
    def test_sandbox_payment_grants_credits(self, client: TestClient):
        response = client.post(
            "/api/v1/payments/verify",
            json={"transaction_hash": "sandbox_abc12345", "agent_id": "agent_pay_1"},
        )
        assert response.status_code == 200

        body = response.json()
        assert body["verified"] is True
        assert body["mode"] == "sandbox"
        assert body["credits_granted"] == 10
        assert body["access_token"].startswith("argp.")

    def test_replayed_transaction_is_rejected(self, client: TestClient):
        payload = {"transaction_hash": "sandbox_replay_01", "agent_id": "agent_pay_2"}
        assert client.post("/api/v1/payments/verify", json=payload).status_code == 200

        second = client.post("/api/v1/payments/verify", json=payload)
        assert second.status_code == 400
        assert second.json()["error"]["details"]["code"] == "replay_detected"

    def test_challenge_belonging_to_another_agent_is_rejected(self, client: TestClient):
        challenge = client.post(
            "/api/v1/payments/challenge", json={"agent_id": "agent_owner"}
        ).json()

        response = client.post(
            "/api/v1/payments/verify",
            json={
                "transaction_hash": "sandbox_wrong_owner",
                "agent_id": "agent_thief",
                "challenge_id": challenge["challenge_id"],
            },
        )
        assert response.status_code == 400
        assert "different agent" in response.json()["error"]["message"]

    def test_malformed_sandbox_hash_is_rejected(self, client: TestClient):
        response = client.post(
            "/api/v1/payments/verify",
            json={"transaction_hash": "sandbox_x", "agent_id": "agent_pay_3"},
        )
        assert response.status_code == 400

    def test_overpayment_buys_proportionally_more_credits(self):
        from app.services.stellar_service import stellar_service

        assert stellar_service._credits_for(0.01) == 10
        assert stellar_service._credits_for(0.05) == 50
        assert stellar_service._credits_for(0.009) == 10  # never fewer than a bundle


class TestCredits:
    def test_new_agent_receives_trial_credits(self, client: TestClient):
        response = client.get("/api/v1/payments/balance/agent_fresh")
        assert response.status_code == 200
        assert response.json()["credits"] == 3

    def test_credit_debit_is_atomic_and_bounded(self):
        repo.get_or_create_agent("agent_ledger")
        repo.grant_credits("agent_ledger", 2, reason="test")
        start = repo.get_credits("agent_ledger")

        for expected in range(start - 1, -1, -1):
            assert repo.consume_credit("agent_ledger") == expected

        # The balance can never go negative, even under repeated pressure.
        assert repo.consume_credit("agent_ledger") is None
        assert repo.get_credits("agent_ledger") == 0

    def test_ledger_records_every_movement(self):
        repo.get_or_create_agent("agent_audit")
        repo.grant_credits("agent_audit", 5, reason="x402_payment_sandbox")
        repo.consume_credit("agent_audit")

        entries = repo.list_ledger("agent_audit")
        assert [entry["delta"] for entry in entries[:2]] == [-1, 5]
        assert entries[0]["balance_after"] == entries[1]["balance_after"] - 1

    def test_exhausted_balance_returns_402_not_500(
        self, client: TestClient, fake_store, fake_llm
    ):
        agent_id = "agent_broke"
        repo.get_or_create_agent(agent_id)
        while repo.consume_credit(agent_id) is not None:
            pass

        token, _ = create_access_token(agent_id)
        response = client.post(
            "/api/v1/rag/query",
            json={"query": "How does consensus work?", "agent_id": agent_id},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 402
        assert response.json()["error"]["code"] == "insufficient_credits"


class TestTokens:
    def test_round_trip(self):
        token, claims = create_access_token("agent_token_1")
        decoded = decode_access_token(token)
        assert decoded is not None
        assert decoded.agent_id == "agent_token_1"
        assert decoded.token_id == claims.token_id

    @pytest.mark.parametrize(
        "token",
        [
            "",
            "not-a-token",
            "argp.abc",
            "argp.eyJhaWQiOiJhIn0.badsignature",
            "wrongprefix.eyJhaWQiOiJhIn0.sig",
        ],
    )
    def test_malformed_tokens_are_refused(self, token: str):
        assert decode_access_token(token) is None

    def test_tampered_payload_fails_signature_check(self):
        token, _ = create_access_token("agent_victim")
        prefix, payload, signature = token.split(".")
        forged = f"{prefix}.{payload[:-4]}AAAA.{signature}"
        assert decode_access_token(forged) is None

    def test_expired_token_is_refused(self):
        token, _ = create_access_token("agent_expired", expires_in_minutes=1)
        import time
        from unittest.mock import patch

        with patch.object(time, "time", return_value=time.time() + 120):
            assert decode_access_token(token) is None

    def test_query_with_invalid_token_returns_401(self, client: TestClient):
        response = client.post(
            "/api/v1/rag/query",
            json={"query": "Anything at all", "agent_id": "agent_x"},
            headers={"Authorization": "Bearer argp.forged.signature"},
        )
        assert response.status_code == 401
