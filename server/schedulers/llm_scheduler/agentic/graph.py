"""
LangGraph state machine for agentic code generation.
"""
from langgraph.graph import StateGraph, END
from typing import TypedDict
from schedulers.llm_scheduler.agentic.nodes import generate, extract, execute, should_retry


class CodeGenState(TypedDict, total=False):
    prompt:   str
    llm_name: str
    max:      int
    attempt:  int
    response: str
    code:     str
    output:   str
    error:    str
    passed:   bool
    history:  list


def build_graph():
    g = StateGraph(CodeGenState)

    g.add_node("generate", generate)
    g.add_node("extract",  extract)
    g.add_node("execute",  execute)

    g.set_entry_point("generate")
    g.add_edge("generate", "extract")
    g.add_edge("extract",  "execute")
    g.add_conditional_edges("execute", should_retry, {
        "retry": "generate",
        "done":  END,
    })

    return g.compile()


# module-level compiled graph
codegen_graph = build_graph()
