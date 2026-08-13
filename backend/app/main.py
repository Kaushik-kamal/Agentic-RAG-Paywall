"""Agentic RAG Paywall — FastAPI application entrypoint."""

from __future__ import annotations

import logging
import secrets
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from starlette.concurrency import run_in_threadpool

from app.api.router import api_router
from app.core.config import settings
from app.core.errors import RateLimitedError, register_exception_handlers
from app.core.logging import configure_logging, request_id_ctx
from app.core.rate_limit import global_limiter
from app.db.database import close_db, init_db
from app.services import bootstrap, x402

configure_logging(settings.log_level, settings.log_json)
logger = logging.getLogger(__name__)

DESCRIPTION = """
A **pay-per-query knowledge API for autonomous agents**, settled on Stellar with
the HTTP `402 Payment Required` protocol.

### How an agent buys an answer

1. `POST /api/v1/rag/query` without a token → **402** with payment instructions
   in both the headers and the body.
2. Pay the exact amount to the address, carrying the returned memo.
3. `POST /api/v1/payments/verify` with the transaction hash → access token
   plus a bundle of query credits.
4. Retry the query with `Authorization: Bearer <token>`. One credit per answer.

### Retrieval

Hybrid search — dense Gemini embeddings fused with BM25 lexical scoring via
Reciprocal Rank Fusion — over heading-aware chunks. Every answer carries
chunk-level citations, a retrieval trace, and a computed confidence score.
"""


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    await run_in_threadpool(init_db)
    logger.info(
        "%s v%s starting · env=%s · model=%s · network=%s",
        settings.app_name,
        settings.app_version,
        settings.environment,
        settings.gemini_model,
        settings.stellar_network,
    )
    if not settings.gemini_enabled:
        logger.warning(
            "GEMINI_API_KEY is not set — retrieval and generation will return 503. "
            "Add it to backend/.env."
        )
    if not settings.stellar_live_mode:
        logger.warning(
            "STELLAR_PUBLIC_KEY is not set — on-chain verification is disabled. "
            "Run `python scripts/setup_stellar.py` to provision a funded testnet account."
        )
    if settings.x402_sandbox_mode:
        logger.warning(
            "Sandbox payments are ENABLED: transaction hashes starting with "
            "'sandbox_' are accepted without touching the chain. Never enable "
            "this in production."
        )
    # A host with no persistent disk starts empty on every restart. This fills
    # the network in the background so the API is serving straight away.
    await run_in_threadpool(bootstrap.seed_if_empty)

    try:
        yield
    finally:
        await run_in_threadpool(close_db)
        logger.info("Shutdown complete")


app = FastAPI(
    title=settings.app_name,
    description=DESCRIPTION,
    version=settings.app_version,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    contact={"name": "Agentic RAG Paywall", "url": "https://github.com/Kaushik-kamal/Agentic-RAG-Paywall"},
    license_info={"name": "MIT"},
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=x402.EXPOSED_HEADERS,
    max_age=600,
)
app.add_middleware(GZipMiddleware, minimum_size=1024)


@app.middleware("http")
async def observability(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    """Correlation id, timing, rate limiting, and baseline security headers."""
    request_id = request.headers.get("x-request-id") or secrets.token_hex(6)
    token = request_id_ctx.set(request_id)
    started = time.perf_counter()

    try:
        if settings.rate_limit_enabled and request.method != "OPTIONS":
            forwarded = request.headers.get("x-forwarded-for")
            client = (
                forwarded.split(",")[0].strip()
                if forwarded
                else (request.client.host if request.client else "unknown")
            )
            verdict = global_limiter.check(client)
            if not verdict.allowed:
                raise RateLimitedError(
                    "Global rate limit exceeded.",
                    details={"retry_after_seconds": verdict.reset_after},
                    headers={"Retry-After": str(verdict.reset_after)},
                )

        response = await call_next(request)
        elapsed_ms = (time.perf_counter() - started) * 1000

        response.headers["X-Request-Id"] = request_id
        response.headers["X-Response-Time-Ms"] = f"{elapsed_ms:.1f}"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

        if request.url.path.startswith(settings.api_prefix):
            logger.info(
                "%s %s → %d in %.0f ms",
                request.method,
                request.url.path,
                response.status_code,
                elapsed_ms,
            )
        return response
    finally:
        request_id_ctx.reset(token)


register_exception_handlers(app)
app.include_router(api_router, prefix=settings.api_prefix)


@app.get("/health", tags=["System"], summary="Liveness probe")
async def health() -> dict[str, Any]:
    """Deliberately shallow — the host polls this to decide whether to keep the
    container. Dependency detail lives at `{api_prefix}/health`. Seeding state
    is included because a freshly started instance is alive but not yet useful,
    and that difference is worth being able to see from the outside."""
    return {
        "status": "ok",
        "service": "agentic-rag-paywall",
        "version": settings.app_version,
        "bootstrap": bootstrap.status(),
    }


@app.get("/", include_in_schema=False)
async def root() -> dict[str, str]:
    return {
        "service": settings.app_name,
        "version": settings.app_version,
        "docs": "/docs",
        "api": settings.api_prefix,
    }
