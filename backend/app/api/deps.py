"""Shared FastAPI dependencies: paywall enforcement, admin auth, rate limits."""

from __future__ import annotations

import logging
from typing import Annotated, Any

from fastapi import Depends, Header, Request

from app.core.config import settings
from app.core.errors import (
    ForbiddenError,
    InsufficientCreditsError,
    PaymentRequiredError,
    RateLimitedError,
    UnauthorizedError,
)
from app.core.rate_limit import query_limiter, upload_limiter
from app.core.security import TokenClaims, constant_time_equals, decode_access_token
from app.db import repository as repo
from app.services import x402
from app.services.stellar_service import stellar_service

logger = logging.getLogger(__name__)


def client_key(request: Request) -> str:
    """Best-effort client identity for rate limiting."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _payment_challenge(agent_id: str, reason: str) -> tuple[dict[str, Any], dict[str, str]]:
    challenge = stellar_service.get_or_create_challenge(agent_id)
    return x402.challenge_body(challenge, reason), x402.challenge_headers(challenge)


def require_paid_agent(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
) -> TokenClaims:
    """Enforce the paywall: a valid token **and** a positive credit balance.

    Credits are *not* debited here — the endpoint does that only once it is
    about to do real work, so a rejected request never costs the caller.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        anonymous = request.headers.get("x-agent-id", "anonymous")
        body, headers = _payment_challenge(
            anonymous, "Missing access token. Settle an x402 payment to continue."
        )
        raise PaymentRequiredError(
            "Payment required. Obtain an access token via the x402 flow.",
            details=body,
            headers=headers,
        )

    claims = decode_access_token(authorization[7:].strip())
    if claims is None:
        raise UnauthorizedError(
            "Access token is invalid or has expired. Request a new one after payment."
        )

    agent = repo.get_agent(claims.agent_id)
    if agent is None:
        raise UnauthorizedError("The agent on this token no longer exists.")
    if agent["status"] != "active":
        raise ForbiddenError("This agent has been suspended.")

    if int(agent["credits"]) <= 0:
        body, headers = _payment_challenge(
            claims.agent_id, "Credit balance exhausted. Top up to continue."
        )
        raise InsufficientCreditsError(
            "Query credits exhausted. Settle another x402 payment to continue.",
            details={**body, "credits": 0},
            headers=headers,
        )

    return claims


def require_admin(
    x_admin_key: Annotated[str | None, Header()] = None,
) -> bool:
    """Guard write operations on the shared knowledge base.

    When no key is configured (local development) the guard is open but every
    call is logged, so it is obvious in the terminal. Production configuration
    makes ``ADMIN_API_KEY`` mandatory — see ``Settings._harden_production``.
    """
    if not settings.admin_api_key:
        logger.warning(
            "Admin endpoint reached with no ADMIN_API_KEY configured — "
            "set one before exposing this deployment."
        )
        return True
    if not x_admin_key or not constant_time_equals(x_admin_key, settings.admin_api_key):
        raise ForbiddenError(
            "A valid X-Admin-Key header is required for knowledge-base changes."
        )
    return True


def enforce_query_limit(request: Request) -> None:
    result = query_limiter.check(client_key(request))
    if not result.allowed:
        raise RateLimitedError(
            "Too many queries. Try again shortly.",
            details={"retry_after_seconds": result.reset_after},
            headers={"Retry-After": str(result.reset_after)},
        )


def enforce_upload_limit(request: Request) -> None:
    result = upload_limiter.check(client_key(request))
    if not result.allowed:
        raise RateLimitedError(
            "Upload rate limit reached. Try again shortly.",
            details={"retry_after_seconds": result.reset_after},
            headers={"Retry-After": str(result.reset_after)},
        )


PaidAgent = Annotated[TokenClaims, Depends(require_paid_agent)]
AdminOnly = Annotated[bool, Depends(require_admin)]
QueryLimit = Annotated[None, Depends(enforce_query_limit)]
UploadLimit = Annotated[None, Depends(enforce_upload_limit)]
