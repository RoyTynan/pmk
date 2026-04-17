"""
Test scheduler router — FastAPI routes backed by test.db.
Modify or extend these routes as your scheduler evolves.
"""
from fastapi import APIRouter
from pydantic import BaseModel

from schedulers.test_scheduler import db as scheduler_db
from schedulers.test_scheduler.handlers.string_handlers import (
    RemoveAlternateWordsHandler,
    AddWordHandler,
    DeleteWordHandler,
)

router = APIRouter(prefix="/test", tags=["test"])

_HANDLERS = {
    "remove_alternate": RemoveAlternateWordsHandler,
    "add_word":         AddWordHandler,
    "delete_word":      DeleteWordHandler,
}


class ProcessRequest(BaseModel):
    operation: str   # remove_alternate | add_word | delete_word
    input:     str
    options:   dict = {}


@router.get("/results", summary="List all results")
def list_results():
    return scheduler_db.list_results()


@router.post("/process", summary="Process a string")
def process(req: ProcessRequest):
    if req.operation not in _HANDLERS:
        return {"ok": False, "error": f"Unknown operation '{req.operation}'. Valid: {list(_HANDLERS)}"}
    result = _HANDLERS[req.operation]().handle(req.input, req.options)
    row_id = scheduler_db.save_result(req.operation, req.input, result)
    return {"ok": True, "id": row_id, "result": result}


@router.delete("/results/{id}", summary="Delete a result")
def delete_result(id: str):
    scheduler_db.delete_result(id)
    return {"ok": True}
