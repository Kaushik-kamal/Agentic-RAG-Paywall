"""SQLite persistence.

SQLite in WAL mode is the right call here: the platform is single-node, the
write volume is tiny, and zero-configuration durability means a judge can
clone the repo and have real data survive a restart. The repository layer
in :mod:`app.db.repository` is the only module that writes SQL, so swapping
in Postgres later is a contained change.
"""

from __future__ import annotations

import logging
import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from app.core.config import settings

logger = logging.getLogger(__name__)

_local = threading.local()

SCHEMA = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS agents (
    agent_id        TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    description     TEXT,
    stellar_address TEXT,
    webhook_url     TEXT,
    credits         INTEGER NOT NULL DEFAULT 0,
    total_queries   INTEGER NOT NULL DEFAULT 0,
    total_spent_xlm REAL    NOT NULL DEFAULT 0,
    status          TEXT    NOT NULL DEFAULT 'active',
    created_at      TEXT    NOT NULL,
    last_seen_at    TEXT
);

CREATE TABLE IF NOT EXISTS challenges (
    challenge_id TEXT PRIMARY KEY,
    agent_id     TEXT NOT NULL,
    destination  TEXT NOT NULL,
    amount_xlm   REAL NOT NULL,
    memo         TEXT NOT NULL,
    network      TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    expires_at   TEXT NOT NULL,
    consumed_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_challenges_agent ON challenges(agent_id);
CREATE INDEX IF NOT EXISTS idx_challenges_memo  ON challenges(memo);

CREATE TABLE IF NOT EXISTS payments (
    payment_id      TEXT PRIMARY KEY,
    agent_id        TEXT NOT NULL,
    tx_hash         TEXT NOT NULL UNIQUE,
    amount_xlm      REAL NOT NULL,
    credits_granted INTEGER NOT NULL,
    network         TEXT NOT NULL,
    mode            TEXT NOT NULL,
    challenge_id    TEXT,
    created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_agent   ON payments(agent_id);
CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at);

CREATE TABLE IF NOT EXISTS credit_ledger (
    entry_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id      TEXT NOT NULL,
    delta         INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    reason        TEXT NOT NULL,
    reference_id  TEXT,
    created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_agent ON credit_ledger(agent_id, entry_id DESC);

CREATE TABLE IF NOT EXISTS documents (
    document_id  TEXT PRIMARY KEY,
    filename     TEXT NOT NULL,
    title        TEXT NOT NULL,
    media_type   TEXT NOT NULL,
    size_bytes   INTEGER NOT NULL,
    checksum     TEXT NOT NULL UNIQUE,
    chunk_count  INTEGER NOT NULL DEFAULT 0,
    char_count   INTEGER NOT NULL DEFAULT 0,
    page_count   INTEGER,
    summary      TEXT,
    topics       TEXT,
    status       TEXT NOT NULL DEFAULT 'ready',
    error        TEXT,
    created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_created ON documents(created_at DESC);

CREATE TABLE IF NOT EXISTS conversations (
    conversation_id TEXT PRIMARY KEY,
    agent_id        TEXT NOT NULL,
    title           TEXT NOT NULL,
    message_count   INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversations_agent
    ON conversations(agent_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
    message_id      TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role            TEXT NOT NULL,
    content         TEXT NOT NULL,
    citations       TEXT,
    metrics         TEXT,
    created_at      TEXT NOT NULL,
    FOREIGN KEY (conversation_id)
        REFERENCES conversations(conversation_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation
    ON messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS query_log (
    query_id        TEXT PRIMARY KEY,
    agent_id        TEXT NOT NULL,
    conversation_id TEXT,
    question        TEXT NOT NULL,
    answer_preview  TEXT,
    confidence      REAL,
    latency_ms      INTEGER,
    tokens_used     INTEGER,
    credits_spent   INTEGER NOT NULL DEFAULT 1,
    chunks_used     INTEGER,
    status          TEXT NOT NULL DEFAULT 'success',
    created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_query_log_created ON query_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_query_log_agent   ON query_log(agent_id, created_at DESC);
"""


def _connect() -> sqlite3.Connection:
    path = settings.database_path
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=15.0, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 15000")
    return conn


def get_connection() -> sqlite3.Connection:
    """One connection per thread — SQLite objects are not thread-safe."""
    conn = getattr(_local, "conn", None)
    if conn is None:
        conn = _connect()
        _local.conn = conn
    return conn


@contextmanager
def transaction() -> Iterator[sqlite3.Connection]:
    conn = get_connection()
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
    except Exception:
        conn.execute("ROLLBACK")
        raise
    else:
        conn.execute("COMMIT")


def init_db() -> None:
    conn = get_connection()
    conn.executescript(SCHEMA)
    logger.info("SQLite ready at %s", settings.database_path)


def close_db() -> None:
    conn = getattr(_local, "conn", None)
    if conn is not None:
        conn.close()
        _local.conn = None


def query_all(sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    rows = get_connection().execute(sql, params).fetchall()
    return [dict(row) for row in rows]


def query_one(sql: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
    row = get_connection().execute(sql, params).fetchone()
    return dict(row) if row else None


def query_scalar(sql: str, params: tuple[Any, ...] = (), default: Any = 0) -> Any:
    row = get_connection().execute(sql, params).fetchone()
    if row is None or row[0] is None:
        return default
    return row[0]


def execute(sql: str, params: tuple[Any, ...] = ()) -> sqlite3.Cursor:
    return get_connection().execute(sql, params)
