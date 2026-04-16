"""
PlannerAgent — breaks a high-level task into subtasks and spawns them as child echo tasks.
child_routing = "same"  → all subtasks use the same LLM as the planner
child_routing = "split" → subtasks are round-robined across all registered LLMs
aggregate     = True    → waits for all children to finish, then synthesises a final answer
"""
import time
from schedulers.llm_scheduler.agents.base import AgentBase
from schedulers.llm_scheduler import registry as llm_registry
from kernelroot.core import task_queue

SYSTEM_PROMPT = """You are a task planner. Given a high-level goal, break it into 2-4 concrete, self-contained subtasks.
Output ONLY a numbered list, one subtask per line. No explanations, no headers, no extra text.
Example:
1. Research the background of the topic
2. Write a summary of key points
3. List three practical applications"""

SYNTHESIS_PROMPT = """You are a helpful assistant. Below are the results of several subtasks completed to achieve a goal.
Synthesise them into a single coherent final answer. Be concise."""


class PlannerAgent(AgentBase):
    TOKEN_BUDGET = 512

    def run(self) -> str:
        # --- plan ---
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": self.prompt},
        ]
        response = self.call_llm(messages)

        subtasks = []
        for line in response.strip().split("\n"):
            line = line.strip()
            if line and line[0].isdigit() and "." in line:
                subtask = line.split(".", 1)[-1].strip()
                if subtask:
                    subtasks.append(subtask)

        # --- route ---
        if self.child_routing == "split":
            llm_names = list(llm_registry.load().keys())
        else:
            llm_names = [self.llm_name]

        spawned = []
        child_ids = []
        for i, subtask in enumerate(subtasks):
            llm = llm_names[i % len(llm_names)]
            child_id = self.spawn_task(subtask, agent_type="echo", llm=llm)
            child_ids.append(child_id)
            spawned.append(f"{child_id[:8]}→{llm}")

        spawn_summary = f"spawned {len(spawned)} subtasks: {', '.join(spawned)}"

        if not self.aggregate:
            return spawn_summary

        # --- aggregate ---
        deadline = time.time() + 180
        while time.time() < deadline:
            children = task_queue.get_children(self.task_id)
            if children and all(c["status"] in ("done", "failed") for c in children):
                break
            time.sleep(2)
        else:
            return f"{spawn_summary}\n[aggregate timed out after 180s]"

        results_text = "\n\n".join(
            f"Subtask: {c['prompt']}\nResult: {c.get('result') or c.get('error') or '(no result)'}"
            for c in children
        )
        synthesis_messages = [
            {"role": "system", "content": SYNTHESIS_PROMPT},
            {"role": "user", "content": f"Goal: {self.prompt}\n\nSubtask results:\n{results_text}"},
        ]
        synthesis = self.call_llm(synthesis_messages, max_tokens=self.token_budget)
        return f"[aggregated result]\n{synthesis}\n\n---\n{spawn_summary}"
