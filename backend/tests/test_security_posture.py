"""Security posture: defaults must fail closed, production must refuse to start
without credentials, and knowledge-base mutation must never be anonymous.
"""

from __future__ import annotations

import io

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings


class TestSecureDefaults:
    def test_sandbox_payments_are_off_by_default(self, monkeypatch):
        """A deployment that configures nothing must not mint free credits."""
        monkeypatch.delenv("X402_SANDBOX_MODE", raising=False)
        assert Settings(_env_file=None).x402_sandbox_mode is False

    def test_insecure_admin_is_off_by_default(self, monkeypatch):
        monkeypatch.delenv("ALLOW_INSECURE_ADMIN", raising=False)
        assert Settings(_env_file=None).allow_insecure_admin is False

    def test_development_can_opt_into_sandbox(self):
        settings = Settings(
            environment="development", x402_sandbox_mode=True, _env_file=None
        )
        assert settings.x402_sandbox_mode is True

    def test_development_can_opt_into_insecure_admin(self):
        settings = Settings(
            environment="development", allow_insecure_admin=True, _env_file=None
        )
        assert settings.allow_insecure_admin is True


class TestProductionFailsClosed:
    def _production(self, **overrides):
        base = {
            "environment": "production",
            "stellar_public_key": "GTESTTREASURY",
            "admin_api_key": "a-real-key",
            "_env_file": None,
        }
        return Settings(**{**base, **overrides})

    def test_production_refuses_to_start_without_an_admin_key(self, monkeypatch):
        monkeypatch.delenv("ADMIN_API_KEY", raising=False)
        with pytest.raises(ValueError, match="ADMIN_API_KEY"):
            Settings(
                environment="production",
                stellar_public_key="GTEST",
                admin_api_key="",
                _env_file=None,
            )

    def test_production_refuses_to_start_without_a_treasury(self, monkeypatch):
        monkeypatch.delenv("STELLAR_PUBLIC_KEY", raising=False)
        with pytest.raises(ValueError, match="STELLAR_PUBLIC_KEY"):
            Settings(
                environment="production", admin_api_key="key", _env_file=None
            )

    def test_production_overrides_sandbox_even_when_requested(self):
        # An operator explicitly asking for sandbox in production is refused.
        assert self._production(x402_sandbox_mode=True).x402_sandbox_mode is False

    def test_production_overrides_insecure_admin_even_when_requested(self):
        assert self._production(allow_insecure_admin=True).allow_insecure_admin is False

    def test_production_forces_debug_off(self):
        assert self._production(debug=True).debug is False

    def test_insecure_secret_keys_are_never_used(self):
        for placeholder in ("", "change-me-in-production", "secret"):
            generated = Settings(secret_key=placeholder, _env_file=None).secret_key
            assert generated not in {placeholder, ""}
            assert len(generated) >= 32


class TestAdminGuard:
    """`require_admin` is the only thing between the internet and DELETE."""

    def _upload(self, client: TestClient, headers: dict | None = None):
        return client.post(
            "/api/v1/documents",
            files={"file": ("a.md", io.BytesIO(b"# T\n\nBody."), "text/markdown")},
            headers=headers or {},
        )

    def test_upload_without_a_key_is_refused(self, client: TestClient):
        assert self._upload(client).status_code == 403

    def test_upload_with_a_wrong_key_is_refused(self, client: TestClient):
        response = self._upload(client, {"X-Admin-Key": "not-the-key"})
        assert response.status_code == 403

    def test_upload_with_the_right_key_is_admitted(self, client: TestClient):
        # 403 is the security outcome under test; anything else means the guard
        # let the request through to the ingestion pipeline.
        response = self._upload(client, {"X-Admin-Key": "test-admin-key"})
        assert response.status_code != 403

    def test_delete_without_a_key_is_refused(self, client: TestClient):
        assert client.delete("/api/v1/documents/doc_any").status_code == 403

    def test_delete_with_a_wrong_key_is_refused(self, client: TestClient):
        response = client.delete(
            "/api/v1/documents/doc_any", headers={"X-Admin-Key": "wrong"}
        )
        assert response.status_code == 403

    def test_provider_registration_without_a_key_is_refused(self, client: TestClient):
        response = client.post(
            "/api/v1/marketplace/providers",
            json={
                "slug": "anon",
                "name": "Anonymous AI",
                "tagline": "Should not list",
                "description": "Registration must require a credential.",
                "category": "X",
                "capabilities": ["a"],
                "keywords": ["b"],
                "price_xlm": 0.01,
                "credits_per_call": 1,
                "target_latency_ms": 100,
            },
        )
        assert response.status_code == 403

    def test_provider_status_change_without_a_key_is_refused(self, client: TestClient):
        response = client.post("/api/v1/marketplace/providers/any/status?status=offline")
        assert response.status_code == 403

    def test_empty_key_header_is_not_authentication(self, client: TestClient):
        response = self._upload(client, {"X-Admin-Key": ""})
        assert response.status_code == 403

    def test_missing_admin_key_config_refuses_rather_than_opening(self, monkeypatch):
        """With no key configured and no explicit opt-in, the guard shuts."""
        from app.api import deps
        from app.core.errors import ForbiddenError

        monkeypatch.setattr(deps.settings, "admin_api_key", "", raising=False)
        monkeypatch.setattr(deps.settings, "allow_insecure_admin", False, raising=False)
        with pytest.raises(ForbiddenError, match="ADMIN_API_KEY"):
            deps.require_admin(x_admin_key=None)

    def test_explicit_local_opt_in_is_honoured_outside_production(self, monkeypatch):
        from app.api import deps

        monkeypatch.setattr(deps.settings, "admin_api_key", "", raising=False)
        monkeypatch.setattr(deps.settings, "allow_insecure_admin", True, raising=False)
        monkeypatch.setattr(deps.settings, "environment", "development", raising=False)
        assert deps.require_admin(x_admin_key=None) is True

    def test_local_opt_in_is_ignored_in_production(self, monkeypatch):
        from app.api import deps
        from app.core.errors import ForbiddenError

        monkeypatch.setattr(deps.settings, "admin_api_key", "", raising=False)
        monkeypatch.setattr(deps.settings, "allow_insecure_admin", True, raising=False)
        monkeypatch.setattr(deps.settings, "environment", "production", raising=False)
        with pytest.raises(ForbiddenError):
            deps.require_admin(x_admin_key=None)


class TestSandboxSettlement:
    def test_sandbox_hash_is_refused_when_sandbox_is_off(self, client: TestClient, monkeypatch):
        from app.services import stellar_service as module

        monkeypatch.setattr(module.settings, "x402_sandbox_mode", False, raising=False)
        response = client.post(
            "/api/v1/payments/verify",
            json={
                "transaction_hash": "sandbox_should_be_refused",
                "agent_id": "agent_sandbox_off",
            },
        )
        assert response.status_code == 400
        assert response.json()["error"]["details"]["code"] == "sandbox_disabled"
