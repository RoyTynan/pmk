# PMK — Design Specification

## The Core Idea

Modern LLM deployment is stuck in a simple request/response loop. A user sends a prompt, the model responds, the context is discarded. This is the equivalent of running a CPU with no operating system — raw, uncoordinated, and wasteful.

The shift: **treat the LLM as volatile compute hardware** and build a proper operating system on top of it.

| Analogy | Role in this system |
|---|---|
| CPU | The LLM — stateless, fast at inference, blind to everything outside its context window |
| RAM | The context window — small, expensive, volatile |
| Processes | Agents — isolated units of work with defined input/output contracts and token budgets |
| Scheduler | Task queue — assigns work to available inference slots, manages concurrency |
| Kernel | Two-process backend — control plane (port 8000) and execution plane (port 8002) |
| Terminal | Next.js UI — the human interface to the OS |
| Peripheral drivers | LLM registry — abstracts local, LAN, and cloud models behind a uniform interface |

The game is no longer about the model. It is about **what surrounds the model**.

---

## Design Principles

**Local-first.** The system must run entirely on local hardware. Cloud providers are optional peripherals, not dependencies. A llama-server instance on a LAN machine is a first-class inference device.

**Hardware-agnostic.** The same agent code must run against a local GGUF model, a LAN server, and a cloud API like Anthropic or OpenAI without modification. The LLM registry handles the translation.

**Provider-neutral.** Cloud providers speak different protocols. OpenAI, Groq, and Together AI use `/v1/chat/completions`. Anthropic uses `/v1/messages` with different headers and response shapes. The unified LLM client handles all of this transparently — agents and the pipeline runner never need to know which provider they are talking to.

**Observable.** The OS must have live visibility into what is happening. Every state change — task submitted, task running, task done, LLM started, LLM stopped — must be pushed to the UI in real time without polling.

**Self-correcting.** Agents must be able to detect their own failure and retry with the failure fed back as context. Code execution is the judge — if the code does not run, the attempt failed, and the LLM must try again.

**Crash-resilient.** Tasks must survive server restarts. If the process crashes mid-execution, in-flight tasks must be recoverable and requeued automatically on startup.

**Pluggable.** The kernel must have no knowledge of what its workers do. New classes of work are added by writing a scheduler — a self-contained module that registers for task types and dispatches them to handlers. The kernel, the queue, and the API need no changes.

---

## Architecture

### Layer 0 — Inference Hardware

The OS does not own the inference hardware. It treats inference as a peripheral — a service that accepts requests and returns completions.

**Supported backends:**
- Local llama-server (GGUF models via llama.cpp) — started and managed by the OS
- LAN llama-server or Ollama — registered by URL
- Cloud APIs: OpenAI (ChatGPT), Anthropic (Claude), Groq, Together AI — registered with API key

All backends expose an OpenAI-compatible `/v1/chat/completions` interface, except Anthropic which requires protocol translation. The unified LLM client in `server/schedulers/llm_scheduler/client.py` handles both.

---

### Layer 1 — Kernel

The backend is two cooperating processes:

**Control plane** (`server/kernelroot/main.py`, port 8000) — the FastAPI server that owns the REST and WebSocket APIs, manages child processes (the execution plane and local model servers), and pushes live state to all browser clients.

**Execution plane** (`server/kernelroot/kernel.py`, port 8002) — the process that runs scheduler threads and exposes an auto-generated API for direct handler calls. Kept separate because scheduler poll loops must not share the control plane's uvicorn event loop.

**Responsibilities of the control plane:**
- Serve REST endpoints for all OS operations
- Manage the WebSocket connection for real-time state push
- Route inference calls through the LLM registry
- Mount sub-routers for built-in subsystems (agentic, Ray, analyse, traces)
- Load and mount routers for user-created schedulers from `router_registry.py`

**Real-time state push:** Every mutation — task created, LLM registered, task completed — calls `_notify()`, which posts a `"change"` event to an asyncio queue. A background worker drains the queue (collapsing bursts into one broadcast) and sends a full snapshot to all connected WebSocket clients. No polling, no stale UI.

---

### Layer 2 — Process Manager

**Task queue (`server/kernelroot/core/task_queue.py`):**
- SQLite-backed persistent queue at `server/kernelroot/database/tasks.db`
- Tasks survive server restarts
- States: `pending → running → done / failed`
- Supports parent/child task relationships for agent spawning
- Automatic crash recovery: tasks stuck in `running` state on startup are requeued
- IPC: after every state change, opens a TCP connection to port 8001 to notify the control plane

**LLM registry (`server/schedulers/llm_scheduler/registry.py`):**
- SQLite-backed at `server/schedulers/llm_scheduler/database/llms.db`
- Stores per-LLM: url, model, type, api_key, provider, max_tasks, port, path, use_gpu
- Migrates automatically from legacy `llms.json` on first run
- Local LLMs: started as subprocesses by the control plane, PIDs tracked in `llm_states` table
- Remote/cloud LLMs: registered by the user, available immediately

**Activity log (`server/kernelroot/core/activity_log.py`):**
- Records every LLM call regardless of which path triggered it — queue, pipeline, agentic, Ray, or direct
- Stored in the `activity` table in `tasks.db`
- Captures: LLM name, model, provider, source, prompt length, result length, duration, success/failure

**Scheduler registry (`server/kernelroot/scheduler_registry.py`):**
- Maps scheduler names to fully-qualified class paths
- The control plane reads this at startup and passes the names to the execution plane
- The assistant appends new entries here automatically when a scheduler is created

---

### Layer 3 — Scheduler System

The kernel has no knowledge of what its schedulers do. It only manages lifecycle and routing. Each scheduler is a self-contained module that:

1. Subclasses `SchedulerBase`
2. Declares `NAME` and `HANDLER_REGISTRY`
3. Implements a blocking `run()` loop
4. Is registered in `scheduler_registry.py`

The execution plane loads each scheduler at startup, runs it in a daemon thread, and auto-generates one kernel API endpoint per operation in its `HANDLER_REGISTRY`.

**LLMScheduler** — connects the kernel to AI models. Reads the LLM registry on every poll so new models are picked up without a restart. Each LLM has its own concurrency slot counter so multiple models run in parallel while each serialises its own tasks. Dispatches to `EchoAgent` and `PlannerAgent`.

**JsonParserScheduler** — demonstrates the same kernel pattern applied to a different class of work. Receives tasks of type `file_parse_json`, parses and validates the JSON content, and returns a structural report: root type, size, nesting depth, a recursive schema, and any warnings.

---

### Layer 4 — Agent Runtime

Every LLM agent inherits from `AgentBase` (`server/schedulers/llm_scheduler/agents/base.py`). The base class provides:

- **LLM access** — resolves the assigned LLM from the registry and calls it via the unified client with correct headers and protocol per provider
- **Token budget** — each agent declares a `TOKEN_BUDGET`; the base class enforces a hard ceiling (`TOKEN_BUDGET_CEILING`) across all agents
- **Child task spawning** — agents submit new tasks to the queue via `spawn_task()`, enabling hierarchical agent trees
- **Input estimation** — estimates input token count (chars ÷ 4) for observability
- **Input/output contract** — agents implement a single `run()` method; return value is stored as the task result

**EchoAgent** — sends the prompt directly to the LLM and returns the response.

**PlannerAgent** — two-phase: asks the LLM to decompose a goal into 2–4 subtasks, then spawns each as a child `echo` task. Child routing is `same` (all to the same LLM) or `split` (round-robined across all registered LLMs). Optional aggregation: waits for all children to complete, then synthesises a final answer.

---

### Layer 5 — Agentic Loop

The agentic layer implements a self-correcting code generation loop using LangGraph (`server/schedulers/llm_scheduler/agentic/`). It is isolated from the task queue — the control plane mounts it as a sub-router at `/agentic`.

**State machine:**

```
generate → extract → execute → judge
                                  ↓ passed, or max attempts reached → END
                                  ↓ failed → generate (retry with error)
```

**Nodes:**
- `generate` — calls the selected LLM; on retry, the previous error is appended to the conversation so the model can fix it
- `extract` — pulls Python code from the LLM response using regex; falls back gracefully if the model responds with a plain expression
- `execute` — runs the extracted code in a subprocess with a 10-second timeout; captures stdout and stderr
- `judge` — checks exit code; pass if zero and no stderr, fail otherwise; if failed and attempts remain, loop back to generate

**Streaming:** Results are streamed as SSE events, one per node per attempt, so the UI shows each stage live — generating, executing, passed or failed — without waiting for the full run to complete.

**Why code execution as the judge?** Code either runs or it does not. There is no ambiguity, no hallucination in the verdict. This is the most reliable form of agent self-correction available without a second model.

---

### Layer 6 — Shell

The shell is a Next.js application — the human interface to the OS. It is structured in three levels:

**Top-level tabs:** `kernel` | `schedulers` | `assistant`

**kernel** — live view of the execution engine: task queue stats, collapsible panels per task state with pagination, per-row requeue and delete actions, LLM activity log, loaded scheduler list.

**schedulers** — a second row of tabs selects the active scheduler (`llm`, `jsonparser`, user-created). Under the `llm` scheduler, a third row of feature tabs: `llms`, `single`, `multi`, `agentic`, `ray`, `analyse`, `logs`, `api`.

**assistant** — scaffold generator for new schedulers. Produces a complete folder structure, handler base class, router, database, and registry entry in one click. Also provides ready-made Claude Code prompts for extending the scaffold.

**Live state:** All tabs receive real-time updates via a single WebSocket connection. Initial snapshot on connect; re-fetched on every `"change"` push from the control plane.

**Tab persistence:** All tabs are mounted on load and shown/hidden with CSS. State survives tab switches — a running pipeline or agentic loop continues in the background while you navigate elsewhere.

---

## LLM Registry and Provider Support

The registry is the peripheral driver layer. It abstracts all the differences between inference backends behind a single interface.

**Supported providers:**

| Provider | Protocol | Auth |
|---|---|---|
| Local llama-server | OpenAI-compatible | None |
| LAN llama-server / Ollama | OpenAI-compatible | None |
| ChatGPT (OpenAI) | OpenAI `/v1/chat/completions` | Bearer token |
| Anthropic (Claude) | `/v1/messages` + `x-api-key` header | x-api-key |
| Groq | OpenAI-compatible | Bearer token |
| Together AI | OpenAI-compatible | Bearer token |
| Custom | OpenAI-compatible | Optional Bearer token |

**Registration flow for cloud providers:**
1. Select provider — base URL and default model are pre-filled
2. Enter API key
3. Hit register — the control plane tests connectivity before saving
4. If the test passes, the LLM is saved to `llms.db`; the API key never travels back to the browser after registration

**Unified LLM client** (`server/schedulers/llm_scheduler/client.py`): sync and async variants. Handles protocol differences, header construction, and response parsing per provider. Every call is recorded to the activity log.

---

## Observability

**WebSocket state push:** Single connection per browser session. Every mutation triggers `_notify()` → asyncio push queue → WebSocket broadcast. Clients receive a full snapshot on each event and on connect.

**SSE streaming:** Long-running operations stream progress events:
- Pipeline runner (`/multi/run`) — one event per step
- Agentic loop (`/agentic/run`) — one event per node per attempt
- Ray batch and analyse (`/ray/batch`, `/analyse/run`) — one event per task as it finishes (fastest result first via `ray.wait`)

**Activity log:** Every LLM call from any source is recorded to the `activity` table in `tasks.db` with timing and outcome. Visible in the kernel tab.

**Logs tab:** Shows the log file for each running local LLM server process.

---

## Technology Choices

**Python / FastAPI** — the inference stack (llama.cpp, httpx) is Python-native. FastAPI provides async support for WebSocket, SSE streaming, and concurrent request handling. Two FastAPI processes — one for the control plane, one for the execution plane — keep the blocking scheduler loops off the main event loop.

**SQLite** — sufficient for the task queue at this scale. No external process to manage. Survives restarts. Supports the parent/child task relationship query pattern. Used for three stores: task queue, LLM registry, activity log.

**LangGraph** — the correct tool for the agentic loop. Built around state machines with conditional edges — exactly what a generate/execute/retry loop requires. Isolated to `server/schedulers/llm_scheduler/agentic/`.

**Ray** — distributed execution framework, run in local mode. Used by the batch and analyse features for true parallel dispatch across CPU cores.

**Next.js** — provides the WebSocket proxy, API route forwarding, and static serving in a single process alongside the React frontend. The custom `server.js` handles WebSocket upgrade forwarding to the FastAPI backend.

**No vector store, no embedding model** — the current system does not need retrieval. Agents work from task prompts and conversation history. A vector store is the natural next addition if the system needs to reason over documents or a large codebase.

---

## Hard Problems and How They Are Addressed

**Task persistence across crashes** — SQLite queue with explicit state transitions. On startup, any task left in `running` state is automatically requeued.

**Silent LLM failure** — LLMs fail silently, producing plausible wrong output rather than exceptions. The agentic loop addresses this for code generation by using execution as the judge — the output is verified objectively. The error is fed back on retry.

**Provider protocol fragmentation** — solved at the client layer. The unified LLM client handles OpenAI and Anthropic protocols. Adding a new provider requires one new branch in `client.py`, not changes across the codebase.

**API key security** — keys are stored server-side in `llms.db` and never returned to the browser after registration. Outbound calls include the key in the appropriate header.

**Concurrency on a single model** — llama-server serialises inference requests internally. The scheduler respects `max_tasks` per LLM, preventing queue pile-up. Multiple model instances can run concurrently on different ports.

**Execution plane isolation** — the kernel's scheduler threads run blocking poll loops. Keeping them in a separate process prevents them from interfering with the control plane's async event loop.

---

## What Comes Next

The system as specified is a functional LLM micro OS. Natural next additions, in order of value:

1. **Retrieval layer** — a vector store for document Q&A; the memory pager concept from the original vision
2. **More agent types** — reviewer, summariser, tool-calling agents built on `AgentBase`
3. **Multi-language agentic execution** — JavaScript, shell execution alongside Python in the agentic loop
4. **Agent-to-agent IPC** — structured message passing between running agents via the task queue
5. **Context compression** — summarise long conversation histories before they overflow the context window
6. **Token accounting** — aggregate token expenditure per agent, per task, per LLM across sessions
