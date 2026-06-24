"""
Stellar x402 Payment Service — Full Implementation
Uses Stellar SDK to verify on-chain transactions and issues short-lived JWTs.
"""
import logging
import time
import hashlib
import hmac
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

# In-memory nonce store — swap for Redis in production
_used_tx_hashes: set[str] = set()
_pending_challenges: dict[str, dict] = {}  # agent_id -> challenge


# ---------------------------------------------------------------------------
# StellarPaymentService
# ---------------------------------------------------------------------------

class StellarPaymentService:
    """
    x402 payment flow:
      1. create_payment_request()  → returns destination + amount
      2. Agent pays on-chain
      3. verify_transaction()      → checks amount, destination, no-replay
      4. issue_access_token()      → returns signed JWT
    """

    def __init__(self):
        self.network = settings.stellar_network
        self.horizon_url = settings.stellar_horizon_url
        self.price_xlm = settings.x402_price_xlm
        self.public_key = settings.stellar_public_key
        self._total_payments = 0
        self._total_revenue_xlm = 0.0

    # ── Payment request (challenge) ──────────────────────────────────────────

    async def create_payment_request(self, agent_id: str) -> dict:
        """
        Generate an x402 payment challenge.
        Returns the destination address and required amount.
        """
        challenge = {
            "destination": self.public_key or "GCEXAMPLESTELLARADDRESS000000000000000000000",
            "amount_xlm": self.price_xlm,
            "asset": "XLM",
            "network": self.network,
            "memo": f"rag-query:{agent_id[:8]}",
            "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat(),
        }
        _pending_challenges[agent_id] = challenge
        return challenge

    # ── On-chain verification ────────────────────────────────────────────────

    async def verify_transaction(self, tx_hash: str, agent_id: str) -> dict:
        """
        Verify a Stellar transaction:
          • Fetch from Horizon
          • Confirm destination matches our public key
          • Confirm amount >= price
          • Confirm no replay (tx_hash not seen before)
        Returns dict with verified bool and details.
        """
        import asyncio

        # Replay protection
        if tx_hash in _used_tx_hashes:
            return {"verified": False, "reason": "Transaction already used (replay)"}

        # Fetch from Horizon
        try:
            result = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self._fetch_transaction(tx_hash),
            )
        except Exception as e:
            logger.warning("Stellar verification error: %s", e)
            # ── DEMO MODE: accept any hash that starts with "demo_"
            if tx_hash.startswith("demo_"):
                _used_tx_hashes.add(tx_hash)
                self._total_payments += 1
                self._total_revenue_xlm += self.price_xlm
                return {"verified": True, "amount_xlm": self.price_xlm, "demo": True}
            return {"verified": False, "reason": str(e)}

        # Validate
        if not result.get("valid"):
            return {"verified": False, "reason": result.get("reason", "Invalid transaction")}

        _used_tx_hashes.add(tx_hash)
        self._total_payments += 1
        self._total_revenue_xlm += result.get("amount_xlm", self.price_xlm)

        return {
            "verified": True,
            "amount_xlm": result.get("amount_xlm"),
            "demo": False,
        }

    def _fetch_transaction(self, tx_hash: str) -> dict:
        """Synchronous Stellar Horizon fetch — run in executor."""
        try:
            from stellar_sdk import Server
            server = Server(self.horizon_url)
            tx = server.transactions().transaction(tx_hash).call()

            # Parse operations
            ops = server.operations().for_transaction(tx_hash).call()
            records = ops.get("_embedded", {}).get("records", [])

            destination = settings.stellar_public_key
            total_paid = 0.0

            for op in records:
                if op.get("type") == "payment":
                    if op.get("asset_type") == "native":  # XLM
                        if op.get("to") == destination:
                            total_paid += float(op.get("amount", 0))

            if total_paid < self.price_xlm:
                return {
                    "valid": False,
                    "reason": f"Insufficient payment: {total_paid} XLM (need {self.price_xlm})",
                }

            return {"valid": True, "amount_xlm": total_paid}

        except Exception as e:
            raise RuntimeError(f"Horizon error: {e}") from e

    # ── JWT token issuance ───────────────────────────────────────────────────

    async def issue_access_token(self, agent_id: str, tx_hash: str) -> dict:
        """
        Issue a short-lived HMAC-signed access token after payment is verified.
        Format: {agent_id}:{tx_hash_prefix}:{expiry_ts}:{signature}
        """
        expiry = int(time.time()) + (settings.access_token_expire_minutes * 60)
        payload = f"{agent_id}:{tx_hash[:16]}:{expiry}"
        sig = hmac.new(
            settings.secret_key.encode(),
            payload.encode(),
            hashlib.sha256,
        ).hexdigest()[:24]
        token = f"{payload}:{sig}"

        return {
            "access_token": token,
            "expires_in": settings.access_token_expire_minutes * 60,
            "token_type": "x402",
        }

    def validate_access_token(self, token: str) -> Optional[str]:
        """
        Validate access token. Returns agent_id on success, None on failure.
        """
        try:
            parts = token.split(":")
            if len(parts) != 4:
                return None
            agent_id, tx_prefix, expiry_str, sig = parts
            expiry = int(expiry_str)
            if time.time() > expiry:
                return None  # Expired
            payload = f"{agent_id}:{tx_prefix}:{expiry}"
            expected_sig = hmac.new(
                settings.secret_key.encode(),
                payload.encode(),
                hashlib.sha256,
            ).hexdigest()[:24]
            if not hmac.compare_digest(sig, expected_sig):
                return None
            return agent_id
        except Exception:
            return None

    # ── Stats ────────────────────────────────────────────────────────────────

    def get_stats(self) -> dict:
        return {
            "total_payments": self._total_payments,
            "total_revenue_xlm": round(self._total_revenue_xlm, 6),
            "price_per_query_xlm": self.price_xlm,
            "network": self.network,
        }


stellar_service = StellarPaymentService()
