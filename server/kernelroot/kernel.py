"""
kernel.py — entry point for the PMK task processing engine.

Loads one or more schedulers, runs each in its own thread, and starts a
FastAPI HTTP server that auto-generates endpoints from each scheduler's
HANDLER_REGISTRY. No manual router code is needed — adding a scheduler
with a populated HANDLER_REGISTRY automatically creates public API routes.

Scheduler selection:
    KERNEL_SCHEDULERS=llm,file   (comma-separated, default: llm,file)

Kernel API port:
    KERNEL_PORT=8002             (default: 8002)

Built-in scheduler names:
    llm    — LLMScheduler  (LLM agents)
    jsonparser — JsonParserScheduler (JSON parsing handlers)

Custom schedulers can be loaded by dotted class path:
    KERNEL_SCHEDULERS=mypackage.mymodule.MyScheduler
"""
import importlib
import os
import threading
import uuid

import uvicorn
from fastapi import FastAPI
from pydantic import BaseModel

from kernelroot.core import task_queue
from kernelroot.core.config import TASKS_DB_PATH
from kernelroot.scheduler_registry import SCHEDULER_MAP

task_queue.init(TASKS_DB_PATH)

KERNEL_PORT = int(os.environ.get("KERNEL_PORT", 8002))


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class KernelRequest(BaseModel):
    input:   str  = ""
    options: dict = {}


# ---------------------------------------------------------------------------
# Loader
# ---------------------------------------------------------------------------

def _load_scheduler_cls(name: str):
    dotted = SCHEDULER_MAP.get(name.strip(), name.strip())
    module_path, class_name = dotted.rsplit(".", 1)
    module = importlib.import_module(module_path)
    return getattr(module, class_name)


# ---------------------------------------------------------------------------
# Kernel API — auto-generated from scheduler HANDLER_REGISTRY entries
# ---------------------------------------------------------------------------

def _build_kernel_api(loaded: dict, instances: dict) -> FastAPI:
    """Build a FastAPI app with one route per handler in each scheduler."""

    api = FastAPI(
        title="Kernel API",
        description="Auto-generated endpoints from loaded scheduler handler registries.",
    )

    # index — list all schedulers and their operations
    registry_snapshot = {
        name: {
            op: {k: v for k, v in meta.items() if k != "handler"}
            for op, meta in cls.HANDLER_REGISTRY.items()
        }
        for name, cls in loaded.items()
        if cls.HANDLER_REGISTRY
    }

    @api.get("/", summary="List all kernel operations")
    def index():
        return {
            "schedulers": registry_snapshot,
            "port":       KERNEL_PORT,
        }

    @api.post("/schedulers/{name}/stop", summary="Stop a running scheduler")
    def stop_scheduler(name: str):
        instance = instances.get(name)
        if not instance:
            return {"ok": False, "error": f'"{name}" not found'}
        instance.stop()
        instances.pop(name, None)
        return {"ok": True, "stopped": name}

    class StartRequest(BaseModel):
        dotted: str  # e.g. "schedulers.llm_scheduler.scheduler.LLMScheduler"

    @api.post("/schedulers/{name}/start", summary="Start a scheduler thread")
    def start_scheduler(name: str, req: StartRequest):
        if name in instances:
            return {"ok": False, "error": f'"{name}" is already running'}
        try:
            mod_path, cls_name = req.dotted.rsplit(".", 1)
            mod = importlib.import_module(mod_path)
            cls = getattr(mod, cls_name)
            instance = cls()
            instances[name] = instance
            t = threading.Thread(target=instance.run, daemon=True, name=f"scheduler-{name}")
            t.start()
            return {"ok": True, "started": name}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # one POST route per operation per scheduler
    def _make_route(handler_cls, sched_name: str, op_name: str):
        async def route(body: KernelRequest):
            try:
                handler = handler_cls()
                result  = handler.handle(body.input, body.options or {})
                return {"ok": True, "result": result,
                        "scheduler": sched_name, "operation": op_name}
            except Exception as e:
                return {"ok": False, "error": str(e),
                        "scheduler": sched_name, "operation": op_name}
        route.__name__ = f"{sched_name}_{op_name}"
        return route

    for sched_name, sched_cls in loaded.items():
        for op_name, meta in sched_cls.HANDLER_REGISTRY.items():
            handler_cls = meta["handler"]
            api.add_api_route(
                path=f"/{sched_name}/{op_name}",
                endpoint=_make_route(handler_cls, sched_name, op_name),
                methods=["POST"],
                summary=meta.get("description", ""),
            )

    return api


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    recovered = task_queue.requeue_stuck_tasks()
    if recovered:
        print(f"[kernel] recovered {recovered} stuck task(s) from previous run")

    names = [n.strip() for n in
             os.environ.get("KERNEL_SCHEDULERS", "llm,jsonparser").split(",") if n.strip()]

    loaded: dict    = {}   # name → class
    instances: dict = {}   # name → instance (for stop())
    scheduler_threads = []

    for name in names:
        cls = _load_scheduler_cls(name)
        loaded[name] = cls
        scheduler = cls()
        instances[name] = scheduler
        print(f"[kernel] starting {name} scheduler ({cls.__name__})")
        t = threading.Thread(target=scheduler.run, daemon=True, name=f"scheduler-{name}")
        t.start()
        scheduler_threads.append(t)

    # Build and start the kernel API server
    kernel_api = _build_kernel_api(loaded, instances)
    print(f"[kernel] API server starting on port {KERNEL_PORT}")
    api_thread = threading.Thread(
        target=lambda: uvicorn.run(kernel_api, host="0.0.0.0", port=KERNEL_PORT, log_level="warning"),
        daemon=True,
        name="kernel-api",
    )
    api_thread.start()

    try:
        for t in scheduler_threads:
            t.join()
    except KeyboardInterrupt:
        print("\n[kernel] shutting down")
