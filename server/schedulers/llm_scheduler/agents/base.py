"""
Base class for all LLM agents.
Handles LLM calls — subclasses implement run() and declare TOKEN_BUDGET.
The kernel enforces TOKEN_BUDGET_CEILING as a hard cap on all agents.
Agents can spawn child tasks via spawn_task() for IPC.
"""
import time
from kernelroot.core.config import DEFAULT_LLM, DEFAULT_MAX_TOKENS, TOKEN_BUDGET_CEILING
from kernelroot.core import activity_log
from schedulers.llm_scheduler import registry as llm_registry
from schedulers.llm_scheduler.client import call_llm as _call_llm


class AgentBase:
    TOKEN_BUDGET = DEFAULT_MAX_TOKENS  # subclasses override this

    def __init__(self, task_id: str, prompt: str, llm: str = DEFAULT_LLM, child_routing: str = "same", aggregate: bool = False):
        self.task_id = task_id
        self.prompt = prompt
        self.llm_name = llm
        self.child_routing = child_routing
        self.aggregate = aggregate
        llms = llm_registry.load()
        self.llm = llms.get(llm) or llms.get(DEFAULT_LLM)
        self.token_budget = min(self.TOKEN_BUDGET, TOKEN_BUDGET_CEILING)

    def spawn_task(self, prompt: str, agent_type: str = "echo", llm: str = None) -> str:
        """Spawn a child task. Returns the new task ID."""
        from kernelroot.core import task_queue
        return task_queue.add_task(
            prompt=prompt,
            agent_type=agent_type,
            target_llm=llm or self.llm_name,
            parent_id=self.task_id,
        )

    @staticmethod
    def estimate_input_tokens(messages: list[dict]) -> int:
        total_chars = sum(len(m.get("content", "")) for m in messages)
        return max(1, round(total_chars / 4))

    def call_llm(self, messages: list[dict], max_tokens: int = None) -> str:
        prompt_len = sum(len(m.get("content", "")) for m in messages)
        t0 = time.time()
        ok, error, result = True, None, ""
        try:
            result = _call_llm(
                url=self.llm["url"],
                model=self.llm["model"],
                messages=messages,
                api_key=self.llm.get("api_key", ""),
                provider=self.llm.get("provider", "custom"),
                max_tokens=max_tokens or self.token_budget,
            )
            return result
        except Exception as exc:
            ok, error = False, str(exc)
            raise
        finally:
            activity_log.log(
                llm=self.llm_name,
                model=self.llm.get("model", ""),
                provider=self.llm.get("provider", "custom"),
                source="queue",
                prompt_len=prompt_len,
                result_len=len(result),
                duration_ms=int((time.time() - t0) * 1000),
                ok=ok,
                error=error,
            )

    def run(self) -> str:
        raise NotImplementedError
