"""x402 payment endpoints: pricing, challenge, verification, balance."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Response
from starlette.concurrency import run_in_threadpool

from app.core.config import settings
from app.core.security import create_access_token
from app.db import repository as repo
from app.schemas import (
    BalanceResponse,
    ChallengeRequest,
    ChallengeResponse,
    VerifyRequest,
    VerifyResponse,
)
from app.services import x402
from app.services.stellar_service import stellar_service

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/price", summary="Current price per query")
async def get_price() -> dict[str, Any]:
    return stellar_service.pricing()


@router.post(
    "/challenge",
    response_model=ChallengeResponse,
    summary="Request an x402 payment challenge",
    description=(
        "Returns the destination address, exact amount, and a unique memo. "
        "The memo binds the on-chain payment to this challenge so it can be "
        "attributed to your agent."
    ),
)
async def create_challenge(body: ChallengeRequest, response: Response) -> ChallengeResponse:
    await run_in_threadpool(repo.get_or_create_agent, body.agent_id)
    challenge = await run_in_threadpool(
        stellar_service.get_or_create_challenge, body.agent_id
    )
    for key, value in x402.challenge_headers(challenge).items():
        response.headers[key] = value
    return ChallengeResponse(**{k: challenge[k] for k in ChallengeResponse.model_fields})


@router.post(
    "/verify",
    response_model=VerifyResponse,
    summary="Verify a Stellar payment and mint an access token",
    responses={400: {"description": "Verification failed (replay, underpaid, memo mismatch)"}},
)
async def verify_payment(body: VerifyRequest) -> VerifyResponse:
    await run_in_threadpool(repo.get_or_create_agent, body.agent_id)
    outcome = await run_in_threadpool(
        stellar_service.verify_payment,
        body.transaction_hash,
        body.agent_id,
        body.challenge_id,
    )

    token, claims = create_access_token(body.agent_id)
    credits = await run_in_threadpool(repo.get_credits, body.agent_id)

    explorer = (
        f"{settings.stellar_explorer_base}/tx/{body.transaction_hash}"
        if outcome.mode == "live"
        else None
    )
    return VerifyResponse(
        verified=True,
        access_token=token,
        expires_in=claims.seconds_remaining,
        credits_granted=outcome.credits_granted,
        credits_remaining=credits,
        amount_xlm=round(outcome.amount_xlm, 7),
        mode=outcome.mode,
        transaction_hash=body.transaction_hash,
        explorer_url=explorer,
    )


@router.get(
    "/balance/{agent_id}",
    response_model=BalanceResponse,
    summary="Remaining query credits for an agent",
)
async def get_balance(agent_id: str) -> BalanceResponse:
    agent = await run_in_threadpool(repo.get_or_create_agent, agent_id)
    return BalanceResponse(
        agent_id=agent_id,
        credits=int(agent["credits"]),
        total_queries=int(agent["total_queries"]),
        total_spent_xlm=round(float(agent["total_spent_xlm"]), 7),
        price_xlm=settings.x402_price_xlm,
        credits_per_payment=settings.x402_credits_per_payment,
    )


@router.get("/ledger/{agent_id}", summary="Credit ledger for an agent")
async def get_ledger(agent_id: str, limit: int = 25) -> dict[str, Any]:
    entries = await run_in_threadpool(repo.list_ledger, agent_id, min(limit, 100))
    return {"agent_id": agent_id, "entries": entries}


@router.get("/history", summary="Recent verified payments")
async def payment_history(limit: int = 20) -> dict[str, Any]:
    payments = await run_in_threadpool(repo.list_payments, min(limit, 100))
    for payment in payments:
        payment["explorer_url"] = (
            f"{settings.stellar_explorer_base}/tx/{payment['tx_hash']}"
            if payment["mode"] == "live"
            else None
        )
    return {"payments": payments, **repo.payment_totals()}


@router.get("/account", summary="Treasury account status on Stellar")
async def account_status() -> dict[str, Any]:
    return await run_in_threadpool(stellar_service.account_status)


@router.get("/stats", summary="Aggregate payment statistics")
async def payment_stats() -> dict[str, Any]:
    return await run_in_threadpool(stellar_service.stats)
