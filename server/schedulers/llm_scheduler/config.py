"""
LLM-scheduler configuration.
All LLM-specific constants live here — nothing in schedhost/ should import these.
"""
import os

from schedhost.core.config import REPO_DIR

# ---------------------------------------------------------------------------
# Embedding server
# ---------------------------------------------------------------------------
EMBED_URL   = "http://127.0.0.1:11435/v1/embeddings"
EMBED_MODEL = "nomic-embed-text"

# ---------------------------------------------------------------------------
# LLM registry seed data — used only when llms.db is empty on first run
# ---------------------------------------------------------------------------
LLMS: dict = {
    "qwen-32b": {
        "url":       "http://192.168.178.99:8080",
        "model":     "Qwen2.5-Coder-32B-Instruct-Q8_0.gguf",
        "max_tasks": 1,
    },
    "qwen-0.5b": {
        "url":       "http://127.0.0.1:8081",
        "model":     "qwen2.5-0.5b-instruct-q4_k_m.gguf",
        "max_tasks": 1,
    },
}

DEFAULT_LLM = "qwen-32b"

LLM_SHORTCUTS: dict = {
    "use1": "qwen-32b",
    "use2": "qwen-0.5b",
}

# ---------------------------------------------------------------------------
# Local model storage and llama-server binary
# ---------------------------------------------------------------------------
LLM_MODELS_DIR    = os.path.join(REPO_DIR, "llm_models")
LLAMA_SERVER_PATH = os.environ.get(
    "LLAMA_SERVER_PATH",
    os.path.join(os.path.expanduser("~"), "llama.cpp", "build", "bin", "llama-server"),
)

# ---------------------------------------------------------------------------
# Agent token limits
# ---------------------------------------------------------------------------
MAX_CONCURRENT_TASKS  = 1     # default per-LLM slot limit
DEFAULT_MAX_TOKENS    = 1024
TOKEN_BUDGET_CEILING  = 4096  # hard cap — no agent can exceed this
