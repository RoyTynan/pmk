# Running PMK

> **Before reading this:** make sure you have completed the setup steps in [setting-up.md](setting-up.md) first.

---

## Starting the app

The app has two parts that run at the same time:

- **Backend** — the Python server that manages models, tasks, and agents (port 8000)
- **Frontend** — the web interface you use in your browser (port 3000)

### Manual — Linux and macOS

Open a terminal in the project folder and run:

```bash
source .venv/bin/activate
./start.sh
```

If you get a "permission denied" error on `start.sh`, run this once first:
```bash
chmod +x start.sh
```

### Manual — Windows

Windows does not run `.sh` files directly. Open two separate Command Prompt windows.

**Window 1 — backend:**
```cmd
cd PMK
.venv\Scripts\activate
set PYTHONPATH=server
.venv\Scripts\uvicorn kernelroot.main:app --host 0.0.0.0 --port 8000
```

**Window 2 — frontend:**
```cmd
cd PMK\frontend
npm run dev
```

### Docker

```bash
docker compose up --build
```

On the first run this builds the images, which takes a few minutes. Subsequent starts are fast. The frontend is on `http://localhost:3000` and the backend API is on `http://localhost:8000`.

---

## Opening the app

Once both processes are running, open your browser and go to:

```
http://localhost:3000
```

You should see the PMK interface with three top-level tabs: **kernel**, **schedulers**, and **assistant**. Clicking **schedulers** shows a second row of scheduler tabs — **llm** and **jsonparser** by default, plus any you have created. Selecting **llm** shows a third row of feature tabs: **llms**, **single**, **multi**, **agentic**, **ray**, **analyse**, **logs**, and **api**.

A small green dot in the top bar means the browser is connected to the backend in real time. If it is red, the backend is not running.

---

## The tabs

### kernel

The kernel tab gives you a live view of the task execution engine — the part of the system that manages the queue and dispatches work to schedulers.

#### Stats bar

At the top of the tab, four counters update in real time:

| Counter | What it shows |
|---|---|
| Pending | Tasks waiting to be picked up |
| Running | Tasks currently being processed |
| Done | Tasks that completed successfully |
| Failed | Tasks that encountered an error |

#### Task panels

Below the stats bar are collapsible panels for each task state. Click any panel header to expand or collapse it.

Each panel shows a table of tasks, 10 per page, with pagination controls at the bottom. Every row shows the task ID, time, status, agent type, prompt, and result. For LLM tasks, the LLM column shows which model handled the task.

Each row has two icon buttons on the right:
- **↺** — requeue the task (reset it to pending so it will run again)
- **✕** — delete the task permanently

#### Kernel activity log

A separate card shows a log of activity across all schedulers and sources — the model used, the time, the source (queue, pipeline, agentic, ray), and whether the call succeeded or failed.

Use the **clear** button (with a two-click confirmation) to wipe the log.

#### Loaded schedulers

A small card lists the schedulers currently loaded and running inside the kernel. Each entry shows the scheduler name. This is useful for confirming that a newly installed scheduler has been picked up without restarting.

---

### schedulers

The schedulers tab is where all the work happens. A second row of tabs selects which scheduler you are working with — **llm** and **jsonparser** are built in, and any custom schedulers you create appear here too.

Selecting the **llm** scheduler shows a third row of feature tabs: **llms**, **single**, **multi**, **agentic**, **ray**, **analyse**, **logs**, and **api**. These are all documented below.

Selecting the **jsonparser** scheduler opens the JSON parser tab directly — paste or load a JSON file and it returns a structural report: root type, size, nesting depth, a full schema, and any warnings.

---

### llms

The llms tab is where you register, start, stop, and remove AI models. Everything in the app — the single tab, multi tab, agentic tab, ray tab, and analyse tab — uses the models registered here. Nothing runs until you have at least one model registered and available.

#### The model table

At the top of the tab is a table listing every model currently registered. Each row shows:

| Column | What it shows |
|---|---|
| Status dot | Green ● = running and ready · Grey ○ = stopped |
| Name | The label you gave the model when registering it |
| Model | The model file name (local) or model identifier (cloud) |
| URL | The address the app uses to send requests to this model |
| Type | `local`, `remote`, or the cloud provider name |
| Actions | **start** / **stop** for local models · **remove** to delete the registration |

If the table is empty, no models are registered yet — use one of the three panels below to add one.

---

#### Add local model

Use this panel to run an AI model on your own machine using a `.gguf` model file.

**Model file** — a dropdown listing all `.gguf` files found in the `llm_models/` folder. The included model (`qwen2.5-0.5b-instruct-q4_k_m.gguf`) appears here automatically. If you download additional `.gguf` files and place them in that folder, restart the app and they will appear here too.

You can also tick **use custom path** and navigate the filesystem to select a model file stored anywhere on your machine.

**Name** — a short label you choose, for example `local-gpu` or `qwen-cpu`. This name appears in every LLM dropdown across the app, so pick something that makes it easy to identify.

**Port** — the network port this model server will listen on. The default is `8082`. If you want to run two instances at the same time (for example one on GPU and one on CPU), give them different ports — `8082` and `8083` for example.

**CPU or GPU** — the most important choice:

> **Use graphics card (GPU) — faster**
> The model runs on your graphics card. Responses come back in seconds for small models. Requires a compatible Nvidia GPU with enough VRAM. The included 0.5B model fits comfortably in even modest GPUs.

> **Use processor only (CPU) — slower, works on any machine**
> The model runs on your computer's main processor. Works on any machine including those with no graphics card, but is noticeably slower — expect 5–30 seconds per response depending on hardware.

Once you have filled in all fields, click **register & start**. The model row appears in the table immediately. The green dot lights up once the server has fully loaded the model — this usually takes 10–30 seconds. Do not submit tasks until the dot is green.

**Running multiple local instances** — you can register the same model file more than once with a different name and port, or register multiple different model files at the same time. Each is a fully independent server process. This lets you compare GPU vs CPU speed, run different steps of a pipeline on different hardware, or keep a fallback running while testing another.

---

#### Add remote (LAN) server

Use this panel to connect to an AI server running on another machine on your local network — for example a more powerful desktop machine, a home server, or another PC running llama.cpp.

**Name** — a label for this connection, e.g. `home-server`.

**URL** — the full address of the remote server including port, e.g. `http://192.168.1.50:8082`. The machine must be reachable from your computer on the same network.

**Model** — the model identifier the remote server is running, e.g. `qwen2.5-0.5b-instruct`. This must match what the remote server expects.

Click **register**. Remote models are always shown as available once registered — there is no start/stop, because you are not controlling the remote process from here. If the remote machine goes offline the requests will simply fail.

---

#### Add cloud / provider

Use this panel to connect to a commercial cloud AI service. No local hardware is required — requests go over the internet to the provider's servers. You will need an account and an API key from the provider.

**Provider** — select from the dropdown:
- **OpenAI (ChatGPT)** — GPT-4o and other OpenAI models
- **Anthropic (Claude)** — Claude 3.5 Sonnet and other Anthropic models
- **Groq** — very fast inference for open-source models (Llama, Mixtral, etc.)
- **Together AI** — a wide range of open-source models via cloud API

When you select a provider, the URL and a default model name are filled in automatically.

**Name** — a label for this connection, e.g. `claude` or `chatgpt`.

**Model** — the model identifier. The default is a sensible choice for each provider. You can change it to any model your account has access to.

**API key** — the secret key from the provider's website. Where to find it:
- OpenAI: [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
- Anthropic: [console.anthropic.com](https://console.anthropic.com) → API Keys
- Groq: [console.groq.com](https://console.groq.com) → API Keys
- Together AI: [api.together.xyz](https://api.together.xyz) → Settings → API Keys

The API key field shows the text as you type — it is not hidden.

Click **register**. The app tests the connection first by making a real (minimal) request to the provider. If the key is wrong, there is no credit on the account, or the model name is invalid, it will show an error and will not save. Only a successful test results in registration.

Cloud models are always shown as available once registered. There is no start/stop — they are always reachable as long as your internet connection is working and your account has credit.

> **Cost:** cloud providers charge per token (roughly per word). The included small local model is completely free to run. Cloud models are only needed if you want higher quality responses than the local model can provide.

---

### single

The single tab is the control centre for submitting tasks to the kernel. It has two sections: a task submission panel at the top, and a live task table below.

#### Submitting a task

Type your prompt in the text area. You can press **Ctrl+Enter** as a shortcut instead of clicking the submit button.

Before submitting, choose two things from the dropdowns:

**LLM** — which AI model to send the task to. This lists every model currently registered (local or cloud). The model must be running (green dot) for tasks to be processed. If you select a model that is stopped, the task will wait in the queue until the model is started.

**Agent** — the type of agent that will handle the task. Different agents have different behaviours:

- **echo** — the simplest agent; repeats back what you sent. Useful for testing that the system is connected and working without using any AI credits.
- **simple** — sends your prompt directly to the LLM and returns the response. The standard agent for most tasks.
- **planner** — breaks your prompt into subtasks, sends each subtask to the LLM separately, and optionally collects all the results into a final synthesised answer. This is more powerful but uses more credits.

#### Planner options

When the **planner** agent is selected, two extra controls appear:

**Routing** — controls where the planner sends its subtasks:
- *same model* — all subtasks go to the same LLM you selected
- *split across models* — subtasks are distributed across all available registered models

**Aggregate results** — if ticked, the planner waits for all subtasks to finish and then makes one final LLM call to combine all the answers into a single coherent response. If unticked, each subtask result is shown individually.

#### The task table

Every task that has ever been submitted appears here, most recent first, 10 per page. The columns are:

| Column | What it shows |
|---|---|
| ID | A short identifier for the task (first 8 characters) |
| STATUS | `pending` — waiting to run · `running` — currently being processed · `done` — completed · `failed` — encountered an error |
| AGENT | Which agent type handled the task |
| LLM | Which model actually ran the task |
| STARTED | Time the task began running |
| FINISHED | Time the task completed |
| IN ~TKN | Estimated number of tokens in the input (the prompt) |
| OUT TKN | Token budget available for the response |
| PRI | Task priority (lower number = higher priority) |
| PROMPT | The first 60 characters of the prompt |
| RESULT | The response from the LLM — click to expand the full text |

**Parent and child tasks** — when the planner agent creates subtasks, they appear indented below the parent task with a `└` symbol, showing the hierarchy clearly.

**Colours** — task statuses are colour coded: grey for pending, amber for running, green for done, red for failed.

**Pagination** — use the **← prev** and **next →** buttons at the bottom to move through pages. The total task count is shown alongside.

---

### multi

The multi tab is a pipeline builder. It lets you chain multiple AI models together in a sequence, where the output of each step feeds into the next. This is useful for testing how different models handle the same conversation, comparing local and cloud models side by side, or building multi-step workflows.

#### Building a pipeline

The pipeline starts with two blank steps. Each step has three parts:

**Step number** — shown on the left (1, 2, 3…). Steps run in this order, top to bottom.

**Prompt** — a text area where you write what you want to ask at this step. This can be anything — a question, an instruction, a continuation of the previous step. You can press **Ctrl+Enter** to run the pipeline from any prompt box.

**Model selector** — a dropdown listing every registered model, both local and cloud, labelled with their type. Select which model should handle this step. You can assign the same model to multiple steps or use a different model for each step.

To add more steps click **+ add step**. To remove a step click the red **✕** button on the right of that step. You must have at least one step — the last step cannot be removed.

#### How the conversation history works

This is the key feature of the pipeline. When you run it, the steps do not run in isolation — they share a conversation history:

1. Step 1's prompt is sent to its model as the first user message. The response comes back.
2. Step 2's prompt is added to the conversation as a new user message — but the full history so far (step 1 prompt + step 1 response) is included. The model at step 2 can see everything that was said before.
3. Step 3 sees the history from steps 1 and 2, and so on.

This means you can write natural follow-up prompts. For example:
- Step 1: *"List three capitals of European countries"* → model answers
- Step 2: *"Now tell me the population of each one"* → model knows which capitals from step 1

The models do not need to be the same. Step 1 might use a fast local model and step 2 might use Claude — the history passes between them seamlessly.

#### Running the pipeline

Click **▶ run** to start. Each step runs one at a time in order. As each step runs you will see a spinner next to it, then the result appears inline beneath that step once it completes. Results appear live as they stream in — you do not wait for the whole pipeline to finish.

To stop a running pipeline click **■ stop** (the run button changes while the pipeline is running).

Steps with an empty prompt or no model selected are skipped automatically.

#### Conversation history panel

After the pipeline finishes, a **conversation sent** panel appears below the steps. This shows the complete conversation that was sent — every user message and every assistant response in order, formatted clearly by role. This is exactly what the final model in the pipeline received as context. It is useful for understanding what information each model had access to and debugging unexpected responses.

---

### agentic

The agentic tab implements a self-correcting code generation loop. Unlike the multi tab where you chain prompts manually, this tab puts the AI in a loop where it writes code, the system tests whether the code actually works, and if it fails the AI is shown the error and asked to fix it — automatically, without you doing anything.

> **Python only** — the agentic tab generates and runs Python code. The code is executed on your machine inside the app's Python environment. Do not enter prompts asking for code that deletes files or modifies your system.

#### The three controls

**LLM** — select which registered model to use. The dropdown shows all running local models and all registered cloud models. A local model must be started (green dot in the LLMs tab) before it appears as a usable option here. Cloud models (ChatGPT, Claude, Groq) are always available once registered.

Larger, more capable models (Claude, GPT-4o) will succeed on the first attempt for most tasks. The small included local model (qwen 0.5B) can handle simple tasks but may struggle with anything complex and will use more retries.

**Max retries** — how many attempts the system will make before giving up. The default is 3. Each retry costs one LLM call, so if you are using a cloud model with a paid API key, higher retry counts use more credits. For simple tasks 3 is plenty. For more complex code you may want to increase this to 5.

**Prompt** — describe in plain English the Python code you want written. Be specific about what it should do and what it should print. For example:
- *"Write a function that takes a list of numbers and returns the average. Print the result for [10, 20, 30, 40]."*
- *"Calculate the first 10 Fibonacci numbers and print them as a list."*
- *"Write a function that counts how many vowels are in a string. Test it with the word 'hello world'."*

#### What happens when you click run

The system runs through a loop managed by LangGraph, a state machine framework. Here is exactly what happens at each stage:

**1. Generating** — the model is sent your prompt with a strict instruction to respond with only a Python code block. A spinner and "generating" badge appear on the attempt card while the LLM is thinking.

**2. Executing** — once the model responds, the system extracts the Python code from the response and runs it in a separate process with a 10-second timeout. The "executing" badge appears and the code block is shown so you can see exactly what was run.

**3. Passed or Failed** — the result of running the code determines what happens next:
- If the code ran without errors, the attempt card turns green and shows "passed" with the output from the code. The loop ends.
- If the code produced an error (syntax error, runtime exception, timeout), the attempt card turns red and shows "failed" with the error message.

**4. Retry** — if the attempt failed and there are retries remaining, the system automatically starts the next attempt. This time, the full error message is added to the conversation before asking the model to fix the code. The model sees both its previous attempt and exactly what went wrong. This is the self-correcting part — each retry is smarter than the last because the model has more information.

**5. Gave up** — if all attempts fail, a red summary line appears: *"✗ gave up after N attempts"*. You can read through the attempt cards to understand what the model tried and why it kept failing. This usually means the task is too complex for the selected model, or the prompt needs to be more specific.

#### Reading the attempt cards

Each attempt has its own card showing:
- **Attempt number** and **status badge** — the colour tells you at a glance what happened (blue = generating, amber = executing, green = passed, red = failed)
- **Code block** — the exact Python code that was extracted from the model's response and run
- **Output** (green text) — what the code printed to the screen when it ran successfully
- **Error** (red text) — the Python error message if the code failed

If there are multiple attempts you can scroll through the cards to see how the model's approach changed between retries.

#### The summary line

At the bottom, after the run completes, a single line summarises the outcome:
- *"✓ passed on attempt 1"* — success first time
- *"✓ passed on attempt 3"* — succeeded after two failures
- *"✗ gave up after 3 attempts"* — all attempts failed

#### Tips for good results

- **Be specific about output** — the judge is the code's exit code; if the code runs without crashing it passes. Always ask for a `print()` statement so you can see the result in the output panel.
- **Use a capable model for complex tasks** — the small local qwen model works well for simple arithmetic and string operations but will struggle with anything requiring libraries, file I/O, or complex algorithms. Use Claude or GPT-4o for harder tasks.
- **Increase retries for complex tasks** — set max retries to 5 or more if you are asking for something non-trivial. The model often gets close on attempt 1 and fixes it on attempt 2.
- **Click clear between runs** — the clear button resets the attempt cards so the next run starts fresh.

#### Run history

Below the run controls, the agentic tab has a persistent history of every attempt across all past runs. Each attempt is a separate row — if a run used three retries, it creates three rows.

The toolbar above the history list lets you filter by **all**, **passed**, or **failed**, and shows how many attempts have been recorded in total. Click **refresh** to reload. Click **clear all** to delete all history permanently (a confirmation dialog appears before anything is deleted).

Click any row to expand it and see the generated code, output or error, and timing breakdown (how long generation, extraction, and execution each took).

The history updates automatically after each run.

---

### ray

The ray tab gives you direct access to Ray, a distributed execution framework. It runs tasks through Ray worker processes rather than the kernel and scheduler used by the single tab — the two paths are completely separate. Ray is better suited to parallel and experimental workloads where you want direct control over how tasks are dispatched.

All tasks in the batch panel are dispatched to Ray simultaneously and results stream back as each one finishes — the fastest task appears first regardless of submission order. The pipeline panel runs steps sequentially, passing the output of each step to the next as `{input}`.

> **Note:** Ray does not require a separate cluster. It runs in local mode within the server process — no additional setup is needed beyond having Ray installed in the Python environment.
>
> For best performance with parallel batch tasks, llama.cpp supports concurrent inference via the `--parallel` flag. Alternatively, vllm can replace llama.cpp as the inference backend for higher throughput.

The tab is split into two panels side by side.

#### Left panel — parallel tasks

**Single task** — send one prompt to one LLM and see the result streamed back in real time. Select an LLM from the dropdown and click **▶ run**.

**Parallel batch** — send multiple prompts to multiple LLMs simultaneously. All tasks are dispatched to Ray at the same moment and run in parallel. Results appear as each one completes — you do not wait for all to finish before seeing the first result.

- Click **+ add task** to add more rows. Each row has its own prompt and LLM selector.
- Click the red **✕** on a row to remove it.
- Click **▶ run all** to dispatch everything at once.

The key difference from the single tab: tasks run in parallel with no queue — Ray decides how to schedule them across available CPU cores.

#### Right panel — chained pipeline

The pipeline runs tasks sequentially where the output of each step becomes the input to the next. This is how you make AI models communicate — the result from one LLM is passed forward as `{input}` to the next step's prompt.

**Initial input** — the starting data or question. This is the raw value that `{input}` refers to in step 1's template.

**Steps** — each step has a prompt template and an LLM selector. Write your instruction and include `{input}` anywhere you want the previous step's output to appear. You can use a different LLM for each step.

**Example — math chain:**

| | |
|---|---|
| Initial input | `2 + 2` |
| Step 1 template | `Calculate {input}. Reply with only the number.` |
| Step 2 template | `Take the number {input} and add 3. Reply with only the number.` |
| Step 3 template | `Write one sentence explaining that the final answer is {input}.` |

**Important:** the initial input should be raw data, not a question. The prompt templates are where you put the instructions. Each step must fully resolve `{input}` to a simple value before the next step acts on it.

If any step fails, the pipeline stops at that point and shows the error. Subsequent steps do not run.

**Load example** buttons at the top of the pipeline panel pre-fill the initial input and all step templates with working examples so you can see the pattern immediately. Your LLM selections are preserved when loading an example.

**Example load options:**
- *math chain* — three-step arithmetic demonstrating number passing
- *summarise → translate* — summarise a paragraph then translate the summary to French
- *question → facts → explain* — extract a key fact then put it in everyday context

The output panel for each step shows the actual prompt that was sent (with `{input}` substituted) and the result, so you can see exactly what each LLM received.

---

### analyse

The analyse tab is for running a set of questions or rules against a dataset — typically a JSON file — using Ray to process all the prompts in parallel. It does not use the kernel or scheduler.

All prompts are dispatched to Ray at the same time and results stream back as each one finishes, so you see answers arriving as they complete rather than waiting for the whole batch. This makes it well suited to bulk analysis tasks where you have many questions and want answers as fast as possible.

> For higher throughput with large prompt sets, llama.cpp supports concurrent inference via the `--parallel` flag. vllm can also replace llama.cpp as the inference backend if you need to handle more concurrent requests.

The tab has three panels.

#### Data panel (left)

Paste your JSON directly into the text area, or click **load file** to open a `.json` file from your computer. The app validates the JSON as you type and shows either a green ✓ or an error message describing the problem.

A token estimate is shown below the text area (characters ÷ 4 as a rough guide). If the estimate exceeds 3,000 tokens a warning appears — local models typically have a context window of 2,048–4,096 tokens, so very large datasets may be truncated or cause errors. Cloud models (Claude, GPT-4) handle much larger inputs.

Click **load example** to load a small built-in weather dataset so you can try the tab without having real data to hand.

#### Prompts panel (middle)

Type one prompt per line. Each line becomes a separate question that will be run against your data. Blank lines are ignored.

Click **load .md file** to load prompts from a Markdown file. The app automatically strips heading markers (`#`) and bullet points (`-`, `*`, `+`) so you can write your prompts in a readable format:

```markdown
# Weather Analysis Rules

- What is the highest temperature recorded?
- What day had the most rainfall?
- Are there any anomalies in this data?
- Summarise the overall trend in 2-3 sentences.
```

Each bullet becomes one prompt. You can maintain this file separately and load it each time — useful for reusing the same set of analysis rules across different datasets.

Click **load examples** to load a set of five built-in weather prompts to go with the example data.

The prompt count updates as you type so you know how many tasks will be dispatched.

**LLM selector** — choose which model to use for all prompts. All prompts use the same LLM. The **▶ run analysis** button stays disabled until you have valid JSON, at least one prompt, and a selected LLM.

#### Output panel (right)

Results appear here as they stream back from Ray. Because all prompts are dispatched in parallel, results may arrive in any order — they are matched to their prompt by task ID.

Each result card shows:
- The prompt that was asked (in italics)
- A status badge — blue for running, green for done, red for failed
- The LLM's answer once complete

A counter in the panel header (e.g. `3/5 done`) tracks overall progress.

#### How it works under the hood

Each prompt is sent to Ray as an independent task. Before being sent, the full JSON data is appended to the prompt automatically:

```
What is the highest temperature recorded?

Use the following data to answer:
{ ...your JSON... }
```

The LLM sees both the question and the data together. All prompts are dispatched to Ray simultaneously — Ray schedules them across available CPU cores, and results come back as each one finishes.

---

### assistant

The assistant tab helps you build new schedulers for the kernel. It generates a complete scaffold — folder structure, handler base class, router, database, and registry entry — in one click, wired up and ready to extend.

At the top of the tab, enter a name for your new scheduler and click **generate**. The scaffold is written to disk immediately inside its own folder under `server/schedulers/`. The kernel does not need to be modified.

Below the generator, a set of ready-made prompts is shown in a grid. Each card is a Claude Code style prompt you can copy and paste directly into your AI coding assistant to extend the scaffold — adding new handlers, new API routes, new database columns, or new agent types. The prompts are scoped to your scheduler's own folder and will not touch the kernel.

---

### logs

View the output log for each running local model server. Useful for diagnosing problems with a local model that is not responding.

---

## Removing a built-in scheduler

The two built-in schedulers — **llm** and **jsonparser** — can be removed if you do not need them. Each requires changes in two places: the backend registry and the frontend.

### Removing the jsonparser scheduler

**Backend** — open `server/kernelroot/scheduler_registry.py` and delete the `jsonparser` line:

```python
"jsonparser": "schedulers.jsonparser_scheduler.scheduler.JsonParserScheduler",
```

**Frontend** — open `frontend/src/app/page.tsx` and remove `'jsonparser'` from the `BUILTIN_L2` array:

```typescript
const BUILTIN_L2 = ['llm']   // was: ['llm', 'jsonparser']
```

Also remove the jsonparser render block a few lines below:

```tsx
{/* ── JSON Parser scheduler ───────────────────────── */}
<div style={{ display: l2 === 'jsonparser' ? undefined : 'none' }}>
  ...
</div>
```

And remove the `JsonParserTab` import at the top of the file.

---

### Removing the llm scheduler

This is a larger change — the llm scheduler drives everything in the **llms**, **single**, **multi**, **agentic**, **ray**, **analyse**, **logs**, and **api** tabs.

**Backend** — open `server/kernelroot/scheduler_registry.py` and delete the `llm` line:

```python
"llm": "schedulers.llm_scheduler.scheduler.LLMScheduler",
```

Then open `server/kernelroot/main.py` and remove:

- All imports from `schedulers.llm_scheduler.*` (registry, client, agentic router, ray router, analyse router, traces router, paths)
- The four `app.include_router(...)` calls for `/agentic`, `/ray`, `/analyse`, and `/traces`
- The `init_traces_db()` call

**Frontend** — open `frontend/src/app/page.tsx` and remove `'llm'` from `BUILTIN_L2`:

```typescript
const BUILTIN_L2 = []   // or remove the constant entirely if no other schedulers remain
```

Remove the `L1Tab`, `L3Tab`, `L3_TABS` declarations and the entire llm scheduler render block (the `display: l2 === 'llm'` div and everything inside it). Remove the imports for `LLMsTab`, `MonitorTab`, `MultiTab`, `AgenticTab`, `RayTab`, `AnalyseTab`, `LogsTab`, and `SchedulerApi`.

---

### What to rebuild after removing a scheduler

**Manual setup** — restart the backend. The frontend dev server picks up the `page.tsx` change automatically — no rebuild needed.

**Docker** — rebuild the images:

```bash
docker compose up --build
```

---

## Stopping the app

### Manual — Linux and macOS
Press **Ctrl+C** in the terminal where `start.sh` is running. Both the backend and frontend will stop.

### Manual — Windows
Press **Ctrl+C** in each Command Prompt window — one for the backend, one for the frontend.

### Docker
```bash
docker compose down
```

---

## Troubleshooting

**The page loads but is not interactive (buttons do nothing)**
The browser cannot reach the backend. Check that the backend is running and that port 8000 is not blocked by a firewall. On Linux/macOS, check the terminal for errors.

**The green dot is red**
The WebSocket connection dropped. Try refreshing the page. If it stays red, the backend has crashed — check the terminal for error output.

**Local model starts but never shows a green dot**
The model server is taking a long time to load. Wait up to a minute. If it still does not connect, check the **logs** tab for that model — it will show what went wrong.

**"Port already in use" error on startup**
A previous run did not shut down cleanly. Find and stop the processes:
```bash
# Linux / macOS
lsof -ti:8000 | xargs kill -9
lsof -ti:3000 | xargs kill -9
```
On Windows, open Task Manager, find `python` and `node` processes, and end them.

**pip install fails**
Make sure your virtual environment is activated (you should see `(.venv)` at the start of your terminal prompt) before running `pip install`.

**npm install fails**
Make sure you are inside the `frontend/` folder when you run `npm install`.
