# Built-in Schedulers

HostScheduler ships with two schedulers that run side by side and demonstrate the breadth of the pluggable scheduler pattern. Both read from the same shared task queue; neither is aware of the other.

---

## LLM scheduler (`server/schedulers/llm_scheduler/`)

Connects the kernel to AI language models. It manages a dynamic registry of named model entries, enforces per-model concurrency limits, and routes each task to the right model via an agent layer.

### Model registry (`registry.py`)

SQLite database at `database/llms.db`. Owns two tables:

**`llms`** — maps model names to connection config. Both the control plane and the scheduler read from it at runtime — no restart needed when a model is registered. On first run, migrates automatically from the legacy `llms.json` if one exists, otherwise seeds from the hardcoded defaults in `config.py`.

| Field | Description |
|---|---|
| `url` | Base URL of the model server |
| `model` | Model identifier (file name for local, model ID for cloud) |
| `type` | `local`, `remote`, or `cloud` |
| `max_tasks` | Concurrency limit for this model |
| `api_key` | API key (cloud models only) |
| `provider` | `openai`, `anthropic`, `groq`, `together`, `custom` |
| `path` | Absolute path to the `.gguf` file (local only) |
| `port` | Port the llama-server listens on (local only) |
| `use_gpu` | Whether to enable GPU layers (local only) |

**`llm_states`** — tracks runtime state of each model. Kept in `llms.db` so all LLM-specific state is co-located and the kernel's `tasks.db` stays generic.

| Field | Description |
|---|---|
| `name` | Model name (foreign key to `llms`) |
| `running` | 1 if currently active, 0 if stopped |
| `pid` | OS process ID (local models only) |
| `started_at` | Unix timestamp when last started |
| `stopped_at` | Unix timestamp when last stopped |

On startup, local model states are reset to stopped (their processes died on last exit); remote/cloud models keep their persisted state.

### Concurrency and dispatch

Each registered model has its own slot counter. The scheduler only dispatches a task to a model if its slot count is below `max_tasks` (default 1):

- Multiple models can run tasks simultaneously
- Each model serialises its own tasks
- New models added to the registry are picked up on the next poll without a restart

**LLM routing per task** — target model is resolved in this order:
1. `target_llm` field set on the task at submission
2. Prompt prefix shortcut — if the first word matches an entry in `LLM_SHORTCUTS`, that model is used and the prefix stripped
3. `DEFAULT_LLM` fallback

### HTTP client (`client.py`)

Unified HTTP caller used by agents, the pipeline runner, and the agentic subsystem. Handles two wire protocols:

- **OpenAI-compatible** (`/v1/chat/completions`) — local llama-server, Groq, Together AI, and any `custom` provider
- **Anthropic** (`/v1/messages`) — detected by `provider == 'anthropic'`; builds the correct headers and body shape

Both sync (`call_llm`) and async (`acall_llm`) variants exist. Agents in scheduler threads use the sync version; the pipeline runner and agentic subsystem use async. Every call is recorded to the kernel activity log.

### Agents (`agents/`)

Agents are the units of work that run inside the scheduler's worker threads. All extend `AgentBase` and implement a single `run()` method that returns a string.

**AgentBase** (`agents/base.py`):
- Resolves the target model from the registry at construction time
- Enforces a `TOKEN_BUDGET_CEILING` hard cap (4096 tokens)
- Exposes `call_llm()` which delegates to the HTTP client
- Exposes `spawn_task()` for creating child tasks in the queue
- Estimates input token count (chars ÷ 4)

**EchoAgent** — sends the prompt directly to the model as a single user message and returns the response.

**PlannerAgent** — two-phase:
1. Calls the model with a system prompt instructing it to output a numbered list of 2–4 subtasks
2. Spawns each subtask as a child `echo` task in the queue

Child routing options:
- `same` — all subtasks go to the same model as the planner
- `split` — subtasks are round-robined across all registered models

If `aggregate=True`, the planner polls the queue waiting for all children to complete (timeout 180s), then makes a final call to synthesise all results into one answer.

### Agentic subsystem (`agentic/`)

Separate from the kernel task queue. The agentic tab calls `/agentic/run` directly — it does not go through the scheduler or task queue.

Uses **LangGraph** to implement a self-correcting code generation loop as a compiled state machine:

```
generate → extract → execute → (passed or retries remaining?)
                                    ├── retry → generate
                                    └── done  → END
```

**Nodes:**
- **generate** — calls the model with a strict system prompt requiring a Python code block. On retries, appends the previous error to the conversation so the model can self-correct.
- **extract** — pulls the Python code from the response using regex. Falls back gracefully if the model responds with a plain expression.
- **execute** — runs the extracted code in a `subprocess.run` call with a 10-second timeout. Passes if the process exits with code 0 and no stderr.
- **should_retry** (conditional edge) — returns `done` if passed or max attempts reached, `retry` otherwise.

Each attempt is saved to the `agentic_traces` table when the execute node fires. Results are streamed to the browser as Server-Sent Events so each stage appears as it happens.

### Ray subsystem (`ray/`)

Separate execution path, also bypassing the task queue. Ray runs in local mode within the server process — no external cluster required.

Exposes three SSE endpoints:
- **`/ray/run`** — single task dispatched to a Ray remote function
- **`/ray/batch`** — multiple tasks dispatched simultaneously; results arrive via `ray.wait()` as each finishes — fastest result appears first regardless of submission order
- **`/ray/pipeline`** — sequential chain where each step's output is substituted as `{input}` into the next step's prompt template

**`/analyse/run`** (analyse subsystem) uses the same `ray.wait()` approach — all prompts are dispatched to Ray in parallel and results stream back as they complete.

---

## JSON parser scheduler (`server/schedulers/jsonparser_scheduler/`)

Demonstrates the same scheduler pattern applied to a non-LLM workload. It reads from the same task queue as the LLM scheduler but processes tasks with a completely different handler.

**Task type:** `jsonparser_parse_json`

**Handler** (`handlers/json_handler.py`) — receives raw JSON text as the prompt and returns a structural report as a JSON string containing:

| Field | Description |
|---|---|
| `valid` | Whether the input parsed without error |
| `root_type` | Type of the top-level value (`object`, `array`, `string`, etc.) |
| `size_chars` | Character length of the input |
| `size_tokens_est` | Estimated token count (chars ÷ 4) |
| `max_depth` | Maximum nesting depth |
| `schema` | Recursive type map of every key at every level |
| `warnings` | List of notable issues (null values, empty containers, mixed-type arrays) |

Adding a new JSON operation means writing a handler class with a single `handle(input, options)` method and registering it in `HANDLER_REGISTRY` — the kernel, queue, and API are untouched.
