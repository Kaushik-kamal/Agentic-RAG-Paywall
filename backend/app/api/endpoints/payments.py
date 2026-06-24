"""Payment endpoints — wired to StellarPaymentService."""
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.stellar_service import stellar_service

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Models ────────────────────────────────────────────────────────────────────

class PaymentChallengeRequest(BaseModel):
    agent_id: str


class PaymentVerifyRequest(BaseModel):
    transaction_hash: str
    agent_id: str


class PaymentChallengeResponse(BaseModel):
    destination: str
    amount_xlm: float
    asset: str
    network: str
    memo: str
    expires_at: str


class PaymentVerifyResponse(BaseModel):
    verified: bool
    access_token: Optional[str] = None
    expires_in: Optional[int] = None
    token_type: Optional[str] = None
    reason: Optional[str] = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/price")
async def get_query_price():
    """Return the current price per RAG query in XLM."""
    stats = stellar_service.get_stats()
    return {
        "price_xlm": stats["price_per_query_xlm"],
        "price_usd_approx": round(stats["price_per_query_xlm"] * 0.10, 4),
        "currency": "XLM",
        "network": stats["network"],
    }


@router.post("/challenge", response_model=PaymentChallengeResponse)
async def get_payment_challenge(request: PaymentChallengeRequest):
    """
    Get an x402 payment challenge for an agent.
    The agent must send XLM to the returned destination address.
    """
    try:
        challenge = await stellar_service.create_payment_request(request.agent_id)
        return PaymentChallengeResponse(**challenge)
    except Exception as e:
        logger.exception("Challenge creation failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/verify", response_model=PaymentVerifyResponse)
async def verify_payment(request: PaymentVerifyRequest):
    """
    Verify a Stellar transaction hash and issue an access token.
    Pass 'demo_<anything>' as tx_hash to test in demo mode.
    """
    try:
        result = await stellar_service.verify_transaction(
            request.transaction_hash, request.agent_id
        )
        if not result.get("verified"):
            return PaymentVerifyResponse(
                verified=False,
                reason=result.get("reason", "Verification failed"),
            )

        token_data = await stellar_service.issue_access_token(
            request.agent_id, request.transaction_hash
        )
        return PaymentVerifyResponse(
            verified=True,
            access_token=token_data["access_token"],
            expires_in=token_data["expires_in"],
            token_type=token_data["token_type"],
        )
    except Exception as e:
        logger.exception("Payment verification failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stats")
async def get_payment_stats():
    """Return payment statistics."""
    return stellar_service.get_stats()
