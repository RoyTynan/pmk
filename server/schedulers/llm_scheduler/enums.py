"""
enums.py — LLM scheduler enumerations.
Run `python enums.py` from the server/ directory to regenerate
frontend/src/lib/enums.ts whenever values change.
"""
from enum import Enum


class LLMType(str, Enum):
    LOCAL  = "local"   # llama.cpp process managed by the monitor
    REMOTE = "remote"  # self-hosted or custom OpenAI-compatible endpoint
    CLOUD  = "cloud"   # managed cloud provider (Anthropic, OpenAI, etc.)


# ---------------------------------------------------------------------------
# Code generation — produces frontend/src/lib/enums.ts
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import os

    enums = [LLMType]
    lines = [
        "// AUTO-GENERATED — do not edit by hand.",
        "// Source of truth: server/schedulers/llm_scheduler/enums.py",
        "// Regenerate: cd server && python schedulers/llm_scheduler/enums.py",
        "",
    ]

    for enum_cls in enums:
        lines.append(f"export enum {enum_cls.__name__} {{")
        for member in enum_cls:
            lines.append(f'  {member.name:<8} = "{member.value}",')
        lines.append("}")
        lines.append("")

    # server/schedulers/llm_scheduler/enums.py → go up 3 levels to repo root
    repo_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    out_path = os.path.join(repo_dir, "frontend", "src", "lib", "enums.ts")
    with open(out_path, "w") as f:
        f.write("\n".join(lines))
    print(f"Written: {out_path}")
