#!/bin/bash
# start-server.sh — boot the PMK backend only (no web UI)
cd "$(dirname "$0")"

# Load environment variables from .env if present
set -a
[ -f .env ] && source .env
set +a

MONITOR_PORT=${MONITOR_PORT:-8000}
KERNEL_PORT=${KERNEL_PORT:-8002}

echo ""
echo "PMK backend running:"
echo "  monitor API → http://localhost:$MONITOR_PORT"
echo "  kernel API  → http://localhost:$KERNEL_PORT  (started by monitor)"
echo ""
echo "Press Ctrl+C to stop."

PYTHONPATH=server MONITOR_PORT=$MONITOR_PORT KERNEL_PORT=$KERNEL_PORT \
  .venv/bin/uvicorn kernelroot.main:app --host 0.0.0.0 --port $MONITOR_PORT
