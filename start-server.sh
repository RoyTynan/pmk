#!/bin/bash
# start-server.sh — boot the HostScheduler backend only (no web UI)
cd "$(dirname "$0")"

# Load environment variables from .env if present
set -a
[ -f .env ] && source .env
set +a

MONITOR_PORT=${MONITOR_PORT:-8000}
HOST_PORT=${HOST_PORT:-8002}

echo ""
echo "HostScheduler backend running:"
echo "  monitor API → http://localhost:$MONITOR_PORT"
echo "  host API  → http://localhost:$HOST_PORT  (started by monitor)"
echo ""
echo "Press Ctrl+C to stop."

PYTHONPATH=server MONITOR_PORT=$MONITOR_PORT HOST_PORT=$HOST_PORT \
  .venv/bin/uvicorn schedhost.main:app --host 0.0.0.0 --port $MONITOR_PORT
