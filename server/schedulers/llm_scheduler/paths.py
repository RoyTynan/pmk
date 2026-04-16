"""
All filesystem paths owned by the LLM scheduler.
Each scheduler package defines its own paths.py — nothing in core/ should reference scheduler-specific paths.
"""
import os

SCHEDULER_DIR = os.path.dirname(os.path.abspath(__file__))
DATABASE_DIR  = os.path.join(SCHEDULER_DIR, "database")

LLMS_DB_PATH   = os.path.join(DATABASE_DIR, "llms.db")
LLMS_JSON_PATH = os.path.join(DATABASE_DIR, "llms.json")   # legacy — migration source only
LOGS_DIR       = os.path.join(SCHEDULER_DIR, "logs")
CHROMA_DIR     = os.path.join(DATABASE_DIR, "chromadb")
