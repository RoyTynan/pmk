"""
Trace storage for agentic runs.
Uses the existing SQLite database — no new files or dependencies.
"""
import json
import sqlite3
import uuid
from datetime import datetime
from kernelroot.core.config import TASKS_DB_PATH


def _conn():
    return sqlite3.connect(TASKS_DB_PATH)


def init_db():
    """Create the traces table if it doesn't exist. Called on server startup."""
    with _conn() as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS agentic_traces (
                id          TEXT PRIMARY KEY,
                timestamp   TEXT NOT NULL,
                llm_name    TEXT NOT NULL,
                prompt      TEXT NOT NULL,
                result      TEXT NOT NULL,   -- 'passed' | 'failed'
                attempts    INTEGER NOT NULL,
                duration_ms INTEGER NOT NULL,
                data        TEXT NOT NULL    -- full JSON blob
            )
        """)


def save_trace(llm_name: str, prompt: str, passed: bool,
               attempt_count: int, duration_ms: int, attempts: list) -> str:
    """Persist one agentic run. Returns the new trace id."""
    trace_id = str(uuid.uuid4())[:8]
    row = {
        "id":          trace_id,
        "timestamp":   datetime.utcnow().isoformat(timespec="seconds"),
        "llm_name":    llm_name,
        "prompt":      prompt,
        "result":      "passed" if passed else "failed",
        "attempts":    attempt_count,
        "duration_ms": duration_ms,
        "data":        json.dumps({"attempts": attempts}),
    }
    with _conn() as db:
        db.execute("""
            INSERT INTO agentic_traces
                (id, timestamp, llm_name, prompt, result, attempts, duration_ms, data)
            VALUES
                (:id, :timestamp, :llm_name, :prompt, :result, :attempts, :duration_ms, :data)
        """, row)
    return trace_id


def get_traces(limit: int = 50, offset: int = 0) -> list:
    """Return trace rows newest first, each row is one attempt."""
    with _conn() as db:
        rows = db.execute("""
            SELECT id, timestamp, llm_name, prompt, result, attempts, duration_ms, data
            FROM agentic_traces
            ORDER BY timestamp DESC
            LIMIT ? OFFSET ?
        """, (limit, offset)).fetchall()
    result = []
    for r in rows:
        attempt = {}
        try:
            data = json.loads(r[7])
            attempt = data.get("attempts", [{}])[0]
        except Exception:
            pass
        result.append({
            "id":          r[0],
            "timestamp":   r[1],
            "llm_name":    r[2],
            "prompt":      r[3],
            "result":      r[4],
            "duration_ms": r[6],
            "attempt":     attempt.get("attempt", 1),
            "code":        attempt.get("code", ""),
            "output":      attempt.get("output", ""),
            "error":       attempt.get("error", ""),
            "generate_ms": attempt.get("generate_ms", 0),
            "extract_ms":  attempt.get("extract_ms", 0),
            "execute_ms":  attempt.get("execute_ms", 0),
        })
    return result


def get_trace(trace_id: str) -> dict | None:
    """Return a single trace with full attempt detail."""
    with _conn() as db:
        row = db.execute("""
            SELECT id, timestamp, llm_name, prompt, result, attempts, duration_ms, data
            FROM agentic_traces WHERE id = ?
        """, (trace_id,)).fetchone()
    if not row:
        return None
    detail = json.loads(row[7])
    return {
        "id":          row[0],
        "timestamp":   row[1],
        "llm_name":    row[2],
        "prompt":      row[3],
        "result":      row[4],
        "attempts":    row[5],
        "duration_ms": row[6],
        **detail,
    }


def get_count() -> int:
    with _conn() as db:
        return db.execute("SELECT COUNT(*) FROM agentic_traces").fetchone()[0]


def clear_traces():
    with _conn() as db:
        db.execute("DELETE FROM agentic_traces")
