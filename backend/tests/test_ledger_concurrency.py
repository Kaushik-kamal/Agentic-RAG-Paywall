"""The credit ledger under concurrent load.

These tests use real threads against the real SQLite file — each thread gets
its own connection, so the invariant is genuinely enforced by the database and
not by any Python-level coordination. A lock in the application would make
these pass while leaving the system wrong the moment a second process exists.
"""

from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor

import pytest

from app.core.errors import InsufficientCreditsError
from app.db import repository as repo
from app.db.database import close_db, query_one
from app.services.marketplace import _debit


def _ledger_delta(agent_id: str) -> int:
    row = query_one(
        "SELECT COALESCE(SUM(delta), 0) AS total FROM credit_ledger WHERE agent_id = ?",
        (agent_id,),
    )
    return int(row["total"]) if row else 0


def _run_concurrently(worker, count: int) -> list:
    """Run `count` copies of `worker`, released together to maximise overlap."""
    barrier = threading.Barrier(count)

    def wrapped(index: int):
        barrier.wait()  # every thread starts within microseconds of the others
        try:
            return worker(index)
        finally:
            # Thread-local connections must not leak between tests.
            close_db()

    with ThreadPoolExecutor(max_workers=count) as pool:
        return list(pool.map(wrapped, range(count)))


class TestAtomicDebit:
    def test_concurrent_debits_cannot_overspend(self):
        """Eight threads want 3 credits each from a balance of 10."""
        agent_id = "agent_race_overspend"
        repo.get_or_create_agent(agent_id)
        repo.grant_credits(agent_id, 10 - repo.get_credits(agent_id), reason="test_setup")
        assert repo.get_credits(agent_id) == 10

        results = _run_concurrently(
            lambda _: repo.consume_credits(agent_id, 3, reason="test"), 8
        )

        succeeded = [r for r in results if r is not None]
        # 10 // 3 == 3 successful debits; the balance can never go negative.
        assert len(succeeded) == 3
        assert repo.get_credits(agent_id) == 1
        assert repo.get_credits(agent_id) >= 0

    def test_no_credits_disappear(self):
        """Spend plus remaining must equal the starting balance, exactly."""
        agent_id = "agent_race_conservation"
        repo.get_or_create_agent(agent_id)
        repo.grant_credits(agent_id, 20 - repo.get_credits(agent_id), reason="test_setup")
        start = repo.get_credits(agent_id)
        ledger_before = _ledger_delta(agent_id)

        results = _run_concurrently(
            lambda _: repo.consume_credits(agent_id, 4, reason="test"), 10
        )

        successes = len([r for r in results if r is not None])
        spent = successes * 4
        remaining = repo.get_credits(agent_id)

        assert spent + remaining == start
        # The ledger is the audit trail; it must agree with the balance.
        assert _ledger_delta(agent_id) == ledger_before - spent

    def test_a_failed_debit_consumes_nothing(self):
        agent_id = "agent_debit_rejected"
        repo.get_or_create_agent(agent_id)
        repo.grant_credits(agent_id, 2 - repo.get_credits(agent_id), reason="test_setup")
        before = repo.get_credits(agent_id)
        ledger_before = _ledger_delta(agent_id)

        assert repo.consume_credits(agent_id, 5, reason="test") is None

        # No partial state: not the balance, not the ledger, not one credit.
        assert repo.get_credits(agent_id) == before
        assert _ledger_delta(agent_id) == ledger_before

    def test_a_successful_debit_takes_exactly_the_amount(self):
        agent_id = "agent_debit_exact"
        repo.get_or_create_agent(agent_id)
        repo.grant_credits(agent_id, 9 - repo.get_credits(agent_id), reason="test_setup")

        remaining = repo.consume_credits(agent_id, 4, reason="test")

        assert remaining == 5
        assert repo.get_credits(agent_id) == 5
        entry = repo.list_ledger(agent_id, 1)[0]
        assert entry["delta"] == -4
        assert entry["balance_after"] == 5

    def test_mixed_amounts_never_go_negative(self):
        """Providers charge different amounts; interleaving them is the real case."""
        agent_id = "agent_race_mixed"
        repo.get_or_create_agent(agent_id)
        repo.grant_credits(agent_id, 15 - repo.get_credits(agent_id), reason="test_setup")
        amounts = [1, 2, 3, 4, 5, 1, 2, 3, 4, 5]

        results = _run_concurrently(
            lambda index: (
                amounts[index],
                repo.consume_credits(agent_id, amounts[index], reason="test"),
            ),
            len(amounts),
        )

        spent = sum(amount for amount, outcome in results if outcome is not None)
        assert repo.get_credits(agent_id) == 15 - spent
        assert repo.get_credits(agent_id) >= 0

    def test_marketplace_debit_raises_without_charging(self):
        """The service-level wrapper must inherit the same guarantee."""
        agent_id = "agent_marketplace_debit"
        repo.get_or_create_agent(agent_id)
        repo.grant_credits(agent_id, 3 - repo.get_credits(agent_id), reason="test_setup")
        before = repo.get_credits(agent_id)

        with pytest.raises(InsufficientCreditsError):
            _debit(agent_id, 5)

        assert repo.get_credits(agent_id) == before

    def test_concurrent_marketplace_debits_are_consistent(self):
        agent_id = "agent_marketplace_race"
        repo.get_or_create_agent(agent_id)
        repo.grant_credits(agent_id, 12 - repo.get_credits(agent_id), reason="test_setup")

        def worker(_: int):
            try:
                return _debit(agent_id, 5)
            except InsufficientCreditsError:
                return None

        results = _run_concurrently(worker, 6)

        succeeded = len([r for r in results if r is not None])
        assert succeeded == 2  # 12 // 5
        assert repo.get_credits(agent_id) == 2

    def test_zero_or_negative_amounts_are_rejected(self):
        agent_id = "agent_debit_invalid"
        repo.get_or_create_agent(agent_id)
        for amount in (0, -1, -100):
            with pytest.raises(ValueError):
                repo.consume_credits(agent_id, amount)


class TestSpendReconciliation:
    """The buyer's recorded spend must equal what the seller was paid."""

    def test_recorded_spend_matches_the_price_charged(self):
        agent_id = "agent_spend_reconcile"
        repo.get_or_create_agent(agent_id)
        repo.grant_credits(agent_id, 10, reason="test_setup")
        before = repo.get_agent(agent_id)["total_spent_xlm"]

        # A provider charging 0.025 XLM for 3 credits: the agent's spend must be
        # 0.025, not 3 × the base credit price.
        repo.consume_credits(agent_id, 3, reason="marketplace_call", spend_xlm=0.025)

        after = repo.get_agent(agent_id)["total_spent_xlm"]
        assert round(after - before, 7) == 0.025

    def test_spend_defaults_to_the_base_price_when_unspecified(self):
        agent_id = "agent_spend_default"
        repo.get_or_create_agent(agent_id)
        repo.grant_credits(agent_id, 10, reason="test_setup")
        before = repo.get_agent(agent_id)["total_spent_xlm"]

        repo.consume_credits(agent_id, 2, reason="rag_query")

        after = repo.get_agent(agent_id)["total_spent_xlm"]
        assert round(after - before, 7) == round(0.01 * 2, 7)


class TestRefundSymmetry:
    def test_refund_restores_exactly_what_was_charged(self):
        agent_id = "agent_refund_symmetry"
        repo.get_or_create_agent(agent_id)
        repo.grant_credits(agent_id, 10 - repo.get_credits(agent_id), reason="test_setup")

        repo.consume_credits(agent_id, 4, reason="test")
        assert repo.get_credits(agent_id) == 6

        repo.refund_credits(agent_id, 4)
        assert repo.get_credits(agent_id) == 10
        assert _ledger_delta(agent_id) == 10  # grant 10, −4, +4

    def test_refunding_zero_is_a_no_op(self):
        agent_id = "agent_refund_zero"
        repo.get_or_create_agent(agent_id)
        before = repo.get_credits(agent_id)
        assert repo.refund_credits(agent_id, 0) == before
        assert repo.get_credits(agent_id) == before
