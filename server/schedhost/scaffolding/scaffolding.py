"""
scaffolding.py — generates and manages user-created scheduler packages.

Provides:
  scaffold_write()            — write a file and record it in the created list
  update_scheduler_registry() — insert a new entry into scheduler_registry.py
  update_router_registry()    — insert a new entry into router_registry.py
  unregister_scheduler()      — remove a scheduler from both registries
  generate_scheduler()        — create the full boilerplate folder for a new scheduler
"""
import importlib
import inspect
import os
import re
import shutil

from schedhost.core.config import BASE_DIR
from schedhost.core.scheduler_base import SchedulerBase


# ---------------------------------------------------------------------------
# Registry helpers
# ---------------------------------------------------------------------------

def scaffold_write(path: str, content: str, created: list):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(content)
    created.append(path.replace(BASE_DIR + os.sep, "server/"))


def update_scheduler_registry(name: str, dotted: str, scheduler_map: dict):
    reg_path = os.path.join(BASE_DIR, "schedhost", "scheduler_registry.py")
    with open(reg_path) as f:
        src = f.read()
    entry = f'    "{name}":  "{dotted}",\n    # [ASSISTANT_SCHEDULERS]'
    src = src.replace("    # [ASSISTANT_SCHEDULERS]", entry)
    with open(reg_path, "w") as f:
        f.write(src)
    import schedhost.scheduler_registry as _sr
    importlib.reload(_sr)
    scheduler_map[name] = dotted


def update_router_registry(name: str, mod_path: str):
    reg_path = os.path.join(BASE_DIR, "schedhost", "router_registry.py")
    with open(reg_path) as f:
        src = f.read()
    entry = f'    ("{mod_path}", "router"),\n    # [ASSISTANT_ROUTERS]'
    src = src.replace("    # [ASSISTANT_ROUTERS]", entry)
    with open(reg_path, "w") as f:
        f.write(src)


def unregister_scheduler(name: str, scheduler_map: dict):
    """Remove scheduler from both registries. Code files are left untouched."""
    folder = f"{name}_scheduler"

    # scheduler_registry.py
    reg_path = os.path.join(BASE_DIR, "schedhost", "scheduler_registry.py")
    with open(reg_path) as f:
        src = f.read()
    dotted_prefix = f"schedulers.{folder}.scheduler"
    lines = [l for l in src.splitlines(keepends=True)
             if not (f'"{name}"' in l and dotted_prefix in l)]
    with open(reg_path, "w") as f:
        f.writelines(lines)
    scheduler_map.pop(name, None)
    import schedhost.scheduler_registry as _sr
    importlib.reload(_sr)

    # router_registry.py
    rr_path = os.path.join(BASE_DIR, "schedhost", "router_registry.py")
    with open(rr_path) as f:
        src = f.read()
    lines = [l for l in src.splitlines(keepends=True)
             if f"schedulers.{folder}.router" not in l]
    with open(rr_path, "w") as f:
        f.writelines(lines)


def discover_scheduler_class(folder: str) -> str:
    """Return the class name of the SchedulerBase subclass in the scheduler module."""
    mod_path = f"schedulers.{folder}.scheduler"
    mod = importlib.import_module(mod_path)
    cls_name = next(
        n for n, c in inspect.getmembers(mod, inspect.isclass)
        if issubclass(c, SchedulerBase) and c is not SchedulerBase
    )
    return cls_name


def delete_scheduler_folder(name: str, scheduler_map: dict):
    """Unregister and permanently delete the scheduler folder."""
    folder    = f"{name}_scheduler"
    sched_dir = os.path.join(BASE_DIR, "schedulers", folder)
    if not os.path.exists(sched_dir):
        raise FileNotFoundError(f"schedulers/{folder} not found")
    unregister_scheduler(name, scheduler_map)
    shutil.rmtree(sched_dir)


# ---------------------------------------------------------------------------
# Scaffold generator
# ---------------------------------------------------------------------------

def generate_scheduler(name: str, scheduler_map: dict) -> dict:
    """
    Generate a full boilerplate scheduler package under server/schedulers/{name}_scheduler/.
    Registers it in both registry files and returns a result dict.
    """
    name = re.sub(r"[^a-z0-9_]", "_", name.lower().strip())
    if not name:
        return {"ok": False, "error": "Invalid name"}

    folder    = f"{name}_scheduler"
    sched_dir = os.path.join(BASE_DIR, "schedulers", folder)
    if os.path.exists(sched_dir):
        return {"ok": False, "error": f"schedulers/{folder} already exists"}

    Name    = name.replace("_", " ").title().replace(" ", "")
    created: list[str] = []

    # ── directories ─────────────────────────────────────────────────────────
    for sub in ("database", "logs", "handlers"):
        os.makedirs(os.path.join(sched_dir, sub), exist_ok=True)

    # ── __init__.py ─────────────────────────────────────────────────────────
    scaffold_write(os.path.join(sched_dir, "__init__.py"), "", created)
    scaffold_write(os.path.join(sched_dir, "handlers", "__init__.py"), "", created)

    # ── logger.py ───────────────────────────────────────────────────────────
    scaffold_write(os.path.join(sched_dir, "logger.py"), f"""\
\"\"\"
Scheduler-level file logger — writes to logs/{name}.log.
Import 'logger' in any scheduler module that needs exception logging.
\"\"\"
import logging
import logging.handlers
import os

from schedulers.{folder}.paths import LOGS_DIR


def _build():
    os.makedirs(LOGS_DIR, exist_ok=True)
    log = logging.getLogger("schedulers.{folder}")
    log.propagate = False
    log.setLevel(logging.DEBUG)
    if not log.handlers:
        h = logging.handlers.RotatingFileHandler(
            os.path.join(LOGS_DIR, "{name}.log"),
            maxBytes=5 * 1024 * 1024,
            backupCount=3,
        )
        h.setFormatter(logging.Formatter(
            "%(asctime)s  %(levelname)-8s  %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        ))
        log.addHandler(h)
    return log


logger = _build()
""", created)

    # ── paths.py ────────────────────────────────────────────────────────────
    scaffold_write(os.path.join(sched_dir, "paths.py"), f"""\
import os

SCHEDULER_DIR = os.path.dirname(os.path.abspath(__file__))
DATABASE_DIR  = os.path.join(SCHEDULER_DIR, "database")
LOGS_DIR      = os.path.join(SCHEDULER_DIR, "logs")
DB_PATH       = os.path.join(DATABASE_DIR, "{name}.db")
""", created)

    # ── db.py ───────────────────────────────────────────────────────────────
    scaffold_write(os.path.join(sched_dir, "db.py"), f"""\
\"\"\"
{name}_scheduler database — owns {name}.db.
Modify the schema and helpers to match your scheduler's data model.
\"\"\"
import os
import sqlite3
import uuid

from schedulers.{folder}.paths import DATABASE_DIR, DB_PATH


def _conn() -> sqlite3.Connection:
    os.makedirs(DATABASE_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _init():
    with _conn() as conn:
        conn.execute(\"\"\"
            CREATE TABLE IF NOT EXISTS results (
                id         TEXT PRIMARY KEY,
                operation  TEXT NOT NULL,
                input      TEXT NOT NULL,
                output     TEXT NOT NULL,
                created_at REAL NOT NULL DEFAULT (unixepoch())
            )
        \"\"\")


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
""", created)

    # ── handlers/base.py ────────────────────────────────────────────────────
    scaffold_write(os.path.join(sched_dir, "handlers", "base.py"), f"""\
\"\"\"
Base class for all {name} scheduler handlers.

Subclasses implement _handle(input, options) — the base class wraps every
call in try/except and logs failures to the scheduler log file.
\"\"\"
from schedhost.core.handler_base import HandlerBase
from schedulers.{folder}.logger import logger


class {Name}HandlerBase(HandlerBase):

    def handle(self, input: str, options: dict | None = None) -> str:
        try:
            return self._handle(input, options or {{}})
        except Exception as e:
            logger.exception(
                f"{{self.__class__.__name__}}.handle failed — "
                f"input: {{input[:120]!r}}"
            )
            raise

    def _handle(self, input: str, options: dict) -> str:
        raise NotImplementedError
""", created)

    # ── handlers/string_handlers.py ─────────────────────────────────────────
    scaffold_write(os.path.join(sched_dir, "handlers", "string_handlers.py"), f"""\
\"\"\"
String manipulation handlers — BOILERPLATE to prove the scaffold works.
Replace or extend with your own handler logic.

Each handler receives input (str) and options (dict), returns a JSON string.
\"\"\"
import json

from schedulers.{folder}.handlers.base import {Name}HandlerBase


class RemoveAlternateWordsHandler({Name}HandlerBase):
    \"\"\"Removes every other word from the input string.\"\"\"

    def _handle(self, input: str, options: dict) -> str:
        words  = input.split()
        result = " ".join(words[i] for i in range(0, len(words), 2))
        return json.dumps({{"input": input, "output": result}})


class AddWordHandler({Name}HandlerBase):
    \"\"\"Appends a word to the end of the input string.
    Options: word (str) — word to append (default: 'hello')
    \"\"\"

    def _handle(self, input: str, options: dict) -> str:
        word   = options.get("word", "hello")
        result = f"{{input}} {{word}}"
        return json.dumps({{"input": input, "output": result}})


class DeleteWordHandler({Name}HandlerBase):
    \"\"\"Removes all occurrences of a word from the input string.
    Options: word (str) — word to remove
    \"\"\"

    def _handle(self, input: str, options: dict) -> str:
        word = options.get("word", "")
        if not word:
            return json.dumps({{"input": input, "output": input, "warning": "no word specified"}})
        result = " ".join(w for w in input.split() if w != word)
        return json.dumps({{"input": input, "output": result}})
""", created)

    # ── scheduler.py ────────────────────────────────────────────────────────
    scaffold_write(os.path.join(sched_dir, "scheduler.py"), f"""\
\"\"\"
{Name}Scheduler — generated by the HostScheduler scheduler assistant.

To make this your own:
  1. Rename / replace handlers in handlers/ and update HANDLER_REGISTRY
  2. Update SCHEDULER_INFO labels and api entries
  3. Update the database schema in db.py
  4. Add or modify routes in router.py
  5. Restart the kernel to pick up changes (Stop Kernel & Register button)
\"\"\"
import threading
import time

from schedhost.core import task_queue
from schedhost.core.scheduler_base import SchedulerBase
from schedhost.core.config import POLL_INTERVAL_SECONDS
from schedulers.{folder}.handlers.string_handlers import (
    RemoveAlternateWordsHandler,
    AddWordHandler,
    DeleteWordHandler,
)
from schedulers.{folder} import db as scheduler_db
from schedulers.{folder}.logger import logger

MAX_CONCURRENT = 4

# ---------------------------------------------------------------------------
# SCHEDULER_INFO — read by the frontend to build the dynamic tab.
# Update to reflect your scheduler's actual API and description.
# ---------------------------------------------------------------------------
SCHEDULER_INFO = {{
    "name":        "{name}",
    "label":       "{Name}",
    "description": "{Name} scheduler",
    "api": [
        {{"method": "GET",    "path": "/{name}/results",        "label": "List results",  "description": "List all processed results"}},
        {{"method": "POST",   "path": "/{name}/process",        "label": "Process",       "description": "Submit input for processing"}},
        {{"method": "DELETE", "path": "/{name}/results/{{id}}", "label": "Delete result", "description": "Delete a result by id"}},
    ],
}}


class {Name}Scheduler(SchedulerBase):
    NAME             = "{name}"
    SCHEDULER_INFO   = SCHEDULER_INFO
    HANDLER_REGISTRY = {{
        "remove_alternate": {{
            "handler":     RemoveAlternateWordsHandler,
            "description": "Remove every other word from the input string",
            "input_label": "String",
        }},
        "add_word": {{
            "handler":     AddWordHandler,
            "description": "Append a word to the end of the string",
            "input_label": "String",
            "options":     {{"word": "Word to append (default: 'hello')"}},
        }},
        "delete_word": {{
            "handler":     DeleteWordHandler,
            "description": "Remove a specific word from the string",
            "input_label": "String",
            "options":     {{"word": "Word to remove"}},
        }},
    }}

    def __init__(self):
        super().__init__()
        self._lock    = threading.Lock()
        self._running = 0

    def run(self):
        task_types = [f"{{self.NAME}}_{{op}}" for op in self.HANDLER_REGISTRY]
        print(f"[{name}-scheduler] started — handling: {{', '.join(task_types)}}")
        while not self._stop_event.is_set():
            with self._lock:
                if self._running < MAX_CONCURRENT:
                    task = task_queue.get_next_pending_for_types(task_types)
                    if task:
                        self._running += 1
                        threading.Thread(
                            target=self._run_task, args=(task,), daemon=True
                        ).start()
            self._sleep(POLL_INTERVAL_SECONDS)
        print(f"[{name}-scheduler] stopped")

    def _run_task(self, task: dict):
        task_id  = task["id"]
        short_id = task_id[:8]
        op       = task["agent_type"].removeprefix(f"{{self.NAME}}_")
        t0 = time.time()
        ok = True
        err = None
        result = ""
        try:
            handler = self.HANDLER_REGISTRY[op]["handler"]()
            task_queue.mark_running(task_id)
            print(f"[{name}-scheduler] running {{short_id}} ({{task['agent_type']}})")
            result = handler.handle(task["prompt"], task.get("options") or {{}})
            scheduler_db.save_result(op, task["prompt"], result)
        except Exception as e:
            ok = False
            err = str(e)
            logger.exception(
                f"task {{short_id}} ({{task['agent_type']}}) failed: {{e}}"
            )
        finally:
            # log before mark_done/failed so activity is written before the IPC notify fires
            self.log_activity(
                operation=op,
                prompt_len=len(task.get("prompt", "")),
                result_len=len(result),
                duration_ms=int((time.time() - t0) * 1000),
                ok=ok,
                error=err,
            )
            if ok:
                task_queue.mark_done(task_id, result)
                print(f"[{name}-scheduler] done    {{short_id}}")
            else:
                task_queue.mark_failed(task_id, err)
                print(f"[{name}-scheduler] failed  {{short_id}}: {{err}}")
            with self._lock:
                self._running = max(0, self._running - 1)
""", created)

    # ── router.py ───────────────────────────────────────────────────────────
    scaffold_write(os.path.join(sched_dir, "router.py"), f"""\
\"\"\"
{Name} scheduler router — FastAPI routes backed by {name}.db.
Modify or extend these routes as your scheduler evolves.
\"\"\"
from fastapi import APIRouter
from pydantic import BaseModel

from schedulers.{folder} import db as scheduler_db
from schedulers.{folder}.handlers.string_handlers import (
    RemoveAlternateWordsHandler,
    AddWordHandler,
    DeleteWordHandler,
)
from schedulers.{folder}.logger import logger

router = APIRouter(prefix="/{name}", tags=["{name}"])

_HANDLERS = {{
    "remove_alternate": RemoveAlternateWordsHandler,
    "add_word":         AddWordHandler,
    "delete_word":      DeleteWordHandler,
}}


class ProcessRequest(BaseModel):
    operation: str   # remove_alternate | add_word | delete_word
    input:     str
    options:   dict = {{}}


@router.get("/results", summary="List all results")
def list_results():
    try:
        return scheduler_db.list_results()
    except Exception as e:
        logger.exception("GET /{name}/results failed")
        return {{"ok": False, "error": str(e)}}


@router.post("/process", summary="Process a string")
def process(req: ProcessRequest):
    if req.operation not in _HANDLERS:
        return {{"ok": False, "error": f"Unknown operation '{{req.operation}}'. Valid: {{list(_HANDLERS)}}"}}
    try:
        result = _HANDLERS[req.operation]().handle(req.input, req.options)
        row_id = scheduler_db.save_result(req.operation, req.input, result)
        return {{"ok": True, "id": row_id, "result": result}}
    except Exception as e:
        logger.exception(f"POST /{name}/process failed — operation={{req.operation!r}}")
        return {{"ok": False, "error": str(e)}}


@router.delete("/results/{{id}}", summary="Delete a result")
def delete_result(id: str):
    try:
        scheduler_db.delete_result(id)
        return {{"ok": True}}
    except Exception as e:
        logger.exception(f"DELETE /{name}/results/{{{{id}}}} failed — id={{id!r}}")
        return {{"ok": False, "error": str(e)}}
""", created)

    # ── README.md ───────────────────────────────────────────────────────────
    scaffold_write(os.path.join(sched_dir, "README.md"), f"""\
# {Name} Scheduler

Generated by the HostScheduler scheduler assistant.

## Structure

```
{folder}/
├── scheduler.py           ← SchedulerBase subclass — start here
├── paths.py               ← filesystem paths (database/, logs/)
├── logger.py              ← rotating file logger → logs/{name}.log
├── db.py                  ← SQLite schema and helpers for {name}.db
├── router.py              ← FastAPI GET / POST / DELETE routes
├── handlers/
│   ├── base.py            ← base class; owns try/except + logging via _handle()
│   └── string_handlers.py ← boilerplate handlers (replace with your own)
├── database/
│   └── {name}.db          ← scheduler's own SQLite database
└── logs/
    └── {name}.log         ← rotating exception log (5 MB × 3)
```

## Getting started

1. Implement your handlers in `handlers/` — each has a `handle(input, options)` method
2. Register them in `scheduler.py` HANDLER_REGISTRY
3. Update the database schema in `db.py`
4. Update routes in `router.py`
5. Update `SCHEDULER_INFO` in `scheduler.py` to reflect your actual API
6. Click **Stop Kernel & Register** in the Assistant tab to reload

## Submitting tasks via the queue

```
POST /submit
{{
  "prompt": "the quick brown fox",
  "agent_type": "{name}_remove_alternate"
}}
```

## Direct API (synchronous, no queue)

- `GET  /{name}/results`        — list results from the database
- `POST /{name}/process`        — process and store immediately
- `DELETE /{name}/results/{{id}}` — delete a result
""", created)

    # ── register ────────────────────────────────────────────────────────────
    dotted   = f"schedulers.{folder}.scheduler.{Name}Scheduler"
    mod_path = f"schedulers.{folder}.router"
    update_scheduler_registry(name, dotted, scheduler_map)
    update_router_registry(name, mod_path)

    return {
        "ok":      True,
        "folder":  f"schedulers/{folder}",
        "created": created,
        "dotted":  dotted,
        "router":  mod_path,
        "registered": {
            "kernel_map": f'"{name}": "{dotted}"',
            "router":     f'("{mod_path}", "router")',
        },
    }
