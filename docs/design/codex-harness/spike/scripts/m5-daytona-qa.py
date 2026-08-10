# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx"]
# ///
"""Milestone 5 QA: a MANAGED-key codex run on a DAYTONA sandbox, on the PRODUCT path.

Mirrors m4-tool-qa.py but flips two axes: the sandbox is `daytona` (not local) and the
connection is managed (`agenta` + the `openai-managed` vault slug -> credentialMode=env), so the
runner writes auth.json into the sandbox VM (in-VM CODEX_HOME, D-002 M5 amendment). Two runs:
a plain chat run (assert finish=stop + non-empty reply), and, if MODE=tool, one allow-tool run.

Env (worktree .env): AGENTA_QA_HOST, AGENTA_QA_API_KEY, AGENTA_QA_PROJECT. MODE=chat|tool.
Usage: uv run m5-daytona-qa.py   (or MODE=tool uv run m5-daytona-qa.py)
"""

import json
import os
import sys
import uuid

import httpx

BASE = os.environ["AGENTA_QA_HOST"].rstrip("/")
KEY = os.environ["AGENTA_QA_API_KEY"]
PROJECT = os.environ.get("AGENTA_QA_PROJECT", "019f93b7-8660-7cf0-bf03-b4061c049dd5")
MODE = os.environ.get("MODE", "chat")
TOOL = "list_connections"


def template():
    tmpl = {
        "instructions": {"agents_md": "Be terse."},
        "llm": {
            "model": os.environ.get("MODEL", "gpt-5.6-luna"),
            "provider": "openai",
            # Managed vault key (not subscription): resolver -> credentialMode=env.
            "connection": {"mode": "agenta", "slug": None},
            "extras": {},
        },
        "tools": [],
        "mcps": [],
        "skills": [],
        "harness": {"kind": "codex"},
        # The axis under test: provision a real Daytona sandbox (SANDBOX=local to isolate).
        "sandbox": {"kind": os.environ.get("SANDBOX", "daytona")},
    }
    if MODE == "tool":
        tmpl["instructions"]["agents_md"] = (
            "Be terse. When asked to list connections, call the list_connections tool."
        )
        tmpl["tools"] = [{"type": "platform", "op": TOOL, "permission": "allow"}]
    return tmpl


def user_msg(text):
    return {
        "id": str(uuid.uuid4()),
        "role": "user",
        "parts": [{"type": "text", "text": text}],
    }


def invoke(messages, timeout=600.0):
    body = {
        "session_id": str(uuid.uuid4()),
        "data": {"inputs": {"messages": messages}, "parameters": {"agent": template()}},
    }
    headers = {
        "Authorization": f"ApiKey {KEY}",
        "Accept": "text/event-stream",
        "x-ag-messages-format": "vercel",
        "Content-Type": "application/json",
    }
    out = {
        "frames": [],
        "reply": "",
        "tool_calls": [],
        "tool_outputs": [],
        "approvals": [],
        "finish": None,
        "errors": [],
    }
    text = []
    with httpx.Client(timeout=timeout) as client:
        with client.stream(
            "POST",
            f"{BASE}/services/agent/v0/invoke",
            params={"project_id": PROJECT},
            json=body,
            headers=headers,
        ) as r:
            if r.status_code >= 400:
                out["errors"].append(f"HTTP {r.status_code}: {r.read().decode()[:800]}")
                return out
            for line in r.iter_lines():
                if not line or line.startswith(":") or not line.startswith("data: "):
                    continue
                payload = line[6:]
                if payload == "[DONE]":
                    break
                try:
                    f = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                ftype = f.get("type", "?")
                out["frames"].append(ftype)
                if ftype == "text-delta":
                    text.append(f.get("delta", ""))
                elif ftype in ("tool-input-available", "tool-call"):
                    out["tool_calls"].append(
                        {k: f.get(k) for k in ("toolCallId", "toolName", "input")}
                    )
                elif ftype in (
                    "tool-output-available",
                    "tool-output-error",
                    "tool-result",
                ):
                    out["tool_outputs"].append(
                        {k: f.get(k) for k in ("toolCallId", "output", "errorText")}
                    )
                elif "approval" in ftype:
                    out["approvals"].append(f)
                elif ftype == "finish":
                    out["finish"] = f.get("finishReason")
                elif ftype in ("error", "error-text"):
                    out["errors"].append(json.dumps(f)[:600])
    out["reply"] = "".join(text)
    return out


prompt = (
    "List my connections using the tool."
    if MODE == "tool"
    else "Reply with exactly: DAYTONA-OK"
)
t = invoke([user_msg(prompt)])
print("mode     :", MODE)
print("frames   :", t["frames"])
print("tool_call:", json.dumps(t["tool_calls"])[:300])
print("tool_out :", json.dumps(t["tool_outputs"])[:300])
print("finish   :", t["finish"])
print("reply    :", repr(t["reply"])[:300])
print("errors   :", t["errors"])
if MODE == "tool":
    ok = bool(t["tool_calls"]) and not t["approvals"] and not t["errors"]
    print("PASS(daytona managed tool ran, no error):", ok)
else:
    ok = t["finish"] == "stop" and bool(t["reply"].strip()) and not t["errors"]
    print("PASS(daytona managed chat finished, reply, no error):", ok)
sys.exit(0 if ok else 1)
