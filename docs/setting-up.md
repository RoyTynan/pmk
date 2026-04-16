w# Setting Up PMK

> Download the code first — see the [Getting the code](../README.md#getting-the-code) section in the README.

PMK can be set up in two ways — **manually** or via **Docker**. Choose whichever suits you.

---

## Manual Setup

Manual setup is recommended if you want to run local AI models, use GPU acceleration, or do development work on the project.

### Prerequisites

You need two things installed: **Python 3.10 or later** and **Node.js 20 LTS**.

#### Windows

**Python**
1. Go to [python.org/downloads](https://www.python.org/downloads/) and download Python 3.12
2. Run the installer — **tick "Add Python to PATH"** before clicking Install
3. Verify in Command Prompt: `python --version`

**Node.js**
1. Go to [nodejs.org](https://nodejs.org) and download the **LTS** installer
2. Run it and accept the defaults
3. Verify: `node --version` and `npm --version`

#### Linux

```bash
# Python (Ubuntu / Debian)
sudo apt update && sudo apt install python3 python3-pip python3-venv

# Node.js 20 (Ubuntu / Debian)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

Verify: `python3 --version` and `node --version`

#### macOS

1. Download and install Python 3.12 from [python.org/downloads](https://www.python.org/downloads/)
2. Download and install Node.js LTS from [nodejs.org](https://nodejs.org)
3. Verify in Terminal: `python3 --version` and `node --version`

---

### Install the project

#### Linux / macOS

```bash
cd PMK
python3 -m venv .venv
source .venv/bin/activate
pip install -r server/requirements.txt
cd frontend && npm install && cd ..
```

#### Windows

```
cd PMK
python -m venv .venv
.venv\Scripts\activate
pip install -r server/requirements.txt
cd frontend
npm install
cd ..
```

---

### Python packages installed

| Package | What it does |
|---|---|
| `fastapi` | Web framework for the backend API |
| `uvicorn[standard]` | Runs the FastAPI server with WebSocket support |
| `httpx` | Makes HTTP requests to local and cloud LLMs |
| `pydantic` | Data validation for API request bodies |
| `ray` | Distributed task execution for the Ray and Analyse tabs |
| `langgraph` | State machine framework for the Agentic tab |
| `chromadb` | Vector database for future RAG features |

---

### Installing llama.cpp

PMK uses **llama.cpp** to run local AI models. All you need is the `llama-server` binary — install it with your OS package manager or grab a pre-built binary. You do not need to build from source unless you want GPU support on NVIDIA.

#### macOS — Homebrew (recommended)

```bash
brew install llama.cpp
```

That is all. Homebrew installs `llama-server` to:
- `/opt/homebrew/bin/llama-server` on Apple Silicon (M1, M2, M3, M4)
- `/usr/local/bin/llama-server` on Intel Mac

Apple Silicon gets Metal GPU acceleration automatically — no extra steps needed. You will see `ggml_metal: GPU name: Apple M…` in the output when it is active.

#### Linux — apt (Ubuntu 24.04 and later)

```bash
sudo apt install llama-cpp
```

The binary lands at `/usr/bin/llama-server`. On other distributions, download a pre-built binary from the [llama.cpp releases page](https://github.com/ggerganov/llama.cpp/releases) — look for a file with `ubuntu` or `linux` in the name, unzip it, and note the path.

#### Windows — pre-built binary

1. Go to the [llama.cpp releases page](https://github.com/ggerganov/llama.cpp/releases)
2. Download the latest zip with `win-avx2-x64` in the name (works on most modern CPUs)
3. Unzip it and place `llama-server.exe` somewhere convenient, e.g. `C:\llama\llama-server.exe`

#### NVIDIA GPU — Linux and Windows (optional)

For faster inference with an NVIDIA card, install the CUDA toolkit and build from source with CUDA enabled:

**Linux:**
```bash
sudo apt install nvidia-cuda-toolkit
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp
cmake -B build -DGGML_CUDA=ON
cmake --build build --config Release --target llama-server
```

**Windows:** Install the CUDA Toolkit from [developer.nvidia.com/cuda-downloads](https://developer.nvidia.com/cuda-downloads) and Build Tools for Visual Studio from [visualstudio.microsoft.com/downloads](https://visualstudio.microsoft.com/downloads/), then run the same cmake commands in a **Developer Command Prompt for VS**.

#### Intel Mac

CPU only. No CUDA or Metal support. Smaller models (1B–3B parameters) are recommended.

---

### Telling PMK where llama-server is

Add the binary path to your `.env` file:

```
# macOS Homebrew — Apple Silicon
LLAMA_SERVER_PATH=/opt/homebrew/bin/llama-server

# macOS Homebrew — Intel
LLAMA_SERVER_PATH=/usr/local/bin/llama-server

# Linux apt
LLAMA_SERVER_PATH=/usr/bin/llama-server

# Windows
LLAMA_SERVER_PATH=C:\llama\llama-server.exe
```

Not sure of the path? Run `which llama-server` (macOS / Linux) or `where llama-server` (Windows).

---

### Running llama-server with a model

You can start `llama-server` directly from the terminal to verify it works before using PMK:

```bash
llama-server -m llm_models/qwen2.5-0.5b-instruct-q4_k_m.gguf --port 8081
```

Replace the path with your `.gguf` file location. Common flags:

| Flag | What it does |
|---|---|
| `-m <path>` | Path to the `.gguf` model file — required |
| `--port <n>` | Port to listen on, e.g. `8081` |
| `--ctx-size <n>` | Context window size — default 2048 |
| `--n-gpu-layers <n>` | Layers to offload to GPU — omit for CPU-only |

When the model has loaded you will see:

```
llama server listening at http://127.0.0.1:8081
```

Press `Ctrl+C` to stop it. PMK starts and stops `llama-server` for you when you use the app — running it manually is just a quick way to confirm the binary and model are working.

---

### Getting a model

The app works out of the box with this small free model:

**`qwen2.5-0.5b-instruct-q4_k_m.gguf`**

- **0.5B parameters** — runs on ordinary hardware without a GPU
- **Q4_K_M** — 4-bit compressed; small and fast while retaining most quality
- **GGUF** — the file format used by llama.cpp

Download it from Hugging Face (no account required):
[bartowski/Qwen2.5-0.5B-Instruct-GGUF](https://huggingface.co/bartowski/Qwen2.5-0.5B-Instruct-GGUF) → Files and versions → `Qwen2.5-0.5B-Instruct-Q4_K_M.gguf`

Place it in:
```
PMK/
  llm_models/
    qwen2.5-0.5b-instruct-q4_k_m.gguf
```

Any `.gguf` file placed in `llm_models/` will appear automatically in the LLMs tab.

---

### Environment variables

A `.env.example` file is included in the repo root. Copy it to `.env` before starting:

```bash
cp .env.example .env
```

The defaults work out of the box. Edit `.env` if you need to change ports or point the frontend at a backend running on a different machine. The `.env` file is gitignored — never commit it.

### Starting the app

```bash
./start.sh          # starts backend + frontend
./start-server.sh   # backend only (headless)
```

On Windows, use the **start.sh** script inside WSL, or run the uvicorn and npm commands manually as shown in `start.sh`.

---

### Accessing from another machine

The backend binds to `0.0.0.0:8000` so it is reachable from any device on the same network.

1. Find the server machine's IP address:
   - **Linux / macOS:** `ip a` or `ifconfig`
   - **Windows:** `ipconfig`
2. On another device open: `http://<server-ip>:3000`

> **Firewall note:** if you cannot connect, allow ports 3000 and 8000 through the firewall. On Linux with ufw: `sudo ufw allow 3000 && sudo ufw allow 8000`

---

---

## Docker Setup

Docker is the quickest way to get running. It installs all dependencies automatically and works on Linux, macOS, and Windows with no manual Python or Node.js setup.

### Prerequisites

Install **Docker Desktop** (Mac and Windows) or **Docker Engine + Compose plugin** (Linux):

- **Mac / Windows:** [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/)
- **Linux (Ubuntu):**
  ```bash
  sudo apt install docker.io docker-compose-plugin
  sudo usermod -aG docker $USER   # allow running without sudo (re-login after)
  ```

---

### CPU or GPU — llama.cpp

The Docker image does not include llama.cpp. You provide the `llama-server` binary from your host machine, and Docker mounts it into the container. This means the CPU/GPU choice is entirely determined by which binary you have — Docker itself does not change.

#### CPU

Build or download a CPU `llama-server` binary as described in the manual setup section above. Place it at `~/llama.cpp/build/bin/llama-server` or set the path in `.env`:

```
LLAMA_SERVER_PATH=/your/path/to/llama-server
```

#### GPU — NVIDIA (Linux and Windows)

1. Build a CUDA-enabled `llama-server` binary (see manual setup above)
2. Install the **NVIDIA Container Toolkit** so Docker can see your GPU:

   **Linux:**
   ```bash
   sudo apt install nvidia-container-toolkit
   sudo nvidia-ctk runtime configure --runtime=docker
   sudo systemctl restart docker
   ```

   **Windows:** Install NVIDIA drivers (WDDM 470+) on Windows. Docker Desktop with the WSL2 backend picks up the GPU automatically — no extra steps inside WSL2.

3. Add this to your `docker-compose.override.yml` (create it in the repo root):
   ```yaml
   services:
     pmk-backend:
       deploy:
         resources:
           reservations:
             devices:
               - driver: nvidia
                 count: all
                 capabilities: [gpu]
   ```

   Then start with:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.override.yml up --build
   ```

#### macOS

GPU is not available inside Docker on macOS (the container runs in a Linux VM with no Metal access). CPU inference only — no extra steps needed.

---

### Getting a model

Same as manual setup — download your `.gguf` file and place it in `llm_models/`. The Docker compose file mounts this folder into the container automatically.

---

### Starting with Docker

```bash
docker compose up --build
```

Frontend on `http://localhost:3000`, backend API on `http://localhost:8000`.

On first run this will take a few minutes to build the images. Subsequent starts are fast.

To stop:
```bash
docker compose down
```

---

### Environment variables

A `.env.example` file is included in the repo root. Copy it to `.env` before starting:

```bash
cp .env.example .env
```

The defaults work out of the box. The main values you may want to change:

```
MONITOR_PORT=8000       # backend API port
KERNEL_PORT=8002        # kernel port
PORT=3000               # frontend port
API_URL=http://localhost:8000   # change host if backend runs on another machine
```

Cloud provider API keys (OpenAI, Anthropic, Groq, etc.) are entered directly in the LLMs tab in the web app — they are stored in the LLM registry, not in `.env`. The `.env` file is gitignored — never commit it.
