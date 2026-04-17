# Design Specification

## Introduction

This is my refactor document that I produced prior to the refactor of this project.<br>
It started out as a series of notes that I gradually refined into this spec.<br>
During December 2025 I wrote a series of prompts into Gemini AI asking for suggestions / answers.<br>
The document started to take shape.<br>
This document has become a bit outdated but I decided to include it in this repo by way of an example of how to plan ahead rather than just hack at it.

## The Core Idea

A general-purpose host that loads pluggable scheduler modules at startup, routes tasks to them via a shared queue, and exposes everything over a uniform API — without ever needing to be modified when new schedulers are added.

The host itself is stable and minimal. All domain knowledge lives in the schedulers.

---

## Design Principles

**Pluggable.** The host has no knowledge of what its schedulers do. New classes of work are added by writing a scheduler — a self-contained module that registers for task types and dispatches them to handlers. The host, the queue, and the API need no changes.

**Observable.** Every state change — task submitted, task running, task done, host started, host stopped — is pushed to the UI in real time without polling.

**Crash-resilient.** Tasks survive server restarts. If the process crashes mid-execution, in-flight tasks are recovered and requeued automatically on startup.

**Local-first.** The system runs entirely on local hardware. External services are optional and registered as peripherals, not hard dependencies.

**Self-contained schedulers.** Each scheduler owns its own database, log files, and exception handling. The host does not manage scheduler state or catch scheduler exceptions.

---

## Architecture

### Two-Process Backend

The backend is two cooperating processes:

**Control plane** (`server/schedhost/main.py`, port 8000) — the FastAPI server that owns the REST and WebSocket APIs, manages child processes, and pushes live state to all browser clients.

**Execution plane** (`server/schedhost/host.py`, port 8002) — the process that runs scheduler threads and exposes an auto-generated API for direct handler calls. Kept separate because scheduler poll loops must not share the control plane's uvicorn event loop.

The control plane starts the execution plane as a subprocess and monitors it. If it exits unexpectedly, the control plane marks it as stopped and reports the status to connected clients.

---

### Task Queue

**`server/schedhost/core/task_queue.py`**

- SQLite-backed persistent queue at `server/schedhost/database/tasks.db`
- Tasks survive server restarts
- States: `pending → running → done / failed`
- Supports parent/child task relationships for hierarchical work
- Automatic crash recovery: tasks stuck in `running` state on startup are requeued to `pending`
- IPC: after every state change, opens a TCP connection to port 8001 to notify the control plane; the control plane pushes a snapshot to all WebSocket clients

**Task fields:**

| Field | Purpose |
|---|---|
| `id` | UUID |
| `prompt` | Input string passed to the handler |
| `agent_type` | Routing key — `{scheduler_name}_{operation}` |
| `status` | `pending / running / done / failed` |
| `result` | Handler output (string) on success |
| `error` | Error message on failure |
| `options` | JSON dict of handler options |
| `parent_id` | Links child tasks to a parent |
| `created_at / started_at / finished_at` | Unix timestamps |

---

### Scheduler Plugin System

A scheduler is a Python class that subclasses `SchedulerBase`, declares a `HANDLER_REGISTRY`, and implements a blocking `run()` loop. The execution plane loads all registered schedulers at startup and runs each in a daemon thread.

**`SchedulerBase`** (`server/schedhost/core/scheduler_base.py`) provides:
- `_stop_event` — set when the host is asked to stop; `run()` must respect it
- `_sleep(seconds)` — interruptible sleep that wakes immediately when `_stop_event` is set
- `log_activity(...)` — writes a row to the shared activity log in `tasks.db`
- Base implementation of `_run_task(task)` that schedulers can override

**`HANDLER_REGISTRY`** declares what the scheduler can do:

```python
HANDLER_REGISTRY = {
    "my_operation": {
        "handler":     MyHandler,
        "description": "What this operation does",
        "input_label": "Input",
        "options":     {"key": "description of option"},
    },
}
```

The execution plane auto-generates one `POST /host/{name}/{operation}` endpoint per registry entry. This endpoint calls the handler directly, bypassing the task queue.

**Registration** is two lines — one in `server/schedhost/scheduler_registry.py` (maps name to class path) and one in `server/schedhost/router_registry.py` (mounts the scheduler's optional FastAPI router). The assistant tab handles both automatically.

---

### Real-Time State Push

Every mutation in the control plane calls `_notify()`, which posts a `"change"` event to an asyncio queue. A background worker drains the queue (collapsing bursts into one broadcast) and sends a full JSON snapshot to all connected WebSocket clients.

The task queue notifies the control plane via IPC (TCP on port 8001) after every state transition. This means task completions in the execution plane's scheduler threads still reach the browser in real time.

Clients receive:
- A full snapshot on connect
- A full snapshot on every `"change"` push

No polling anywhere in the system.

---

### Activity Log

**`server/schedhost/core/activity_log.py`**

Records every handler call from any source — queue, direct host API. Stored in the `activity` table in `tasks.db`. Each row captures: scheduler name, operation, prompt length, result length, duration in ms, and success/failure.

---

### Exception Log

**`server/schedhost/core/error_log.py`**

Host-level exception log for the `schedhost` package itself. Records unexpected exceptions to both a rotating log file (`errors.log`, 5 MB × 3 files) and an `error_log` table in `tasks.db`.

Each entry stores: timestamp, log level (Python logging constants: 10/20/30/40/50), level name, source module, location (`filename:lineno` of the innermost frame), message, and full traceback.

DB writes are best-effort — if the DB is unavailable, the file log still captures the exception.

Schedulers are **not** expected to use this. Each generated scheduler has its own `logger.py` with a separate rotating file log. The host exception log is for `schedhost` infrastructure only.

---

### Scheduler Exception Handling

Each scaffold-generated scheduler includes:

- **`logger.py`** — rotating file logger writing to `logs/{name}.log` (5 MB × 3 files)
- **`handlers/base.py`** — `handle()` wraps `_handle()` in try/except and calls `logger.exception()` before re-raising; subclasses implement `_handle()` only
- **`scheduler.py`** — `_run_task()` catches re-raised exceptions from `handle()`, logs them, and marks the task failed
- **`router.py`** — each route wraps its handler call in try/except with `logger.exception()`

This gives every scheduler automatic exception capture with full tracebacks for free. Developers add specific exception handling inside `_handle()` for known failure modes (timeouts, validation errors, external service failures).

---

### Package Structure

```
server/schedhost/
├── main.py                    ← control plane (FastAPI, port 8000)
├── host.py                    ← execution plane (FastAPI, port 8002)
├── scheduler_registry.py      ← name → class path map
├── router_registry.py         ← scheduler routers to mount
├── core/
│   ├── scheduler_base.py      ← SchedulerBase
│   ├── task_queue.py          ← SQLite queue + IPC notify
│   ├── activity_log.py        ← per-call activity records
│   ├── error_log.py           ← host exception log
│   └── config.py              ← ports, paths, poll interval
├── database/
│   └── tasks.db               ← tasks + activity + error_log tables
└── scaffolding/
    └── scaffolding.py         ← templates for generated schedulers
```

---

## Technology Choices

**Python / FastAPI** — FastAPI provides async support for WebSocket and concurrent request handling. Two FastAPI processes — one for the control plane, one for the execution plane — keep the blocking scheduler poll loops off the main event loop.

**SQLite** — sufficient for the task queue at this scale. No external process to manage. Survives restarts. Supports the parent/child task relationship query pattern. Three tables in one file: `tasks`, `activity`, `error_log`.


---

## Hard Problems and How They Are Addressed

**Task persistence across crashes** — SQLite queue with explicit state transitions. On startup, any task left in `running` state is automatically requeued to `pending`.

**Execution plane isolation** — the host's scheduler threads run blocking poll loops. Keeping them in a separate process prevents them from interfering with the control plane's async event loop. If the execution plane crashes, the control plane detects it and reports the status without itself crashing.


**Scheduler isolation** — each scheduler owns its own database and log files. A badly-behaved scheduler cannot corrupt the host's queue or exception log. The host does not catch scheduler exceptions — they are the scheduler's responsibility.

---

## What Comes Next

1. **Scheduler dependency injection** — allow schedulers to declare dependencies on other schedulers and receive references at startup
2. **Task priorities** — weighted queue dispatch so high-priority tasks are picked up ahead of background work
3. **Scheduler health checks** — the execution plane polls each scheduler thread and reports stalled threads to the control plane
4. **Task streaming** — allow handlers to stream partial results back to the client via SSE rather than only returning on completion
5. **Scheduled tasks** — cron-style recurring task submission without external tooling
