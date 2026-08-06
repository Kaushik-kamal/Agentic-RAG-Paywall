"""Access-token minting and verification for the x402 paywall.

Tokens are compact, stateless, HMAC-SHA256 signed envelopes:

    argp.<base64url(payload)>.<base64url(signature)>

They authenticate *which agent* is calling. They deliberately do **not**
carry a credit balance — credits live in the ledger so a token cannot be
replayed for free queries after the balance is spent.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from dataclasses import dataclass
from typing import Any

from app.core.config import settings

TOKEN_PREFIX = "argp"


def _b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def _sign(payload: bytes) -> bytes:
    return hmac.new(settings.secret_key.encode(), payload, hashlib.sha256).digest()


@dataclass(frozen=True, slots=True)
class TokenClaims:
    agent_id: str
    token_id: str
    issued_at: int
    expires_at: int
    payment_id: str | None = None

    @property
    def seconds_remaining(self) -> int:
        return max(0, self.expires_at - int(time.time()))


def create_access_token(
    agent_id: str,
    *,
    payment_id: str | None = None,
    expires_in_minutes: int | None = None,
) -> tuple[str, TokenClaims]:
    now = int(time.time())
    ttl = (expires_in_minutes or settings.access_token_expire_minutes) * 60
    claims = TokenClaims(
        agent_id=agent_id,
        token_id=secrets.token_urlsafe(9),
        issued_at=now,
        expires_at=now + ttl,
        payment_id=payment_id,
    )
    body: dict[str, Any] = {
        "aid": claims.agent_id,
        "jti": claims.token_id,
        "iat": claims.issued_at,
        "exp": claims.expires_at,
    }
    if payment_id:
        body["pid"] = payment_id
    payload = json.dumps(body, separators=(",", ":"), sort_keys=True).encode()
    token = f"{TOKEN_PREFIX}.{_b64encode(payload)}.{_b64encode(_sign(payload))}"
    return token, claims


def decode_access_token(token: str) -> TokenClaims | None:
    """Return claims for a structurally valid, correctly signed, unexpired token."""
    try:
        prefix, payload_b64, signature_b64 = token.strip().split(".")
    except ValueError:
        return None
    if prefix != TOKEN_PREFIX:
        return None

    try:
        payload = _b64decode(payload_b64)
        signature = _b64decode(signature_b64)
    except (ValueError, TypeError):
        return None

    if not hmac.compare_digest(signature, _sign(payload)):
        return None

    try:
        body = json.loads(payload)
        claims = TokenClaims(
            agent_id=str(body["aid"]),
            token_id=str(body["jti"]),
            issued_at=int(body["iat"]),
            expires_at=int(body["exp"]),
            payment_id=body.get("pid"),
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        return None

    if claims.expires_at <= int(time.time()):
        return None
    return claims


def constant_time_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


def new_agent_id() -> str:
    return f"agent_{secrets.token_hex(6)}"


def new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(8)}"


def fingerprint(value: str) -> str:
    """Short, non-reversible identifier — safe to log."""
    return hashlib.sha256(value.encode()).hexdigest()[:12]
