#!/bin/bash
# start.sh — boot the PMK monitor (FastAPI) and Next.js frontend
cd "$(dirname "$0")"

# Load environment variables from .env if present
set -a
[ -f .env ] && source .env
set +a

MONITOR_PORT=${MONITOR_PORT:-8000}
KERNEL_PORT=${KERNEL_PORT:-8002}
PORT=${PORT:-3000}

# Start FastAPI backend in background (PYTHONPATH=server so imports resolve)
PYTHONPATH=server MONITOR_PORT=$MONITOR_PORT KERNEL_PORT=$KERNEL_PORT \
  .venv/bin/uvicorn kernelroot.main:app --host 0.0.0.0 --port $MONITOR_PORT &
BACKEND_PID=$!

# Wait for backend to be ready before starting the frontend
echo "Waiting for backend..."
until curl -sf http://localhost:$MONITOR_PORT/routes > /dev/null 2>&1; do
  sleep 0.5
done

# Start Next.js frontend
PORT=$PORT cd frontend && npm run dev &
FRONTEND_PID=$!

cd ..
echo ""
echo "PMK running:"
echo "  backend  → http://localhost:$MONITOR_PORT"
echo "  kernel   → http://localhost:$KERNEL_PORT  (started by backend)"
echo "  frontend → http://localhost:$PORT"
echo ""
echo "Press Ctrl+C to stop both."

# Stop both on exit
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT
wait
