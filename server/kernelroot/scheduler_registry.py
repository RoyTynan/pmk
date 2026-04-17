# Scheduler registry — shared between kernel.py and main.py.
# Built-in schedulers are defined here. User-created schedulers are appended
# by the Assistant when a new scheduler is generated.
# Do not edit the user-created section manually.

SCHEDULER_MAP: dict[str, str] = {
    "llm":        "schedulers.llm_scheduler.scheduler.LLMScheduler",
    "jsonparser": "schedulers.jsonparser_scheduler.scheduler.JsonParserScheduler",
    "test":  "schedulers.test_scheduler.scheduler.TestScheduler",
    # [ASSISTANT_SCHEDULERS]
}
