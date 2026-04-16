"""
SchedulerBase — abstract base for all schedulers.

A scheduler pulls tasks of specific types from the shared queue and dispatches
them to handlers. The kernel loads one or more schedulers at startup and runs
each in its own thread.

Class-level declarations on each subclass:
    NAME             — identifier used as the URL prefix in the kernel API
                       e.g. NAME = "jsonparser" → POST /jsonparser/parse_json
    HANDLER_REGISTRY — maps operation names to handler metadata dicts:
                       {
                           "operation_name": {
                               "handler":     HandlerClass,
                               "description": "What this operation does",
                               "input_label": "Human label for the input field",
                               "options":     {"key": "description"},  # optional
                           }
                       }
                       Operations listed here are automatically exposed as
                       kernel API endpoints AND used for queue-based dispatch.

To create a new scheduler:
    1. Subclass SchedulerBase
    2. Set NAME and HANDLER_REGISTRY
    3. Implement run() — a blocking loop that never returns
    4. Register it in kernel.py's SCHEDULER_MAP
"""


import threading


class SchedulerBase:
    NAME: str = ""
    HANDLER_REGISTRY: dict = {}

    def __init_subclass__(cls, **kwargs):
        super().__init_subclass__(**kwargs)

    def __init__(self):
        self._stop_event = threading.Event()

    def stop(self):
        """Signal the scheduler's run() loop to exit cleanly."""
        self._stop_event.set()

    def _sleep(self, seconds: float):
        """Interruptible sleep — returns early if stop() is called."""
        self._stop_event.wait(timeout=seconds)

    def log_activity(self, operation: str, prompt_len: int = 0, result_len: int = 0,
                     duration_ms: int = 0, ok: bool = True, error: str = None,
                     source: str = "queue"):
        """Record a kernel activity entry for this scheduler operation.
        Call from _run_task() finally block to ensure every dispatch is logged.
        """
        try:
            from kernelroot.core import activity_log
            activity_log.log(
                llm=f"{self.NAME}/{operation}",
                model=operation,
                provider=self.NAME,
                source=source,
                prompt_len=prompt_len,
                result_len=result_len,
                duration_ms=duration_ms,
                ok=ok,
                error=error,
            )
        except Exception:
            pass  # never crash the caller

    def run(self):
        raise NotImplementedError(f"{self.__class__.__name__} must implement run()")
