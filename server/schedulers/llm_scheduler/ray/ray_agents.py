"""
Ray remote tasks for LLM inference.
Wraps the existing llm client so agent logic is shared but execution is Ray-managed.
Completely isolated from the existing scheduler and task queue.
"""
import ray
from schedulers.llm_scheduler.client import call_llm
from schedulers.llm_scheduler import registry as llm_registry  # also provides get_api_key


@ray.remote
def run_task(prompt: str, llm_name: str) -> dict:
    """
    A Ray remote task — runs in a Ray worker process.
    Looks up the LLM from the registry and calls it directly.
    Returns a result dict.
    """
    llms = llm_registry.load()
    llm  = llms.get(llm_name)
    if not llm:
        return {"ok": False, "error": f"LLM '{llm_name}' not found in registry", "result": ""}

    messages = [{"role": "user", "content": prompt}]
    try:
        provider = llm.get("provider", "custom")
        result = call_llm(
            url=llm["url"],
            model=llm["model"],
            messages=messages,
            api_key=llm_registry.get_api_key(provider),
            provider=provider,
            max_tokens=2048,
        )
        return {"ok": True, "result": result, "error": ""}
    except Exception as exc:
        return {"ok": False, "result": "", "error": str(exc)}
