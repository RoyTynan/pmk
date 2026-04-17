"""
cli.py — command-line interface for submitting and inspecting tasks.

Usage:
    python cli.py submit <prompt>
    python cli.py submit --agent echo <prompt>
    python cli.py status
    python cli.py result <task_id_or_prefix>
"""
import sys
from schedhost.core import task_queue


def cmd_submit(args: list[str]):
    agent_type = "echo"
    if args and args[0] == "--agent":
        agent_type = args[1]
        args = args[2:]
    prompt = " ".join(args)
    if not prompt:
        print("Usage: python cli.py submit [--agent <type>] <prompt>")
        sys.exit(1)
    task_id = task_queue.add_task(prompt, agent_type=agent_type)
    print(f"submitted  {task_id}")


def cmd_status():
    tasks = task_queue.list_tasks()
    if not tasks:
        print("no tasks")
        return
    print(f"{'ID':10}  {'STATUS':10}  {'AGENT':8}  PROMPT")
    print("-" * 70)
    for t in tasks:
        print(f"{t['id'][:8]:10}  {t['status']:10}  {t['agent_type']:8}  {t['prompt'][:45]}")


def cmd_result(args: list[str]):
    if not args:
        print("Usage: python cli.py result <task_id_or_prefix>")
        sys.exit(1)
    prefix = args[0]
    # Support short ID prefix
    all_tasks = task_queue.list_tasks()
    matches = [t for t in all_tasks if t["id"].startswith(prefix)]
    if not matches:
        print(f"no task found matching '{prefix}'")
        sys.exit(1)
    task = matches[0]
    status = task["status"]
    if status == "done":
        print(task["result"])
    elif status == "failed":
        print(f"[failed] {task['error']}")
    elif status == "running":
        print(f"[running] task is in progress")
    else:
        print(f"[{status}] task not yet started")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)

    cmd = sys.argv[1]
    rest = sys.argv[2:]

    if cmd == "submit":
        cmd_submit(rest)
    elif cmd == "status":
        cmd_status()
    elif cmd == "result":
        cmd_result(rest)
    else:
        print(f"unknown command: {cmd}")
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
