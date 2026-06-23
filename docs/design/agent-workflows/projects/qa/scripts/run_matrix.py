# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27"]
# ///
"""Agent-workflows QA matrix driver.

Runs Gherkin-style scenarios against the live agent service `/invoke` endpoint, asserts an
unguessable token in the reply, and captures the full request and response under `qa/runs/`
so the captures can seed replayable regression tests.

Usage:
  uv run run_matrix.py --env-label E2 --sandbox local --group core
  uv run run_matrix.py --env-label E3 --sandbox daytona --only code_tool_pi
  AGENTA_PROJECT_ID=<pid> uv run run_matrix.py --list

The agent service returns only the final assistant message, so a scenario proves a capability
by forcing an output token the model cannot produce without using the capability (a constant
embedded in a code tool, an environment value from bash, a script's computed output). Where
the token alone is weak, check the sandbox-agent runner logs for the tool-call.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import sys
import datetime

import httpx

BASE = os.environ.get("AGENTA_BASE", "http://localhost:8280")
PROJ = os.environ.get("AGENTA_PROJECT_ID", "019e8df5-2a58-7501-8fe2-56f7b332bd00")
MODEL = os.environ.get("AGENTA_QA_MODEL", "gpt-4o-mini")
RUNS = pathlib.Path(__file__).resolve().parents[1] / "runs"


def _api_key() -> str:
    key = os.environ.get("AGENTA_API_KEY")
    if key:
        return key
    # Fall back to the hotel-agent draft env, which authenticates cross-project in this
    # workspace (see feature-matrix-test.md).
    repo = pathlib.Path(__file__).resolve().parents[5]
    envf = repo / "examples/python/hotel_agent/draft/.env"
    for line in envf.read_text().splitlines():
        if line.startswith("AGENTA_API_KEY="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("no AGENTA_API_KEY in env or hotel-agent .env")


KEY = _api_key()

# A python code tool that returns an unguessable constant plus a transform of its input, so a
# matching reply proves the tool's code ran and its input flowed through.
SECRET_MATH = {
    "type": "code",
    "name": "secret_math",
    "description": "Compute the QA code for an integer.",
    "runtime": "python",
    "script": "def main(x=0):\n    return 'QA-CODE-OK-' + str(int(x) * 7 + 1)\n",
    "input_schema": {
        "type": "object",
        "properties": {"x": {"type": "integer"}},
        "required": ["x"],
    },
}


def reply_text(body: dict) -> str:
    out = (body.get("data") or {}).get("outputs") or {}
    if isinstance(out, dict):
        return out.get("content") or ""
    return str(out)


def status_msg(body: dict) -> str:
    return (body.get("status") or {}).get("message") or ""


# Each scenario: id, group, capability, the agent config overrides, the user message, and a
# check(reply)->bool. `base` (harness, sandbox, model, agents_md) is merged in by run().
SCENARIOS = [
    {
        "id": "smoke_chat_pi",
        "group": "core",
        "capability": "chat+instructions+model",
        "harness": "pi",
        "agent": {
            "agents_md": "Reply with exactly the requested word and nothing else."
        },
        "msg": "Reply with exactly: PONG",
        "check": lambda r: r.strip() == "PONG",
        "expect": "exactly PONG",
    },
    {
        "id": "smoke_chat_agenta",
        "group": "core",
        "capability": "chat+instructions+model",
        "harness": "agenta",
        "agent": {
            "agents_md": "When asked to reply with a word, output exactly that word."
        },
        "msg": "Reply with exactly: PONG",
        "check": lambda r: "PONG" in r,
        "expect": "contains PONG",
    },
    {
        "id": "code_tool_pi",
        "group": "core",
        "capability": "code tool",
        "harness": "pi",
        "agent": {
            "agents_md": "When asked to compute, call secret_math and report exactly its output.",
            "tools": [SECRET_MATH],
        },
        "msg": "Call secret_math with x=6 and reply with exactly the tool's output, nothing else.",
        "check": lambda r: "QA-CODE-OK-43" in r,
        "expect": "contains QA-CODE-OK-43 (7*6+1)",
    },
    {
        "id": "code_tool_agenta",
        "group": "core",
        "capability": "code tool",
        "harness": "agenta",
        "agent": {
            "agents_md": "When asked to compute, call secret_math and report exactly its output.",
            "tools": [SECRET_MATH],
        },
        "msg": "Call secret_math with x=6 and reply with exactly the tool's output, nothing else.",
        "check": lambda r: "QA-CODE-OK-43" in r,
        "expect": "contains QA-CODE-OK-43",
    },
    {
        "id": "builtin_bash_pi",
        "group": "core",
        "capability": "builtin bash",
        "harness": "pi",
        "agent": {
            "agents_md": "Use the bash tool when asked to run a command. Report only its stdout.",
            "tools": [{"type": "builtin", "name": "bash"}],
        },
        "msg": 'Use the bash tool to run: echo "QA-BASH-$(uname -m)" and reply with exactly its stdout.',
        "check": lambda r: bool(re.search(r"QA-BASH-(x86_64|aarch64|arm64|amd64)", r)),
        "expect": "QA-BASH-<arch from uname -m>",
    },
    {
        "id": "builtin_bash_agenta",
        "group": "core",
        "capability": "builtin bash (forced)",
        "harness": "agenta",
        "agent": {
            "agents_md": "Use the bash tool when asked to run a command. Report only its stdout.",
        },
        "msg": 'Use the bash tool to run: echo "QA-BASH-$(uname -m)" and reply with exactly its stdout.',
        "check": lambda r: bool(re.search(r"QA-BASH-(x86_64|aarch64|arm64|amd64)", r)),
        "expect": "QA-BASH-<arch>; bash is forced for agenta",
    },
    {
        "id": "append_system_pi",
        "group": "f001",
        "capability": "pi append_system override",
        "harness": "pi",
        "agent": {
            "agents_md": "Be brief.",
            "harness_options": {
                "pi": {
                    "append_system": "Always end every reply with the exact token ZK-9-END."
                }
            },
        },
        "msg": "Say hello in one short sentence.",
        "check": lambda r: r.rstrip().endswith("ZK-9-END") or "ZK-9-END" in r,
        "expect": "reply contains ZK-9-END (F-001: dropped on sandbox-agent, works in-process)",
    },
    # Claude cells: run against a project whose vault has an Anthropic key (e.g. pi-agents)
    # with that project's own API key. Use the alias `haiku` (a full model id is dropped to the
    # default on the Claude ACP path, see F-007), so testing stays cheap.
    {
        "id": "claude_smoke",
        "group": "claude",
        "capability": "claude chat (cheap model)",
        "harness": "claude",
        "agent": {
            "model": "haiku",
            "agents_md": "Reply with exactly the requested token, nothing else.",
        },
        "msg": "Reply with exactly: CLAUDE-HAIKU-OK",
        "check": lambda r: "CLAUDE-HAIKU-OK" in r,
        "expect": "CLAUDE-HAIKU-OK on model haiku",
    },
    {
        "id": "claude_code_tool",
        "group": "claude",
        "capability": "claude code tool (delivered over MCP bridge)",
        "harness": "claude",
        "agent": {
            "model": "haiku",
            "agents_md": "Use the secret_math tool and report exactly its output.",
            "tools": [SECRET_MATH],
        },
        "msg": "Call secret_math with x=6 and reply with exactly its output.",
        "check": lambda r: "QA-CODE-OK-43" in r,
        "expect": "QA-CODE-OK-43 (tool over Claude MCP bridge)",
    },
    {
        "id": "mcp_claude",
        "group": "claude",
        "capability": "MCP stdio server on claude",
        "harness": "claude",
        "agent": {
            "model": "haiku",
            "agents_md": "Use the get_secret_record MCP tool to fetch the record; do not guess.",
            "mcp_servers": [
                {
                    "name": "qa",
                    "transport": "stdio",
                    "command": "node",
                    "args": ["/tmp/mcp_qa_server.mjs"],
                }
            ],
        },
        "msg": "Use the get_secret_record tool to fetch the record, then reply with exactly the record text.",
        "check": lambda r: "MCP-RECORD-X9F2" in r,
        "expect": "MCP-RECORD-X9F2 (needs AGENTA_AGENT_ENABLE_MCP=true + the server at /tmp/mcp_qa_server.mjs)",
    },
]


def run(sc: dict, sandbox: str, env_label: str, timeout: float) -> dict:
    agent = {
        "harness": sc["harness"],
        "sandbox": sandbox,
        "model": MODEL,
    }
    agent.update(sc.get("agent", {}))
    body = {
        "data": {
            "inputs": {"messages": [{"role": "user", "content": sc["msg"]}]},
            "parameters": {"agent": agent},
        }
    }
    url = f"{BASE}/services/agent/v0/invoke"
    headers = {"Authorization": f"ApiKey {KEY}", "content-type": "application/json"}
    rec = {
        "id": sc["id"],
        "group": sc["group"],
        "capability": sc["capability"],
        "env_label": env_label,
        "sandbox": sandbox,
        "harness": sc["harness"],
        "model": MODEL,
        "ts": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "request": body,
    }
    try:
        resp = httpx.post(
            url,
            params={"project_id": PROJ},
            headers=headers,
            json=body,
            timeout=timeout,
        )
        rec["http_status"] = resp.status_code
        try:
            rec["response"] = resp.json()
        except Exception:
            rec["response"] = {"_raw": resp.text[:2000]}
    except Exception as exc:  # noqa: BLE001
        rec["http_status"] = -1
        rec["response"] = {"_error": str(exc)}

    reply = reply_text(rec["response"]) if isinstance(rec["response"], dict) else ""
    rec["reply"] = reply
    rec["status_message"] = (
        status_msg(rec["response"]) if isinstance(rec["response"], dict) else ""
    )
    try:
        rec["passed"] = bool(reply) and sc["check"](reply)
    except Exception as exc:  # noqa: BLE001
        rec["passed"] = False
        rec["check_error"] = str(exc)
    rec["expect"] = sc["expect"]
    return rec


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--env-label", default="E2", help="capture label, e.g. E1/E2/E3")
    ap.add_argument("--sandbox", default="local", choices=["local", "daytona"])
    ap.add_argument("--group", default=None)
    ap.add_argument("--only", default=None, help="comma-separated scenario ids")
    ap.add_argument("--timeout", type=float, default=180.0)
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()

    if args.list:
        for sc in SCENARIOS:
            print(f"{sc['id']:24} {sc['group']:8} {sc['harness']:7} {sc['capability']}")
        return

    sel = SCENARIOS
    if args.group:
        sel = [s for s in sel if s["group"] == args.group]
    if args.only:
        ids = set(args.only.split(","))
        sel = [s for s in sel if s["id"] in ids]
    if not sel:
        raise SystemExit("no scenarios selected")

    RUNS.mkdir(exist_ok=True)
    results = []
    for sc in sel:
        rec = run(sc, args.sandbox, args.env_label, args.timeout)
        results.append(rec)
        cap = RUNS / f"{args.env_label}__{sc['id']}.json"
        cap.write_text(json.dumps(rec, indent=2, default=str))
        mark = (
            "PASS"
            if rec["passed"]
            else ("ERR " if rec["http_status"] != 200 else "FAIL")
        )
        extra = (
            ""
            if rec["passed"]
            else f"  got={rec['reply'][:80]!r} status={rec.get('status_message', '')[:80]!r}"
        )
        print(
            f"[{mark}] {args.env_label} {sc['id']:24} http={rec['http_status']}{extra}"
        )

    n_pass = sum(1 for r in results if r["passed"])
    print(f"\n{n_pass}/{len(results)} passed on {args.env_label}/{args.sandbox}")
    sys.exit(0 if n_pass == len(results) else 1)


if __name__ == "__main__":
    main()
