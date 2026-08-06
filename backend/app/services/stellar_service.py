"""Stellar x402 settlement.

Flow
----
1. ``create_challenge``  → destination, exact amount, unique memo, expiry.
2. Agent submits a Stellar payment carrying that memo.
3. ``verify_payment``    → re-reads the transaction from Horizon and asserts
   destination, asset, amount, memo and success before granting credits.
4. Credits land in the ledger; the access token only proves *identity*, so a
   stolen token cannot buy free answers.

Replay protection is enforced by a UNIQUE constraint on ``payments.tx_hash``
rather than an in-memory set, so it survives a restart.
"""

from __future__ import annotations

import logging
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx

from app.core.config import settings
from app.core.errors import PaymentVerificationError
from app.db import repository as repo

logger = logging.getLogger(__name__)

SANDBOX_PREFIX = "sandbox_"
#: Horizon rounds to 7 decimals; allow for that when comparing amounts.
AMOUNT_TOLERANCE = 1e-7


@dataclass(slots=True)
class VerificationOutcome:
    verified: bool
    amount_xlm: float = 0.0
    credits_granted: int = 0
    mode: str = "live"
    reason: str | None = None
    ledger: int | None = None
    source_account: str | None = None


class StellarPaymentService:
    # ── Challenge ────────────────────────────────────────────────────────────

    def create_challenge(self, agent_id: str) -> dict[str, Any]:
        destination = settings.stellar_public_key or "UNCONFIGURED"
        memo = f"x402-{secrets.token_hex(4)}"  # ≤ 28 bytes: fits MEMO_TEXT
        challenge = repo.create_challenge(
            agent_id=agent_id,
            destination=destination,
            amount_xlm=settings.x402_price_xlm,
            memo=memo,
            network=settings.stellar_network,
        )
        return self._decorate(challenge)

    def get_or_create_challenge(self, agent_id: str) -> dict[str, Any]:
        existing = repo.find_open_challenge(agent_id)
        if existing:
            return self._decorate(existing)
        return self.create_challenge(agent_id)

    def _decorate(self, challenge: dict[str, Any]) -> dict[str, Any]:
        return {
            **challenge,
            "asset": "XLM",
            "credits_granted": settings.x402_credits_per_payment,
            "sandbox_mode": settings.x402_sandbox_mode,
            "price_usd": settings.price_usd,
            "funding_url": (
                "https://friendbot.stellar.org"
                if settings.stellar_network == "testnet"
                else None
            ),
        }

    # ── Verification ─────────────────────────────────────────────────────────

    def verify_payment(
        self, tx_hash: str, agent_id: str, challenge_id: str | None = None
    ) -> VerificationOutcome:
        tx_hash = tx_hash.strip()
        if not tx_hash:
            raise PaymentVerificationError("A transaction hash is required.")

        if repo.payment_exists(tx_hash):
            raise PaymentVerificationError(
                "This transaction has already been redeemed.",
                details={"code": "replay_detected", "transaction_hash": tx_hash},
            )

        challenge = repo.get_challenge(challenge_id) if challenge_id else None
        if challenge:
            if challenge["agent_id"] != agent_id:
                raise PaymentVerificationError(
                    "This challenge belongs to a different agent."
                )
            if challenge["consumed_at"]:
                raise PaymentVerificationError("This challenge was already redeemed.")
            if datetime.fromisoformat(challenge["expires_at"]) < datetime.now(
                UTC
            ):
                raise PaymentVerificationError(
                    "This payment challenge expired. Request a new one.",
                    details={"code": "challenge_expired"},
                )

        if tx_hash.startswith(SANDBOX_PREFIX):
            outcome = self._verify_sandbox(tx_hash)
        else:
            outcome = self._verify_on_chain(tx_hash, challenge)

        if not outcome.verified:
            raise PaymentVerificationError(outcome.reason or "Verification failed.")

        credits = self._credits_for(outcome.amount_xlm)
        payment = repo.record_payment(
            agent_id=agent_id,
            tx_hash=tx_hash,
            amount_xlm=outcome.amount_xlm,
            credits_granted=credits,
            mode=outcome.mode,
            challenge_id=challenge["challenge_id"] if challenge else None,
        )
        repo.grant_credits(
            agent_id,
            credits,
            reason=f"x402_payment_{outcome.mode}",
            reference_id=payment["payment_id"],
        )
        if challenge:
            repo.consume_challenge(challenge["challenge_id"])

        outcome.credits_granted = credits
        logger.info(
            "Payment verified: agent=%s credits=%d mode=%s amount=%.7f",
            agent_id,
            credits,
            outcome.mode,
            outcome.amount_xlm,
        )
        return outcome

    def _credits_for(self, amount_xlm: float) -> int:
        """Paying more than the minimum buys proportionally more credits."""
        bundles = max(1, int((amount_xlm + AMOUNT_TOLERANCE) // settings.x402_price_xlm))
        return bundles * settings.x402_credits_per_payment

    def _verify_sandbox(self, tx_hash: str) -> VerificationOutcome:
        if not settings.x402_sandbox_mode:
            raise PaymentVerificationError(
                "Sandbox payments are disabled on this deployment. "
                "Submit a real Stellar transaction hash.",
                details={"code": "sandbox_disabled"},
            )
        if len(tx_hash) < len(SANDBOX_PREFIX) + 8:
            raise PaymentVerificationError("Malformed sandbox transaction hash.")
        return VerificationOutcome(
            verified=True, amount_xlm=settings.x402_price_xlm, mode="sandbox"
        )

    def _verify_on_chain(
        self, tx_hash: str, challenge: dict[str, Any] | None
    ) -> VerificationOutcome:
        if not settings.stellar_live_mode:
            raise PaymentVerificationError(
                "On-chain verification is unavailable: STELLAR_PUBLIC_KEY is not "
                "configured. Run `python scripts/setup_stellar.py` to provision a "
                "funded testnet account.",
                details={"code": "stellar_not_configured"},
            )

        base = settings.stellar_horizon_url.rstrip("/")
        try:
            with httpx.Client(timeout=12.0) as client:
                tx_response = client.get(f"{base}/transactions/{tx_hash}")
                if tx_response.status_code == 404:
                    return VerificationOutcome(
                        verified=False,
                        reason="Transaction not found on the Stellar network. "
                        "Wait a few seconds for it to settle, then retry.",
                    )
                tx_response.raise_for_status()
                transaction = tx_response.json()

                ops_response = client.get(
                    f"{base}/transactions/{tx_hash}/operations", params={"limit": 200}
                )
                ops_response.raise_for_status()
                operations = ops_response.json().get("_embedded", {}).get("records", [])
        except httpx.HTTPError as exc:
            logger.warning("Horizon request failed: %s", exc)
            raise PaymentVerificationError(
                "Could not reach the Stellar network to verify this payment. "
                "Please retry in a moment.",
                details={"code": "horizon_unreachable"},
            ) from exc

        if not transaction.get("successful", False):
            return VerificationOutcome(
                verified=False, reason="The Stellar transaction failed on-chain."
            )

        expected_memo = challenge["memo"] if challenge else None
        if expected_memo and transaction.get("memo") != expected_memo:
            return VerificationOutcome(
                verified=False,
                reason=(
                    f"Memo mismatch: expected '{expected_memo}'. The memo binds a "
                    "payment to its challenge — without it we cannot attribute the "
                    "payment to your agent."
                ),
            )

        destination = settings.stellar_public_key
        paid = 0.0
        for operation in operations:
            if operation.get("type") not in {"payment", "create_account"}:
                continue
            if operation.get("type") == "create_account":
                if operation.get("account") == destination:
                    paid += float(operation.get("starting_balance", 0) or 0)
                continue
            if operation.get("asset_type") != "native":
                continue
            if operation.get("to") != destination:
                continue
            paid += float(operation.get("amount", 0) or 0)

        if paid <= 0:
            return VerificationOutcome(
                verified=False,
                reason=f"No XLM payment to {destination[:8]}… found in this transaction.",
            )
        if paid + AMOUNT_TOLERANCE < settings.x402_price_xlm:
            return VerificationOutcome(
                verified=False,
                reason=(
                    f"Underpayment: {paid:.7f} XLM received, "
                    f"{settings.x402_price_xlm} XLM required."
                ),
            )

        return VerificationOutcome(
            verified=True,
            amount_xlm=paid,
            mode="live",
            ledger=transaction.get("ledger"),
            source_account=transaction.get("source_account"),
        )

    # ── Diagnostics ──────────────────────────────────────────────────────────

    def account_status(self) -> dict[str, Any]:
        """Balance and reachability of the treasury account."""
        status: dict[str, Any] = {
            "network": settings.stellar_network,
            "configured": settings.stellar_live_mode,
            "public_key": settings.stellar_public_key or None,
            "sandbox_mode": settings.x402_sandbox_mode,
            "horizon_url": settings.stellar_horizon_url,
            "explorer_url": (
                f"{settings.stellar_explorer_base}/account/{settings.stellar_public_key}"
                if settings.stellar_live_mode
                else None
            ),
        }
        if not settings.stellar_live_mode:
            status["status"] = "unconfigured"
            return status

        try:
            with httpx.Client(timeout=6.0) as client:
                response = client.get(
                    f"{settings.stellar_horizon_url.rstrip('/')}"
                    f"/accounts/{settings.stellar_public_key}"
                )
            if response.status_code == 404:
                status["status"] = "unfunded"
                status["detail"] = (
                    "Account does not exist on-chain yet. Fund it with Friendbot."
                )
                return status
            response.raise_for_status()
            balances = response.json().get("balances", [])
            native = next(
                (b for b in balances if b.get("asset_type") == "native"), None
            )
            status["status"] = "ok"
            status["balance_xlm"] = float(native["balance"]) if native else 0.0
        except httpx.HTTPError as exc:
            status["status"] = "unreachable"
            status["detail"] = str(exc)
        return status

    def pricing(self) -> dict[str, Any]:
        return {
            "price_xlm": settings.x402_price_xlm,
            "price_usd": settings.price_usd,
            "credits_per_payment": settings.x402_credits_per_payment,
            "price_per_credit_xlm": round(
                settings.x402_price_xlm / settings.x402_credits_per_payment, 8
            ),
            "free_credits_on_signup": settings.x402_free_credits,
            "asset": "XLM",
            "network": settings.stellar_network,
            "sandbox_mode": settings.x402_sandbox_mode,
            "settlement_seconds": 5,
        }

    def stats(self) -> dict[str, Any]:
        return {**repo.payment_totals(), **self.pricing()}


stellar_service = StellarPaymentService()
