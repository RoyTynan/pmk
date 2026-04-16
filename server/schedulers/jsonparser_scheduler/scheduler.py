"""
JsonParserScheduler — pulls JSON parsing tasks from the queue and dispatches
them to handlers.

NAME and HANDLER_REGISTRY are read by the kernel to:
  - auto-generate REST API endpoints (POST /jsonparser/{operation})
  - determine which task agent_types this scheduler handles
"""
import time
import threading

from kernelroot.core import task_queue
from kernelroot.core.scheduler_base import SchedulerBase
from kernelroot.core.config import POLL_INTERVAL_SECONDS
from schedulers.jsonparser_scheduler.handlers.json_handler import JsonHandler

MAX_CONCURRENT = 4


class JsonParserScheduler(SchedulerBase):
    NAME = "jsonparser"
    HANDLER_REGISTRY = {
        "parse_json": {
            "handler":      JsonHandler,
            "description":  "Parse and validate JSON content. Returns structure, schema, size, and warnings.",
            "input_label":  "JSON content",
        },
    }

    def __init__(self):
        super().__init__()
        self._lock    = threading.Lock()
        self._running = 0

    def run(self):
        task_types = [f"jsonparser_{op}" for op in self.HANDLER_REGISTRY]
        print(f"[jsonparser-scheduler] started — handling: {', '.join(task_types)}")
        while not self._stop_event.is_set():
            with self._lock:
                if self._running < MAX_CONCURRENT:
                    task = task_queue.get_next_pending_for_types(task_types)
                    if task:
                        self._running += 1
                        t = threading.Thread(target=self._run_task, args=(task,), daemon=True)
                        t.start()
            self._sleep(POLL_INTERVAL_SECONDS)
        print("[jsonparser-scheduler] stopped")

    def _run_task(self, task: dict):
        task_id  = task["id"]
        short_id = task_id[:8]
        op = task["agent_type"].removeprefix("jsonparser_")
        t0 = time.time()
        ok = True
        err = None
        result = ""
        try:
            handler = self.HANDLER_REGISTRY[op]["handler"]()
            task_queue.mark_running(task_id)
            print(f"[jsonparser-scheduler] running {short_id} ({task['agent_type']})")
            result = handler.handle(task["prompt"])
            task_queue.mark_done(task_id, result)
            print(f"[jsonparser-scheduler] done    {short_id}")
        except Exception as e:
            ok = False
            err = str(e)
            task_queue.mark_failed(task_id, err)
            print(f"[jsonparser-scheduler] failed  {short_id}: {e}")
        finally:
            self.log_activity(
                operation=op,
                prompt_len=len(task.get("prompt", "")),
                result_len=len(result),
                duration_ms=int((time.time() - t0) * 1000),
                ok=ok,
                error=err,
            )
            with self._lock:
                self._running = max(0, self._running - 1)
