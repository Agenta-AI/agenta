# /// script
# requires-python = ">=3.11"
# dependencies = ["anthropic>=0.40", "httpx>=0.27"]
# ///
"""Run the task suite against one model with one instruction document.

Usage:
    uv run run.py --model haiku --instructions v1 --n 5 --out results/haiku-v1.jsonl
"""

import argparse
import copy
import json
import os
import pathlib
import random
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional, Tuple

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))

import harness  # noqa: E402
import tasks as T  # noqa: E402

MAX_ATTEMPTS = 3  # the first call plus two retries

SYSTEM = (
    "You are an agent that can edit your own configuration. The user asks for a change. "
    "Make exactly the change they ask for, and nothing else, by calling the "
    f"{harness.TOOL_NAME} tool. Do not ask questions. Do not explain first; call the tool."
)

MODELS = {
    "haiku": {
        "provider": "anthropic",
        "id": "claude-haiku-4-5-20251001",
    },
    "deepseek": {
        "provider": "openrouter",
        "id": "deepseek/deepseek-v4-flash",
    },
}


def load_env() -> None:
    path = pathlib.Path.home() / ".agenta-qa-secrets.env"
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.replace("export ", "").strip()
        value = value.strip().strip('"').strip("'")
        if value and key not in os.environ:
            os.environ[key] = value


# --------------------------------------------------------------------------------------
# Providers
# --------------------------------------------------------------------------------------


class Anthropic:
    def __init__(self, model_id: str, instructions: str, schema: Dict[str, Any]):
        import anthropic

        self.client = anthropic.Anthropic(timeout=180.0, max_retries=10)
        self.model_id = model_id
        self.tools = [
            {
                "name": harness.TOOL_NAME,
                "description": instructions,
                "input_schema": schema,
            }
        ]

    def call(self, messages: List[Dict[str, Any]]) -> Tuple[Any, Dict[str, Any]]:
        last: Optional[Exception] = None
        for attempt in range(8):
            try:
                response = self.client.messages.create(
                    model=self.model_id,
                    max_tokens=8000,
                    system=SYSTEM,
                    tools=self.tools,
                    messages=messages,
                )
                break
            except Exception as error:  # noqa: BLE001 - retry every transport failure
                last = error
                time.sleep(3 * (attempt + 1) + random.random() * 3)
        else:
            raise RuntimeError(f"anthropic failed after 8 tries: {last}")
        blocks = [b.model_dump() for b in response.content]
        tool_calls = [b for b in blocks if b["type"] == "tool_use"]
        text = "".join(b.get("text", "") for b in blocks if b["type"] == "text")
        return (
            {"blocks": blocks, "tool_calls": tool_calls, "text": text},
            {
                "input_tokens": response.usage.input_tokens,
                "output_tokens": response.usage.output_tokens,
            },
        )

    def assistant_message(self, turn: Dict[str, Any]) -> Dict[str, Any]:
        return {"role": "assistant", "content": turn["blocks"]}

    def tool_result_message(
        self, turn: Dict[str, Any], payload: Dict[str, Any]
    ) -> Dict[str, Any]:
        call = turn["tool_calls"][0]
        return {
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": call["id"],
                    "content": json.dumps(payload, ensure_ascii=False),
                    "is_error": "error" in payload,
                }
            ],
        }

    @staticmethod
    def tool_input(turn: Dict[str, Any]) -> Tuple[bool, Any]:
        """(json_ok, parsed_input). The SDK parses tool input server-side."""
        return True, turn["tool_calls"][0]["input"]


class OpenRouter:
    def __init__(self, model_id: str, instructions: str, schema: Dict[str, Any]):
        import httpx

        self.http = httpx.Client(
            base_url="https://openrouter.ai/api/v1",
            headers={
                "Authorization": f"Bearer {os.environ['OPENROUTER_API_KEY']}",
                "Content-Type": "application/json",
            },
            timeout=180.0,
        )
        self.model_id = model_id
        self.tools = [
            {
                "type": "function",
                "function": {
                    "name": harness.TOOL_NAME,
                    "description": instructions,
                    "parameters": schema,
                },
            }
        ]

    def call(self, messages: List[Dict[str, Any]]) -> Tuple[Any, Dict[str, Any]]:
        body = {
            "model": self.model_id,
            "max_tokens": 8000,
            "messages": [{"role": "system", "content": SYSTEM}] + messages,
            "tools": self.tools,
        }
        last: Optional[Exception] = None
        for attempt in range(5):
            try:
                response = self.http.post("/chat/completions", json=body)
                if response.status_code >= 500 or response.status_code == 429:
                    raise RuntimeError(f"http {response.status_code}: {response.text[:200]}")
                response.raise_for_status()
                data = response.json()
                if "choices" not in data:
                    raise RuntimeError(f"no choices: {json.dumps(data)[:300]}")
                break
            except Exception as error:  # noqa: BLE001
                last = error
                time.sleep(2 * (attempt + 1))
        else:
            raise RuntimeError(f"openrouter failed: {last}")

        message = data["choices"][0]["message"]
        usage = data.get("usage") or {}
        return (
            {
                "message": message,
                "tool_calls": message.get("tool_calls") or [],
                "text": message.get("content") or "",
            },
            {
                "input_tokens": usage.get("prompt_tokens", 0),
                "output_tokens": usage.get("completion_tokens", 0),
            },
        )

    def assistant_message(self, turn: Dict[str, Any]) -> Dict[str, Any]:
        message = dict(turn["message"])
        message.pop("reasoning", None)
        message.pop("reasoning_details", None)
        return message

    def tool_result_message(
        self, turn: Dict[str, Any], payload: Dict[str, Any]
    ) -> Dict[str, Any]:
        call = turn["tool_calls"][0]
        return {
            "role": "tool",
            "tool_call_id": call["id"],
            "content": json.dumps(payload, ensure_ascii=False),
        }

    @staticmethod
    def tool_input(turn: Dict[str, Any]) -> Tuple[bool, Any]:
        raw = turn["tool_calls"][0]["function"]["arguments"]
        if isinstance(raw, dict):
            return True, raw
        try:
            return True, json.loads(raw)
        except Exception:  # noqa: BLE001
            return False, raw


# --------------------------------------------------------------------------------------
# One trial
# --------------------------------------------------------------------------------------


def head_for(task: "T.Task") -> Tuple[Dict[str, Any], str]:
    """The configuration the commit really lands on, and its revision id."""
    if task.recovery == "conflict":
        return T.CONFIG_F_NEW_HEAD, T.NEW_HEAD_REVISION_ID
    return task.config, task.base_revision_id


def run_trial(client: Any, task: "T.Task", trial: int) -> Dict[str, Any]:
    head_config, head_revision_id = head_for(task)

    user = (
        "Here is the current configuration, from read_config:\n\n"
        f"{harness.read_config_result(task.config, task.base_revision_id)}\n\n"
        f"Task: {task.prompt}"
    )
    messages: List[Dict[str, Any]] = [{"role": "user", "content": user}]

    record: Dict[str, Any] = {
        "task": task.tid,
        "trial": trial,
        "attempts": [],
        "tool_call_made": False,
        "json_ok": False,
        "engine_accepted": False,
        "correct": False,
        "recovered": False,
        "attempts_used": 0,
        "input_tokens": 0,
        "output_tokens": 0,
        "error": None,
    }

    served_conflict = False

    for attempt in range(MAX_ATTEMPTS):
        try:
            turn, usage = client.call(messages)
        except Exception as error:  # noqa: BLE001
            record["error"] = f"api: {type(error).__name__}: {error}"
            return record
        record["input_tokens"] += usage["input_tokens"]
        record["output_tokens"] += usage["output_tokens"]
        record["attempts_used"] = attempt + 1

        if not turn["tool_calls"]:
            record["attempts"].append(
                {"attempt": attempt, "no_tool_call": True, "text": turn["text"][:600]}
            )
            record["error"] = "no tool call"
            return record

        record["tool_call_made"] = True
        json_ok, envelope = client.tool_input(turn)
        if attempt == 0:
            record["json_ok"] = json_ok
        if not json_ok:
            record["attempts"].append(
                {"attempt": attempt, "bad_json": True, "raw": str(envelope)[:600]}
            )
            record["error"] = "unparseable tool arguments"
            return record

        # For the conflict flow the model's first call is aimed at the stale head; the
        # commit wrapper answers 409 and hands back the moved head.
        new_config, payload = harness.run_commit(
            envelope,
            head_config=head_config,
            head_revision_id=head_revision_id,
        )
        if (
            task.recovery == "conflict"
            and not served_conflict
            and new_config is None
            and payload.get("error", {}).get("code") == "stale_base_revision"
        ):
            served_conflict = True
            payload["error"]["head"] = {
                "revision_id": head_revision_id,
                "data": head_config,
            }

        step = {
            "attempt": attempt,
            "envelope": envelope,
            "ok": new_config is not None,
        }
        if new_config is None:
            step["error"] = payload["error"]
        record["attempts"].append(step)

        if new_config is not None:
            record["engine_accepted"] = True
            problem = task.checker(new_config)
            record["correct"] = problem is None
            if problem:
                record["error"] = f"wrong result: {problem}"
            record["final_config"] = new_config
            record["recovered"] = record["correct"] and (
                task.recovery is None or attempt > 0
            )
            return record

        retryable = (payload.get("error") or {}).get("retryable")
        if retryable is None:
            retryable = ((payload.get("error") or {}).get("reason") or {}).get(
                "retryable", True
            )
        if payload["error"].get("code") == "change_set_rejected":
            retryable = payload["error"].get("retryable", True)

        messages.append(client.assistant_message(turn))
        messages.append(client.tool_result_message(turn, payload))

    record["error"] = "gave up after {} attempts".format(MAX_ATTEMPTS)
    return record


# --------------------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, choices=sorted(MODELS))
    parser.add_argument("--instructions", required=True)
    parser.add_argument("--n", type=int, default=5)
    parser.add_argument("--tasks", default="")
    parser.add_argument("--union-schema", action="store_true")
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--rich-errors", action="store_true")
    parser.add_argument("--lenient", action="store_true")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    load_env()
    harness.RICH_ERRORS = args.rich_errors or args.lenient
    harness.LENIENT = args.lenient

    instructions = (HERE / "instructions" / f"{args.instructions}.md").read_text()
    schema = harness.tool_schema(union=args.union_schema)
    spec = MODELS[args.model]

    selected = [t for t in T.TASKS if not args.tasks or t.tid in args.tasks.split(",")]

    lock = threading.Lock()
    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    handle = out.open("w")

    if spec["provider"] == "anthropic":
        client = Anthropic(spec["id"], instructions, schema)
    else:
        client = OpenRouter(spec["id"], instructions, schema)

    def work(item: Tuple["T.Task", int]) -> Dict[str, Any]:
        task, trial = item
        record = run_trial(client, task, trial)
        record["model"] = args.model
        record["instructions"] = args.instructions
        record["union_schema"] = args.union_schema
        record["rich_errors"] = args.rich_errors
        record["lenient"] = args.lenient
        with lock:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
            handle.flush()
            flag = "OK " if record["correct"] else "BAD"
            print(
                f"{flag} {args.model}/{args.instructions} task {task.tid} "
                f"trial {trial}: {record['error'] or 'correct'}",
                flush=True,
            )
        return record

    jobs = [(task, trial) for task in selected for trial in range(args.n)]
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        records = list(pool.map(work, jobs))
    handle.close()

    print("\n=== summary ===")
    for task in selected:
        rows = [r for r in records if r["task"] == task.tid]
        n = len(rows)
        print(
            f"  {task.tid}  tool_call {sum(r['tool_call_made'] for r in rows)}/{n}  "
            f"engine_ok {sum(r['engine_accepted'] for r in rows)}/{n}  "
            f"correct {sum(r['correct'] for r in rows)}/{n}"
        )
    total = len(records)
    print(
        f"  ALL correct {sum(r['correct'] for r in records)}/{total}  "
        f"tokens in {sum(r['input_tokens'] for r in records)} "
        f"out {sum(r['output_tokens'] for r in records)}"
    )


if __name__ == "__main__":
    main()
