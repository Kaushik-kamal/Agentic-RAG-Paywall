"""Request and response models shared across the API."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

AGENT_ID_PATTERN = r"^[A-Za-z0-9_\-]{3,64}$"


class Schema(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


# ── RAG ───────────────────────────────────────────────────────────────────────


class QueryRequest(Schema):
    query: str = Field(min_length=3, max_length=2000, description="Natural-language question")
    agent_id: str = Field(pattern=AGENT_ID_PATTERN)
    conversation_id: str | None = Field(default=None, max_length=64)
    document_ids: list[str] | None = Field(default=None, max_length=25)
    remember: bool = Field(
        default=True, description="Persist this turn to the conversation history"
    )

    @field_validator("query")
    @classmethod
    def _reject_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Query must not be blank")
        return value.strip()


class SearchRequest(Schema):
    query: str = Field(min_length=2, max_length=2000)
    top_k: int = Field(default=8, ge=1, le=25)
    document_ids: list[str] | None = Field(default=None, max_length=25)


class CitationModel(Schema):
    marker: int
    chunk_id: str
    document_id: str
    document_title: str
    locator: str
    section: str
    page: int | None
    score: float
    snippet: str
    used: bool


class ConfidenceModel(Schema):
    score: float
    percent: int
    label: str
    reasons: list[str]


class CacheInfo(Schema):
    hit: bool
    matched_question: str
    similarity: float
    age_seconds: int
    credits_charged: int


class QueryResponse(Schema):
    question: str
    answer: str
    citations: list[CitationModel]
    sources: list[str]
    follow_ups: list[str]
    confidence: ConfidenceModel
    retrieval: dict[str, Any]
    candidates: list[dict[str, Any]]
    latency_ms: int
    tokens_used: int
    cost_xlm: float
    model: str
    metrics: dict[str, Any]
    credits_remaining: int
    conversation_id: str | None = None
    #: True when the answer came from the semantic cache — no credit charged.
    cached: bool = False
    cache: CacheInfo | None = None


# ── Documents ─────────────────────────────────────────────────────────────────


class DocumentModel(Schema):
    document_id: str
    filename: str
    title: str
    media_type: str
    size_bytes: int
    chunk_count: int
    char_count: int
    page_count: int | None = None
    summary: str | None = None
    topics: list[str] = Field(default_factory=list)
    status: str
    created_at: str


class IngestResponse(Schema):
    document: DocumentModel
    chunks_indexed: int
    duplicate: bool
    elapsed_ms: int
    message: str


# ── Payments ──────────────────────────────────────────────────────────────────


class ChallengeRequest(Schema):
    agent_id: str = Field(pattern=AGENT_ID_PATTERN)


class ChallengeResponse(Schema):
    challenge_id: str
    agent_id: str
    destination: str
    amount_xlm: float
    asset: str
    memo: str
    network: str
    expires_at: str
    credits_granted: int
    sandbox_mode: bool
    price_usd: float
    funding_url: str | None = None


class VerifyRequest(Schema):
    transaction_hash: str = Field(min_length=6, max_length=128)
    agent_id: str = Field(pattern=AGENT_ID_PATTERN)
    challenge_id: str | None = Field(default=None, max_length=64)


class VerifyResponse(Schema):
    verified: bool
    access_token: str
    token_type: Literal["Bearer"] = "Bearer"
    expires_in: int
    credits_granted: int
    credits_remaining: int
    amount_xlm: float
    mode: str
    transaction_hash: str
    explorer_url: str | None = None


class BalanceResponse(Schema):
    agent_id: str
    credits: int
    total_queries: int
    total_spent_xlm: float
    price_xlm: float
    credits_per_payment: int


# ── Agents ────────────────────────────────────────────────────────────────────


class AgentRegistration(Schema):
    name: str = Field(min_length=2, max_length=80)
    description: str | None = Field(default=None, max_length=400)
    stellar_address: str | None = Field(default=None, max_length=64)
    webhook_url: str | None = Field(default=None, max_length=300)


class AgentModel(Schema):
    agent_id: str
    name: str
    description: str | None = None
    stellar_address: str | None = None
    credits: int
    total_queries: int
    total_spent_xlm: float
    status: str
    created_at: str
    last_seen_at: str | None = None


# ── Conversations ─────────────────────────────────────────────────────────────


class ConversationModel(Schema):
    conversation_id: str
    agent_id: str
    title: str
    message_count: int
    created_at: str
    updated_at: str


class MessageModel(Schema):
    message_id: str
    conversation_id: str
    role: str
    content: str
    citations: list[dict[str, Any]] = Field(default_factory=list)
    metrics: dict[str, Any] = Field(default_factory=dict)
    created_at: str
