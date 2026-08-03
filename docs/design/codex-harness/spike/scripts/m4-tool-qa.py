# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx"]
# ///
"""Milestone 4 QA: a subscription (self_managed) codex TOOL run on the PRODUCT path.

Same product invoke endpoint and self-contained `list_connections` platform tool as m3-qa.py, but
the connection mode is `self_managed` -> the resolver yields credentialMode=runtime_provided, so the
run authenticates from the mounted ~/.codex login (no API key). Exercises subscription auth + the
internal agenta-tools MCP server (the M3 regression path, now fixed) + one allow-mode tool call.

Env (worktree .env): AGENTA_QA_HOST, AGENTA_QA_API_KEY, AGENTA_QA_PROJECT.
Usage: uv run m4-tool-qa.py
"""

import json
import os
import sys
import uuid

import httpx

BASE = os.environ["AGENTA_QA_HOST"].rstrip("/")
KEY = os.environ["AGENTA_QA_API_KEY"]
PROJECT = os.environ.get("AGENTA_QA_PROJECT", "019f93b7-8660-7cf0-bf03-b4061c049dd5")
TOOL = "list_connections"


def template():
    return {
        "instructions": {
            "agents_md": "Be terse. When asked to list connections, call the list_connections tool."
        },
        "llm": {
            "model": "gpt-5.6-luna",
            "provider": "openai",
            # The one change vs m3-qa: subscription connection -> credentialMode runtime_provided.
            "connection": {"mode": "self_managed", "slug": None},
            "extras": {},
        },
        "tools": [{"type": "platform", "op": TOOL, "permission": "allow"}],
        "mcps": [],
        "skills": [],
        "harness": {"kind": "codex"},
        "sandbox": {"kind": "local"},
    }


def user_msg(text):
    return {
        "id": str(uuid.uuid4()),
        "role": "user",
        "parts": [{"type": "text", "text": text}],
    }


def invoke(messages, timeout=300.0):
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
                    out["errors"].append(json.dumps(f)[:400])
    out["reply"] = "".join(text)
    return out


t = invoke([user_msg("List my connections using the tool.")])
print("frames   :", t["frames"])
print("tool_call:", json.dumps(t["tool_calls"])[:300])
print("tool_out :", json.dumps(t["tool_outputs"])[:300])
print("finish   :", t["finish"])
print("reply    :", repr(t["reply"])[:300])
print("errors   :", t["errors"])
ran = bool(t["tool_calls"]) and not t["approvals"] and not t["errors"]
print("PASS(subscription allow-tool ran, no pause, no error):", ran)
sys.exit(0 if ran else 1)
