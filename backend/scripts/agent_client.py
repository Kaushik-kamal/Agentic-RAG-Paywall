"""Reference autonomous agent — the full x402 loop against a live API.

This is the honest version of the demo: it creates its own Stellar keypair,
funds it from Friendbot, submits a **real payment on the Stellar testnet**,
and spends the credits it bought. No mocks, no sandbox hashes.

    python scripts/agent_client.py "How does Reciprocal Rank Fusion work?"
    python scripts/agent_client.py --sandbox "..."   # skip the chain
    python scripts/agent_client.py --stream "..."    # token-by-token output

Requires the API to be running (``uvicorn app.main:app --port 8000``).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import httpx

BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

DEFAULT_API = "http://localhost:8000/api/v1"
FRIENDBOT = "https://friendbot.stellar.org"
HORIZON = "https://horizon-testnet.stellar.org"

DIM = "\033[38;5;244m"
BOLD = "\033[1m"
OK = "\033[38;5;42m"
WARN = "\033[38;5;214m"
ERR = "\033[38;5;203m"
ACCENT = "\033[38;5;141m"
RESET = "\033[0m"


def step(number: int, title: str) -> None:
    print(f"\n{ACCENT}{BOLD}[{number}]{RESET} {BOLD}{title}{RESET}")


def detail(label: str, value: str) -> None:
    print(f"    {DIM}{label:<18}{RESET}{value}")


class AgentWallet:
    """A throwaway Stellar identity that can pay for its own answers."""

    def __init__(self) -> None:
        from stellar_sdk import Keypair

        self.keypair = Keypair.random()

    @property
    def public_key(self) -> str:
        return self.keypair.public_key

    def fund(self) -> float:
        with httpx.Client(timeout=45.0) as client:
            client.get(FRIENDBOT, params={"addr": self.public_key})
            response = client.get(f"{HORIZON}/accounts/{self.public_key}")
            response.raise_for_status()
            balances = response.json().get("balances", [])
        native = next((b for b in balances if b.get("asset_type") == "native"), None)
        return float(native["balance"]) if native else 0.0

    def pay(self, destination: str, amount: float, memo: str) -> str:
        """Submit a real payment and return the transaction hash."""
        from stellar_sdk import Asset, Network, Server, TransactionBuilder

        server = Server(HORIZON)
        source = server.load_account(self.public_key)
        transaction = (
            TransactionBuilder(
                source_account=source,
                network_passphrase=Network.TESTNET_NETWORK_PASSPHRASE,
                base_fee=200,
            )
            .add_text_memo(memo)
            .append_payment_op(
                destination=destination, asset=Asset.native(), amount=f"{amount:.7f}"
            )
            .set_timeout(60)
            .build()
        )
        transaction.sign(self.keypair)
        response = server.submit_transaction(transaction)
        return str(response["hash"])


def run(args: argparse.Namespace) -> int:
    api = args.api.rstrip("/")
    agent_id = f"agent_ref_{int(time.time()) % 10**8}"
    started = time.perf_counter()

    print(f"\n{BOLD}Agentic RAG Paywall — reference agent{RESET}")
    print(f"{DIM}{'─' * 62}{RESET}")
    detail("Agent id", agent_id)
    detail("API", api)
    detail("Mode", "sandbox (no chain)" if args.sandbox else "live Stellar testnet")

    with httpx.Client(timeout=180.0) as client:
        # ── 1. Unpaid request → 402 ──────────────────────────────────────────
        step(1, "Request the knowledge API without paying")
        unpaid = client.post(
            f"{api}/rag/query", json={"query": args.question, "agent_id": agent_id}
        )
        detail("Status", f"{unpaid.status_code} {unpaid.reason_phrase}")
        if unpaid.status_code != 402:
            print(f"{WARN}    Expected 402; the paywall may be misconfigured.{RESET}")

        for header in ("X-Payment-Address", "X-Payment-Amount", "X-Payment-Memo"):
            if header in unpaid.headers:
                detail(header, unpaid.headers[header])

        # ── 2. Fetch the challenge ───────────────────────────────────────────
        step(2, "Fetch the x402 payment challenge")
        challenge = client.post(
            f"{api}/payments/challenge", json={"agent_id": agent_id}
        )
        challenge.raise_for_status()
        chal = challenge.json()
        detail("Destination", chal["destination"])
        detail("Amount", f"{chal['amount_xlm']} XLM  (~${chal['price_usd']:.6f})")
        detail("Memo", chal["memo"])
        detail("Buys", f"{chal['credits_granted']} query credits")
        detail("Expires", chal["expires_at"])

        # ── 3. Settle ────────────────────────────────────────────────────────
        if args.sandbox:
            step(3, "Settle (sandbox — no chain involved)")
            tx_hash = f"sandbox_{int(time.time())}_{agent_id[-6:]}"
            detail("Transaction", tx_hash)
        else:
            step(3, "Create and fund a Stellar testnet wallet")
            wallet = AgentWallet()
            detail("Public key", wallet.public_key)
            balance = wallet.fund()
            detail("Funded", f"{balance:,.2f} XLM via Friendbot")

            step(4, "Sign and submit the payment on-chain")
            settle_started = time.perf_counter()
            tx_hash = wallet.pay(chal["destination"], chal["amount_xlm"], chal["memo"])
            detail("Transaction", tx_hash)
            detail("Settled in", f"{time.perf_counter() - settle_started:.1f}s")
            detail(
                "Explorer", f"https://stellar.expert/explorer/testnet/tx/{tx_hash}"
            )

        # ── 4. Verify ────────────────────────────────────────────────────────
        step(5 if not args.sandbox else 4, "Verify the payment and collect credits")
        verify = client.post(
            f"{api}/payments/verify",
            json={
                "transaction_hash": tx_hash,
                "agent_id": agent_id,
                "challenge_id": chal["challenge_id"],
            },
        )
        if verify.status_code != 200:
            print(f"{ERR}    Verification failed: {verify.text[:400]}{RESET}")
            return 1
        payment = verify.json()
        token = payment["access_token"]
        detail("Verified", f"{OK}yes{RESET} (mode: {payment['mode']})")
        detail("Credits granted", str(payment["credits_granted"]))
        detail("Balance", f"{payment['credits_remaining']} credits")
        detail("Token", f"{token[:38]}…")

        # ── 5. Ask ───────────────────────────────────────────────────────────
        step(6 if not args.sandbox else 5, "Query the knowledge base")
        detail("Question", args.question)
        print()

        headers = {"Authorization": f"Bearer {token}"}
        if args.stream:
            answer, meta = stream_answer(client, api, args.question, agent_id, headers)
        else:
            response = client.post(
                f"{api}/rag/query",
                json={"query": args.question, "agent_id": agent_id},
                headers=headers,
            )
            if response.status_code != 200:
                print(f"{ERR}    Query failed: {response.text[:400]}{RESET}")
                return 1
            meta = response.json()
            answer = meta["answer"]
            print(f"{answer}\n")

        # ── 6. Report ────────────────────────────────────────────────────────
        print(f"{DIM}{'─' * 62}{RESET}")
        confidence = meta.get("confidence") or {}
        print(
            f"  {BOLD}Confidence{RESET} {confidence.get('percent', '—')}%"
            f" {DIM}({confidence.get('label', 'unknown')}){RESET}"
        )
        for citation in meta.get("citations", []):
            marker = f"{OK}✓{RESET}" if citation["used"] else f"{DIM}·{RESET}"
            print(
                f"  {marker} [{citation['marker']}] {citation['locator']}"
                f" {DIM}({citation['score']:.0%} match){RESET}"
            )
        if meta.get("follow_ups"):
            print(f"\n  {BOLD}Suggested follow-ups{RESET}")
            for question in meta["follow_ups"]:
                print(f"  {DIM}→{RESET} {question}")

        print(
            f"\n  {DIM}latency {meta.get('latency_ms', 0)} ms · "
            f"{meta.get('tokens_used', 0)} tokens · "
            f"{meta.get('cost_xlm', 0)} XLM · "
            f"{meta.get('credits_remaining', '?')} credits left{RESET}"
        )
        print(
            f"  {DIM}total wall time {time.perf_counter() - started:.1f}s{RESET}\n"
        )

    return 0


def stream_answer(
    client: httpx.Client, api: str, question: str, agent_id: str, headers: dict
) -> tuple[str, dict]:
    """Consume the SSE stream, printing tokens as they arrive."""
    pieces: list[str] = []
    final: dict = {}

    with client.stream(
        "POST",
        f"{api}/rag/stream",
        json={"query": question, "agent_id": agent_id},
        headers={**headers, "Accept": "text/event-stream"},
    ) as response:
        if response.status_code != 200:
            response.read()
            print(f"{ERR}Stream failed: {response.text[:300]}{RESET}")
            return "", {}

        event = "message"
        for line in response.iter_lines():
            if line.startswith("event:"):
                event = line[6:].strip()
            elif line.startswith("data:"):
                payload = json.loads(line[5:].strip())
                if event == "token":
                    print(payload["text"], end="", flush=True)
                    pieces.append(payload["text"])
                elif event == "status":
                    print(f"{DIM}  … {payload['message']}{RESET}", flush=True)
                elif event == "retrieval":
                    trace = payload["trace"]
                    print(
                        f"{DIM}  … {trace['strategy']} search: "
                        f"{trace['dense_candidates']} dense + "
                        f"{trace['lexical_candidates']} lexical → "
                        f"{len(payload['citations'])} passages{RESET}\n",
                        flush=True,
                    )
                elif event == "done":
                    final = payload
                elif event == "error":
                    print(f"\n{ERR}  {payload['message']}{RESET}")

    print("\n")
    return "".join(pieces), final


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "question",
        nargs="?",
        default="How does Reciprocal Rank Fusion combine dense and lexical search?",
    )
    parser.add_argument("--api", default=DEFAULT_API)
    parser.add_argument(
        "--sandbox", action="store_true", help="Skip on-chain settlement"
    )
    parser.add_argument("--stream", action="store_true", help="Stream the answer")
    args = parser.parse_args()

    try:
        return run(args)
    except httpx.ConnectError:
        print(
            f"\n{ERR}Cannot reach {args.api}. Start the API first:{RESET}\n"
            f"  uvicorn app.main:app --reload --port 8000\n"
        )
        return 1
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
