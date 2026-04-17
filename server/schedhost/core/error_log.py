"""
error_log.py — kernel-level exception logging.

Writes every captured exception to a rotating log file (always) and
best-effort to the DB error_log table for UI display.

Schedulers must implement their own exception handling — this module is
kernel infrastructure only.
"""
import logging
import logging.handlers
import os
import sqlite3
import sys
import time
import traceback
import uuid
from datetime import datetime

from schedhost.core.config import ERROR_LOG_PATH, TASKS_DB_PATH


# ---------------------------------------------------------------------------
# File logger — plain formatter so we control the layout ourselves
# ---------------------------------------------------------------------------

class _PlainFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        return record.getMessage()


def _build_file_logger() -> logging.Logger:
    os.makedirs(os.path.dirname(ERROR_LOG_PATH), exist_ok=True)
    logger = logging.getLogger("schedhost.errors")
    logger.propagate = False
    logger.setLevel(logging.DEBUG)
    if not logger.handlers:
        handler = logging.handlers.RotatingFileHandler(
            ERROR_LOG_PATH, maxBytes=5 * 1024 * 1024, backupCount=3
        )
        handler.setFormatter(_PlainFormatter())
        logger.addHandler(handler)
    return logger


_file_logger = _build_file_logger()


# ---------------------------------------------------------------------------
# DB
# ---------------------------------------------------------------------------

def _conn() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(TASKS_DB_PATH), exist_ok=True)
    conn = sqlite3.connect(TASKS_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _setup():
    with _conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS error_log (
                id          TEXT PRIMARY KEY,
                ts          REAL NOT NULL,
                ts_human    TEXT NOT NULL,
                level       INTEGER NOT NULL,
                level_name  TEXT NOT NULL,
                source      TEXT NOT NULL,
                location    TEXT,
                message     TEXT NOT NULL,
                traceback   TEXT
            )
        """)
        cols = [r[1] for r in conn.execute("PRAGMA table_info(error_log)").fetchall()]
        if "location" not in cols:
            conn.execute("ALTER TABLE error_log ADD COLUMN location TEXT")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def capture(exc: Exception, level: int = logging.ERROR, source: str = "") -> None:
    """Capture an exception from a kernel except-block.

    Call as: error_log.capture(e, logging.ERROR, "schedhost.module.function")
    Must be called from within an except block so traceback is available.
    """
    tb_str = traceback.format_exc()
    level_name = logging.getLevelName(level)
    now = time.time()
    ts_human = datetime.fromtimestamp(now).strftime("%Y-%m-%d %H:%M:%S")

    # Extract innermost frame for quick location reference
    location: str | None = None
    _, _, exc_tb = sys.exc_info()
    if exc_tb:
        frames = traceback.extract_tb(exc_tb)
        if frames:
            f = frames[-1]
            location = f"{os.path.basename(f.filename)}:{f.lineno}"

    # Build human-readable entry for the log file
    loc_str = f" ({location})" if location else ""
    parts = [f"{ts_human}  {level_name:<8}  {source}{loc_str}", f"  {exc}"]
    if tb_str and tb_str.strip() not in ("None", "NoneType: None"):
        for line in tb_str.rstrip().splitlines():
            parts.append(f"  {line}")
    parts.append("")
    try:
        _file_logger.log(level, "\n".join(parts))
    except Exception:
        pass

    # DB — best effort, never crash the caller
    try:
        with _conn() as conn:
            conn.execute(
                """INSERT INTO error_log
                       (id, ts, ts_human, level, level_name, source, location, message, traceback)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
                (str(uuid.uuid4())[:8], now, ts_human, level, level_name,
                 source, location, str(exc), tb_str),
            )
    except Exception:
        pass


def list_recent(limit: int = 200) -> list[dict]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT * FROM error_log ORDER BY ts DESC LIMIT ?", (limit,)
        ).fetchall()
    return [dict(r) for r in rows]


def clear() -> int:
    with _conn() as conn:
        cursor = conn.execute("DELETE FROM error_log")
    return cursor.rowcount


_setup()
