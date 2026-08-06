"""The Agent Discovery Network API.

Agents arrive knowing nothing about who can serve them. These endpoints let
them enumerate the network, evaluate providers, route a request autonomously,
and compare offers before committing.
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from typing import Any, Literal

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import Field
from starlette.concurrency import iterate_in_threadpool, run_in_threadpool

from app.api.deps import AdminOnly, PaidAgent, QueryLimit
from app.core.errors import NotFoundError
from app.core.logging import request_id_ctx
from app.db import repository as repo
from app.schemas import AGENT_ID_PATTERN, Schema
from app.services import marketplace, registry, reputation, router_agent

logger = logging.getLogger(__name__)
router = APIRouter()

_SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
    "Content-Encoding": "identity",
}


def _sse(event: str, payload: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, default=str)}\n\n"


# ── Schemas ───────────────────────────────────────────────────────────────────


class DiscoverRequest(Schema):
    query: str = Field(min_length=3, max_length=2000)
    objective: Literal["balanced", "cheapest", "fastest", "quality"] = "balanced"
    limit: int | None = Field(default=None, ge=1, le=50)


class RouteRequest(Schema):
    query: str = Field(min_length=3, max_length=2000)
    agent_id: str = Field(pattern=AGENT_ID_PATTERN)
    objective: Literal["balanced", "cheapest", "fastest", "quality"] = "balanced"


class CompareRequest(Schema):
    query: str = Field(min_length=3, max_length=2000)
    agent_id: str = Field(pattern=AGENT_ID_PATTERN)
    providers: list[str] = Field(min_length=2, max_length=5)


class RegisterProviderRequest(Schema):
    slug: str = Field(pattern=r"^[a-z0-9][a-z0-9\-]{1,48}$")
    name: str = Field(min_length=2, max_length=80)
    tagline: str = Field(min_length=4, max_length=140)
    description: str = Field(min_length=10, max_length=800)
    category: str = Field(min_length=2, max_length=40)
    capabilities: list[str] = Field(min_length=1, max_length=12)
    keywords: list[str] = Field(min_length=1, max_length=60)
    scope_documents: list[str] = Field(default_factory=list, max_length=200)
    price_xlm: float = Field(gt=0, le=10)
    credits_per_call: int = Field(default=1, ge=1, le=50)
    target_latency_ms: int = Field(default=2000, ge=100, le=60_000)
    model: str | None = None
    top_k: int = Field(default=6, ge=1, le=20)
    temperature: float = Field(default=0.15, ge=0.0, le=2.0)
    accent: str = "accent"
    endpoint: str | None = None
    registered_by: str | None = Field(default=None, max_length=80)


# ── Registry ──────────────────────────────────────────────────────────────────


@router.get("/providers", summary="Enumerate every service on the network")
async def list_providers(category: str | None = None) -> dict[str, Any]:
    providers = await run_in_threadpool(registry.list_providers)
    enriched = reputation.enrich_all(providers)
    if category:
        enriched = [p for p in enriched if p["category"].lower() == category.lower()]
    return {
        "providers": enriched,
        "total": len(enriched),
        "categories": sorted({p["category"] for p in enriched}),
    }


@router.get("/providers/{slug}", summary="Provider detail with reputation history")
async def get_provider(slug: str) -> dict[str, Any]:
    provider = await run_in_threadpool(registry.get_provider, slug)
    if provider is None:
        raise NotFoundError(f"Provider '{slug}' is not listed on this network.")

    enriched = reputation.enrich(provider)
    return {
        **enriched,
        "reputation_history": await run_in_threadpool(
            reputation.history, provider["provider_id"]
        ),
        "recent_events": await run_in_threadpool(
            registry.recent_events, provider["provider_id"], 25
        ),
    }


@router.post(
    "/providers",
    summary="Register a new service",
    description=(
        "The registry is open by design: any service that can declare "
        "capabilities, a price, and a knowledge scope can list here and will be "
        "ranked by the routing agent from its first request."
    ),
)
async def register_provider(
    body: RegisterProviderRequest, _admin: AdminOnly
) -> dict[str, Any]:
    provider = await run_in_threadpool(
        registry.register_provider, **body.model_dump()
    )
    return reputation.enrich(provider)


@router.post("/providers/{slug}/status", summary="Take a provider on- or offline")
async def set_status(slug: str, status: str, _admin: AdminOnly) -> dict[str, Any]:
    if status not in {"online", "offline", "degraded"}:
        raise NotFoundError("Status must be online, offline, or degraded.")
    if await run_in_threadpool(registry.get_provider, slug) is None:
        raise NotFoundError(f"Provider '{slug}' is not listed.")
    await run_in_threadpool(registry.set_status, slug, status)
    return {"slug": slug, "status": status}


# ── Discovery ─────────────────────────────────────────────────────────────────


@router.post(
    "/discover",
    summary="Rank the network against a request — free, no LLM, no payment",
    description=(
        "Returns every provider scored on capability match, trust, price and "
        "latency under the chosen objective, with the rationale the routing "
        "agent would use. Discovery is free so an agent can shop before it buys."
    ),
)
async def discover(body: DiscoverRequest) -> dict[str, Any]:
    decision = await run_in_threadpool(
        router_agent.discover,
        body.query,
        objective=body.objective,
        limit=body.limit,
    )
    return decision.to_dict()


@router.post(
    "/route",
    summary="Autonomous end-to-end routing (costs the chosen provider's price)",
    response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {}}}},
)
async def route(
    body: RouteRequest, request: Request, claims: PaidAgent, _limit: QueryLimit
) -> StreamingResponse:
    """Discover → rank → select → pay → invoke → return, as Server-Sent Events.

    Event sequence: ``intent`` → ``discovered`` → ``ranked`` → ``selected``
    → ``payment`` → ``invoking`` → ``retrieval`` → ``token``* → ``follow_ups``
    → ``done``. A failure emits ``error`` and refunds every credit charged.
    """
    agent_id = claims.agent_id
    request_id = request_id_ctx.get()

    async def stream() -> AsyncIterator[str]:
        token = request_id_ctx.set(request_id)
        try:
            generator = marketplace.route_and_execute(
                body.query, agent_id, objective=body.objective
            )
            async for event, payload in iterate_in_threadpool(generator):
                if await request.is_disconnected():
                    logger.info("Client disconnected during routing")
                    break
                yield _sse(event, payload)
        except Exception:  # the stream must always terminate cleanly
            logger.exception("Routing failed")
            yield _sse(
                "error",
                {
                    "code": "routing_failed",
                    "message": "The routing agent could not complete this request.",
                },
            )
        finally:
            request_id_ctx.reset(token)

    return StreamingResponse(
        stream(), media_type="text/event-stream", headers=_SSE_HEADERS
    )


@router.post(
    "/compare",
    summary="Send one request to several providers and score the offers",
)
async def compare(
    body: CompareRequest, claims: PaidAgent, _limit: QueryLimit
) -> dict[str, Any]:
    return await run_in_threadpool(
        marketplace.compare, body.query, body.providers, claims.agent_id
    )


# ── Network telemetry ─────────────────────────────────────────────────────────


@router.get("/stats", summary="Live marketplace metrics")
async def stats() -> dict[str, Any]:
    return await run_in_threadpool(marketplace.network_stats)


@router.get("/leaderboard", summary="Provider rankings")
async def leaderboard() -> dict[str, Any]:
    providers = await run_in_threadpool(registry.list_providers)
    return {
        "leaderboard": reputation.leaderboard(providers),
        "providers": sorted(
            reputation.enrich_all(providers),
            key=lambda p: p["reputation"]["trust"],
            reverse=True,
        ),
    }


@router.get("/activity", summary="Recent network activity")
async def activity(limit: int = 30) -> dict[str, Any]:
    return {
        "events": await run_in_threadpool(registry.network_events, min(limit, 100)),
        "decisions": await run_in_threadpool(
            router_agent.recent_decisions, min(limit, 50)
        ),
        "hourly": await run_in_threadpool(reputation.network_activity),
    }


@router.get("/balance/{agent_id}", summary="An agent's spending power")
async def balance(agent_id: str) -> dict[str, Any]:
    agent = await run_in_threadpool(repo.get_or_create_agent, agent_id)
    providers = await run_in_threadpool(registry.list_providers)
    affordable = [
        p["slug"] for p in providers if p["credits_per_call"] <= int(agent["credits"])
    ]
    return {
        "agent_id": agent_id,
        "credits": int(agent["credits"]),
        "affordable_providers": affordable,
        "locked_out": [p["slug"] for p in providers if p["slug"] not in affordable],
    }
