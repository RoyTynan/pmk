"""
registry.py — persistent LLM config backed by db/llms.db (SQLite).
Migrates automatically from the legacy db/llms.json on first run.

API keys are NOT stored in the database.
Set them as environment variables — the server reads them at call time:
  ANTHROPIC_API_KEY, OPENAI_API_KEY, GROQ_API_KEY, TOGETHER_API_KEY
"""
import json
import os
import sqlite3

from schedulers.llm_scheduler.config import LLMS as DEFAULT_LLMS

# Map provider names → environment variable names
_PROVIDER_KEY_ENV: dict[str, str] = {
    "anthropic": "ANTHROPIC_API_KEY",
    "openai":    "OPENAI_API_KEY",
    "groq":      "GROQ_API_KEY",
    "together":  "TOGETHER_API_KEY",
}


def get_api_key(provider: str) -> str:
    """Return the API key for a provider from environment variables.
    Returns an empty string if no key is configured.
    """
    env_var = _PROVIDER_KEY_ENV.get((provider or "").lower(), f"{(provider or '').upper()}_API_KEY")
    return os.environ.get(env_var, "")
from schedulers.llm_scheduler.enums import LLMType
from schedulers.llm_scheduler.paths import DATABASE_DIR, LLMS_DB_PATH, LLMS_JSON_PATH


def _conn() -> sqlite3.Connection:
    os.makedirs(DATABASE_DIR, exist_ok=True)
    conn = sqlite3.connect(LLMS_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _init():
    with _conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS llms (
                name          TEXT PRIMARY KEY,
                type          TEXT NOT NULL DEFAULT 'remote' CHECK(type IN ('local','remote','cloud')),
                url           TEXT NOT NULL DEFAULT '',
                model         TEXT NOT NULL DEFAULT '',
                port          INTEGER,
                path          TEXT,
                max_tasks     INTEGER NOT NULL DEFAULT 1,
                use_gpu       INTEGER NOT NULL DEFAULT 1,
                api_key       TEXT NOT NULL DEFAULT '',
                provider      TEXT NOT NULL DEFAULT 'custom',
                registered_at REAL NOT NULL DEFAULT (unixepoch())
            )
        """)
    _migrate()


def _migrate():
    """One-time import from llms.json → llms.db, then leave json in place as backup.
    Also blanks any api_key values that were stored before keys moved to env vars.
    """
    with _conn() as conn:
        count = conn.execute("SELECT COUNT(*) FROM llms").fetchone()[0]
        # Clear any previously stored keys — keys now come from environment variables
        conn.execute("UPDATE llms SET api_key = '' WHERE api_key != ''")
    if count > 0:
        return  # already populated

    # Try legacy JSON first, fall back to hardcoded defaults
    source = {}
    if os.path.exists(LLMS_JSON_PATH):
        with open(LLMS_JSON_PATH) as f:
            source = json.load(f)
    if not source:
        source = dict(DEFAULT_LLMS)

    for name, cfg in source.items():
        _insert(name, cfg)


def _insert(name: str, cfg: dict):
    with _conn() as conn:
        conn.execute("""
            INSERT OR REPLACE INTO llms
                (name, type, url, model, port, path, max_tasks, use_gpu, api_key, provider)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            name,
            LLMType(cfg.get("type", LLMType.REMOTE)).value,
            cfg.get("url", ""),
            cfg.get("model", ""),
            cfg.get("port"),
            cfg.get("path"),
            cfg.get("max_tasks", 1),
            int(cfg.get("use_gpu", True)),
            cfg.get("api_key", ""),
            cfg.get("provider", "custom"),
        ))


def load() -> dict:
    """Return all LLMs as {name: cfg_dict} — same shape as the old JSON."""
    with _conn() as conn:
        rows = conn.execute("SELECT * FROM llms").fetchall()
    return {r["name"]: dict(r) for r in rows}


def add(name: str, entry: dict):
    entry["name"] = name
    _insert(name, entry)


def remove(name: str):
    with _conn() as conn:
        conn.execute("DELETE FROM llms WHERE name = ?", (name,))


def get(name: str) -> dict | None:
    with _conn() as conn:
        row = conn.execute("SELECT * FROM llms WHERE name = ?", (name,)).fetchone()
    return dict(row) if row else None


# ---------------------------------------------------------------------------
# LLM runtime state — lives in llms.db alongside the registry
# ---------------------------------------------------------------------------

def _init_states():
    with _conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS llm_states (
                name       TEXT PRIMARY KEY,
                running    INTEGER NOT NULL DEFAULT 0,
                pid        INTEGER,
                started_at REAL,
                stopped_at REAL
            )
        """)
        existing = {r[1] for r in conn.execute("PRAGMA table_info(llm_states)").fetchall()}
        for col, ddl in [("pid", "INTEGER"), ("started_at", "REAL"), ("stopped_at", "REAL")]:
            if col not in existing:
                conn.execute(f"ALTER TABLE llm_states ADD COLUMN {col} {ddl}")
        all_llms = load()
        tracked  = {r[0] for r in conn.execute("SELECT name FROM llm_states").fetchall()}
        for name, cfg in all_llms.items():
            if name not in tracked:
                running = 1 if cfg.get("type") == "remote" else 0
                conn.execute("INSERT INTO llm_states (name, running) VALUES (?, ?)", (name, running))
        # reset local LLMs — their processes died on last exit
        local_names = [n for n, c in all_llms.items() if c.get("type") == "local"]
        if local_names:
            placeholders = ",".join("?" * len(local_names))
            conn.execute(
                f"UPDATE llm_states SET running = 0, pid = NULL WHERE name IN ({placeholders})",
                local_names,
            )


def set_state(name: str, running: bool, pid: int | None = None):
    import time
    now = time.time()
    with _conn() as conn:
        if running:
            conn.execute("""
                INSERT INTO llm_states (name, running, pid, started_at, stopped_at)
                VALUES (?, 1, ?, ?, NULL)
                ON CONFLICT(name) DO UPDATE SET
                    running = 1, pid = excluded.pid, started_at = excluded.started_at, stopped_at = NULL
            """, (name, pid, now))
        else:
            conn.execute("""
                INSERT INTO llm_states (name, running, pid, started_at, stopped_at)
                VALUES (?, 0, NULL, NULL, ?)
                ON CONFLICT(name) DO UPDATE SET
                    running = 0, pid = NULL, stopped_at = excluded.stopped_at
            """, (name, now))


def all_states() -> dict[str, dict]:
    with _conn() as conn:
        rows = conn.execute("SELECT * FROM llm_states").fetchall()
    return {r["name"]: dict(r) for r in rows}


_init()
_init_states()
