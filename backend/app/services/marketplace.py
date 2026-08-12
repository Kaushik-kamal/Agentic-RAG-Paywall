"""Marketplace execution — discovery, settlement, invocation, reputation.

This is the loop the whole project exists to demonstrate:

    intent → discover → rank → select → pay → invoke → return → reputation

Every stage is real. Discovery ranks live registry state, settlement debits the
credit ledger at the *chosen provider's* price, invocation runs that provider's
own scoped retrieval, and the outcome is written back to reputation — so the
next routing decision is influenced by this one.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Iterator
from typing import Any

from app.core.errors import AppError, InsufficientCreditsError, NotFoundError
from app.db import repository as repo
from app.services import registry, reputation, router_agent
from app.services.rag_service import rag_service
from app.services.router_agent import Objective, RoutingDecision

logger = logging.getLogger(__name__)


def _debit(agent_id: str, credits: int, price_xlm: float | None = None) -> int:
    """Charge the provider's price as one indivisible operation.

    Either the full amount is taken or nothing is — the database enforces it,
    so concurrent callers cannot overspend a balance and no caller can end up
    partially charged. ``price_xlm`` records what the buyer actually paid, so
    the agent's spend and the provider's revenue reconcile to the same figure.
    """
    remaining = repo.consume_credits(
        agent_id, credits, reason="marketplace_call", spend_xlm=price_xlm
    )
    if remaining is None:
        raise InsufficientCreditsError(
            f"This provider charges {credits} credits per call; the agent holds "
            f"{repo.get_credits(agent_id)}. Settle another x402 payment to continue.",
            details={"required": credits, "available": repo.get_credits(agent_id)},
        )
    return remaining


def _refund(agent_id: str, credits: int) -> None:
    repo.refund_credits(agent_id, credits)


def invoke(
    provider: dict[str, Any],
    query: str,
    agent_id: str,
    *,
    charge: bool = True,
) -> dict[str, Any]:
    """Call one provider and record the outcome against its reputation."""
    credits = provider["credits_per_call"]
    remaining = (
        _debit(agent_id, credits, provider["price_xlm"])
        if charge
        else repo.get_credits(agent_id)
    )

    started = time.perf_counter()
    try:
        result = rag_service.answer(
            query,
            document_ids=provider["scope_documents"] or None,
            top_k=provider["top_k"],
            model=provider["model"],
            temperature=provider["temperature"],
        )
    except AppError as exc:
        if charge:
            _refund(agent_id, credits)
        registry.record_outcome(
            provider["provider_id"],
            agent_id=agent_id,
            query=query,
            status="failed",
            latency_ms=int((time.perf_counter() - started) * 1000),
            cost_xlm=0.0,
            confidence=None,
        )
        raise exc

    latency_ms = int((time.perf_counter() - started) * 1000)
    payload = result.to_dict()
    confidence = payload["confidence"]["score"]

    # A provider that refuses because the question is outside its corpus has not
    # failed — it behaved correctly. Reputation records it as a distinct outcome
    # so honest refusals do not look like outages.
    refused = confidence < 0.2
    registry.record_outcome(
        provider["provider_id"],
        agent_id=agent_id,
        query=query,
        status="success",
        latency_ms=latency_ms,
        cost_xlm=provider["price_xlm"] if charge else 0.0,
        confidence=confidence,
        cited_chunks=payload["metrics"]["chunks_cited"],
    )

    repo.log_query(
        agent_id=agent_id,
        question=query,
        answer_preview=payload["answer"][:280],
        confidence=confidence,
        latency_ms=latency_ms,
        tokens_used=payload["tokens_used"],
        chunks_used=len(payload["citations"]),
        status="success",
    )

    return {
        **payload,
        "provider": {
            "provider_id": provider["provider_id"],
            "slug": provider["slug"],
            "name": provider["name"],
            "category": provider["category"],
            "accent": provider["accent"],
            "price_xlm": provider["price_xlm"],
            "credits_charged": credits if charge else 0,
        },
        "latency_ms": latency_ms,
        "cost_xlm": provider["price_xlm"] if charge else 0.0,
        "credits_remaining": remaining,
        "refused": refused,
    }


def route_and_execute(
    query: str,
    agent_id: str,
    *,
    objective: Objective = "balanced",
) -> Iterator[tuple[str, dict[str, Any]]]:
    """The full autonomous loop, emitted as Server-Sent Events."""
    started = time.perf_counter()

    yield "intent", {
        "query": query,
        "objective": objective,
        "message": "Parsing intent and embedding the request",
    }

    decision: RoutingDecision = router_agent.discover(query, objective=objective)

    yield "discovered", {
        "considered": decision.considered,
        "providers": [c.to_dict() for c in decision.candidates],
        "message": f"Found {decision.considered} providers on the network",
    }
    yield "ranked", {
        "shortlisted": decision.shortlisted,
        "weights": decision.weights,
        "objective_label": router_agent.OBJECTIVE_LABEL[objective],
        "decided_in_ms": decision.decided_in_ms,
        "message": f"{decision.shortlisted} declare matching capability",
    }

    if decision.chosen is None:
        yield "error", {
            "code": "no_capable_provider",
            "message": decision.rationale,
        }
        return

    chosen = decision.chosen.provider
    yield "selected", {
        "decision_id": decision.decision_id,
        "provider": decision.chosen.to_dict(),
        "runner_up": decision.runner_up.to_dict() if decision.runner_up else None,
        "rationale": decision.rationale,
        "tradeoffs": decision.tradeoffs,
    }

    # ── Settlement ───────────────────────────────────────────────────────────
    credits = chosen["credits_per_call"]
    yield "payment", {
        "stage": "authorising",
        "provider": chosen["name"],
        "price_xlm": chosen["price_xlm"],
        "credits": credits,
        "message": f"Authorising {chosen['price_xlm']} XLM to {chosen['name']}",
    }

    try:
        remaining = _debit(agent_id, credits, chosen["price_xlm"])
    except InsufficientCreditsError as exc:
        yield "error", {
            "code": exc.code,
            "message": exc.message,
            "details": exc.details,
        }
        return

    yield "payment", {
        "stage": "settled",
        "provider": chosen["name"],
        "price_xlm": chosen["price_xlm"],
        "credits": credits,
        "credits_remaining": remaining,
        "message": f"Settled — {remaining} credits remaining",
    }

    # ── Invocation ───────────────────────────────────────────────────────────
    yield "invoking", {
        "provider": chosen["name"],
        "endpoint": chosen["endpoint"],
        "model": chosen["model"],
        "scope_documents": len(chosen["scope_documents"]),
        "message": f"Calling {chosen['name']} over its own knowledge scope",
    }

    invocation_started = time.perf_counter()
    answer_parts: list[str] = []
    citations: list[dict[str, Any]] = []
    confidence: dict[str, Any] | None = None
    metrics: dict[str, Any] = {}
    follow_ups: list[str] = []

    try:
        for event, payload in rag_service.stream_answer(
            query,
            document_ids=chosen["scope_documents"] or None,
            top_k=chosen["top_k"],
            model=chosen["model"],
            temperature=chosen["temperature"],
        ):
            if event == "retrieval":
                citations = payload["citations"]
                yield "retrieval", payload
            elif event == "token":
                answer_parts.append(payload["text"])
                yield "token", payload
            elif event == "follow_ups":
                follow_ups = payload["questions"]
                yield "follow_ups", payload
            elif event == "done":
                citations = payload["citations"]
                confidence = payload["confidence"]
                metrics = payload["metrics"]
    except AppError as exc:
        _refund(agent_id, credits)
        registry.record_outcome(
            chosen["provider_id"],
            agent_id=agent_id,
            query=query,
            status="failed",
            latency_ms=int((time.perf_counter() - invocation_started) * 1000),
            cost_xlm=0.0,
            confidence=None,
        )
        yield "error", {
            "code": exc.code,
            "message": f"{chosen['name']} failed: {exc.message}",
            "refunded": True,
            "credits_refunded": credits,
        }
        return

    latency_ms = int((time.perf_counter() - invocation_started) * 1000)
    answer = "".join(answer_parts).strip()
    score = (confidence or {}).get("score", 0.0)

    registry.record_outcome(
        chosen["provider_id"],
        agent_id=agent_id,
        query=query,
        status="success",
        latency_ms=latency_ms,
        cost_xlm=chosen["price_xlm"],
        confidence=score,
        cited_chunks=metrics.get("chunks_cited"),
    )
    repo.log_query(
        agent_id=agent_id,
        question=query,
        answer_preview=answer[:280],
        confidence=score,
        latency_ms=latency_ms,
        tokens_used=metrics.get("chunks_retrieved", 0) * 200,
        chunks_used=len(citations),
        status="success",
    )

    refreshed = reputation.enrich(registry.get_provider(chosen["provider_id"]))

    yield "done", {
        "decision_id": decision.decision_id,
        "answer": answer,
        "citations": citations,
        "follow_ups": follow_ups,
        "confidence": confidence,
        "metrics": metrics,
        "provider": {
            "provider_id": chosen["provider_id"],
            "slug": chosen["slug"],
            "name": chosen["name"],
            "accent": chosen["accent"],
            "category": chosen["category"],
        },
        "reputation_after": refreshed["reputation"],
        "stats_after": refreshed["stats"],
        "price_xlm": chosen["price_xlm"],
        "credits_charged": credits,
        "credits_remaining": remaining,
        "invocation_ms": latency_ms,
        "total_ms": int((time.perf_counter() - started) * 1000),
        "routing_ms": decision.decided_in_ms,
    }


def compare(
    query: str, slugs: list[str], agent_id: str, *, charge: bool = True
) -> dict[str, Any]:
    """Send one question to several providers and score the results side by side."""
    started = time.perf_counter()
    results: list[dict[str, Any]] = []

    for slug in slugs:
        provider = registry.get_provider(slug)
        if provider is None:
            raise NotFoundError(f"Provider '{slug}' is not listed on this network.")

        try:
            outcome = invoke(provider, query, agent_id, charge=charge)
            confidence = outcome["confidence"]["score"]
            results.append(
                {
                    "slug": slug,
                    "name": provider["name"],
                    "accent": provider["accent"],
                    "category": provider["category"],
                    "status": "refused" if outcome["refused"] else "answered",
                    "answer": outcome["answer"],
                    "citations": outcome["citations"],
                    "confidence": outcome["confidence"],
                    "latency_ms": outcome["latency_ms"],
                    "price_xlm": provider["price_xlm"],
                    "credits_charged": outcome["provider"]["credits_charged"],
                    "cited": outcome["metrics"]["chunks_cited"],
                    "retrieved": outcome["metrics"]["chunks_retrieved"],
                    "top_score": outcome["metrics"]["top_score"],
                    "value_score": round(
                        confidence / max(provider["price_xlm"], 1e-6) / 100, 4
                    ),
                }
            )
        except AppError as exc:
            results.append(
                {
                    "slug": slug,
                    "name": provider["name"],
                    "accent": provider["accent"],
                    "category": provider["category"],
                    "status": "failed",
                    "error": exc.message,
                    "price_xlm": provider["price_xlm"],
                }
            )

    answered = [r for r in results if r["status"] in {"answered", "refused"}]

    # An overall score that respects all three axes a buyer actually cares about.
    if answered:
        max_latency = max(r["latency_ms"] for r in answered) or 1
        max_price = max(r["price_xlm"] for r in answered) or 1
        for result in answered:
            quality = result["confidence"]["score"]
            speed = 1 - (result["latency_ms"] / max_latency)
            thrift = 1 - (result["price_xlm"] / max_price)
            result["overall"] = round(0.6 * quality + 0.2 * speed + 0.2 * thrift, 4)
        answered.sort(key=lambda r: r["overall"], reverse=True)

    decision = router_agent.discover(query, objective="balanced")

    return {
        "query": query,
        "results": results,
        "ranked": [r["slug"] for r in answered],
        "winner": answered[0]["slug"] if answered else None,
        "router_would_choose": decision.chosen.provider["slug"]
        if decision.chosen
        else None,
        "router_rationale": decision.rationale,
        "agreement": bool(
            answered
            and decision.chosen
            and answered[0]["slug"] == decision.chosen.provider["slug"]
        ),
        "elapsed_ms": int((time.perf_counter() - started) * 1000),
    }


def network_stats() -> dict[str, Any]:
    """Everything the marketplace dashboard needs, in one query set."""
    providers = reputation.enrich_all(registry.list_providers())
    online = [p for p in providers if p["status"] == "online"]

    total_requests = sum(p["stats"]["total_requests"] for p in providers)
    successful = sum(p["stats"]["successful"] for p in providers)
    revenue = sum(p["stats"]["revenue_xlm"] for p in providers)
    latencies = [
        p["stats"]["avg_latency_ms"] for p in providers if p["stats"]["avg_latency_ms"]
    ]

    return {
        "providers_total": len(providers),
        "providers_online": len(online),
        "categories": sorted({p["category"] for p in providers}),
        "total_requests": total_requests,
        "successful": successful,
        "failed": total_requests - successful,
        "success_rate": round(successful / total_requests, 4)
        if total_requests
        else None,
        "revenue_xlm": round(revenue, 7),
        "avg_latency_ms": int(sum(latencies) / len(latencies)) if latencies else None,
        "avg_price_xlm": round(
            sum(p["price_xlm"] for p in providers) / len(providers), 5
        )
        if providers
        else 0,
        "cheapest_xlm": min((p["price_xlm"] for p in providers), default=0),
        "dearest_xlm": max((p["price_xlm"] for p in providers), default=0),
        "leaderboard": reputation.leaderboard(registry.list_providers()),
        "activity": reputation.network_activity(),
        "recent_events": registry.network_events(20),
        "recent_decisions": router_agent.recent_decisions(10),
    }
