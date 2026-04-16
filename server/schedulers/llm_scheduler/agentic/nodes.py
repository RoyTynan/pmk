"""
LangGraph nodes for agentic code generation.
Each node receives the full state dict and returns a partial update.
"""
import re
import subprocess
import sys
from schedulers.llm_scheduler import registry as llm_registry
from schedulers.llm_scheduler.client import call_llm

SYSTEM_PROMPT = (
    "You are a Python programmer. "
    "ALWAYS respond with ONLY a Python code block. "
    "Format EXACTLY like this:\n"
    "```python\n"
    "# your code here\n"
    "print(result)\n"
    "```\n"
    "No explanation. No text outside the code block. The code must print its result."
)


def generate(state: dict) -> dict:
    """Call the LLM to generate or fix code."""
    llms     = llm_registry.load()
    llm      = llms.get(state["llm_name"], {})
    url      = llm.get("url", "")
    model    = llm.get("model", "")
    api_key  = llm.get("api_key", "")
    provider = llm.get("provider", "custom")

    history = state.get("history", [])
    if not history:
        # first attempt — initial prompt
        history = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user",   "content": state["prompt"]},
        ]
    else:
        # retry — append the error so the LLM can fix it
        history = history + [{
            "role": "user",
            "content": (
                f"That code produced an error:\n```\n{state['error']}\n```\n"
                "Please fix it and return the corrected code block only."
            ),
        }]

    response = call_llm(url, model, history, api_key, provider)

    return {
        "response": response,
        "history":  history + [{"role": "assistant", "content": response}],
        "attempt":  state.get("attempt", 0) + 1,
    }


def extract(state: dict) -> dict:
    """Pull the Python code block out of the LLM response."""
    response = state.get("response", "").strip()

    # 1. fenced code block
    match = re.search(r"```(?:python)?\n?(.*?)```", response, re.DOTALL)
    if match:
        return {"code": match.group(1).strip()}

    # 2. "expr = result" natural language answer e.g. "2 + 2 = 4"
    eq_match = re.match(r'^(.+?)\s*=\s*([\d\.]+)\s*$', response)
    if eq_match:
        return {"code": f"print({eq_match.group(2).strip()})"}

    # 3. bare number or pure math expression
    if re.match(r'^[\d\s\+\-\*/\(\)\.]+$', response):
        return {"code": f"print({response})"}

    # 4. give it as-is and let the executor report the error
    return {"code": response}


def execute(state: dict) -> dict:
    """Run the extracted code in a subprocess with a timeout."""
    code = state.get("code", "")
    try:
        result = subprocess.run(
            [sys.executable, "-c", code],
            capture_output=True,
            text=True,
            timeout=10,
        )
        return {
            "output": result.stdout.strip(),
            "error":  result.stderr.strip(),
            "passed": result.returncode == 0 and not result.stderr.strip(),
        }
    except subprocess.TimeoutExpired:
        return {"output": "", "error": "Execution timed out (10s)", "passed": False}
    except Exception as exc:
        return {"output": "", "error": str(exc), "passed": False}


def should_retry(state: dict) -> str:
    """Conditional edge: retry if failed and attempts remaining."""
    if state.get("passed"):
        return "done"
    if state.get("attempt", 0) >= state.get("max", 3):
        return "done"
    return "retry"
