"""Application settings.

Every value is overridable via environment variables or ``backend/.env``.
Validators here are deliberately strict: a misconfigured paywall is a
revenue leak, and a misconfigured secret is a security incident.
"""

from __future__ import annotations

import secrets
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, computed_field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parents[2]

INSECURE_SECRETS = {
    "",
    "change-me-in-production",
    "change-me-to-a-random-32-char-string",
    "your-secret-key-here",
    "secret",
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BACKEND_ROOT / ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Application ──────────────────────────────────────────────────────────
    app_name: str = "Agentic RAG Paywall"
    app_version: str = "2.0.0"
    environment: Literal["development", "staging", "production"] = "development"
    debug: bool = False
    api_prefix: str = "/api/v1"
    log_level: str = "INFO"
    log_json: bool = False

    # ── Security ─────────────────────────────────────────────────────────────
    secret_key: str = ""
    admin_api_key: str = ""
    #: Opt-in escape hatch for local work with no admin key configured. It is
    #: refused outright in production — knowledge-base mutation must never be
    #: reachable without a credential on a deployed instance.
    allow_insecure_admin: bool = False
    access_token_expire_minutes: int = Field(default=60, ge=1, le=1440)
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    # ── Rate limiting (per client, sliding window) ───────────────────────────
    rate_limit_enabled: bool = True
    rate_limit_requests: int = Field(default=120, ge=1)
    rate_limit_window_seconds: int = Field(default=60, ge=1)

    # ── Gemini ───────────────────────────────────────────────────────────────
    gemini_api_key: str = ""
    #: Model availability varies by API key and tier — run
    #: ``python scripts/list_models.py`` to see what a given key can call.
    #:
    #: flash-lite is deliberate: the reasoning models spend 20+ seconds
    #: "thinking" before emitting a token, which makes a streamed answer feel
    #: broken. Extraction from supplied context is exactly what a lite model
    #: does well, and it returns a first token in ~1.2s.
    gemini_model: str = "gemini-3.1-flash-lite"
    gemini_embedding_model: str = "models/gemini-embedding-001"
    gemini_temperature: float = Field(default=0.15, ge=0.0, le=2.0)
    gemini_max_output_tokens: int = Field(default=1536, ge=64, le=8192)

    # ── Vector store ─────────────────────────────────────────────────────────
    chroma_collection: str = "knowledge_base"
    chroma_persist_dir: str = "./data/chroma"

    # ── Retrieval ────────────────────────────────────────────────────────────
    retrieval_top_k: int = Field(default=6, ge=1, le=20)
    retrieval_fetch_k: int = Field(default=24, ge=1, le=100)
    retrieval_min_relevance: float = Field(default=0.15, ge=0.0, le=1.0)
    hybrid_search_enabled: bool = True
    rrf_k: int = Field(default=60, ge=1)

    # ── Ingestion ────────────────────────────────────────────────────────────
    chunk_size: int = Field(default=1100, ge=200, le=8000)
    chunk_overlap: int = Field(default=180, ge=0, le=2000)
    max_upload_mb: int = Field(default=25, ge=1, le=200)
    upload_dir: str = "./data/uploads"

    # ── Persistence ──────────────────────────────────────────────────────────
    database_url: str = "./data/paywall.db"

    # ── Stellar / x402 ───────────────────────────────────────────────────────
    stellar_network: Literal["testnet", "public"] = "testnet"
    stellar_horizon_url: str = "https://horizon-testnet.stellar.org"
    stellar_secret_key: str = ""
    stellar_public_key: str = ""
    x402_price_xlm: float = Field(default=0.01, gt=0)
    x402_credits_per_payment: int = Field(default=10, ge=1)
    x402_challenge_ttl_seconds: int = Field(default=300, ge=30, le=3600)
    x402_free_credits: int = Field(default=3, ge=0, le=100)
    #: Accept ``sandbox_*`` transaction hashes without touching the chain.
    #: **Off by default and opt-in**: a deployment that forgets to configure
    #: this fails closed rather than letting anyone mint free credits. Local
    #: development sets ``X402_SANDBOX_MODE=true`` explicitly, and production
    #: cannot enable it at all — see the validator below.
    x402_sandbox_mode: bool = False

    # ── Pricing display ──────────────────────────────────────────────────────
    xlm_usd_rate: float = Field(default=0.11, gt=0)

    # ── Validators ───────────────────────────────────────────────────────────

    @field_validator("secret_key")
    @classmethod
    def _generate_dev_secret(cls, value: str) -> str:
        """Never run on a shared/default secret. Dev gets an ephemeral one."""
        if value.strip() in INSECURE_SECRETS:
            return secrets.token_urlsafe(48)
        return value.strip()

    @field_validator("log_level")
    @classmethod
    def _upper_log_level(cls, value: str) -> str:
        level = value.upper()
        if level not in {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}:
            raise ValueError(f"Invalid log level: {value}")
        return level

    @model_validator(mode="after")
    def _harden_production(self) -> Settings:
        if self.environment == "production":
            # Sandbox payments would let anyone mint credits for free, and an
            # open admin surface would let anyone delete the knowledge base.
            # Both are forced shut regardless of what the environment asks for.
            object.__setattr__(self, "x402_sandbox_mode", False)
            object.__setattr__(self, "allow_insecure_admin", False)
            object.__setattr__(self, "debug", False)
            if not self.stellar_public_key:
                raise ValueError(
                    "STELLAR_PUBLIC_KEY is required when ENVIRONMENT=production"
                )
            if not self.admin_api_key:
                raise ValueError(
                    "ADMIN_API_KEY is required when ENVIRONMENT=production. "
                    "Generate one with: "
                    'python -c "import secrets; print(secrets.token_urlsafe(24))"'
                )
        if self.chunk_overlap >= self.chunk_size:
            raise ValueError("CHUNK_OVERLAP must be smaller than CHUNK_SIZE")
        if self.retrieval_fetch_k < self.retrieval_top_k:
            object.__setattr__(self, "retrieval_fetch_k", self.retrieval_top_k * 4)
        return self

    # ── Derived values ───────────────────────────────────────────────────────

    @computed_field  # type: ignore[prop-decorator]
    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @computed_field  # type: ignore[prop-decorator]
    @property
    def gemini_enabled(self) -> bool:
        return bool(self.gemini_api_key.strip())

    @computed_field  # type: ignore[prop-decorator]
    @property
    def admin_configured(self) -> bool:
        return bool(self.admin_api_key.strip())

    @computed_field  # type: ignore[prop-decorator]
    @property
    def stellar_live_mode(self) -> bool:
        """True when on-chain verification is actually possible."""
        return bool(self.stellar_public_key.strip())

    @computed_field  # type: ignore[prop-decorator]
    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @computed_field  # type: ignore[prop-decorator]
    @property
    def price_usd(self) -> float:
        return round(self.x402_price_xlm * self.xlm_usd_rate, 6)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def stellar_explorer_base(self) -> str:
        net = "testnet" if self.stellar_network == "testnet" else "public"
        return f"https://stellar.expert/explorer/{net}"

    def resolve(self, relative: str) -> Path:
        """Resolve a possibly-relative configured path against the backend root."""
        path = Path(relative)
        return path if path.is_absolute() else (BACKEND_ROOT / path).resolve()

    @property
    def chroma_path(self) -> Path:
        return self.resolve(self.chroma_persist_dir)

    @property
    def upload_path(self) -> Path:
        return self.resolve(self.upload_dir)

    @property
    def database_path(self) -> Path:
        return self.resolve(self.database_url)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
