"""
FastAPI router for the Analyse tab.
Mounted at /analyse in main.py.
Reuses run_task from ray — no new LLM code needed.
Each prompt is sent to Ray with the user's data injected as context.
"""
import json
import uuid
import asyncio
import ray
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from schedulers.llm_scheduler.ray.ray_agents import run_task

router = APIRouter()

if not ray.is_initialized():
    ray.init(ignore_reinit_error=True)


class AnalysePrompt(BaseModel):
    text:     str
    llm_name: str


class AnalyseRequest(BaseModel):
    data:    str               # raw JSON (or any text) pasted by the user
    prompts: list[AnalysePrompt]


@router.post("/run")
async def analyse_run(req: AnalyseRequest):
    """
    Dispatch all prompts in parallel via Ray.
    Each prompt has the full data block appended as context.
    Results are streamed back as SSE as they complete.
    """
    async def stream():
        loop = asyncio.get_event_loop()

        # Build (task_id, prompt_text, llm, ray_ref) tuples — all dispatched at once
        tasks = []
        for p in req.prompts:
            task_id    = str(uuid.uuid4())[:8]
            full_prompt = f"{p.text}\n\nUse the following data to answer:\n{req.data}"
            ref        = run_task.remote(full_prompt, p.llm_name)
            tasks.append((task_id, p.text, p.llm_name, ref))

        # Notify frontend that every task is now running, build ref lookup
        ref_meta = {}
        for task_id, text, llm, ref in tasks:
            ref_meta[ref] = (task_id, text, llm)
            yield f"data: {json.dumps({'task_id': task_id, 'prompt': text, 'llm': llm, 'status': 'running'})}\n\n"

        # Collect results as they complete — fastest first
        remaining = [ref for _, _, _, ref in tasks]
        while remaining:
            done, remaining = await loop.run_in_executor(
                None, lambda r=remaining: ray.wait(r, num_returns=1, timeout=None)
            )
            for ref in done:
                task_id, text, llm = ref_meta[ref]
                try:
                    result = await loop.run_in_executor(None, ray.get, ref)
                    if result["ok"]:
                        yield f"data: {json.dumps({'task_id': task_id, 'prompt': text, 'llm': llm, 'status': 'done', 'result': result['result']})}\n\n"
                    else:
                        yield f"data: {json.dumps({'task_id': task_id, 'prompt': text, 'llm': llm, 'status': 'failed', 'error': result['error']})}\n\n"
                except Exception as exc:
                    yield f"data: {json.dumps({'task_id': task_id, 'prompt': text, 'llm': llm, 'status': 'failed', 'error': str(exc)})}\n\n"

        yield f"data: {json.dumps({'done': True})}\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"cache-control": "no-cache", "x-accel-buffering": "no"},
    )
