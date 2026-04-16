"""
EchoAgent — simplest possible agent.
Takes a prompt, sends it to the LLM, returns the result.
No RAG, no ChromaDB. Used to verify the OS loop end-to-end.
"""
from schedulers.llm_scheduler.agents.base import AgentBase


class EchoAgent(AgentBase):
    TOKEN_BUDGET = 512  # simple Q&A — no need for long responses

    def run(self) -> str:
        messages = [{"role": "user", "content": self.prompt}]
        return self.call_llm(messages)
