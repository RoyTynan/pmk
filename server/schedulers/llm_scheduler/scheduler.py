"""
LLMScheduler — pulls tasks from the queue and dispatches them to LLM agents.
Per-LLM concurrency: each LLM has its own slot counter so tasks on
different LLMs run in parallel without blocking each other.
Reloads the LLM registry on every poll so new LLMs are picked up live.

HANDLER_REGISTRY exposes echo and planner as direct kernel API endpoints.
Both require an LLM name in options (defaults to the configured DEFAULT_LLM).
"""
import time
import threading
import uuid

from schedhost.core import task_queue
from schedulers.llm_scheduler import registry as llm_registry
from schedhost.core.scheduler_base import SchedulerBase
from schedhost.core.handler_base import HandlerBase
from schedulers.llm_scheduler.agents.echo_agent import EchoAgent
from schedulers.llm_scheduler.agents.planner import PlannerAgent
from schedhost.core.config import POLL_INTERVAL_SECONDS
from schedulers.llm_scheduler.config import DEFAULT_LLM, LLM_SHORTCUTS


# ---------------------------------------------------------------------------
# Direct-call handler wrappers — used by the kernel API
# ---------------------------------------------------------------------------

class EchoHandler(HandlerBase):
    def handle(self, input: str, options: dict | None = None) -> str:
        llm = (options or {}).get("llm", DEFAULT_LLM)
        agent = EchoAgent(str(uuid.uuid4()), input, llm=llm)
        return agent.run()


class PlannerHandler(HandlerBase):
    def handle(self, input: str, options: dict | None = None) -> str:
        llm = (options or {}).get("llm", DEFAULT_LLM)
        agent = PlannerAgent(str(uuid.uuid4()), input, llm=llm)
        return agent.run()


# ---------------------------------------------------------------------------

class LLMScheduler(SchedulerBase):
    NAME = "llm"
    HANDLER_REGISTRY = {
        "echo": {
            "handler":      EchoHandler,
            "description":  "Send a prompt directly to an LLM and return the response.",
            "input_label":  "Prompt",
            "options":      {"llm": "LLM name from registry (uses default if omitted)"},
        },
        "planner": {
            "handler":      PlannerHandler,
            "description":  "Decompose a goal into subtasks via an LLM and execute them.",
            "input_label":  "Goal",
            "options":      {"llm": "LLM name from registry (uses default if omitted)"},
        },
    }

    # Queue-based agent registry — maps agent_type strings to agent classes
    AGENT_REGISTRY = {
        "echo":    EchoAgent,
        "planner": PlannerAgent,
    }

    def __init__(self):
        super().__init__()
        self._lock    = threading.Lock()
        self._running: dict[str, int] = {}

    def _sync_llms(self, llms: dict):
        for name in llms:
            if name not in self._running:
                self._running[name] = 0

    def run(self):
        print(f"[llm-scheduler] started — polling every {POLL_INTERVAL_SECONDS}s")
        while not self._stop_event.is_set():
            with self._lock:
                llms      = llm_registry.load()
                self._sync_llms(llms)
                available = self._available_llms(llms)
                task      = task_queue.get_next_pending_for_available_llm(
                    available, list(self.AGENT_REGISTRY.keys()),
                    shortcuts=LLM_SHORTCUTS, default_llm=DEFAULT_LLM,
                )
                if task:
                    llm, prompt = self._parse_llm(task["prompt"], task.get("target_llm"))
                    self._running[llm] += 1
                    t = threading.Thread(target=self._run_task, args=(task, llm, prompt), daemon=True)
                    t.start()
            self._sleep(POLL_INTERVAL_SECONDS)
        print("[llm-scheduler] stopped")

    def _available_llms(self, llms: dict) -> list[str]:
        return [
            name for name, cfg in llms.items()
            if self._running.get(name, 0) < cfg.get("max_tasks", 1)
        ]

    def _parse_llm(self, prompt: str, target_llm: str = None) -> tuple[str, str]:
        if target_llm:
            return target_llm, prompt
        first_word = prompt.split()[0].lower() if prompt.split() else ""
        if first_word in LLM_SHORTCUTS:
            return LLM_SHORTCUTS[first_word], prompt[len(first_word):].lstrip()
        return DEFAULT_LLM, prompt

    def _run_task(self, task: dict, llm: str, prompt: str):
        task_id  = task["id"]
        short_id = task_id[:8]
        try:
            agent_cls = self.AGENT_REGISTRY.get(task["agent_type"], EchoAgent)
            agent = agent_cls(task_id, prompt, llm=llm,
                              child_routing=task.get("child_routing") or "same",
                              aggregate=bool(task.get("aggregate")))
            input_est = agent.estimate_input_tokens([{"role": "user", "content": prompt}])
            task_queue.mark_running(task_id, llm=llm, token_budget=agent.token_budget,
                                    input_tokens_est=input_est)
            print(f"[llm-scheduler] running {short_id} ({task['agent_type']}) [{llm}] "
                  f"[in:~{input_est} out:{agent.token_budget}]: {prompt[:60]}")
            result = agent.run()
            task_queue.mark_done(task_id, result)
            print(f"[llm-scheduler] done    {short_id}: {result[:80]}")
        except Exception as e:
            task_queue.mark_failed(task_id, str(e))
            print(f"[llm-scheduler] failed  {short_id}: {e}")
        finally:
            with self._lock:
                self._running[llm] = max(0, self._running.get(llm, 1) - 1)
