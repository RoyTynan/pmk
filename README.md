# Python-Micro-Kernel ( PMK )

---

## Introduction

I originated this project in 2020 as a C++ task execution pipeline to automate a GitHub repository to run tasks for Continuous Integration and Deployment.
The code was a controlled hack but worked quite well.
In 2022 I converted the code to Python as I was having various build issues with C++ on both Windows and Linux.<br>
January 2026 I revisited the project and completely refactored it. The GitHub stuff was removed and the kernel was made generic. 
I introduced the concept of schedulers to do the work; they are units of work and isolated from the kernel.<br>
I then wrote the llm_scheduler as a sort of AI test-bed.<br><br>
The original GitHub CI & CD I wrote was to control C++ code for the STM32 series of micro-contollers.<br>
Task 1: Compile the code<br>
Task 2: Run Unit Tests<br>
Task 3: Merge and push to the repo<br>
Task 4: Prepare binary image and flash the chip<br>
Tasks 1, 2 and 3 had feedback to flag errors and start the process again.


## Contact

You can contact me on roytynandev@gmail.com<br><br>
I try to reply to everyone but I can't guarantee a quick response.<br>
Any criticisms please keep constructive, otherwise I'll just crawl off to my local pub for a calming beer or ten.<br>
I live in West Yorkshire, England btw.

---

## What is it?

### The micro kernel

At the core of this project is a small operating system kernel. It manages a persistent task queue backed by SQLite, with a scheduler that polls for pending work and dispatches it to workers running in threads. Tasks move through a defined lifecycle — pending, running, done, failed — and that state survives process restarts. The kernel runs as its own process, separate from the API server, and communicates state changes back via a lightweight IPC channel. It handles crash recovery automatically: any task left in a running state from a previous session is re-queued on startup.

### A generic, plug-and-play dispatch engine

The kernel has no knowledge of what its workers do. It only manages lifecycle and routing. The actual work is done by schedulers — pluggable modules that each register for a set of task types, pull matching tasks from the shared queue, and dispatch them to their own handlers. The kernel loads whichever schedulers are configured at startup and runs each in its own thread. To add a new class of work to the system you write a scheduler and a handler; the kernel, the queue, and the API need no changes.

This project ships with two schedulers running side by side as a demonstration of that principle. The **LLM scheduler** handles tasks that need to be sent to an AI model — it reads the LLM registry, respects per-model concurrency limits, and routes each task to the right model. The **file scheduler** handles file processing tasks — it parses and validates JSON content, reports structure, types, and warnings. Both schedulers read from the same task queue simultaneously. A task submitted as `file_parse_json` is picked up by the file scheduler; a task submitted as `echo` or `planner` is picked up by the LLM scheduler. Neither scheduler is aware of the other.

The intent is that the same pattern extends to anything: an email handler, an HTTP request dispatcher, a database query runner, a machine learning pipeline. Each is a scheduler with its own handler registry, dropped into the system without touching the core.

### Built-in schedulers

The project ships with two schedulers as a demonstration of the pattern.

**LLM scheduler** — connects the kernel to AI models. A dynamic registry maps named LLM entries to their connection details — local models served by llama.cpp, or remote cloud providers like OpenAI, Anthropic, and Groq. The scheduler reads this registry on every poll, so new models are picked up without a restart. Each LLM has its own concurrency slot counter so multiple models can run tasks in parallel while each individual model stays within its own limit. Agents sit between the scheduler and the LLM: the echo agent sends a prompt straight through, the planner agent asks the LLM to decompose a goal into subtasks and spawns them as children in the kernel queue.

**JSON parser scheduler** — demonstrates the same kernel being used for a completely different class of work. Rather than sending tasks to an AI model, it routes them to file handlers — small modules that process content and return a result. The JSON handler receives raw JSON text, parses it, and returns a structural report: whether the input is valid, the root type, size in characters and estimated tokens, maximum nesting depth, a recursive schema showing the type of every key at every level, and any warnings such as null values, empty containers, or mixed-type arrays. Adding a new file operation means writing a handler class with a single `handle()` method and registering it in the scheduler — the kernel, queue, and API are untouched.

### Building your own scheduler

The web app includes a scheduler assistant that generates a fully wired scaffold for a new scheduler in one click — folder structure, handler base class, router, database, and registry entry all created automatically. It also provides ready-made Claude Code style prompts you can paste directly into your AI coding assistant to extend the scheduler with new handlers, routes, or database columns. The assistant enforces a strict boundary: all generated code lives inside your scheduler's own folder and the kernel is never touched.

### The web app

On top of all of this sits a browser-based interface. It gives you access to every part of the system without touching the command line: register and start local or cloud models, submit single tasks, chain models together in multi-step pipelines, run a self-correcting agentic code generation loop, dispatch parallel workloads through Ray, run bulk prompt analysis against datasets, and parse and validate JSON files through the file scheduler. Every feature in the UI is also available via the REST API, so the kernel can be driven entirely from scripts or external tools without the web app running at all.

### Headless operation

The web app is entirely optional. The kernel and its schedulers can be run without it using `start-server.sh`, and tasks submitted directly via the REST API from the command line or any script. This makes PMK straightforward to embed in automated pipelines, run on a headless server, or drive from your own tooling without a browser in sight.

### Installation

PMK can be installed and run in two ways. **Manual** — clone or download the repository, install the Python and Node dependencies, and run `start.sh`. This is the recommended approach for development or if you want to run local models with GPU support. **Docker** — run `docker compose up --build` and both the backend and frontend start automatically with no manual dependency installation. Docker is the quickest way to get running on any machine.

---

## Getting the code

Download as usual. But you do not need a GitHub account. Download the code as a zip file:

1. Go to the repository page in your browser
2. Click the green **Code** button
3. Click **Download ZIP**
4. Unzip the downloaded file somewhere on your computer — for example your Desktop or Documents folder
5. The unzipped folder is called `PMK` — this is your project folder

---

## Project layout

```
PMK/
  server/           Python backend — kernel, task queue, agent runtime, LLM registry
  frontend/         Next.js web UI
  llm_models/       Local GGUF model files (not included — see setting-up.md)
  db/               SQLite task database and LLM registry JSON
  logs/             Log files for each running LLM server
  docs/             Specification and documentation
  start.sh          Start everything (Linux / macOS)
  start-server.sh   Start backend only (Linux / macOS)
```

---

## Further reading

| | |
|---|---|
| [docs/setting-up.md](docs/setting-up.md) | Installing prerequisites, downloading the model, GPU setup, accessing from another machine |
| [docs/running-this-app.md](docs/running-this-app.md) | Starting and stopping the app, what each tab does |
| [docs/server-architecture.md](docs/server-architecture.md) | How the kernel, scheduler system, task queue, and WebSocket push work |
| [docs/built-in-schedulers.md](docs/built-in-schedulers.md) | Detail on the two built-in schedulers: LLM and JSON parser |
| [docs/building-a-scheduler.md](docs/building-a-scheduler.md) | How to build and install a new scheduler |
| [docs/design.md](docs/design.md) | System design specification |
