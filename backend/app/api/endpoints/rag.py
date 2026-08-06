"""Knowledge API: paid answer generation (buffered + streaming) and free search."""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from starlette.concurrency import iterate_in_threadpool, run_in_threadpool

from app.api.deps import PaidAgent, QueryLimit
from app.core.config import settings
from app.core.errors import AppError
from app.core.logging import request_id_ctx
from app.db import repository as repo
from app.schemas import QueryRequest, QueryResponse, SearchRequest
from app.services import atlas
from app.services.rag_service import rag_service

logger = logging.getLogger(__name__)
router = APIRouter()


_SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",  # disable nginx buffering
    # GZipMiddleware skips responses that already declare an encoding.
    # Compressing an event stream buffers it and destroys the live feel.
    "Content-Encoding": "identity",
}

#: Characters per replayed frame — enough to feel alive without pretending the
#: answer is being generated when it is not.
_REPLAY_CHUNK = 90


def _sse(event: str, payload: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, default=str)}\n\n"


async def _replay_cached(
    cached: dict[str, Any],
    agent_id: str,
    conversation_id: str | None,
    balance: int,
) -> AsyncIterator[str]:
    """Replay a cached answer over the same event sequence a live one uses.

    The client should not need a second code path, and the ``cached`` flag on
    the terminal event tells it plainly that no credit was charged.
    """
    yield _sse(
        "start",
        {
            "agent_id": agent_id,
            "conversation_id": conversation_id,
            "credits_remaining": balance,
            "cost_xlm": 0.0,
            "model": cached.get("model"),
            "cached": True,
        },
    )
    yield _sse(
        "status", {"stage": "cached", "message": "Served from the semantic cache"}
    )
    yield _sse(
        "retrieval",
        {
            "citations": cached.get("citations", []),
            "trace": cached.get("retrieval", {}),
            "candidates": cached.get("candidates", []),
            "retrieval_ms": 0,
        },
    )

    answer = cached.get("answer", "")
    for start in range(0, len(answer), _REPLAY_CHUNK):
        yield _sse("token", {"text": answer[start : start + _REPLAY_CHUNK]})

    if cached.get("follow_ups"):
        yield _sse("follow_ups", {"questions": cached["follow_ups"]})

    yield _sse("done", {**cached, "credits_remaining": balance})


def _ensure_conversation(agent_id: str, request: QueryRequest) -> str | None:
    if not request.remember:
        return None
    if request.conversation_id:
        conversation = repo.get_conversation(request.conversation_id)
        if conversation and conversation["agent_id"] == agent_id:
            return request.conversation_id
    return repo.create_conversation(agent_id, request.query)["conversation_id"]


@router.post(
    "/query",
    response_model=QueryResponse,
    summary="Ask the knowledge base (costs 1 credit)",
    responses={
        402: {"description": "Payment required — settle an x402 payment first"},
        409: {"description": "Knowledge base is empty or has no relevant passage"},
    },
)
async def query_knowledge_base(
    body: QueryRequest, claims: PaidAgent, _limit: QueryLimit
) -> QueryResponse:
    agent_id = claims.agent_id
    conversation_id = await run_in_threadpool(_ensure_conversation, agent_id, body)
    history = (
        await run_in_threadpool(repo.recent_turns, conversation_id)
        if conversation_id
        else []
    )

    # A repeat question — however it is phrased — is served free. Checked
    # before the debit so the caller is never charged for it.
    cached = await run_in_threadpool(rag_service.lookup_cached_answer, body.query)
    if cached is not None:
        balance = await run_in_threadpool(repo.get_credits, agent_id)
        await run_in_threadpool(
            repo.log_query,
            agent_id=agent_id,
            question=body.query,
            conversation_id=conversation_id,
            answer_preview=cached["answer"][:280],
            confidence=(cached.get("confidence") or {}).get("score"),
            latency_ms=0,
            tokens_used=0,
            chunks_used=len(cached.get("citations", [])),
            status="cached",
        )
        return QueryResponse(
            **{**cached, "question": body.query},
            credits_remaining=balance,
            conversation_id=conversation_id,
        )

    remaining = await run_in_threadpool(repo.consume_credit, agent_id)
    if remaining is None:  # lost a race against a concurrent query
        from app.core.errors import InsufficientCreditsError

        raise InsufficientCreditsError()

    try:
        result = await run_in_threadpool(
            rag_service.answer,
            body.query,
            history=history,
            document_ids=body.document_ids,
        )
    except AppError:
        await run_in_threadpool(repo.refund_credit, agent_id)
        await run_in_threadpool(
            repo.log_query,
            agent_id=agent_id,
            question=body.query,
            conversation_id=conversation_id,
            status="failed",
        )
        raise
    except Exception:
        await run_in_threadpool(repo.refund_credit, agent_id)
        logger.exception("Unhandled RAG failure")
        raise

    payload = result.to_dict()
    if conversation_id:
        await run_in_threadpool(repo.add_message, conversation_id, "user", body.query)
        await run_in_threadpool(
            repo.add_message,
            conversation_id,
            "assistant",
            result.answer,
            citations=result.citations,
            metrics={
                "confidence": result.confidence,
                "latency_ms": result.latency_ms,
                "follow_ups": result.follow_ups,
                "model": result.model,
            },
        )

    await run_in_threadpool(
        repo.log_query,
        agent_id=agent_id,
        question=body.query,
        conversation_id=conversation_id,
        answer_preview=result.answer[:280],
        confidence=result.confidence["score"],
        latency_ms=result.latency_ms,
        tokens_used=result.tokens_used,
        chunks_used=len(result.citations),
    )

    return QueryResponse(
        **payload, credits_remaining=remaining, conversation_id=conversation_id
    )


@router.post(
    "/stream",
    summary="Ask the knowledge base with a streamed answer (costs 1 credit)",
    response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {}}}},
)
async def stream_knowledge_base(
    body: QueryRequest, request: Request, claims: PaidAgent, _limit: QueryLimit
) -> StreamingResponse:
    """Server-Sent Events.

    Event sequence: ``status`` → ``retrieval`` → ``token``* → ``follow_ups``
    → ``done``. Any failure emits a terminal ``error`` event and refunds the
    credit, so a dropped connection never costs the caller.
    """
    agent_id = claims.agent_id
    request_id = request_id_ctx.get()
    conversation_id = await run_in_threadpool(_ensure_conversation, agent_id, body)
    history = (
        await run_in_threadpool(repo.recent_turns, conversation_id)
        if conversation_id
        else []
    )

    cached = await run_in_threadpool(rag_service.lookup_cached_answer, body.query)
    if cached is not None:
        balance = await run_in_threadpool(repo.get_credits, agent_id)
        await run_in_threadpool(
            repo.log_query,
            agent_id=agent_id,
            question=body.query,
            conversation_id=conversation_id,
            answer_preview=cached["answer"][:280],
            confidence=(cached.get("confidence") or {}).get("score"),
            latency_ms=0,
            tokens_used=0,
            chunks_used=len(cached.get("citations", [])),
            status="cached",
        )
        return StreamingResponse(
            _replay_cached(cached, agent_id, conversation_id, balance),
            media_type="text/event-stream",
            headers=_SSE_HEADERS,
        )

    remaining = await run_in_threadpool(repo.consume_credit, agent_id)
    if remaining is None:
        from app.core.errors import InsufficientCreditsError

        raise InsufficientCreditsError()

    async def event_stream() -> AsyncIterator[str]:
        token = request_id_ctx.set(request_id)
        charged = True
        answer = ""
        final: dict[str, Any] = {}
        try:
            yield _sse(
                "start",
                {
                    "agent_id": agent_id,
                    "conversation_id": conversation_id,
                    "credits_remaining": remaining,
                    "cost_xlm": settings.x402_price_xlm,
                    "model": settings.gemini_model,
                },
            )

            generator = rag_service.stream_answer(
                body.query, history=history, document_ids=body.document_ids
            )
            async for event, payload in iterate_in_threadpool(generator):
                if await request.is_disconnected():
                    logger.info("Client disconnected mid-stream; aborting generation")
                    break
                if event == "done":
                    final = payload
                    answer = payload.get("answer", "")
                    payload = {**payload, "credits_remaining": remaining}
                yield _sse(event, payload)

        except AppError as exc:
            charged = False
            await run_in_threadpool(repo.refund_credit, agent_id)
            yield _sse(
                "error",
                {
                    "code": exc.code,
                    "message": exc.message,
                    "details": exc.details,
                    "refunded": True,
                },
            )
        except Exception:
            charged = False
            await run_in_threadpool(repo.refund_credit, agent_id)
            logger.exception("Streaming RAG failure")
            yield _sse(
                "error",
                {
                    "code": "internal_error",
                    "message": "Generation failed unexpectedly. Your credit was refunded.",
                    "refunded": True,
                },
            )
        finally:
            if charged and answer:
                if conversation_id:
                    await run_in_threadpool(
                        repo.add_message, conversation_id, "user", body.query
                    )
                    await run_in_threadpool(
                        repo.add_message,
                        conversation_id,
                        "assistant",
                        answer,
                        citations=final.get("citations", []),
                        metrics={
                            "confidence": final.get("confidence"),
                            "latency_ms": final.get("latency_ms"),
                            "follow_ups": final.get("follow_ups", []),
                            "model": final.get("model"),
                        },
                    )
                await run_in_threadpool(
                    repo.log_query,
                    agent_id=agent_id,
                    question=body.query,
                    conversation_id=conversation_id,
                    answer_preview=answer[:280],
                    confidence=(final.get("confidence") or {}).get("score"),
                    latency_ms=final.get("latency_ms"),
                    tokens_used=final.get("tokens_used"),
                    chunks_used=len(final.get("citations", [])),
                )
            elif charged:
                await run_in_threadpool(repo.refund_credit, agent_id)
            request_id_ctx.reset(token)

    return StreamingResponse(
        event_stream(), media_type="text/event-stream", headers=_SSE_HEADERS
    )


@router.post("/search", summary="Semantic search — retrieval only, no LLM, free")
async def semantic_search(body: SearchRequest) -> dict[str, Any]:
    """Inspect what the retriever finds without paying for generation.

    Useful for tuning, and for agents that only need passages.
    """
    return await run_in_threadpool(
        rag_service.search,
        body.query,
        top_k=body.top_k,
        document_ids=body.document_ids,
    )


@router.get(
    "/atlas",
    summary="2D map of the embedding space",
    description=(
        "Projects every indexed chunk onto its two principal components. PCA is "
        "linear, so a query can later be placed in the same basis — which is what "
        "makes the live overlay honest rather than decorative."
    ),
)
async def corpus_atlas() -> dict[str, Any]:
    return await run_in_threadpool(atlas.build_atlas)


@router.post(
    "/atlas/project",
    summary="Place a query in the atlas — free, no LLM",
)
async def project_into_atlas(body: SearchRequest) -> dict[str, Any]:
    return await run_in_threadpool(atlas.project_query, body.query, body.top_k)


@router.get("/stats", summary="RAG pipeline configuration and index size")
async def rag_stats() -> dict[str, Any]:
    return await run_in_threadpool(rag_service.stats)
