"""
test_scheduler database — owns test.db.
Modify the schema and helpers to match your scheduler's data model.
"""
import os
import sqlite3
import uuid

from schedulers.test_scheduler.paths import DATABASE_DIR, DB_PATH


def _conn() -> sqlite3.Connection:
    os.makedirs(DATABASE_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _init():
    with _conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS results (
                id         TEXT PRIMARY KEY,
                operation  TEXT NOT NULL,
                input      TEXT NOT NULL,
                output     TEXT NOT NULL,
                created_at REAL NOT NULL DEFAULT (unixepoch())
            )
        """)


def save_result(operation: str, input_text: str, output: str) -> str:
    row_id = str(uuid.uuid4())[:8]
    with _conn() as conn:
        conn.execute(
            "INSERT INTO results (id, operation, input, output) VALUES (?, ?, ?, ?)",
            (row_id, operation, input_text, output),
        )
    return row_id


def list_results(limit: int = 50) -> list[dict]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT * FROM results ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]


def delete_result(row_id: str):
    with _conn() as conn:
        conn.execute("DELETE FROM results WHERE id = ?", (row_id,))


_init()
