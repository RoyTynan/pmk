FROM python:3.12-slim-bookworm

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies first (cached layer)
COPY server/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy server source
COPY server/ ./server/

ENV PYTHONPATH=/app/server
ENV HOME=/root

# llama-server is bind-mounted from the host at runtime
# Expected at: /root/llama.cpp/build/bin/llama-server
# (matches the path in kernelroot/core/config.py)

EXPOSE 8000 8002

CMD ["python", "-m", "uvicorn", "kernelroot.main:app", "--host", "0.0.0.0", "--port", "8000"]
