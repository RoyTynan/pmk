"""
FastAPI router for agentic trace history.
Mounted at /traces in main.py.
"""
from fastapi import APIRouter
from schedulers.llm_scheduler.traces import store

router = APIRouter()


@router.get("")
def list_traces(limit: int = 50, offset: int = 0):
    return {
        "traces": store.get_traces(limit, offset),
        "total":  store.get_count(),
    }


@router.get("/{trace_id}")
def get_trace(trace_id: str):
    trace = store.get_trace(trace_id)
    if not trace:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="trace not found")
    return trace


@router.delete("")
def clear_traces():
    store.clear_traces()
    return {"ok": True}
