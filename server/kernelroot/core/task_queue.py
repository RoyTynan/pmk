"""
SQLite-backed task queue — path-agnostic.
Callers must call task_queue.init(db_path) before using any other function.
Each scheduler provides its own db_path so they each own their own tasks.db.
"""
import logging
import os
import uuid
import json
import sqlite3
import time
import socket as _socket

from kernelroot.core import error_log


_DB_PATH: str | None = None


def init(db_path: str):
    """Must be called once on startup with the scheduler's tasks.db path."""
    global _DB_PATH
    _DB_PATH = db_path
    _setup()


def _conn():
    assert _DB_PATH, "task_queue.init(db_path) must be called before use"
    os.makedirs(os.path.dirname(_DB_PATH), exist_ok=True)
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _setup():
    with _conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS tasks (
                id          TEXT PRIMARY KEY,
                prompt      TEXT NOT NULL,
                agent_type  TEXT NOT NULL DEFAULT 'echo',
                priority    INTEGER DEFAULT 0,
                status      TEXT DEFAULT 'pending',
                llm         TEXT,
                target_llm  TEXT,
                token_budget INTEGER,
                input_tokens_est INTEGER,
                parent_id     TEXT,
                child_routing TEXT,
                result      TEXT,
                error       TEXT,
                created_at  REAL,
                started_at  REAL,
                finished_at REAL
            )
        """)
        # migrate existing db — add llm column if missing
        cols = [r[1] for r in conn.execute("PRAGMA table_info(tasks)").fetchall()]
        if "llm" not in cols:
            conn.execute("ALTER TABLE tasks ADD COLUMN llm TEXT")
        if "token_budget" not in cols:
            conn.execute("ALTER TABLE tasks ADD COLUMN token_budget INTEGER")
        if "input_tokens_est" not in cols:
            conn.execute("ALTER TABLE tasks ADD COLUMN input_tokens_est INTEGER")
        if "target_llm" not in cols:
            conn.execute("ALTER TABLE tasks ADD COLUMN target_llm TEXT")
        if "parent_id" not in cols:
            conn.execute("ALTER TABLE tasks ADD COLUMN parent_id TEXT")
        if "child_routing" not in cols:
            conn.execute("ALTER TABLE tasks ADD COLUMN child_routing TEXT")
        if "aggregate" not in cols:
            conn.execute("ALTER TABLE tasks ADD COLUMN aggregate INTEGER DEFAULT 0")
        if "options" not in cols:
            conn.execute("ALTER TABLE tasks ADD COLUMN options TEXT")


IPC_HOST = "127.0.0.1"
IPC_PORT = 8001


def _notify():
    """Fire-and-forget: tell the monitor a task state changed."""
    try:
        s = _socket.socket(_socket.AF_INET, _socket.SOCK_STREAM)
        s.settimeout(0.05)
        s.connect((IPC_HOST, IPC_PORT))
        s.sendall(b"change\n")
        s.close()
    except Exception as e:
        error_log.capture(e, logging.WARNING, "kernelroot.core.task_queue._notify")


def _parse_task(row) -> dict:
    """Convert a sqlite3.Row to a dict, deserializing the options JSON field."""
    t = dict(row)
    if t.get("options"):
        try:
            t["options"] = json.loads(t["options"])
        except Exception as e:
            error_log.capture(e, logging.ERROR, "kernelroot.core.task_queue._parse_task")
            t["options"] = {}
    return t


def add_task(prompt: str, agent_type: str = "echo", priority: int = 0, target_llm: str = None, parent_id: str = None, child_routing: str = None, aggregate: bool = False, options: dict = None) -> str:
    task_id = str(uuid.uuid4())
    options_json = json.dumps(options) if options else None
    with _conn() as conn:
        conn.execute(
            "INSERT INTO tasks (id, prompt, agent_type, priority, status, target_llm, parent_id, child_routing, aggregate, options, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (task_id, prompt, agent_type, priority, "pending", target_llm, parent_id, child_routing, int(aggregate), options_json, time.time()),
        )
    return task_id


def get_children(parent_id: str) -> list[dict]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT * FROM tasks WHERE parent_id=? ORDER BY created_at ASC", (parent_id,)
        ).fetchall()
    return [_parse_task(r) for r in rows]


def get_next_task() -> dict | None:
    with _conn() as conn:
        row = conn.execute(
            "SELECT * FROM tasks WHERE status='pending' ORDER BY priority DESC, created_at ASC LIMIT 1"
        ).fetchone()
        return _parse_task(row) if row else None


def get_next_pending_for_types(agent_types: list[str]) -> dict | None:
    """Return the next pending task whose agent_type is in the given list."""
    if not agent_types:
        return None
    placeholders = ",".join("?" * len(agent_types))
    with _conn() as conn:
        row = conn.execute(
            f"SELECT * FROM tasks WHERE status='pending' AND agent_type IN ({placeholders})"
            " ORDER BY priority DESC, created_at ASC LIMIT 1",
            agent_types,
        ).fetchone()
    return _parse_task(row) if row else None


def get_next_pending_for_available_llm(
    available_llms: list[str],
    agent_types: list[str] | None = None,
    shortcuts: dict | None = None,
    default_llm: str | None = None,
) -> dict | None:
    """Return the next pending task whose target LLM has a free slot.

    agent_types:  if provided, only consider tasks whose agent_type is in this list.
    shortcuts:    prompt-prefix → LLM name mapping (caller-supplied, e.g. from llm_scheduler config).
    default_llm:  fallback LLM name when no target or shortcut matches.
    """
    if not available_llms:
        return None
    _shortcuts = shortcuts or {}
    with _conn() as conn:
        if agent_types:
            placeholders = ",".join("?" * len(agent_types))
            rows = conn.execute(
                f"SELECT * FROM tasks WHERE status='pending' AND agent_type IN ({placeholders})"
                " ORDER BY priority DESC, created_at ASC",
                agent_types,
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM tasks WHERE status='pending' ORDER BY priority DESC, created_at ASC"
            ).fetchall()
    for row in rows:
        task = _parse_task(row)
        # prefer explicit target_llm, fall back to prompt prefix shortcut, then default
        if task.get("target_llm"):
            llm = task["target_llm"]
        else:
            first_word = task["prompt"].split()[0].lower() if task["prompt"].split() else ""
            llm = _shortcuts.get(first_word, default_llm or (available_llms[0] if available_llms else None))
        if llm and llm in available_llms:
            return task
    return None


def mark_running(task_id: str, llm: str = None, token_budget: int = None, input_tokens_est: int = None):
    with _conn() as conn:
        conn.execute(
            "UPDATE tasks SET status='running', started_at=?, llm=?, token_budget=?, input_tokens_est=? WHERE id=?",
            (time.time(), llm, token_budget, input_tokens_est, task_id),
        )
    _notify()


def mark_done(task_id: str, result: str):
    with _conn() as conn:
        conn.execute(
            "UPDATE tasks SET status='done', result=?, finished_at=? WHERE id=?",
            (result, time.time(), task_id),
        )
    _notify()


def mark_failed(task_id: str, error: str):
    with _conn() as conn:
        conn.execute(
            "UPDATE tasks SET status='failed', error=?, finished_at=? WHERE id=?",
            (error, time.time(), task_id),
        )
    _notify()


def get_task(task_id: str) -> dict | None:
    with _conn() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        return dict(row) if row else None


def requeue_stuck_tasks() -> int:
    """Requeue any tasks stuck in 'running' state — call on kernel startup or manual recovery."""
    with _conn() as conn:
        cursor = conn.execute(
            "UPDATE tasks SET status='pending', started_at=NULL, llm=NULL WHERE status='running'"
        )
        return cursor.rowcount


def list_tasks() -> list[dict]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT * FROM tasks ORDER BY created_at DESC LIMIT 500"
        ).fetchall()
        return [dict(r) for r in rows]
