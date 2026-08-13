"""Platform health, configuration, and analytics."""

from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter
from starlette.concurrency import run_in_threadpool

from app.core.config import settings
from app.db import repository as repo
from app.services import bootstrap, embeddings, vector_store
from app.services.rag_service import rag_service
from app.services.stellar_service import stellar_service

router = APIRouter()

_STARTED_AT = time.time()


@router.get("/config", summary="Public runtime configuration")
async def public_config() -> dict[str, Any]:
    """Everything the frontend needs to render correctly — and nothing secret."""
    return {
        "app_name": settings.app_name,
        "version": settings.app_version,
        "environment": settings.environment,
        "pricing": stellar_service.pricing(),
        "models": {
            "generation": settings.gemini_model,
            "embedding": settings.gemini_embedding_model,
            "configured": settings.gemini_enabled,
        },
        "retrieval": {
            "strategy": "hybrid" if settings.hybrid_search_enabled else "dense",
            "top_k": settings.retrieval_top_k,
            "fetch_k": settings.retrieval_fetch_k,
            "chunk_size": settings.chunk_size,
            "chunk_overlap": settings.chunk_overlap,
        },
        "uploads": {
            "max_mb": settings.max_upload_mb,
            "extensions": [".pdf", ".docx", ".txt", ".md", ".csv", ".json"],
        },
        "stellar": {
            "network": settings.stellar_network,
            "explorer": settings.stellar_explorer_base,
            "configured": settings.stellar_live_mode,
            "sandbox_mode": settings.x402_sandbox_mode,
        },
    }


@router.get("/health", summary="Liveness and dependency health")
async def health() -> dict[str, Any]:
    vector = await run_in_threadpool(vector_store.health)
    stellar = await run_in_threadpool(stellar_service.account_status)

    components = {
        "api": {"status": "ok"},
        "database": {"status": "ok", "path": str(settings.database_path)},
        "vector_store": vector,
        "gemini": {
            "status": "ok" if settings.gemini_enabled else "unconfigured",
            "model": settings.gemini_model,
        },
        "stellar": {
            "status": stellar.get("status", "unknown"),
            "network": settings.stellar_network,
            "sandbox_mode": settings.x402_sandbox_mode,
        },
    }
    degraded = [
        name
        for name, value in components.items()
        if value.get("status") not in {"ok", "unconfigured"}
    ]
    return {
        "status": "degraded" if degraded else "ok",
        "service": "agentic-rag-paywall",
        "version": settings.app_version,
        "environment": settings.environment,
        "uptime_seconds": int(time.time() - _STARTED_AT),
        "components": components,
        "degraded": degraded,
        # Deliberately outside `components`: a cold instance still filling its
        # index is alive and serving. Reporting it as degraded would make the
        # host's health check fail the deploy.
        "bootstrap": bootstrap.status(),
    }


@router.get("/stats", summary="Headline platform metrics")
async def stats() -> dict[str, Any]:
    documents = await run_in_threadpool(repo.document_totals)
    queries = await run_in_threadpool(repo.query_totals)
    payments = await run_in_threadpool(repo.payment_totals)
    agents = await run_in_threadpool(repo.agent_totals)
    return {
        **documents,
        **queries,
        **payments,
        **agents,
        "indexed_vectors": await run_in_threadpool(vector_store.count),
        "price_xlm": settings.x402_price_xlm,
        "price_usd": settings.price_usd,
        "revenue_usd": round(
            payments["total_revenue_xlm"] * settings.xlm_usd_rate, 6
        ),
        "network": settings.stellar_network,
        "model": settings.gemini_model,
    }


@router.get("/analytics", summary="Time series and rankings for the dashboard")
async def analytics(days: int = 14) -> dict[str, Any]:
    days = max(1, min(days, 90))
    return {
        "queries_by_day": await run_in_threadpool(repo.queries_by_day, days),
        "revenue_by_day": await run_in_threadpool(repo.revenue_by_day, days),
        "recent_queries": await run_in_threadpool(repo.recent_queries, 15),
        "recent_payments": await run_in_threadpool(repo.list_payments, 10),
        "top_questions": await run_in_threadpool(repo.top_questions, 5),
        "totals": {
            **await run_in_threadpool(repo.query_totals),
            **await run_in_threadpool(repo.payment_totals),
            **await run_in_threadpool(repo.document_totals),
            **await run_in_threadpool(repo.agent_totals),
        },
        "pipeline": await run_in_threadpool(rag_service.stats),
        "cache": embeddings.cache_stats(),
    }
