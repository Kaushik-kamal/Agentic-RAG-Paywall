"""Conversation history — chat memory that survives a refresh."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from starlette.concurrency import run_in_threadpool

from app.core.errors import NotFoundError
from app.db import repository as repo

router = APIRouter()


@router.get("", summary="List an agent's conversations")
async def list_conversations(agent_id: str, limit: int = 50) -> dict[str, Any]:
    conversations = await run_in_threadpool(
        repo.list_conversations, agent_id, min(limit, 200)
    )
    return {"conversations": conversations, "total": len(conversations)}


@router.get("/{conversation_id}", summary="Get a conversation with its messages")
async def get_conversation(conversation_id: str) -> dict[str, Any]:
    conversation = await run_in_threadpool(repo.get_conversation, conversation_id)
    if conversation is None:
        raise NotFoundError("Conversation not found.")
    messages = await run_in_threadpool(repo.list_messages, conversation_id)
    return {"conversation": conversation, "messages": messages}


@router.delete("/{conversation_id}", summary="Delete a conversation")
async def delete_conversation(conversation_id: str, agent_id: str) -> dict[str, Any]:
    deleted = await run_in_threadpool(
        repo.delete_conversation, conversation_id, agent_id
    )
    if not deleted:
        raise NotFoundError("Conversation not found for this agent.")
    return {"deleted": True, "conversation_id": conversation_id}
