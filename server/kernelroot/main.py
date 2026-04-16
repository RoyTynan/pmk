"""
main.py — web control panel for PMK.

    ./start.sh          (recommended)
    .venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
"""
import asyncio
import importlib
import json
import os
import re
import signal
import sqlite3
import subprocess
import sys
import time
import uuid

import httpx
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from kernelroot.core import task_queue, activity_log
from schedulers.llm_scheduler import registry as llm_registry
from schedulers.llm_scheduler.client import acall_llm, ANTHROPIC_VERSION
from schedulers.llm_scheduler.agentic.router import router as agentic_router
from schedulers.llm_scheduler.ray.router import router as ray_router
from schedulers.llm_scheduler.analyse.router import router as analyse_router
from schedulers.llm_scheduler.traces.router import router as traces_router
from schedulers.llm_scheduler.traces.store import init_db as init_traces_db
from schedulers.llm_scheduler.paths import LOGS_DIR
from kernelroot.core.config import TASKS_DB_PATH
from kernelroot.core.config import (
    BASE_DIR, DEFAULT_LLM,
    LLAMA_SERVER_PATH, LLM_MODELS_DIR,
)
from kernelroot.scheduler_registry import SCHEDULER_MAP as _SCHEDULER_MAP
from kernelroot.router_registry import ROUTERS as _SCHEDULER_ROUTERS

task_queue.init(TASKS_DB_PATH)


def _clean_exit(signum, frame):
    # Suppress any remaining C++ / Ray stderr output before exiting
    try:
        devnull = open(os.devnull, "w")
        os.dup2(devnull.fileno(), 2)
    except Exception:
        pass
    os._exit(0)

app = FastAPI()
app.include_router(agentic_router,  prefix="/agentic")
app.include_router(ray_router,      prefix="/ray")
app.include_router(analyse_router,  prefix="/analyse")
app.include_router(traces_router,   prefix="/traces")

# Load any user-created scheduler routers registered by the assistant
for _mod_path, _attr in _SCHEDULER_ROUTERS:
    try:
        _mod = importlib.import_module(_mod_path)
        app.include_router(getattr(_mod, _attr))
    except Exception as _e:
        print(f"[main] warning: could not load router {_mod_path}: {_e}")

init_traces_db()

_kernel_proc: subprocess.Popen | None = None
_llm_procs:   dict[str, subprocess.Popen] = {}




# ---------------------------------------------------------------------------
# WebSocket connection manager
# ---------------------------------------------------------------------------

class _WsManager:
    def __init__(self):
        self._clients: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self._clients.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self._clients:
            self._clients.remove(ws)

    async def broadcast(self, data: dict):
        dead = []
        for client in self._clients:
            try:
                await client.send_json(data)
            except Exception:
                dead.append(client)
        for d in dead:
            self.disconnect(d)


_ws_manager  = _WsManager()
_push_queue: asyncio.Queue = asyncio.Queue()
_loop: asyncio.AbstractEventLoop | None = None


def _notify():
    """Trigger a WebSocket push from a synchronous endpoint."""
    if _loop:
        _loop.call_soon_threadsafe(_push_queue.put_nowait, "change")


# ---------------------------------------------------------------------------
# Snapshot — called from a thread pool to avoid blocking the event loop
# ---------------------------------------------------------------------------

def _snapshot() -> dict:
    tasks     = task_queue.list_tasks()
    activity  = activity_log.list_recent(100)
    states    = llm_registry.all_states()
    llms_data = []
    for name, cfg in llm_registry.load().items():
        s = states.get(name, {})
        llms_data.append({
            "name":    name,
            "model":   cfg.get("model", ""),
            "url":     cfg.get("url", ""),
            "type":    cfg.get("type", "remote"),
            "running": bool(s.get("running", False)),
        })
    return {
        "tasks":    tasks,
        "activity": activity,
        "llms":     llms_data,
        "kernel":   {"running": _kernel_proc is not None and _kernel_proc.poll() is None},
        "multi":    {"enabled": False},
    }


# ---------------------------------------------------------------------------
# IPC server — receives change notifications from the scheduler process
# ---------------------------------------------------------------------------

async def _ipc_client(reader: asyncio.StreamReader, _writer: asyncio.StreamWriter):
    """One connection from the scheduler; each line = one change event."""
    try:
        while True:
            line = await reader.readline()
            if not line:
                break
            await _push_queue.put("change")
    except Exception:
        pass


async def _push_worker():
    """Drain the queue and broadcast a fresh snapshot to all WS clients."""
    while True:
        await _push_queue.get()
        while not _push_queue.empty():   # drain burst
            _push_queue.get_nowait()
        snap = await asyncio.to_thread(_snapshot)
        await _ws_manager.broadcast(snap)


@app.on_event("startup")
async def _startup():
    global _loop, _kernel_proc
    _loop = asyncio.get_running_loop()
    ipc = await asyncio.start_server(_ipc_client, "127.0.0.1", 8001)
    asyncio.create_task(ipc.serve_forever())
    asyncio.create_task(_push_worker())
    # Re-register after uvicorn + Ray have both set their own handlers
    signal.signal(signal.SIGTERM, _clean_exit)
    signal.signal(signal.SIGINT,  _clean_exit)
    # Start the kernel automatically and push state to AppState
    kernel_path  = os.path.join(BASE_DIR, "kernelroot", "kernel.py")
    kernel_env   = os.environ.copy()
    kernel_env["PYTHONPATH"] = BASE_DIR  # absolute path so it works regardless of cwd
    kernel_env["KERNEL_SCHEDULERS"] = ",".join(_SCHEDULER_MAP.keys())
    _kernel_proc = subprocess.Popen([sys.executable, kernel_path], cwd=BASE_DIR, env=kernel_env)
    _notify()


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------

@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await _ws_manager.connect(ws)
    try:
        await ws.send_json(await asyncio.to_thread(_snapshot))   # initial state
        while True:
            await ws.receive_text()          # keep alive; ignore client messages
    except (WebSocketDisconnect, Exception):
        pass
    finally:
        _ws_manager.disconnect(ws)


# ---------------------------------------------------------------------------
# Tasks
# ---------------------------------------------------------------------------

@app.get("/tasks")
def tasks():
    return task_queue.list_tasks()


@app.get("/tasks/{task_id}")
def get_task(task_id: str):
    task = task_queue.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="task not found")
    return task


class SubmitRequest(BaseModel):
    prompt:        str
    agent_type:    str  = "echo"
    target_llm:    str  = DEFAULT_LLM
    priority:      int  = 0
    child_routing: str  = "same"
    aggregate:     bool = False
    options:       dict = {}


@app.post("/submit")
def submit(req: SubmitRequest):
    task_id = task_queue.add_task(
        prompt=req.prompt,
        agent_type=req.agent_type,
        priority=req.priority,
        target_llm=req.target_llm,
        child_routing=req.child_routing,
        aggregate=req.aggregate,
        options=req.options or None,
    )
    _notify()
    return {"task_id": task_id}


@app.get("/activity")
def get_activity(limit: int = 200):
    return activity_log.list_recent(limit)


@app.post("/activity/clear")
def clear_activity():
    cleared = activity_log.clear()
    _notify()
    return {"cleared": cleared}


@app.post("/tasks/clear")
def clear_tasks():
    with sqlite3.connect(TASKS_DB_PATH) as conn:
        conn.execute("DELETE FROM tasks")
    _notify()
    return {"cleared": True}


@app.post("/tasks/clear-completed")
def clear_completed_tasks():
    with sqlite3.connect(TASKS_DB_PATH) as conn:
        cursor = conn.execute("DELETE FROM tasks WHERE status IN ('done', 'failed')")
        deleted = cursor.rowcount
    _notify()
    return {"cleared": deleted}


@app.post("/tasks/clear-status/{status}")
def clear_tasks_by_status(status: str):
    if status not in ("pending", "running", "done", "failed"):
        raise HTTPException(status_code=400, detail=f"Unknown status '{status}'")
    with sqlite3.connect(TASKS_DB_PATH) as conn:
        cursor = conn.execute("DELETE FROM tasks WHERE status=?", (status,))
        deleted = cursor.rowcount
    _notify()
    return {"cleared": deleted, "status": status}


@app.delete("/tasks/{task_id}")
def delete_task(task_id: str):
    with sqlite3.connect(TASKS_DB_PATH) as conn:
        cursor = conn.execute("DELETE FROM tasks WHERE id=?", (task_id,))
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="task not found")
    _notify()
    return {"deleted": task_id}


@app.post("/tasks/{task_id}/requeue")
def requeue_task(task_id: str):
    with sqlite3.connect(TASKS_DB_PATH) as conn:
        cursor = conn.execute(
            "UPDATE tasks SET status='pending', started_at=NULL, finished_at=NULL, result=NULL, error=NULL"
            " WHERE id=?",
            (task_id,),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="task not found")
    _notify()
    return {"requeued": task_id}


# ---------------------------------------------------------------------------
# Agents
# ---------------------------------------------------------------------------

@app.get("/agents")
def agents():
    return [{"name": "echo"}, {"name": "planner"}]


# ---------------------------------------------------------------------------
# LLM registry
# ---------------------------------------------------------------------------

@app.get("/llms")
def get_llms():
    states = llm_registry.all_states()
    result = []
    for name, cfg in llm_registry.load().items():
        s = states.get(name, {})
        result.append({
            "name":       name,
            "model":      cfg.get("model", ""),
            "url":        cfg.get("url", ""),
            "max_tasks":  cfg.get("max_tasks", 1),
            "type":       cfg.get("type", "remote"),
            "path":       cfg.get("path", ""),
            "port":       cfg.get("port", ""),
            "api_key":    cfg.get("api_key", ""),
            "provider":   cfg.get("provider", "custom"),
            "running":    bool(s.get("running", False)),
            "pid":        s.get("pid"),
            "started_at": s.get("started_at"),
            "stopped_at": s.get("stopped_at"),
        })
    return result


MODEL_EXTENSIONS = {'.gguf', '.bin', '.safetensors', '.ggml', '.pt', '.pth'}

@app.get("/llms/browse")
def browse_models(path: str = ""):
    target = os.path.expanduser(path) if path else os.path.expanduser("~")
    if not os.path.isdir(target):
        raise HTTPException(status_code=400, detail=f"not a directory: {target}")
    try:
        entries = os.listdir(target)
    except PermissionError:
        raise HTTPException(status_code=403, detail="permission denied")
    dirs  = sorted([e for e in entries if os.path.isdir(os.path.join(target, e)) and not e.startswith('.')])
    files = sorted([e for e in entries if os.path.splitext(e)[1].lower() in MODEL_EXTENSIONS])
    parent = os.path.dirname(target) if target != os.path.dirname(target) else None
    return {"path": target, "parent": parent, "dirs": dirs, "files": files}


@app.get("/llms/models")
def list_models():
    results = {}
    # local model files from disk
    if os.path.exists(LLM_MODELS_DIR):
        for f in os.listdir(LLM_MODELS_DIR):
            results[f] = "local"
    # registered LLMs from DB — use their stored type
    for cfg in llm_registry.load().values():
        model = cfg.get("model", "")
        if model and model not in results:
            results[model] = cfg.get("type", "remote")
    return [{"name": name, "type": t} for name, t in sorted(results.items())]


class RegisterLocalRequest(BaseModel):
    name:      str
    filename:  str
    port:      int
    max_tasks: int  = 1
    use_gpu:   bool = True


@app.post("/llms/register/local")
def register_local(req: RegisterLocalRequest):
    path = req.filename if os.path.isabs(req.filename) else os.path.join(LLM_MODELS_DIR, req.filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"model file not found: {path}")
    entry = {
        "url": f"http://127.0.0.1:{req.port}", "model": req.filename,
        "max_tasks": req.max_tasks, "type": "local", "path": path,
        "port": req.port, "use_gpu": req.use_gpu,
    }
    llm_registry.add(req.name, entry)
    cmd = [LLAMA_SERVER_PATH, "-m", path, "--port", str(req.port)]
    if not req.use_gpu:
        cmd += ["-ngl", "0"]
    os.makedirs(LOGS_DIR, exist_ok=True)
    log_file = open(os.path.join(LOGS_DIR, f"{req.name}.log"), "w")
    log_file.write(f"=== {req.name} — running on {'GPU' if req.use_gpu else 'CPU'} ===\n\n")
    log_file.flush()
    proc = subprocess.Popen(cmd, stdout=log_file, stderr=log_file)
    _llm_procs[req.name] = proc
    llm_registry.set_state(req.name, True, proc.pid)
    _notify()
    return {"registered": True, "pid": proc.pid}


class RegisterRemoteRequest(BaseModel):
    name:      str
    url:       str
    model:     str
    api_key:   str = ''
    provider:  str = 'custom'
    type:      str = 'remote'
    max_tasks: int = 1


@app.post("/llms/register/remote")
def register_remote(req: RegisterRemoteRequest):
    llm_registry.add(req.name, {
        "url": req.url, "model": req.model,
        "max_tasks": req.max_tasks, "type": req.type,
        "api_key": req.api_key, "provider": req.provider,
    })
    llm_registry.set_state(req.name, True)  # remote LLMs are always available once registered
    _notify()
    return {"registered": True}


@app.post("/llms/test")
def test_connection(req: RegisterRemoteRequest):
    try:
        if req.provider == 'anthropic':
            # Anthropic /v1/models is unreliable — use a 1-token completion instead
            headers = {"x-api-key": req.api_key, "anthropic-version": ANTHROPIC_VERSION,
                       "content-type": "application/json"}
            r = httpx.post(
                f"{req.url.rstrip('/')}/messages",
                json={"model": req.model, "messages": [{"role": "user", "content": "hi"}], "max_tokens": 1},
                headers=headers,
                timeout=10.0,
            )
        else:
            headers = {"Authorization": f"Bearer {req.api_key}"} if req.api_key else {}
            # stored URL already includes /v1 (e.g. https://api.openai.com/v1)
            r = httpx.get(f"{req.url.rstrip('/')}/models", timeout=5.0, headers=headers)
        try:
            body = r.json()
        except Exception:
            body = r.text
        if r.status_code < 400:
            return {"ok": True, "data": body}
        if isinstance(body, dict):
            msg = body.get("error", {}).get("message") or str(body)
        else:
            msg = body or f"HTTP {r.status_code}"
        return {"ok": False, "error": msg, "data": body}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.get("/llms/{name}/log")
def llm_log(name: str, lines: int = 50):
    log_path = os.path.join(LOGS_DIR, f"{name}.log")
    if not os.path.exists(log_path):
        return {"lines": [], "exists": False}
    with open(log_path) as f:
        all_lines = f.readlines()
    return {"lines": all_lines[-lines:], "exists": True}


@app.delete("/llms/{name}/log")
def clear_llm_log(name: str):
    log_path = os.path.join(LOGS_DIR, f"{name}.log")
    if os.path.exists(log_path):
        open(log_path, "w").close()
    return {"cleared": True}


@app.delete("/llms/{name}")
def remove_llm(name: str):
    proc = _llm_procs.get(name)
    if proc and proc.poll() is None:
        proc.terminate(); proc.wait()
        _llm_procs.pop(name, None)
    llm_registry.set_state(name, False)
    llm_registry.remove(name)
    _notify()
    return {"removed": True}


@app.post("/llms/{name}/start")
def start_llm(name: str):
    cfg = llm_registry.get(name)
    if not cfg:
        raise HTTPException(status_code=404, detail="LLM not found")
    if cfg.get("type") != "local":
        raise HTTPException(status_code=400, detail="only local LLMs can be started")
    proc = _llm_procs.get(name)
    if proc and proc.poll() is None:
        return {"started": False, "reason": "already running"}
    cmd = [LLAMA_SERVER_PATH, "-m", cfg["path"], "--port", str(cfg["port"])]
    if not cfg.get("use_gpu", True):
        cmd += ["-ngl", "0"]
    os.makedirs(LOGS_DIR, exist_ok=True)
    log_file = open(os.path.join(LOGS_DIR, f"{name}.log"), "w")
    use_gpu  = cfg.get("use_gpu", True)
    log_file.write(f"=== {name} — running on {'GPU' if use_gpu else 'CPU'} ===\n\n")
    log_file.flush()
    proc = subprocess.Popen(cmd, stdout=log_file, stderr=log_file)
    _llm_procs[name] = proc
    llm_registry.set_state(name, True, proc.pid)
    _notify()
    return {"started": True, "pid": proc.pid}


@app.post("/llms/{name}/stop")
def stop_llm(name: str):
    proc = _llm_procs.get(name)
    if proc and proc.poll() is None:
        proc.terminate(); proc.wait()
        llm_registry.set_state(name, False)
        _notify()
        return {"stopped": True}
    llm_registry.set_state(name, False)
    return {"stopped": False, "reason": "not running"}


# ---------------------------------------------------------------------------
# Kernel control
# ---------------------------------------------------------------------------

@app.get("/status")
def system_status():
    """
    Single endpoint summarising the running state of the whole system.
    Useful for external API callers to discover what is available.
    """
    llms_all = []
    for name, cfg in llm_registry.load().items():
        proc    = _llm_procs.get(name)
        running = proc is not None and proc.poll() is None
        llms_all.append({
            "name":    name,
            "model":   cfg.get("model", ""),
            "url":     cfg.get("url", ""),
            "type":    cfg.get("type", "remote"),
            "running": running,
        })

    kernel_running = _kernel_proc is not None and _kernel_proc.poll() is None

    return {
        "kernel":       {"running": kernel_running},
        "llms":         llms_all,
        "llms_running": [l for l in llms_all if l["running"]],
    }


@app.get("/kernel/status")
def kernel_status():
    return {"running": _kernel_proc is not None and _kernel_proc.poll() is None}


@app.post("/kernel/start")
def kernel_start():
    global _kernel_proc
    if _kernel_proc and _kernel_proc.poll() is None:
        return {"started": False, "reason": "already running"}
    kernel_path  = os.path.join(BASE_DIR, "kernelroot", "kernel.py")
    kernel_env   = os.environ.copy()
    kernel_env["PYTHONPATH"] = BASE_DIR  # absolute path so it works regardless of cwd
    kernel_env["KERNEL_SCHEDULERS"] = ",".join(_SCHEDULER_MAP.keys())
    _kernel_proc = subprocess.Popen([sys.executable, kernel_path], cwd=BASE_DIR, env=kernel_env)
    _notify()
    return {"started": True, "pid": _kernel_proc.pid}


@app.post("/kernel/stop")
def kernel_stop():
    global _kernel_proc
    if _kernel_proc and _kernel_proc.poll() is None:
        _kernel_proc.terminate(); _kernel_proc.wait()
        _notify()
        return {"stopped": True}
    return {"stopped": False, "reason": "not running"}


@app.api_route("/kernel/proxy/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"], include_in_schema=False)
async def kernel_proxy(path: str, request: Request):
    """Generic proxy — forwards any method + body to the kernel API."""
    kernel_port = int(os.environ.get("KERNEL_PORT", 8002))
    body = await request.body()
    try:
        r = httpx.request(
            request.method,
            f"http://localhost:{kernel_port}/{path}",
            content=body,
            headers={"content-type": "application/json"},
            timeout=30.0,
        )
        return Response(content=r.content, status_code=r.status_code, media_type="application/json")
    except Exception as e:
        return Response(content=json.dumps({"error": str(e)}), status_code=502, media_type="application/json")


@app.get("/kernel/routes")
def kernel_routes():
    """Proxy to the kernel API index — returns all auto-generated operations."""
    kernel_port = int(os.environ.get("KERNEL_PORT", 8002))
    try:
        r = httpx.get(f"http://localhost:{kernel_port}/", timeout=2.0)
        return r.json()
    except Exception:
        return {"schedulers": {}, "available": False}


# ---------------------------------------------------------------------------
# System info
# ---------------------------------------------------------------------------

@app.get("/system/ports")
def system_ports():
    """Return ports reserved by the app — used by the frontend to block clashing LLM ports."""
    return {
        "monitor": int(os.environ.get("MONITOR_PORT", 8000)),
        "kernel":  int(os.environ.get("KERNEL_PORT",  8002)),
    }


# Monitor route discovery
# ---------------------------------------------------------------------------

@app.get("/routes")
def list_routes():
    """Return all registered monitor API routes."""
    skip = {"/", "/docs", "/openapi.json", "/redoc", "/routes"}
    routes = []
    for route in app.routes:
        if not hasattr(route, "methods") or not hasattr(route, "path"):
            continue
        if route.path in skip:
            continue
        methods = sorted(route.methods - {"HEAD", "OPTIONS"})
        if not methods:
            continue
        routes.append({
            "path":    route.path,
            "methods": methods,
            "name":    getattr(route, "name", ""),
        })
    return sorted(routes, key=lambda r: r["path"])


# ---------------------------------------------------------------------------
# Scheduler discovery
# ---------------------------------------------------------------------------

BUILTIN_SCHEDULER_NAMES = {"llm", "jsonparser"}


def _scheduler_info(name: str, folder: str, builtin: bool) -> dict:
    registered = name in _SCHEDULER_MAP
    dotted = _SCHEDULER_MAP.get(name, f"schedulers.{folder}.scheduler")
    try:
        mod_path, cls_name = dotted.rsplit(".", 1)
        mod = importlib.import_module(mod_path)
        cls = getattr(mod, cls_name)
        info = dict(getattr(cls, "SCHEDULER_INFO", {"name": name, "label": name.capitalize(), "api": []}))
    except Exception:
        info = {"name": name, "label": name.capitalize(), "api": []}
    info["registered"] = registered
    info["builtin"]    = builtin
    return info


@app.get("/schedulers")
def list_schedulers():
    """Return info for all schedulers — built-ins (builtin=True) and user-created (builtin=False).

    Includes unregistered schedulers (registered=False) so their tab remains
    visible after unregistering. Built-ins cannot be deleted.
    """
    result = []

    # Built-ins first, in a fixed order
    for name in ("llm", "jsonparser"):
        result.append(_scheduler_info(name, f"{name}_scheduler", builtin=True))

    # User-created: scan filesystem, skip built-in folders
    schedulers_dir = os.path.join(BASE_DIR, "schedulers")
    builtin_folders = {f"{n}_scheduler" for n in BUILTIN_SCHEDULER_NAMES}
    for entry in sorted(os.scandir(schedulers_dir), key=lambda e: e.name):
        if not entry.is_dir() or not entry.name.endswith("_scheduler"):
            continue
        if entry.name in builtin_folders:
            continue
        name = entry.name[: -len("_scheduler")]
        result.append(_scheduler_info(name, entry.name, builtin=False))

    return result


# ---------------------------------------------------------------------------
# Scheduler assistant
# ---------------------------------------------------------------------------

from kernelroot.scaffolding.scaffolding import (
    generate_scheduler    as _generate_scheduler,
    unregister_scheduler  as _unregister_scheduler_impl,
    update_scheduler_registry as _update_scheduler_registry,
    update_router_registry    as _update_router_registry,
    discover_scheduler_class  as _discover_scheduler_class,
    delete_scheduler_folder   as _delete_scheduler_folder,
)


def _unregister_scheduler(name: str):
    _unregister_scheduler_impl(name, _SCHEDULER_MAP)


class CreateSchedulerRequest(BaseModel):
    name: str


@app.post("/assistant/scheduler/{name}/unregister")
def unregister_scheduler(name: str):
    """Remove from registries and signal the running scheduler thread to stop."""
    folder = f"{name}_scheduler"
    if name not in _SCHEDULER_MAP:
        return {"ok": False, "error": f'"{name}" is not a registered scheduler'}
    # Built-ins stay in the registry file — only stop the running thread
    if name not in BUILTIN_SCHEDULER_NAMES:
        _unregister_scheduler(name)
    # Ask the kernel to stop the scheduler thread via its API
    scheduler_stopped = False
    kernel_port = int(os.environ.get("KERNEL_PORT", 8002))
    try:
        r = httpx.post(f"http://localhost:{kernel_port}/schedulers/{name}/stop", timeout=5.0)
        scheduler_stopped = r.json().get("ok", False)
    except Exception:
        pass  # kernel not running — nothing to stop
    return {"ok": True, "unregistered": f"schedulers/{folder}", "scheduler_stopped": scheduler_stopped}


@app.post("/assistant/scheduler/{name}/register")
def register_scheduler(name: str):
    """Re-register a scheduler that was previously unregistered and restart its thread."""
    folder    = f"{name}_scheduler"
    sched_dir = os.path.join(BASE_DIR, "schedulers", folder)

    if not os.path.exists(sched_dir):
        return {"ok": False, "error": f"schedulers/{folder} not found on disk"}
    if name in _SCHEDULER_MAP:
        return {"ok": False, "error": f'"{name}" is already registered'}

    try:
        cls_name = _discover_scheduler_class(folder)
    except StopIteration:
        return {"ok": False, "error": f"No SchedulerBase subclass found in schedulers.{folder}.scheduler"}
    except Exception as e:
        return {"ok": False, "error": f"Could not import scheduler module: {e}"}

    dotted = f"schedulers.{folder}.scheduler.{cls_name}"

    # Built-ins have their correct entries hardcoded in the registry file —
    # only write to the files for user-created schedulers.
    if name not in BUILTIN_SCHEDULER_NAMES:
        mod_path = f"schedulers.{folder}.router"
        _update_scheduler_registry(name, dotted, _SCHEDULER_MAP)
        _update_router_registry(name, mod_path)
        try:
            router_mod = importlib.import_module(mod_path)
            app.include_router(getattr(router_mod, "router"))
        except Exception as e:
            print(f"[assistant] warning: could not hot-load router: {e}")
    else:
        # For built-ins, just restore the in-memory map
        _SCHEDULER_MAP[name] = dotted

    # Ask the running kernel to start the scheduler thread immediately
    kernel_port = int(os.environ.get("KERNEL_PORT", 8002))
    scheduler_started = False
    try:
        r = httpx.post(f"http://localhost:{kernel_port}/schedulers/{name}/start",
                       json={"dotted": dotted}, timeout=5.0)
        scheduler_started = r.json().get("ok", False)
    except Exception:
        pass  # kernel not running — will pick it up on next restart

    return {"ok": True, "registered": f"schedulers/{folder}", "scheduler_started": scheduler_started}


@app.delete("/assistant/scheduler/{name}")
def delete_scheduler(name: str):
    """Unregister and permanently delete all code files. Built-ins cannot be deleted."""
    import shutil
    if name in BUILTIN_SCHEDULER_NAMES:
        return {"ok": False, "error": f'"{name}" is a built-in scheduler and cannot be deleted'}

    folder    = f"{name}_scheduler"
    sched_dir = os.path.join(BASE_DIR, "schedulers", folder)

    if not os.path.exists(sched_dir):
        return {"ok": False, "error": f"schedulers/{folder} not found"}

    _unregister_scheduler(name)
    shutil.rmtree(sched_dir)
    return {"ok": True, "deleted": f"schedulers/{folder}", "restart_required": True}


@app.post("/assistant/create")
def create_scheduler(req: CreateSchedulerRequest):
    result = _generate_scheduler(req.name, _SCHEDULER_MAP)
    if not result.get("ok"):
        return result

    # hot-load the router into the running app
    mod_path = result["router"]
    try:
        router_mod = importlib.import_module(mod_path)
        app.include_router(getattr(router_mod, "router"))
    except Exception as e:
        print(f"[assistant] warning: could not hot-load router: {e}")

    return result


# ---------------------------------------------------------------------------
# Pipeline — chains prompts across LLM instances
# ---------------------------------------------------------------------------

class PipelineStep(BaseModel):
    name:   str    # LLM registry name — url/model/api_key resolved server-side
    prompt: str

class PipelineRequest(BaseModel):
    steps: list[PipelineStep]


async def _run_pipeline(steps: list[PipelineStep]):
    """Execute steps sequentially, threading conversation history. Yields SSE lines."""
    registry = llm_registry.load()
    history: list[dict] = []

    for i, step in enumerate(steps):
        yield f"data: {json.dumps({'step': i, 'status': 'running'})}\n\n"

        llm      = registry.get(step.name, {})
        url      = llm.get("url", "")
        model    = llm.get("model", "")
        api_key  = llm.get("api_key", "")
        provider = llm.get("provider", "custom")

        history.append({"role": "user", "content": step.prompt})
        prompt_len = sum(len(m.get("content", "")) for m in history)
        t0 = time.time()
        ok, err_str = True, None
        try:
            result = await acall_llm(url, model, history, api_key, provider)
            result = result.strip()
        except Exception as exc:
            ok, err_str, result = False, str(exc), f"[error: {exc}]"
        finally:
            activity_log.log(
                llm=step.name, model=model, provider=provider, source="pipeline",
                prompt_len=prompt_len, result_len=len(result),
                duration_ms=int((time.time() - t0) * 1000),
                ok=ok, error=err_str,
            )

        history.append({"role": "assistant", "content": result})
        yield f"data: {json.dumps({'step': i, 'status': 'done', 'result': result})}\n\n"

    yield f"data: {json.dumps({'done': True, 'history': history})}\n\n"


@app.post("/multi/off")
def multi_off():
    return {"ok": True}


@app.post("/multi/pipeline/run")
async def pipeline_run(req: PipelineRequest):
    return StreamingResponse(
        _run_pipeline(req.steps),
        media_type="text/event-stream",
        headers={"cache-control": "no-cache", "x-accel-buffering": "no"},
    )
