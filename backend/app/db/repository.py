"""Data access. The only module in the app that writes SQL."""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from app.core.config import settings
from app.core.security import new_agent_id, new_id
from app.db.database import execute, query_all, query_one, query_scalar, transaction

logger = logging.getLogger(__name__)


def utcnow() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _loads(value: str | None, fallback: Any) -> Any:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


# ── Agents ────────────────────────────────────────────────────────────────────


def create_agent(
    name: str,
    *,
    description: str | None = None,
    stellar_address: str | None = None,
    webhook_url: str | None = None,
    starting_credits: int | None = None,
) -> dict[str, Any]:
    agent_id = new_agent_id()
    credits = (
        settings.x402_free_credits if starting_credits is None else starting_credits
    )
    now = utcnow()
    with transaction() as conn:
        conn.execute(
            """INSERT INTO agents
               (agent_id, name, description, stellar_address, webhook_url,
                credits, created_at, last_seen_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                agent_id,
                name,
                description,
                stellar_address,
                webhook_url,
                credits,
                now,
                now,
            ),
        )
        if credits:
            conn.execute(
                """INSERT INTO credit_ledger
                   (agent_id, delta, balance_after, reason, reference_id, created_at)
                   VALUES (?, ?, ?, 'signup_grant', NULL, ?)""",
                (agent_id, credits, credits, now),
            )
    logger.info("Registered agent %s (%s) with %d credits", agent_id, name, credits)
    return get_agent(agent_id)  # type: ignore[return-value]


def get_agent(agent_id: str) -> dict[str, Any] | None:
    return query_one("SELECT * FROM agents WHERE agent_id = ?", (agent_id,))


def get_or_create_agent(agent_id: str, *, name: str | None = None) -> dict[str, Any]:
    """Idempotent upsert used by the browser client, which owns its own id."""
    agent = get_agent(agent_id)
    if agent:
        return agent
    now = utcnow()
    credits = settings.x402_free_credits
    with transaction() as conn:
        conn.execute(
            """INSERT OR IGNORE INTO agents
               (agent_id, name, credits, created_at, last_seen_at)
               VALUES (?, ?, ?, ?, ?)""",
            (agent_id, name or "Browser Agent", credits, now, now),
        )
        if credits:
            conn.execute(
                """INSERT INTO credit_ledger
                   (agent_id, delta, balance_after, reason, reference_id, created_at)
                   VALUES (?, ?, ?, 'signup_grant', NULL, ?)""",
                (agent_id, credits, credits, now),
            )
    return get_agent(agent_id)  # type: ignore[return-value]


def list_agents(limit: int = 50) -> list[dict[str, Any]]:
    return query_all(
        "SELECT * FROM agents ORDER BY created_at DESC LIMIT ?", (limit,)
    )


def touch_agent(agent_id: str) -> None:
    execute(
        "UPDATE agents SET last_seen_at = ? WHERE agent_id = ?", (utcnow(), agent_id)
    )


# ── Credits ───────────────────────────────────────────────────────────────────


def get_credits(agent_id: str) -> int:
    return int(
        query_scalar("SELECT credits FROM agents WHERE agent_id = ?", (agent_id,), 0)
    )


def grant_credits(
    agent_id: str, amount: int, *, reason: str, reference_id: str | None = None
) -> int:
    """Add credits and record the ledger entry atomically. Returns new balance."""
    with transaction() as conn:
        conn.execute(
            "UPDATE agents SET credits = credits + ? WHERE agent_id = ?",
            (amount, agent_id),
        )
        row = conn.execute(
            "SELECT credits FROM agents WHERE agent_id = ?", (agent_id,)
        ).fetchone()
        balance = int(row["credits"]) if row else 0
        conn.execute(
            """INSERT INTO credit_ledger
               (agent_id, delta, balance_after, reason, reference_id, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (agent_id, amount, balance, reason, reference_id, utcnow()),
        )
    return balance


def consume_credit(
    agent_id: str, *, reason: str = "rag_query", reference_id: str | None = None
) -> int | None:
    """Atomically debit one credit.

    Returns the remaining balance, or ``None`` when the agent had none —
    the conditional UPDATE makes this safe against concurrent queries.
    """
    with transaction() as conn:
        cursor = conn.execute(
            "UPDATE agents SET credits = credits - 1 WHERE agent_id = ? AND credits > 0",
            (agent_id,),
        )
        if cursor.rowcount == 0:
            return None
        row = conn.execute(
            "SELECT credits FROM agents WHERE agent_id = ?", (agent_id,)
        ).fetchone()
        balance = int(row["credits"]) if row else 0
        conn.execute(
            """INSERT INTO credit_ledger
               (agent_id, delta, balance_after, reason, reference_id, created_at)
               VALUES (?, -1, ?, ?, ?, ?)""",
            (agent_id, balance, reason, reference_id, utcnow()),
        )
        conn.execute(
            """UPDATE agents
               SET total_queries = total_queries + 1,
                   total_spent_xlm = total_spent_xlm + ?,
                   last_seen_at = ?
               WHERE agent_id = ?""",
            (settings.x402_price_xlm, utcnow(), agent_id),
        )
    return balance


def refund_credit(agent_id: str, *, reference_id: str | None = None) -> int:
    """Give the credit back when generation fails — never charge for an error."""
    return grant_credits(
        agent_id, 1, reason="failed_query_refund", reference_id=reference_id
    )


def list_ledger(agent_id: str, limit: int = 25) -> list[dict[str, Any]]:
    return query_all(
        """SELECT * FROM credit_ledger WHERE agent_id = ?
           ORDER BY entry_id DESC LIMIT ?""",
        (agent_id, limit),
    )


# ── Challenges ────────────────────────────────────────────────────────────────


def create_challenge(
    agent_id: str, destination: str, amount_xlm: float, memo: str, network: str
) -> dict[str, Any]:
    challenge_id = new_id("chal")
    now = datetime.now(UTC)
    expires = now + timedelta(seconds=settings.x402_challenge_ttl_seconds)
    execute(
        """INSERT INTO challenges
           (challenge_id, agent_id, destination, amount_xlm, memo, network,
            created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            challenge_id,
            agent_id,
            destination,
            amount_xlm,
            memo,
            network,
            now.isoformat(timespec="seconds"),
            expires.isoformat(timespec="seconds"),
        ),
    )
    return get_challenge(challenge_id)  # type: ignore[return-value]


def get_challenge(challenge_id: str) -> dict[str, Any] | None:
    return query_one(
        "SELECT * FROM challenges WHERE challenge_id = ?", (challenge_id,)
    )


def find_open_challenge(agent_id: str) -> dict[str, Any] | None:
    return query_one(
        """SELECT * FROM challenges
           WHERE agent_id = ? AND consumed_at IS NULL AND expires_at > ?
           ORDER BY created_at DESC LIMIT 1""",
        (agent_id, utcnow()),
    )


def consume_challenge(challenge_id: str) -> None:
    execute(
        "UPDATE challenges SET consumed_at = ? WHERE challenge_id = ?",
        (utcnow(), challenge_id),
    )


# ── Payments ──────────────────────────────────────────────────────────────────


def payment_exists(tx_hash: str) -> bool:
    return (
        query_scalar("SELECT COUNT(*) FROM payments WHERE tx_hash = ?", (tx_hash,), 0)
        > 0
    )


def record_payment(
    agent_id: str,
    tx_hash: str,
    amount_xlm: float,
    credits_granted: int,
    *,
    mode: str,
    challenge_id: str | None = None,
) -> dict[str, Any]:
    payment_id = new_id("pay")
    execute(
        """INSERT INTO payments
           (payment_id, agent_id, tx_hash, amount_xlm, credits_granted,
            network, mode, challenge_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            payment_id,
            agent_id,
            tx_hash,
            amount_xlm,
            credits_granted,
            settings.stellar_network,
            mode,
            challenge_id,
            utcnow(),
        ),
    )
    return query_one("SELECT * FROM payments WHERE payment_id = ?", (payment_id,))  # type: ignore[return-value]


def list_payments(limit: int = 25, agent_id: str | None = None) -> list[dict[str, Any]]:
    if agent_id:
        return query_all(
            """SELECT * FROM payments WHERE agent_id = ?
               ORDER BY created_at DESC LIMIT ?""",
            (agent_id, limit),
        )
    return query_all(
        "SELECT * FROM payments ORDER BY created_at DESC LIMIT ?", (limit,)
    )


def payment_totals() -> dict[str, Any]:
    row = query_one(
        """SELECT COUNT(*) AS count,
                  COALESCE(SUM(amount_xlm), 0) AS revenue,
                  COALESCE(SUM(credits_granted), 0) AS credits
           FROM payments"""
    ) or {"count": 0, "revenue": 0.0, "credits": 0}
    return {
        "total_payments": int(row["count"]),
        "total_revenue_xlm": round(float(row["revenue"]), 7),
        "total_credits_sold": int(row["credits"]),
    }


# ── Documents ─────────────────────────────────────────────────────────────────


def find_document_by_checksum(checksum: str) -> dict[str, Any] | None:
    return query_one("SELECT * FROM documents WHERE checksum = ?", (checksum,))


def create_document(
    *,
    document_id: str,
    filename: str,
    title: str,
    media_type: str,
    size_bytes: int,
    checksum: str,
    chunk_count: int,
    char_count: int,
    page_count: int | None,
    summary: str | None,
    topics: list[str] | None,
) -> dict[str, Any]:
    execute(
        """INSERT INTO documents
           (document_id, filename, title, media_type, size_bytes, checksum,
            chunk_count, char_count, page_count, summary, topics, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?)""",
        (
            document_id,
            filename,
            title,
            media_type,
            size_bytes,
            checksum,
            chunk_count,
            char_count,
            page_count,
            summary,
            json.dumps(topics or []),
            utcnow(),
        ),
    )
    return get_document(document_id)  # type: ignore[return-value]


def get_document(document_id: str) -> dict[str, Any] | None:
    row = query_one("SELECT * FROM documents WHERE document_id = ?", (document_id,))
    if row:
        row["topics"] = _loads(row.get("topics"), [])
    return row


def list_documents(limit: int = 100) -> list[dict[str, Any]]:
    rows = query_all(
        "SELECT * FROM documents ORDER BY created_at DESC LIMIT ?", (limit,)
    )
    for row in rows:
        row["topics"] = _loads(row.get("topics"), [])
    return rows


def delete_document(document_id: str) -> bool:
    cursor = execute("DELETE FROM documents WHERE document_id = ?", (document_id,))
    return cursor.rowcount > 0


def document_totals() -> dict[str, Any]:
    row = query_one(
        """SELECT COUNT(*) AS documents,
                  COALESCE(SUM(chunk_count), 0) AS chunks,
                  COALESCE(SUM(char_count), 0)  AS chars
           FROM documents"""
    ) or {"documents": 0, "chunks": 0, "chars": 0}
    return {
        "total_documents": int(row["documents"]),
        "total_chunks": int(row["chunks"]),
        "total_characters": int(row["chars"]),
    }


# ── Conversations & messages ──────────────────────────────────────────────────


def create_conversation(agent_id: str, title: str) -> dict[str, Any]:
    conversation_id = new_id("conv")
    now = utcnow()
    execute(
        """INSERT INTO conversations
           (conversation_id, agent_id, title, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)""",
        (conversation_id, agent_id, title[:120], now, now),
    )
    return get_conversation(conversation_id)  # type: ignore[return-value]


def get_conversation(conversation_id: str) -> dict[str, Any] | None:
    return query_one(
        "SELECT * FROM conversations WHERE conversation_id = ?", (conversation_id,)
    )


def list_conversations(agent_id: str, limit: int = 50) -> list[dict[str, Any]]:
    return query_all(
        """SELECT * FROM conversations WHERE agent_id = ?
           ORDER BY updated_at DESC LIMIT ?""",
        (agent_id, limit),
    )


def delete_conversation(conversation_id: str, agent_id: str) -> bool:
    cursor = execute(
        "DELETE FROM conversations WHERE conversation_id = ? AND agent_id = ?",
        (conversation_id, agent_id),
    )
    return cursor.rowcount > 0


def add_message(
    conversation_id: str,
    role: str,
    content: str,
    *,
    citations: list[dict[str, Any]] | None = None,
    metrics: dict[str, Any] | None = None,
) -> dict[str, Any]:
    message_id = new_id("msg")
    now = utcnow()
    with transaction() as conn:
        conn.execute(
            """INSERT INTO messages
               (message_id, conversation_id, role, content, citations, metrics, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                message_id,
                conversation_id,
                role,
                content,
                json.dumps(citations or []),
                json.dumps(metrics or {}),
                now,
            ),
        )
        conn.execute(
            """UPDATE conversations
               SET message_count = message_count + 1, updated_at = ?
               WHERE conversation_id = ?""",
            (now, conversation_id),
        )
    return {
        "message_id": message_id,
        "conversation_id": conversation_id,
        "role": role,
        "content": content,
        "citations": citations or [],
        "metrics": metrics or {},
        "created_at": now,
    }


def list_messages(conversation_id: str, limit: int = 200) -> list[dict[str, Any]]:
    rows = query_all(
        """SELECT * FROM messages WHERE conversation_id = ?
           ORDER BY created_at ASC, rowid ASC LIMIT ?""",
        (conversation_id, limit),
    )
    for row in rows:
        row["citations"] = _loads(row.get("citations"), [])
        row["metrics"] = _loads(row.get("metrics"), {})
    return rows


def recent_turns(conversation_id: str, limit: int = 6) -> list[dict[str, str]]:
    """Last N messages as plain role/content pairs, oldest first."""
    rows = query_all(
        """SELECT role, content FROM messages WHERE conversation_id = ?
           ORDER BY created_at DESC, rowid DESC LIMIT ?""",
        (conversation_id, limit),
    )
    return [{"role": r["role"], "content": r["content"]} for r in reversed(rows)]


# ── Query log & analytics ─────────────────────────────────────────────────────


def log_query(
    *,
    agent_id: str,
    question: str,
    conversation_id: str | None = None,
    answer_preview: str | None = None,
    confidence: float | None = None,
    latency_ms: int | None = None,
    tokens_used: int | None = None,
    chunks_used: int | None = None,
    status: str = "success",
) -> str:
    query_id = new_id("qry")
    execute(
        """INSERT INTO query_log
           (query_id, agent_id, conversation_id, question, answer_preview,
            confidence, latency_ms, tokens_used, chunks_used, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            query_id,
            agent_id,
            conversation_id,
            question[:500],
            (answer_preview or "")[:300] or None,
            confidence,
            latency_ms,
            tokens_used,
            chunks_used,
            status,
            utcnow(),
        ),
    )
    return query_id


def recent_queries(limit: int = 20) -> list[dict[str, Any]]:
    return query_all(
        "SELECT * FROM query_log ORDER BY created_at DESC, rowid DESC LIMIT ?",
        (limit,),
    )


def query_totals() -> dict[str, Any]:
    row = query_one(
        """SELECT COUNT(*) AS total,
                  COALESCE(AVG(latency_ms), 0)  AS avg_latency,
                  COALESCE(AVG(confidence), 0)  AS avg_confidence,
                  COALESCE(SUM(tokens_used), 0) AS tokens,
                  COALESCE(SUM(CASE WHEN status != 'success' THEN 1 ELSE 0 END), 0)
                      AS failures
           FROM query_log"""
    ) or {}
    total = int(row.get("total", 0) or 0)
    return {
        "total_queries": total,
        "avg_latency_ms": int(row.get("avg_latency", 0) or 0),
        "avg_confidence": round(float(row.get("avg_confidence", 0) or 0), 3),
        "total_tokens": int(row.get("tokens", 0) or 0),
        "failed_queries": int(row.get("failures", 0) or 0),
        "success_rate": round((total - int(row.get("failures", 0) or 0)) / total, 3)
        if total
        else 1.0,
    }


def queries_by_day(days: int = 14) -> list[dict[str, Any]]:
    rows = query_all(
        """SELECT substr(created_at, 1, 10) AS day,
                  COUNT(*) AS queries,
                  COALESCE(AVG(latency_ms), 0) AS avg_latency
           FROM query_log
           WHERE created_at >= ?
           GROUP BY day ORDER BY day ASC""",
        ((datetime.now(UTC) - timedelta(days=days)).isoformat(),),
    )
    by_day = {r["day"]: r for r in rows}
    series: list[dict[str, Any]] = []
    today = datetime.now(UTC).date()
    for offset in range(days - 1, -1, -1):
        day = (today - timedelta(days=offset)).isoformat()
        entry = by_day.get(day)
        series.append(
            {
                "day": day,
                "queries": int(entry["queries"]) if entry else 0,
                "avg_latency_ms": int(entry["avg_latency"]) if entry else 0,
                "revenue_xlm": round(
                    (int(entry["queries"]) if entry else 0) * settings.x402_price_xlm, 7
                ),
            }
        )
    return series


def revenue_by_day(days: int = 14) -> list[dict[str, Any]]:
    rows = query_all(
        """SELECT substr(created_at, 1, 10) AS day,
                  COALESCE(SUM(amount_xlm), 0) AS revenue,
                  COUNT(*) AS payments
           FROM payments WHERE created_at >= ?
           GROUP BY day ORDER BY day ASC""",
        ((datetime.now(UTC) - timedelta(days=days)).isoformat(),),
    )
    return [
        {
            "day": r["day"],
            "revenue_xlm": round(float(r["revenue"]), 7),
            "payments": int(r["payments"]),
        }
        for r in rows
    ]


def top_questions(limit: int = 5) -> list[dict[str, Any]]:
    return query_all(
        """SELECT question, COUNT(*) AS occurrences, AVG(confidence) AS avg_confidence
           FROM query_log GROUP BY lower(question)
           ORDER BY occurrences DESC, MAX(created_at) DESC LIMIT ?""",
        (limit,),
    )


def agent_totals() -> dict[str, Any]:
    row = query_one(
        """SELECT COUNT(*) AS agents,
                  COALESCE(SUM(credits), 0) AS outstanding_credits
           FROM agents"""
    ) or {"agents": 0, "outstanding_credits": 0}
    return {
        "total_agents": int(row["agents"]),
        "outstanding_credits": int(row["outstanding_credits"]),
    }
