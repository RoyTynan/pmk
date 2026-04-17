# Server Architecture

The backend is two separate Python processes that start together via `start.sh`:

- **Control plane** (`server/schedhost/main.py`) — FastAPI on port 8000. Owns the REST and WebSocket APIs, manages child processes (the host and local model servers), and pushes live state to all connected browser clients.
- **Execution plane** (`server/schedhost/host.py`) — FastAPI on port 8002. Runs the scheduler threads and exposes an auto-generated API for direct handler calls.

The two are kept separate deliberately: the host runs blocking poll loops and must not share the uvicorn event loop used by the control plane.

---

## Process map

```
uvicorn (port 8000)  ←── browser WebSocket / REST
│  main.py — control plane
│  Spawns:
│    ├── host.py         — execution plane (child process, port 8002)
│    └── llama-server ×N  — one per started local LLM
│
uvicorn (port 8002)  ←── kernel API (internal + assistant tab)
│  host.py — execution plane
│  Runs in threads:
│    ├── scheduler ×N  — one thread per registered scheduler, each polls the task queue
│
SQLite (server/schedhost/database/tasks.db)
│  tasks table    — shared task queue (pending → running → done/failed)
│  activity table — kernel activity log (all schedulers and sources)
│
IPC (TCP 127.0.0.1:8001)
   task_queue → main.py  — change notifications trigger WebSocket push
```

---

## Component detail

### Control plane (`server/schedhost/main.py`)

The FastAPI application running on port 8000. Responsibilities:

- **REST API** — all HTTP endpoints: tasks, submit, LLM registration, LLM start/stop, agentic, Ray, analyse, traces, activity log, browse, scheduler list
- **WebSocket push** — maintains connected browser clients; broadcasts a full snapshot whenever task or LLM state changes
- **Process management** — spawns the host subprocess and all llama-server processes with `subprocess.Popen`; handles in `_kernel_proc` and `_llm_procs`
- **IPC server** — listens on TCP port 8001 for change notifications from the task queue; each notification triggers a WebSocket broadcast
- **Router loading** — at startup, imports every router listed in `router_registry.py` and attaches them to the FastAPI app

The control plane does not process tasks. It writes tasks to SQLite and waits for the host to update them.

**Startup sequence:**

1. uvicorn starts the FastAPI app
2. `_startup()` runs: captures the event loop, starts the IPC server on port 8001, starts the WebSocket push worker, re-registers signal handlers
3. Spawns `host.py` as a child process, passing `HOST_SCHEDULERS` from the scheduler registry

**Signal handling:**

`SIGTERM` and `SIGINT` call `_clean_exit`, which redirects stderr to `/dev/null` (to suppress shutdown noise from Ray and C++ subprocesses) then calls `os._exit(0)`. Signal handlers are re-registered after uvicorn and Ray have started because both override them during initialisation.

---

### Execution plane (`server/schedhost/host.py`)

Runs as a child process spawned by the control plane. Responsibilities:

- **Scheduler threads** — loads each scheduler listed in `HOST_SCHEDULERS`, instantiates it, and runs it in a daemon thread
- **Kernel API** — starts a second FastAPI app on port 8002 with auto-generated endpoints from each scheduler's `HANDLER_REGISTRY`; this is the API used by the assistant tab and for direct handler calls

On startup, `requeue_stuck_tasks()` resets any tasks left in `running` state from a previous crash back to `pending`.

**Kernel API auto-generation:**

The kernel iterates every loaded scheduler's `HANDLER_REGISTRY` and creates one `POST /{scheduler_name}/{operation}` route per entry. No router code is needed — registering a handler in `HANDLER_REGISTRY` automatically creates the public endpoint.

---

### Scheduler system

#### SchedulerBase (`server/schedhost/core/scheduler_base.py`)

Abstract base class for all schedulers. Each subclass declares:

- `NAME` — identifier string, used as the URL prefix in the host API
- `HANDLER_REGISTRY` — maps operation names to handler metadata (handler class, description, input label, options)

The base class provides:
- `run()` — must be implemented; a blocking loop that never returns
- `stop()` — sets a threading event that `_sleep()` checks, allowing clean shutdown
- `_sleep(seconds)` — interruptible sleep
- `log_activity()` — writes one row to the host activity log. Must be called in `_run_task()`'s `finally` block **before** `mark_done()`/`mark_failed()` so the entry exists in SQLite when the IPC change notification fires and the WebSocket snapshot is built.

#### Built-in schedulers

Two schedulers ship with the system:

**LLM scheduler** (`server/schedulers/llm_scheduler/`) — handles LLM tasks. Manages per-model concurrency: each registered model has its own slot counter capped at its `max_tasks` limit so multiple models run in parallel while each serialises its own tasks. New models are picked up on the next poll without a restart. Includes the agents, agentic, and Ray subsystems described below.

**JSON parser scheduler** (`server/schedulers/jsonparser_scheduler/`) — handles JSON parsing tasks. Demonstrates the same scheduler pattern applied to a non-LLM workload; same queue, completely different handlers.

---

### Scheduler registry (`server/schedhost/scheduler_registry.py`)

Maps scheduler names to their fully-qualified class paths:

```python
SCHEDULER_MAP = {
    "llm":        "schedulers.llm_scheduler.scheduler.LLMScheduler",
    "jsonparser": "schedulers.jsonparser_scheduler.scheduler.JsonParserScheduler",
    # [ASSISTANT_SCHEDULERS]
}
```

The control plane reads this map at startup and passes the keys as `HOST_SCHEDULERS` to the host process. The `[ASSISTANT_SCHEDULERS]` marker is where the assistant appends new scheduler entries automatically.

### Router registry (`server/schedhost/router_registry.py`)

Lists FastAPI routers from user-created schedulers that should be mounted on the control plane:

```python
ROUTERS = [
    ("schedulers.my_scheduler.router", "router"),
    # [ASSISTANT_ROUTERS]
]
```

The control plane imports each module at startup and calls `app.include_router()`. Built-in scheduler routers (agentic, ray, analyse, traces) are imported directly; only user-created ones go through this registry.

---

### Task queue (`server/schedhost/core/task_queue.py`)

SQLite-backed persistent queue. All task state lives in `tasks.db` in the `tasks` table.

**Task lifecycle:**

```
pending → running → done
                 ↘ failed
```

- `add_task()` — inserts a new row with `status='pending'`
- `mark_running()` — sets `status='running'`, records which handler picked it up and token estimates
- `mark_done()` — sets `status='done'`, stores the result string
- `mark_failed()` — sets `status='failed'`, stores the error string

After every status change, `_notify()` opens a TCP connection to the IPC server on port 8001 and sends `change\n`. The control plane receives this and pushes a fresh snapshot to all WebSocket clients. The notify is fire-and-forget — if the control plane is not running it silently fails.

**Crash recovery:**

On kernel startup, `requeue_stuck_tasks()` resets any tasks in `running` state back to `pending`.

**Task fields:**

| Field | Description |
|---|---|
| `id` | UUID |
| `prompt` | Input text |
| `agent_type` | Which agent handles it (e.g. `echo`, `planner`, `{scheduler}_{operation}`) |
| `priority` | Higher number = dispatched first |
| `status` | `pending`, `running`, `done`, `failed` |
| `options` | JSON object of handler-specific options (e.g. `{"word": "hello"}`) |
| `llm` | Which LLM actually ran the task (set at runtime) |
| `target_llm` | Requested LLM (set at submission) |
| `token_budget` | Max output tokens allowed |
| `input_tokens_est` | Estimated input token count (chars ÷ 4) |
| `parent_id` | Set on child tasks spawned by the planner agent |
| `child_routing` | `same` or `split` — planner routing mode |
| `aggregate` | Whether the planner should synthesise child results |
| `result` | Final output string |
| `error` | Error message if failed |
| `created_at`, `started_at`, `finished_at` | Unix timestamps |

---

### Activity log (`server/schedhost/core/activity_log.py`)

Records activity across all schedulers and kernel sources — queue, pipeline, agentic, Ray, or direct. Stored in the `activity` table in `tasks.db`.

Each entry captures the handler name, model, provider, source, prompt length, result length, duration in milliseconds, and whether the call succeeded. The `clear()` function deletes all rows and is exposed via `POST /activity/clear`.

Every `SchedulerBase` subclass inherits `log_activity()`, which writes to this table. Scaffolded and manually written schedulers both call it at the end of each `_run_task()` invocation. This is what drives the **Kernel Activity** panel in the host tab.


---

### WebSocket push architecture

All browser clients stay in sync via a single WebSocket endpoint (`/ws`). Flow:

1. Browser connects → receives an immediate full snapshot (all tasks, all LLMs, activity log, kernel state)
2. Any state change (task submitted, task completed, LLM started/stopped) calls `_notify()`
3. `_notify()` posts to an asyncio queue (`_push_queue`), crossing the thread boundary safely with `call_soon_threadsafe`
4. `_push_worker` drains the queue (collapsing bursts into one broadcast) and sends a fresh snapshot to all connected clients

Task queue changes signal via TCP on port 8001. The IPC server in the control plane receives these and posts to the same push queue.

---

## Data flow summary

**Queue-based task:**
```
Browser → POST /submit → tasks.db (pending)
                              ↓
                   Scheduler polls (every 2s)
                              ↓
                   Handler runs in thread
                              ↓
                   log_activity() → activity table
                              ↓
                   tasks.db (done/failed)
                              ↓
                   IPC TCP notify → control plane push queue
                              ↓
                   WebSocket broadcast → Browser
```

**User-created scheduler task (scheduler tab):**
```
Browser → POST /submit → tasks.db (pending)
  agent_type: "{scheduler}_{operation}"       ↓
  options:    {…}              scheduler polls (every 2s)
                                         ↓
                                  Handler runs with options dict
                                         ↓
                                  log_activity() → activity table
                                         ↓
                                  tasks.db (done/failed)
                                         ↓
                                  IPC TCP notify → WebSocket broadcast → Browser
```

**Direct kernel call (kernel API):**
```
Client → POST /schedhost/{scheduler}/{operation}  (port 8002)
              ↓
         Handler.handle(input, options)
              ↓
         Synchronous result returned immediately
```
