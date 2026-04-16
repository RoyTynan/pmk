"""
Configuration for PMK.
All paths are relative to this repo — fully self-contained.
Only EMBED_URL and LLM_URL are external (network services).
"""
import os

# Paths — config.py lives at server/kernelroot/core/config.py
_THIS      = os.path.abspath(__file__)
CORE_DIR       = os.path.dirname(_THIS)               # …/server/kernelroot/core
KERNELROOT_DIR = os.path.dirname(CORE_DIR)            # …/server/kernelroot
SERVER_DIR     = os.path.dirname(KERNELROOT_DIR)      # …/server
REPO_DIR       = os.path.dirname(SERVER_DIR)          # …/PMK

# Keep BASE_DIR pointing at server/ for any code that still uses it
BASE_DIR = SERVER_DIR

# Kernel task queue DB — kernel infrastructure, not scheduler-specific
TASKS_DB_DIR  = os.path.join(KERNELROOT_DIR, "database")
TASKS_DB_PATH = os.path.join(TASKS_DB_DIR, "tasks.db")


# Embedding server — llama-server on i7, nomic-embed-text
EMBED_URL    = "http://127.0.0.1:11435/v1/embeddings"
EMBED_MODEL  = "nomic-embed-text"

# LLM registry — named endpoints
LLMS = {
    "qwen-32b": {
        "url":         "http://192.168.178.99:8080",
        "model":       "Qwen2.5-Coder-32B-Instruct-Q8_0.gguf",
        "max_tasks":   1,
    },
    "qwen-0.5b": {
        "url":         "http://127.0.0.1:8081",
        "model":       "qwen2.5-0.5b-instruct-q4_k_m.gguf",
        "max_tasks":   1,
    },
}

DEFAULT_LLM  = "qwen-32b"

LLM_SHORTCUTS = {
    "use1": "qwen-32b",
    "use2": "qwen-0.5b",
}

# Legacy aliases — keep existing code working
LLM_URL      = LLMS[DEFAULT_LLM]["url"]
LLM_MODEL    = LLMS[DEFAULT_LLM]["model"]

# Local model storage
LLM_MODELS_DIR   = os.path.join(REPO_DIR, "llm_models")

# llama-server binary
LLAMA_SERVER_PATH = os.path.join(os.path.expanduser("~"), "llama.cpp", "build", "bin", "llama-server")


# Scheduler
MAX_CONCURRENT_TASKS  = 1   # per-LLM slot limit (see LLMS above)
POLL_INTERVAL_SECONDS = 2   # how often the scheduler checks the queue
DEFAULT_MAX_TOKENS    = 1024
TOKEN_BUDGET_CEILING  = 4096  # hard OS limit — no agent can exceed this
