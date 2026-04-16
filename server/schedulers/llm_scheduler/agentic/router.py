"""
FastAPI router for agentic code generation.
Mounted at /agentic in main.py.
Streams SSE events as the graph iterates.
Records a trace to SQLite after each run.
"""
import json
import time
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from schedulers.llm_scheduler.agentic.graph import codegen_graph
from schedulers.llm_scheduler.traces import store as trace_store

router = APIRouter()


class CodeGenRequest(BaseModel):
    prompt:   str
    llm_name: str
    max:      int = 3


async def _stream_codegen(req: CodeGenRequest):
    state: dict = {
        "prompt":   req.prompt,
        "llm_name": req.llm_name,
        "max":      req.max,
        "attempt":  0,
        "history":  [],
    }

    run_start = time.monotonic()
    current   = {}
    passed    = False

    try:
        for chunk in codegen_graph.stream(state, stream_mode="updates"):
            for node_name, node_update in chunk.items():
                state = {**state, **node_update}

                if node_name == "generate":
                    attempt = state.get("attempt", 1)
                    current = {
                        "attempt":     attempt,
                        "generate_ms": 0,
                        "extract_ms":  0,
                        "execute_ms":  0,
                        "code":        "",
                        "output":      "",
                        "error":       "",
                        "passed":      False,
                        "_t":          time.monotonic(),
                    }
                    yield f"data: {json.dumps({'attempt': attempt, 'status': 'generating'})}\n\n"
                    current["generate_ms"] = int((time.monotonic() - current["_t"]) * 1000)

                elif node_name == "extract":
                    t = time.monotonic()
                    current["code"] = state.get("code", "")
                    yield f"data: {json.dumps({'attempt': state.get('attempt', 1), 'status': 'executing', 'code': current['code']})}\n\n"
                    current["extract_ms"] = int((time.monotonic() - t) * 1000)

                elif node_name == "execute":
                    t = time.monotonic()
                    attempt = state.get("attempt", 1)
                    passed  = bool(state.get("passed"))
                    current["output"]     = state.get("output", "")
                    current["error"]      = state.get("error", "")
                    current["passed"]     = passed
                    current["execute_ms"] = int((time.monotonic() - t) * 1000)
                    rec = {k: v for k, v in current.items() if k != "_t"}
                    current = {}

                    # Save each attempt immediately as its own trace row
                    duration_ms = int((time.monotonic() - run_start) * 1000)
                    try:
                        trace_store.save_trace(
                            llm_name      = req.llm_name,
                            prompt        = req.prompt,
                            passed        = passed,
                            attempt_count = 1,
                            duration_ms   = duration_ms,
                            attempts      = [rec],
                        )
                        print(f"[traces] saved attempt {attempt} passed={passed}")
                    except Exception as e:
                        print(f"[traces] save failed: {e}")

                    if passed:
                        yield f"data: {json.dumps({'attempt': attempt, 'status': 'passed', 'code': state.get('code', ''), 'output': state.get('output', '')})}\n\n"
                    else:
                        yield f"data: {json.dumps({'attempt': attempt, 'status': 'failed', 'code': state.get('code', ''), 'error': state.get('error', '')})}\n\n"

    except Exception as exc:
        print(f"[traces] graph error: {exc}")
        passed = False
        if current:
            current.setdefault("error", str(exc))
            rec = {k: v for k, v in current.items() if k != "_t"}
            try:
                trace_store.save_trace(
                    llm_name      = req.llm_name,
                    prompt        = req.prompt,
                    passed        = False,
                    attempt_count = 1,
                    duration_ms   = int((time.monotonic() - run_start) * 1000),
                    attempts      = [rec],
                )
            except Exception as e:
                print(f"[traces] save failed: {e}")

    yield f"data: {json.dumps({'done': True, 'passed': passed, 'code': state.get('code', ''), 'output': state.get('output', ''), 'attempt': state.get('attempt', 1)})}\n\n"


@router.post("/run")
async def run_codegen(req: CodeGenRequest):
    return StreamingResponse(
        _stream_codegen(req),
        media_type="text/event-stream",
        headers={"cache-control": "no-cache", "x-accel-buffering": "no"},
    )
