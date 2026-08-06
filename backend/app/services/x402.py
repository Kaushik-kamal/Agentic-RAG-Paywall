"""HTTP 402 protocol surface.

x402 revives the long-reserved ``402 Payment Required`` status code: the
server answers an unpaid request with machine-readable payment instructions,
the client settles on-chain, and retries. These helpers keep the header names
and the JSON body in one place so the API, the docs, and the reference agent
client can never drift apart.
"""

from __future__ import annotations

from typing import Any

from app.core.config import settings

HEADER_ADDRESS = "X-Payment-Address"
HEADER_AMOUNT = "X-Payment-Amount"
HEADER_ASSET = "X-Payment-Asset"
HEADER_NETWORK = "X-Payment-Network"
HEADER_MEMO = "X-Payment-Memo"
HEADER_CHALLENGE = "X-Payment-Challenge"
HEADER_EXPIRES = "X-Payment-Expires"
HEADER_CREDITS = "X-Payment-Credits"
HEADER_VERIFY_URL = "X-Payment-Verify-Url"
HEADER_PROTOCOL = "X-Payment-Protocol"

PROTOCOL_VERSION = "x402/1.0 stellar"

#: Exposed so browsers can read the challenge from a cross-origin 402.
EXPOSED_HEADERS = [
    HEADER_ADDRESS,
    HEADER_AMOUNT,
    HEADER_ASSET,
    HEADER_NETWORK,
    HEADER_MEMO,
    HEADER_CHALLENGE,
    HEADER_EXPIRES,
    HEADER_CREDITS,
    HEADER_VERIFY_URL,
    HEADER_PROTOCOL,
    "X-Request-Id",
    "X-Response-Time-Ms",
    "X-RateLimit-Limit",
    "X-RateLimit-Remaining",
]


def challenge_headers(challenge: dict[str, Any]) -> dict[str, str]:
    return {
        HEADER_PROTOCOL: PROTOCOL_VERSION,
        HEADER_ADDRESS: str(challenge["destination"]),
        HEADER_AMOUNT: str(challenge["amount_xlm"]),
        HEADER_ASSET: "XLM",
        HEADER_NETWORK: str(challenge["network"]),
        HEADER_MEMO: str(challenge["memo"]),
        HEADER_CHALLENGE: str(challenge["challenge_id"]),
        HEADER_EXPIRES: str(challenge["expires_at"]),
        HEADER_CREDITS: str(settings.x402_credits_per_payment),
        HEADER_VERIFY_URL: f"{settings.api_prefix}/payments/verify",
    }


def challenge_body(challenge: dict[str, Any], reason: str) -> dict[str, Any]:
    return {
        "protocol": PROTOCOL_VERSION,
        "reason": reason,
        "destination": challenge["destination"],
        "amount_xlm": challenge["amount_xlm"],
        "asset": "XLM",
        "network": challenge["network"],
        "memo": challenge["memo"],
        "challenge_id": challenge["challenge_id"],
        "expires_at": challenge["expires_at"],
        "credits_granted": settings.x402_credits_per_payment,
        "verify_url": f"{settings.api_prefix}/payments/verify",
        "sandbox_mode": settings.x402_sandbox_mode,
        "instructions": (
            "Send the exact amount to the destination with the given memo, then POST "
            "{transaction_hash, agent_id, challenge_id} to the verify URL to receive "
            "an access token."
        ),
    }
