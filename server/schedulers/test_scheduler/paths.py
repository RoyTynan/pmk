import os

SCHEDULER_DIR = os.path.dirname(os.path.abspath(__file__))
DATABASE_DIR  = os.path.join(SCHEDULER_DIR, "database")
LOGS_DIR      = os.path.join(SCHEDULER_DIR, "logs")
DB_PATH       = os.path.join(DATABASE_DIR, "test.db")
