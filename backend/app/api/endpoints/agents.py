"""
Aggregated stats endpoint + agents endpoint wired to in-memory store.
Production: replace _agents dict with a database.
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.rag_service import rag_service
from app.services.stellar_service import stellar_service

logger = logging.getLogger(__name__)
router = APIRouter()

# In-memory agent registry (swap for DB in production)
_agents: dict[str, dict] = {}


# ── Models ────────────────────────────────────────────────────────────────────

class AgentRegistration(BaseModel):
    name: str
    description: Optional[str] = None
    stellar_address: str
    webhook_url: Optional[str] = None


class AgentResponse(BaseModel):
    agent_id: str
    name: str
    stellar_address: str
    created_at: str
    status: str


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/register", response_model=AgentResponse)
async def register_agent(agent: AgentRegistration):
    """Register a new AI agent with its Stellar wallet address."""
    agent_id = f"agent_{uuid.uuid4().hex[:12]}"
    record = {
        "agent_id": agent_id,
        "name": agent.name,
        "description": agent.description,
        "stellar_address": agent.stellar_address,
        "webhook_url": agent.webhook_url,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "status": "active",
        "query_count": 0,
        "xlm_spent": 0.0,
    }
    _agents[agent_id] = record
    logger.info("Registered agent %s (%s)", agent_id, agent.name)
    return AgentResponse(**record)


@router.get("/{agent_id}", response_model=AgentResponse)
async def get_agent(agent_id: str):
    """Get agent details."""
    record = _agents.get(agent_id)
    if not record:
        raise HTTPException(status_code=404, detail="Agent not found")
    return AgentResponse(**record)


@router.get("/{agent_id}/usage")
async def get_agent_usage(agent_id: str):
    """Get an agent's query count and total XLM spent."""
    record = _agents.get(agent_id)
    if not record:
        raise HTTPException(status_code=404, detail="Agent not found")
    return {
        "agent_id": agent_id,
        "query_count": record["query_count"],
        "xlm_spent": record["xlm_spent"],
    }


@router.get("/")
async def list_agents():
    """List all registered agents."""
    return {"agents": list(_agents.values()), "total": len(_agents)}
