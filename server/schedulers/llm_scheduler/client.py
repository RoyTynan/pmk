"""
Unified LLM caller — handles OpenAI-compatible and Anthropic APIs.
Used by agent_base (sync) and the pipeline runner (async).

URL convention matches the OpenAI SDK standard — store the base URL including /v1:
  OpenAI-compatible: http://192.168.1.99:8080/v1   →  appends /chat/completions
  Anthropic:         https://api.anthropic.com/v1   →  appends /messages
"""
import httpx

ANTHROPIC_VERSION = "2023-06-01"


def _anthropic_headers(api_key: str) -> dict:
    return {
        "x-api-key": api_key,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
    }


def _anthropic_body(model: str, messages: list[dict], max_tokens: int) -> dict:
    """Extract optional system message; Anthropic puts it at top level."""
    system = None
    filtered = []
    for m in messages:
        if m["role"] == "system":
            system = m["content"]
        else:
            filtered.append(m)
    body: dict = {"model": model, "messages": filtered, "max_tokens": max_tokens}
    if system:
        body["system"] = system
    return body


def _openai_headers(api_key: str) -> dict:
    return {"Authorization": f"Bearer {api_key}"} if api_key else {}


# ---------------------------------------------------------------------------
# Sync — used by AgentBase.call_llm
# ---------------------------------------------------------------------------

def call_llm(url: str, model: str, messages: list[dict],
             api_key: str = '', provider: str = 'custom',
             max_tokens: int = 2048) -> str:
    base = url.rstrip('/')
    if provider == 'anthropic':
        resp = httpx.post(
            f"{base}/messages",
            json=_anthropic_body(model, messages, max_tokens),
            headers=_anthropic_headers(api_key),
            timeout=120.0,
        )
        resp.raise_for_status()
        return resp.json()["content"][0]["text"]
    else:
        resp = httpx.post(
            f"{base}/chat/completions",
            json={"model": model, "messages": messages, "max_tokens": max_tokens},
            headers=_openai_headers(api_key),
            timeout=120.0,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]


# ---------------------------------------------------------------------------
# Async — used by pipeline runner
# ---------------------------------------------------------------------------

async def acall_llm(url: str, model: str, messages: list[dict],
                    api_key: str = '', provider: str = 'custom',
                    max_tokens: int = 2048) -> str:
    base = url.rstrip('/')
    async with httpx.AsyncClient(timeout=120.0) as client:
        if provider == 'anthropic':
            resp = await client.post(
                f"{base}/messages",
                json=_anthropic_body(model, messages, max_tokens),
                headers=_anthropic_headers(api_key),
            )
            resp.raise_for_status()
            return resp.json()["content"][0]["text"]
        else:
            resp = await client.post(
                f"{base}/chat/completions",
                json={"model": model, "messages": messages, "max_tokens": max_tokens},
                headers=_openai_headers(api_key),
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]
