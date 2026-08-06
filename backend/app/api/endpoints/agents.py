"""Agent registry."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter
from starlette.concurrency import run_in_threadpool

from app.core.errors import NotFoundError
from app.core.security import create_access_token
from app.db import repository as repo
from app.schemas import AgentModel, AgentRegistration

logger = logging.getLogger(__name__)
router = APIRouter()


def _to_model(row: dict[str, Any]) -> AgentModel:
    return AgentModel(
        agent_id=row["agent_id"],
        name=row["name"],
        description=row["description"],
        stellar_address=row["stellar_address"],
        credits=int(row["credits"]),
        total_queries=int(row["total_queries"]),
        total_spent_xlm=round(float(row["total_spent_xlm"]), 7),
        status=row["status"],
        created_at=row["created_at"],
        last_seen_at=row["last_seen_at"],
    )


@router.post(
    "/register",
    summary="Register an AI agent",
    description=(
        "Creates an agent, grants the free trial credits, and returns a ready-to-use "
        "access token so a new agent can query immediately."
    ),
)
async def register_agent(body: AgentRegistration) -> dict[str, Any]:
    agent = await run_in_threadpool(
        repo.create_agent,
        body.name,
        description=body.description,
        stellar_address=body.stellar_address,
        webhook_url=body.webhook_url,
    )
    token, claims = create_access_token(agent["agent_id"])
    return {
        "agent": _to_model(agent).model_dump(),
        "access_token": token,
        "token_type": "Bearer",
        "expires_in": claims.seconds_remaining,
        "free_credits": int(agent["credits"]),
    }


@router.get("", summary="List registered agents")
async def list_agents(limit: int = 50) -> dict[str, Any]:
    rows = await run_in_threadpool(repo.list_agents, min(limit, 200))
    return {
        "agents": [_to_model(row).model_dump() for row in rows],
        **repo.agent_totals(),
    }


@router.get("/{agent_id}", response_model=AgentModel, summary="Get an agent")
async def get_agent(agent_id: str) -> AgentModel:
    row = await run_in_threadpool(repo.get_agent, agent_id)
    if row is None:
        raise NotFoundError(f"Agent '{agent_id}' is not registered.")
    return _to_model(row)


@router.get("/{agent_id}/usage", summary="Usage and spend for an agent")
async def agent_usage(agent_id: str) -> dict[str, Any]:
    row = await run_in_threadpool(repo.get_agent, agent_id)
    if row is None:
        raise NotFoundError(f"Agent '{agent_id}' is not registered.")
    return {
        "agent_id": agent_id,
        "credits_remaining": int(row["credits"]),
        "total_queries": int(row["total_queries"]),
        "total_spent_xlm": round(float(row["total_spent_xlm"]), 7),
        "ledger": await run_in_threadpool(repo.list_ledger, agent_id, 25),
        "payments": await run_in_threadpool(repo.list_payments, 10, agent_id),
    }


@router.post("/{agent_id}/token", summary="Mint a fresh access token for an agent")
async def refresh_token(agent_id: str) -> dict[str, Any]:
    row = await run_in_threadpool(repo.get_or_create_agent, agent_id)
    token, claims = create_access_token(agent_id)
    return {
        "access_token": token,
        "token_type": "Bearer",
        "expires_in": claims.seconds_remaining,
        "credits": int(row["credits"]),
    }
