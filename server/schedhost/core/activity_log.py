"""
activity_log.py — records kernel activity across all schedulers and sources.

Sources:
  'queue'    — task processed by a scheduler
  'pipeline' — multi-tab pipeline step
  'agentic'  — agentic graph node
  'ray'      — ray distributed worker
  'direct'   — any other direct call
"""
import os
import sqlite3
import time
import uuid

from schedhost.core.config import TASKS_DB_PATH


def _conn() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(TASKS_DB_PATH), exist_ok=True)
    conn = sqlite3.connect(TASKS_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _setup():
    with _conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS activity (
                id          TEXT PRIMARY KEY,
                ts          REAL NOT NULL DEFAULT (unixepoch()),
                llm         TEXT NOT NULL,
                model       TEXT,
                provider    TEXT,
                source      TEXT NOT NULL DEFAULT 'direct',
                prompt_len  INTEGER,
                result_len  INTEGER,
                duration_ms INTEGER,
                ok          INTEGER NOT NULL DEFAULT 1,
                error       TEXT
            )
        """)


def log(llm: str, model: str, provider: str, source: str,
        prompt_len: int, result_len: int, duration_ms: int,
        ok: bool = True, error: str = None):
    try:
        with _conn() as conn:
            conn.execute(
                """INSERT INTO activity
                       (id, ts, llm, model, provider, source,
                        prompt_len, result_len, duration_ms, ok, error)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (str(uuid.uuid4())[:8], time.time(), llm, model, provider, source,
                 prompt_len, result_len, duration_ms, int(ok), error),
            )
    except Exception:
        pass  # never crash the caller


def clear() -> int:
    with _conn() as conn:
        cursor = conn.execute("DELETE FROM activity")
    return cursor.rowcount


def list_recent(limit: int = 200) -> list[dict]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT * FROM activity ORDER BY ts DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]


_setup()
