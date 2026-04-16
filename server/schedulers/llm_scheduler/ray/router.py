"""
FastAPI router for the Ray execution path.
Mounted at /ray in main.py — completely isolated from the existing task queue.
"""
import json
import os
import uuid
import asyncio
import ray
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from schedulers.llm_scheduler.ray.ray_agents import run_task

router = APIRouter()

# Suppress Ray's verbose shutdown output and C++ SIGTERM messages.
# Ray worker processes inherit fd 2 (stderr) at fork time, so redirecting
# stderr to /dev/null before ray.init() means workers will write their
# C++ SIGTERM crash output to /dev/null instead of the terminal.
os.environ.setdefault("RAY_LOG_TO_STDERR", "0")

if not ray.is_initialized():
    _saved_stderr = os.dup(2)
    _devnull      = os.open(os.devnull, os.O_WRONLY)
    os.dup2(_devnull, 2)
    os.close(_devnull)
    try:
        ray.init(ignore_reinit_error=True, log_to_driver=False)
    finally:
        os.dup2(_saved_stderr, 2)
        os.close(_saved_stderr)


class RayTaskRequest(BaseModel):
    prompt:   str
    llm_name: str


class RayBatchRequest(BaseModel):
    tasks: list[RayTaskRequest]


class PipelineStep(BaseModel):
    prompt_template: str   # use {input} to reference previous step's output
    llm_name: str


class PipelineRequest(BaseModel):
    initial_input: str
    steps: list[PipelineStep]


@router.get("/status")
def ray_status():
    """Return Ray cluster info."""
    try:
        resources = ray.available_resources()
        nodes     = len(ray.nodes())
        return {"ok": True, "nodes": nodes, "resources": resources}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.post("/run")
async def ray_run(req: RayTaskRequest):
    """
    Submit a single task to Ray and stream the result back as SSE.
    """
    task_id = str(uuid.uuid4())[:8]

    async def stream():
        yield f"data: {json.dumps({'task_id': task_id, 'status': 'running'})}\n\n"
        try:
            ref = run_task.remote(req.prompt, req.llm_name)
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, ray.get, ref)
            if result["ok"]:
                yield f"data: {json.dumps({'task_id': task_id, 'status': 'done', 'result': result['result']})}\n\n"
            else:
                yield f"data: {json.dumps({'task_id': task_id, 'status': 'failed', 'error': result['error']})}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'task_id': task_id, 'status': 'failed', 'error': str(exc)})}\n\n"
        yield f"data: {json.dumps({'done': True})}\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"cache-control": "no-cache", "x-accel-buffering": "no"},
    )


@router.post("/batch")
async def ray_batch(req: RayBatchRequest):
    """
    Submit multiple tasks to Ray in parallel and stream results as they complete.
    All tasks are dispatched simultaneously — Ray schedules them across workers.
    """
    async def stream():
        yield f"data: {json.dumps({'status': 'dispatching', 'count': len(req.tasks)})}\n\n"

        # dispatch all tasks at once — Ray runs them in parallel
        refs = [
            (str(uuid.uuid4())[:8], t.llm_name, run_task.remote(t.prompt, t.llm_name))
            for t in req.tasks
        ]

        loop = asyncio.get_event_loop()

        # emit running events and build a ref→metadata lookup
        ref_meta = {}
        for task_id, llm, ref in refs:
            ref_meta[ref] = (task_id, llm)
            yield f"data: {json.dumps({'task_id': task_id, 'llm': llm, 'status': 'running'})}\n\n"

        # collect results as they complete using ray.wait
        remaining = [ref for _, _, ref in refs]
        while remaining:
            done, remaining = await loop.run_in_executor(
                None, lambda r=remaining: ray.wait(r, num_returns=1, timeout=None)
            )
            for ref in done:
                task_id, llm = ref_meta[ref]
                try:
                    result = await loop.run_in_executor(None, ray.get, ref)
                    if result["ok"]:
                        yield f"data: {json.dumps({'task_id': task_id, 'llm': llm, 'status': 'done', 'result': result['result']})}\n\n"
                    else:
                        yield f"data: {json.dumps({'task_id': task_id, 'llm': llm, 'status': 'failed', 'error': result['error']})}\n\n"
                except Exception as exc:
                    yield f"data: {json.dumps({'task_id': task_id, 'llm': llm, 'status': 'failed', 'error': str(exc)})}\n\n"

        yield f"data: {json.dumps({'done': True})}\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"cache-control": "no-cache", "x-accel-buffering": "no"},
    )


@router.post("/pipeline")
async def ray_pipeline(req: PipelineRequest):
    """
    Run steps sequentially — each step's output becomes {input} for the next.
    Steps can use different LLMs. Pipeline aborts on first failure.
    Streams each step's status in real time via SSE.
    """
    async def stream():
        current = req.initial_input
        loop    = asyncio.get_event_loop()

        for i, step in enumerate(req.steps):
            task_id = str(uuid.uuid4())[:8]
            prompt  = step.prompt_template.replace("{input}", current)
            yield f"data: {json.dumps({'step': i, 'task_id': task_id, 'llm': step.llm_name, 'status': 'running', 'prompt': prompt})}\n\n"
            try:
                ref    = run_task.remote(prompt, step.llm_name)
                result = await loop.run_in_executor(None, ray.get, ref)
                if result["ok"]:
                    current = result["result"]
                    yield f"data: {json.dumps({'step': i, 'task_id': task_id, 'llm': step.llm_name, 'status': 'done', 'result': current})}\n\n"
                else:
                    yield f"data: {json.dumps({'step': i, 'task_id': task_id, 'llm': step.llm_name, 'status': 'failed', 'error': result['error']})}\n\n"
                    break
            except Exception as exc:
                yield f"data: {json.dumps({'step': i, 'task_id': task_id, 'llm': step.llm_name, 'status': 'failed', 'error': str(exc)})}\n\n"
                break

        yield f"data: {json.dumps({'done': True})}\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"cache-control": "no-cache", "x-accel-buffering": "no"},
    )
