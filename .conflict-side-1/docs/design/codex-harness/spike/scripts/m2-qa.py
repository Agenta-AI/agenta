# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx"]
# ///
"""Milestone 2 QA/diagnosis driver for the Codex harness.

Drives the product invoke endpoint (POST /services/agent/v0/invoke) with a Codex agent and
captures the SSE frame stream. Two journeys:
  - chat: a plain text turn (baseline + cost diagnosis)
  - tool: a Codex agent with a platform `discover_tools` tool forced to run, to prove the
    Agenta-tools MCP channel executes on Codex and emits tool events.

Env (from the worktree .env): AGENTA_QA_HOST, AGENTA_QA_API_KEY. Project is fixed below.
Usage: uv run m2-qa.py chat | tool | both
"""

import json
import os
import sys
import uuid

import httpx

BASE = os.environ["AGENTA_QA_HOST"].rstrip("/")
KEY = os.environ["AGENTA_QA_API_KEY"]
PROJECT = os.environ.get("AGENTA_QA_PROJECT", "019f93b7-8660-7cf0-bf03-b4061c049dd5")

CELL = {
    "harness": "codex",
    "model": "gpt-5.6-luna",
    "provider": "openai",
    "connection": {"mode": "agenta", "slug": None},
    "sandbox": "local",
}

# A platform tool that executes server-side over the internal agenta-tools MCP relay channel
# (the same channel a custom callback tool rides). discover_tools runs an Agenta-native search,
# so it proves the executable-tool-over-MCP path on Codex without any external callback URL.
PLATFORM_TOOL = {"type": "platform", "op": "discover_tools"}

TOOL_TOKEN = "discover_tools"


def template(tools=None, instructions=None, permission_default=None):
    t = {
        "instructions": {
            "agents_md": instructions or "Be terse. Do exactly what is asked."
        },
        "llm": {
            "model": CELL["model"],
            "provider": CELL["provider"],
            "connection": CELL["connection"],
            "extras": {},
        },
        "tools": tools or [],
        "mcps": [],
        "skills": [],
        "harness": {"kind": CELL["harness"]},
        "sandbox": {"kind": CELL["sandbox"]},
    }
    if permission_default:
        t["runner"] = {
            "kind": "sidecar",
            "permissions": {"default": permission_default},
        }
    return t


def user_msg(text):
    return {
        "id": str(uuid.uuid4()),
        "role": "user",
        "parts": [{"type": "text", "text": text}],
    }


def invoke(session_id, messages, params, timeout=300.0):
    body = {
        "session_id": session_id,
        "data": {"inputs": {"messages": messages}, "parameters": {"agent": params}},
    }
    headers = {
        "Authorization": f"ApiKey {KEY}",
        "Accept": "text/event-stream",
        "x-ag-messages-format": "vercel",
        "Content-Type": "application/json",
    }
    frames = []
    text = []
    tool_calls = []
    tool_outputs = []
    finish_reason = None
    usage = None
    trace_id = None
    errors = []
    with httpx.Client(timeout=timeout) as client:
        with client.stream(
            "POST",
            f"{BASE}/services/agent/v0/invoke",
            params={"project_id": PROJECT},
            json=body,
            headers=headers,
        ) as r:
            if r.status_code >= 400:
                errors.append(f"HTTP {r.status_code}: {r.read().decode()[:800]}")
                return locals()
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
                frames.append(ftype)
                if ftype == "text-delta":
                    text.append(f.get("delta", ""))
                elif ftype in ("tool-input-available", "tool-call"):
                    tool_calls.append(
                        {k: f.get(k) for k in ("toolCallId", "toolName", "input")}
                    )
                elif ftype in (
                    "tool-output-available",
                    "tool-output-error",
                    "tool-result",
                ):
                    tool_outputs.append(
                        {k: f.get(k) for k in ("toolCallId", "output", "errorText")}
                    )
                elif ftype == "finish":
                    finish_reason = f.get("finishReason")
                    usage = f.get("usage") or usage
                elif ftype in ("error", "error-text"):
                    errors.append(json.dumps(f)[:300])
                if f.get("traceId") or f.get("trace_id"):
                    trace_id = f.get("traceId") or f.get("trace_id")
    return {
        "frames": frames,
        "reply": "".join(text),
        "tool_calls": tool_calls,
        "tool_outputs": tool_outputs,
        "finish_reason": finish_reason,
        "usage": usage,
        "trace_id": trace_id,
        "errors": errors,
    }


def run_chat():
    print("=== CHAT ===")
    t = invoke(str(uuid.uuid4()), [user_msg("Reply with exactly: PONG")], template())
    print("frames:", t["frames"])
    print("reply:", repr(t["reply"])[:200])
    print("finish:", t["finish_reason"], "usage:", t["usage"], "trace:", t["trace_id"])
    print("errors:", t["errors"])
    return t


def run_tool():
    print("=== TOOL (platform discover_tools over agenta-tools MCP) ===")
    t = invoke(
        str(uuid.uuid4()),
        [
            user_msg(
                "Use the discover_tools tool to search for tools that can send email. Then briefly say how many you found."
            )
        ],
        template(
            tools=[PLATFORM_TOOL],
            instructions="When asked to find tools, call the discover_tools tool. Report a short summary of its result.",
            permission_default="allow",
        ),
    )
    print("frames:", t["frames"])
    print("reply:", repr(t["reply"])[:300])
    print("tool_calls:", json.dumps(t["tool_calls"])[:400])
    print("tool_outputs:", json.dumps(t["tool_outputs"])[:400])
    print("finish:", t["finish_reason"], "usage:", t["usage"])
    print("errors:", t["errors"])
    print(
        "TOOL RAN:",
        TOOL_TOKEN in json.dumps(t["tool_outputs"]) or TOOL_TOKEN in t["reply"],
    )
    return t


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "both"
    if which in ("chat", "both"):
        run_chat()
    if which in ("tool", "both"):
        run_tool()
