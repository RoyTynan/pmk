"""
Kernel configuration for HostScheduler.
Contains only kernel-level paths and scheduler constants.
LLM-specific configuration lives in schedulers/llm_scheduler/config.py.
"""
import os

# Paths — config.py lives at server/schedhost/core/config.py
_THIS          = os.path.abspath(__file__)
CORE_DIR       = os.path.dirname(_THIS)               # …/server/schedhost/core
SCHEDHOST_DIR = os.path.dirname(CORE_DIR)            # …/server/schedhost
SERVER_DIR     = os.path.dirname(SCHEDHOST_DIR)      # …/server
REPO_DIR       = os.path.dirname(SERVER_DIR)          # …/HostScheduler

# Keep BASE_DIR pointing at server/ for any code that still uses it
BASE_DIR = SERVER_DIR

# Kernel task queue DB — kernel infrastructure, not scheduler-specific
TASKS_DB_DIR  = os.path.join(SCHEDHOST_DIR, "database")
TASKS_DB_PATH = os.path.join(TASKS_DB_DIR, "tasks.db")
ERROR_LOG_PATH = os.path.join(TASKS_DB_DIR, "errors.log")

# Scheduler polling — shared by all schedulers
POLL_INTERVAL_SECONDS = 2
