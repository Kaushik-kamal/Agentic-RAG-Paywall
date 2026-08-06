"""System endpoints, document management, validation, and error shape."""

from __future__ import annotations

import io

from fastapi.testclient import TestClient


class TestSystem:
    def test_health_reports_every_component(self, client: TestClient):
        response = client.get("/api/v1/health")
        assert response.status_code == 200

        body = response.json()
        assert body["status"] in {"ok", "degraded"}
        assert {"api", "database", "vector_store", "gemini", "stellar"} <= set(
            body["components"]
        )

    def test_public_config_never_leaks_secrets(self, client: TestClient):
        raw = client.get("/api/v1/config").text.lower()
        for secret in ("secret_key", "api_key", "stellar_secret", "admin_api_key"):
            assert secret not in raw

    def test_stats_and_analytics_are_shaped_for_the_dashboard(self, client: TestClient):
        stats = client.get("/api/v1/stats").json()
        assert {"total_queries", "total_revenue_xlm", "indexed_vectors"} <= set(stats)

        analytics = client.get("/api/v1/analytics?days=7").json()
        assert len(analytics["queries_by_day"]) == 7
        assert "totals" in analytics

    def test_liveness_probe(self, client: TestClient):
        assert client.get("/health").json()["status"] == "ok"

    def test_every_response_carries_a_request_id(self, client: TestClient):
        response = client.get("/api/v1/stats")
        assert response.headers["X-Request-Id"]
        assert float(response.headers["X-Response-Time-Ms"]) >= 0


class TestErrorEnvelope:
    def test_not_found_uses_the_standard_shape(self, client: TestClient):
        body = client.get("/api/v1/agents/agent_does_not_exist").json()
        assert body["error"]["code"] == "not_found"
        assert body["error"]["message"]
        assert body["request_id"]

    def test_validation_errors_name_the_offending_field(self, client: TestClient):
        response = client.post("/api/v1/payments/challenge", json={"agent_id": "!!"})
        assert response.status_code == 422
        body = response.json()["error"]
        assert body["code"] == "validation_error"
        assert body["details"]["fields"][0]["field"] == "agent_id"

    def test_unknown_fields_are_rejected(self, client: TestClient):
        response = client.post(
            "/api/v1/payments/challenge",
            json={"agent_id": "agent_ok", "credits": 1_000_000},
        )
        assert response.status_code == 422


class TestDocuments:
    def _upload(self, client: TestClient, name: str, body: bytes):
        return client.post(
            "/api/v1/documents",
            files={"file": (name, io.BytesIO(body), "text/markdown")},
            headers={"X-Admin-Key": "test-admin-key"},
        )

    def test_admin_key_is_required(self, client: TestClient):
        response = client.post(
            "/api/v1/documents",
            files={"file": ("a.md", io.BytesIO(b"# Title\n\nBody."), "text/markdown")},
        )
        assert response.status_code == 403

    def test_unsupported_extension_is_rejected(self, client: TestClient):
        response = self._upload(client, "malware.exe", b"MZ\x90\x00")
        assert response.status_code == 422
        assert "supported_extensions" in response.json()["error"]["details"]

    def test_empty_file_is_rejected(self, client: TestClient):
        assert self._upload(client, "empty.md", b"").status_code == 422

    def test_directory_traversal_in_filename_is_neutralised(
        self, client: TestClient, monkeypatch
    ):
        from app.api.endpoints.documents import _safe_filename

        assert _safe_filename("../../../etc/passwd.md") == "etc_passwd.md" or "/" not in (
            _safe_filename("../../../etc/passwd.md")
        )
        assert "\\" not in _safe_filename("..\\..\\windows\\system32\\a.md")

    def test_listing_reports_limits_and_supported_types(self, client: TestClient):
        body = client.get("/api/v1/documents").json()
        assert isinstance(body["documents"], list)
        assert body["max_upload_mb"] > 0
        assert ".pdf" in body["supported_extensions"]

    def test_deleting_a_missing_document_returns_404(self, client: TestClient):
        response = client.delete(
            "/api/v1/documents/doc_missing", headers={"X-Admin-Key": "test-admin-key"}
        )
        assert response.status_code == 404


class TestAgents:
    def test_registration_returns_a_usable_token(self, client: TestClient):
        response = client.post(
            "/api/v1/agents/register",
            json={"name": "Research Bot", "description": "Reads papers"},
        )
        assert response.status_code == 200

        body = response.json()
        assert body["access_token"].startswith("argp.")
        assert body["free_credits"] == 3
        assert body["agent"]["agent_id"].startswith("agent_")

    def test_usage_includes_ledger_and_payments(self, client: TestClient, paid_agent):
        body = client.get(f"/api/v1/agents/{paid_agent['agent_id']}/usage").json()
        assert body["credits_remaining"] > 0
        assert body["ledger"]
        assert body["payments"]

    def test_token_refresh_does_not_change_the_balance(
        self, client: TestClient, paid_agent
    ):
        before = client.get(f"/api/v1/payments/balance/{paid_agent['agent_id']}").json()
        minted = client.post(f"/api/v1/agents/{paid_agent['agent_id']}/token").json()
        assert minted["credits"] == before["credits"]


class TestConfigurationHardening:
    def test_insecure_secret_keys_are_replaced(self):
        from app.core.config import Settings

        for placeholder in ("", "change-me-in-production", "secret"):
            settings = Settings(secret_key=placeholder)
            assert settings.secret_key not in {placeholder, ""}
            assert len(settings.secret_key) >= 32

    def test_production_refuses_sandbox_payments(self):
        from app.core.config import Settings

        settings = Settings(
            environment="production",
            stellar_public_key="GTEST",
            admin_api_key="key",
            x402_sandbox_mode=True,
            debug=True,
        )
        assert settings.x402_sandbox_mode is False
        assert settings.debug is False

    def test_production_requires_a_treasury_account(self, monkeypatch):
        import pytest

        from app.core.config import Settings

        # The test process exports a treasury key; production must fail without one.
        monkeypatch.delenv("STELLAR_PUBLIC_KEY", raising=False)

        with pytest.raises(ValueError, match="STELLAR_PUBLIC_KEY"):
            Settings(environment="production", admin_api_key="key", _env_file=None)
