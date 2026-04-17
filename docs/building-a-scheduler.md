# Building a Scheduler

A scheduler is a pluggable module that pulls tasks of a specific type from the shared queue and dispatches them to handlers. The kernel loads schedulers at startup and runs each in its own thread. The kernel itself never needs to be modified — adding a new scheduler is entirely self-contained.

The quickest way to get started is the **assistant tab**, which generates a complete scaffold in one click. You can also use any external AI coding assistant, or build one manually.

---

## Using the assistant tab

Open the **assistant** top-level tab. Enter a name for your scheduler (e.g. `image` or `email_parser`) and click **create**. The assistant generates a fully wired folder at `server/schedulers/{name}_scheduler/` containing:

```
{name}_scheduler/
├── scheduler.py           ← SchedulerBase subclass with HANDLER_REGISTRY
├── paths.py               ← filesystem paths (database/, logs/)
├── logger.py              ← rotating file logger → logs/{name}.log
├── db.py                  ← SQLite schema and helpers for {name}.db
├── router.py              ← FastAPI GET / POST / DELETE routes
├── handlers/
│   ├── base.py            ← base class; owns try/except + logging via _handle()
│   └── string_handlers.py ← three working example handlers (replace with your own)
├── database/
│   └── {name}.db          ← scheduler's own SQLite database (created on first run)
└── logs/
    └── {name}.log         ← rotating exception log (5 MB × 3 files)
```

The scaffold is immediately registered in both `scheduler_registry.py` and `router_registry.py` — no manual edits required. Click **stop kernel & register** in the assistant tab to restart the kernel and activate the new scheduler.

The example handlers (`RemoveAlternateWordsHandler`, `AddWordHandler`, `DeleteWordHandler`) are working boilerplate that prove the scaffold is wired correctly. Replace them with your own handler logic.

---

## Exception handling and logging

Each generated scheduler is responsible for its own exception handling. The kernel does **not** catch scheduler exceptions — any unhandled exception will mark a task as failed and be recorded in the scheduler's log file only, not the kernel exception log.

### The log file

`logger.py` sets up a rotating file logger writing to `logs/{name}.log` (5 MB per file, 3 files retained). Import it anywhere in your scheduler:

```python
from schedulers.{name}_scheduler.logger import logger
```

Use the standard Python logging levels:

```python
logger.warning("something unexpected but recoverable")
logger.error("operation failed: %s", err)
logger.exception("unexpected error")   # logs at ERROR and appends the full traceback automatically
```

### The `_handle()` pattern

The scaffold's `handlers/base.py` provides a built-in safety net. The public `handle()` method wraps `_handle()` in try/except and logs any exception before re-raising it:

```python
class MyHandlerBase(HandlerBase):
    def handle(self, input: str, options: dict | None = None) -> str:
        try:
            return self._handle(input, options or {})
        except Exception as e:
            logger.exception(f"{self.__class__.__name__}.handle failed — input: {input[:120]!r}")
            raise

    def _handle(self, input: str, options: dict) -> str:
        raise NotImplementedError
```

**Your handlers implement `_handle()`, not `handle()`**. This means every handler failure is automatically logged with a traceback — you get that for free. You do not need to add try/except in `_handle()` unless you want to handle specific exceptions differently (e.g. catch a network error and retry, or return a fallback value instead of failing the task).

### What the scaffold catches by default

| Location | What is caught | Log level |
|---|---|---|
| `handlers/base.py` `handle()` | Any unhandled exception from `_handle()` | ERROR + traceback |
| `scheduler.py` `_run_task()` | Exception re-raised from `handle()` | ERROR + traceback |
| `router.py` each route | Any exception from handler or DB | ERROR + traceback |

### What you are responsible for

The default try/except blocks are safety nets for unexpected failures. For real exception handling you should:

- **Catch specific exception types** — `except ValueError`, `except httpx.TimeoutException`, etc. rather than bare `except Exception`
- **Log meaningful context** — include the input, the external service name, the operation being attempted
- **Decide the outcome** — re-raise to fail the task, return a fallback value, retry with backoff, or log and continue
- **Clean up resources** — close files, release locks, cancel pending requests in a `finally` block

Example of a well-handled exception in a handler:

```python
def _handle(self, input: str, options: dict) -> str:
    url = options.get("url", "")
    try:
        response = httpx.get(url, timeout=10.0)
        response.raise_for_status()
    except httpx.TimeoutException:
        logger.warning("request timed out for url=%r — returning empty result", url)
        return json.dumps({"input": input, "output": "", "error": "timeout"})
    except httpx.HTTPStatusError as e:
        logger.error("HTTP %s for url=%r", e.response.status_code, url)
        raise
    return json.dumps({"input": input, "output": response.text})
```

---

## Using an external AI assistant

The built-in assistant is not required. You can generate an identical scaffold using any AI coding assistant — Claude Code, GitHub Copilot, Cursor, or anything else — by giving it the scaffolding code as context.

The source of truth for the scaffold is `server/kernelroot/scaffolding/scaffolding.py`. Point your AI assistant at that file and ask it to generate a new scheduler for a given name. The scaffolding code contains the complete template for every file in the scheduler folder, so any capable coding assistant can produce a correctly wired result.

A minimal prompt:

> Read `server/kernelroot/scaffolding/scaffolding.py` to understand the scaffold template, then generate a new scheduler named `{name}` following that exact structure. Create all files under `server/schedulers/{name}_scheduler/`. Do not modify anything in `server/kernelroot/`.

After the files are generated, register the scheduler manually in `server/kernelroot/scheduler_registry.py` and `server/kernelroot/router_registry.py` (the assistant tab does this automatically; with an external AI you do it yourself), then restart the kernel.

---

## Extending a scaffold with AI prompts

Once a scheduler is created, the assistant tab shows a panel of ready-made prompts for that scheduler. Select the scheduler from the dropdown and copy the prompt for whatever you want to do next:

| Prompt | What it does |
|---|---|
| **Add a handler** | Adds a new handler class in `handlers/`, registers it in `HANDLER_REGISTRY` and `_HANDLERS` in `router.py` |
| **Extend the database** | Adds a column to the `results` table, updates `save_result()` and `list_results()` |
| **Add an API route** | Adds a new route to `router.py` using the existing `APIRouter` object |
| **Custom scheduler logic** | Modifies `run()` or `_run_task()` in `scheduler.py` |

Paste the prompt into Claude Code (or any AI coding assistant). Each prompt enforces a strict boundary:

> Work only inside `server/schedulers/{name}_scheduler/`. Do NOT open, read, or modify anything in `server/kernelroot/` — that directory is off-limits.

This keeps the kernel untouched regardless of what the AI does.

---

## Managing schedulers

The **manage schedulers** section in the assistant tab lets you:

- **unregister** — removes the scheduler from the registry so the kernel no longer loads it. Code files are left on disk. Takes effect after a kernel restart.
- **re-register** — re-activates a previously unregistered scheduler.
- **delete all** — permanently deletes the scheduler's entire folder from disk (user-created schedulers only, three-click confirmation). Takes effect after a kernel restart.

Built-in schedulers (`llm`, `jsonparser`) can be unregistered but not deleted from the assistant tab.

### Deleting a scheduler with an external AI assistant

If you are not using the built-in assistant, deleting a scheduler is three steps:

1. **Remove the folder** — delete `server/schedulers/{name}_scheduler/` entirely.
2. **Remove from the scheduler registry** — open `server/kernelroot/scheduler_registry.py` and delete the line for `{name}`.
3. **Remove from the router registry** — open `server/kernelroot/router_registry.py` and delete the corresponding entry.

Then restart the kernel.

A prompt for your AI assistant:

> Delete the scheduler named `{name}` from this project. Remove the folder `server/schedulers/{name}_scheduler/`, then remove its entry from `server/kernelroot/scheduler_registry.py` and `server/kernelroot/router_registry.py`. Do not touch any other files.

---

## Building manually

If you prefer not to use the assistant, you can build a scheduler by hand. The existing schedulers are the reference implementations:

- `server/schedulers/llm_scheduler/`
- `server/schedulers/jsonparser_scheduler/`

### 1. Create the folder structure

```
server/schedulers/{name}_scheduler/
├── __init__.py
├── paths.py
├── db.py
├── scheduler.py
├── router.py
└── handlers/
    ├── __init__.py
    └── base.py
```

### 2. Write a logger

Copy `logger.py` from any generated scaffold, or write it directly:

```python
# server/schedulers/{name}_scheduler/logger.py
import logging, logging.handlers, os
from schedulers.{name}_scheduler.paths import LOGS_DIR

def _build():
    os.makedirs(LOGS_DIR, exist_ok=True)
    log = logging.getLogger("schedulers.{name}_scheduler")
    log.propagate = False
    log.setLevel(logging.DEBUG)
    if not log.handlers:
        h = logging.handlers.RotatingFileHandler(
            os.path.join(LOGS_DIR, "{name}.log"), maxBytes=5*1024*1024, backupCount=3
        )
        h.setFormatter(logging.Formatter("%(asctime)s  %(levelname)-8s  %(message)s", datefmt="%Y-%m-%d %H:%M:%S"))
        log.addHandler(h)
    return log

logger = _build()
```

### 3. Write a handler

Subclass your scheduler's `HandlerBase` (which wraps `_handle()` with automatic logging) and implement `_handle()`. The method receives `input` (str) and `options` (dict) and must return a string. Raise an exception to mark the task as failed.

```python
# server/schedulers/{name}_scheduler/handlers/my_handler.py
from schedulers.{name}_scheduler.handlers.base import MyHandlerBase
import json

class MyHandler(MyHandlerBase):
    def _handle(self, input: str, options: dict) -> str:
        result = f"processed: {input[:50]}"
        return json.dumps({"input": input, "output": result})
```

If you are not using the scaffold's base class pattern, implement `handle()` directly but add try/except and log exceptions yourself — see [Exception handling and logging](#exception-handling-and-logging).

### 4. Write the scheduler

Subclass `SchedulerBase`, declare `NAME` and `HANDLER_REGISTRY`, and implement `run()`. The base class provides `_stop_event` and `_sleep()` for clean shutdown.

```python
# server/schedulers/{name}_scheduler/scheduler.py
import threading
import time
from kernelroot.core import task_queue
from kernelroot.core.scheduler_base import SchedulerBase
from kernelroot.core.config import POLL_INTERVAL_SECONDS
from schedulers.{name}_scheduler.handlers.my_handler import MyHandler
from schedulers.{name}_scheduler.logger import logger

class MyScheduler(SchedulerBase):
    NAME = "{name}"
    HANDLER_REGISTRY = {
        "my_operation": {
            "handler":     MyHandler,
            "description": "What this operation does",
            "input_label": "Input",
            "options":     {"key": "description of option"},  # optional
        },
    }

    def __init__(self):
        super().__init__()
        self._lock    = threading.Lock()
        self._running = 0

    def run(self):
        task_types = [f"{self.NAME}_{op}" for op in self.HANDLER_REGISTRY]
        print(f"[{self.NAME}-scheduler] started")
        while not self._stop_event.is_set():
            with self._lock:
                if self._running < 4:
                    task = task_queue.get_next_pending_for_types(task_types)
                    if task:
                        self._running += 1
                        threading.Thread(target=self._run_task, args=(task,), daemon=True).start()
            self._sleep(POLL_INTERVAL_SECONDS)
        print(f"[{self.NAME}-scheduler] stopped")

    def _run_task(self, task: dict):
        task_id  = task["id"]
        short_id = task_id[:8]
        op       = task["agent_type"].removeprefix(f"{self.NAME}_")
        t0 = time.time()
        ok = True
        err = None
        result = ""
        try:
            handler = self.HANDLER_REGISTRY[op]["handler"]()
            task_queue.mark_running(task_id)
            result = handler.handle(task["prompt"], task.get("options") or {})
        except Exception as e:
            ok = False
            err = str(e)
            logger.exception("task %s (%s) failed: %s", short_id, task["agent_type"], e)
        finally:
            # log before mark_done/failed so the activity entry exists
            # when the IPC change notification fires
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
            else:
                task_queue.mark_failed(task_id, err)
            with self._lock:
                self._running = max(0, self._running - 1)
```

`agent_type` for tasks submitted to this scheduler follows the convention `{scheduler_name}_{operation_name}` — so `my_remove_alternate`, `my_add_word`, etc.

### 5. Write a router (optional)

If your scheduler needs its own HTTP endpoints beyond what the kernel API auto-generates (e.g. for querying your scheduler's database), add a `router.py`:

```python
# server/schedulers/{name}_scheduler/router.py
from fastapi import APIRouter
from schedulers.{name}_scheduler import db as scheduler_db

router = APIRouter(prefix="/{name}", tags=["{name}"])

@router.get("/results")
def list_results():
    return scheduler_db.list_results()
```

### 6. Register it

Add the scheduler to `server/kernelroot/scheduler_registry.py`:

```python
SCHEDULER_MAP: dict[str, str] = {
    "llm":        "schedulers.llm_scheduler.scheduler.LLMScheduler",
    "jsonparser": "schedulers.jsonparser_scheduler.scheduler.JsonParserScheduler",
    "my":         "schedulers.my_scheduler.scheduler.MyScheduler",   # ← add this
    # [ASSISTANT_SCHEDULERS]
}
```

If you added a router, add it to `server/kernelroot/router_registry.py`:

```python
ROUTERS: list[tuple[str, str]] = [
    ("schedulers.my_scheduler.router", "router"),   # ← add this
    # [ASSISTANT_ROUTERS]
]
```

Restart the backend to load the new scheduler.

---

## How the kernel picks up your scheduler

At startup, the control plane (`main.py`) reads `scheduler_registry.py` and passes all keys as `KERNEL_SCHEDULERS` to the kernel process. The kernel:

1. Imports the class from the dotted path
2. Instantiates it
3. Runs it in a daemon thread
4. Auto-generates one `POST /kernel/{name}/{operation}` endpoint per entry in `HANDLER_REGISTRY`

The auto-generated kernel API (port 8002) is separate from the router endpoints (port 8000). The kernel API is synchronous and direct — it bypasses the task queue entirely and calls the handler immediately.

---

## Submitting tasks via the queue

Tasks go through the shared queue and are picked up by the scheduler on the next poll. The `agent_type` follows the convention `{scheduler_name}_{operation_name}`:

```bash
curl -X POST http://localhost:8000/submit \
  -H "Content-Type: application/json" \
  -d '{"prompt": "the quick brown fox", "agent_type": "my_my_operation"}'
```

Pass handler options as the `options` object — the scheduler receives it as a dict in `task.get("options")`:

```bash
curl -X POST http://localhost:8000/submit \
  -H "Content-Type: application/json" \
  -d '{"prompt": "the quick brown fox", "agent_type": "my_add_word", "options": {"word": "hello"}}'
```

Poll `GET /tasks/{task_id}` until `status` is `done` or `failed`.

The scheduler tab in the frontend submits tasks this way automatically — results appear in the task queue and the kernel activity log.

---

## Summary

| Step | Using the assistant | Manual |
|---|---|---|
| Folder structure | Generated automatically | Create by hand |
| Handler | Edit `handlers/` | Write `HandlerBase` subclass |
| Scheduler | Edit `scheduler.py` | Write `SchedulerBase` subclass with `HANDLER_REGISTRY` |
| Router | Edit `router.py` | Write FastAPI `APIRouter`, add to `router_registry.py` |
| Registration | Done automatically | Add to `scheduler_registry.py` (and `router_registry.py`) |
| Activation | Click **stop kernel & register** | Restart the backend |
