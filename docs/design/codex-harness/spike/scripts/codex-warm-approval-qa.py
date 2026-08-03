# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx"]
# ///
"""Warm-approval QA for the patched codex-acp bridge.

Same three scenarios as `m3-qa.py`, but the resume re-invokes the way the real playground does:
the ORIGINAL turn-1 user text, unchanged, followed by the assistant tool part carrying the
`approval-responded` decision, and NO extra user message. That keeps the request's prior
conversation byte-identical to what the parked session recorded, so the runner's history
fingerprint matches and the keep-alive dispatch can resume the LIVE session instead of evicting
to a cold replay. `m3-qa.py` rewrites turn-1 and appends a nudge, which trips the guard by
design and can only ever exercise the cold path.

Env: AGENTA_QA_HOST, AGENTA_QA_API_KEY, AGENTA_QA_PROJECT.
"""

import json
import os
import sys
import uuid

import httpx

BASE = os.environ["AGENTA_QA_HOST"].rstrip("/")
KEY = os.environ["AGENTA_QA_API_KEY"]
PROJECT = os.environ["AGENTA_QA_PROJECT"]

CODEWORD = "FLAMINGO-42"
TOOL = "list_connections"
TURN1 = (
    f"Remember this codeword: {CODEWORD}. "
    "Now list my connections using the list_connections tool, then tell me the codeword."
)


def template(permission):
    return {
        "instructions": {
            "agents_md": (
                "Be terse. When asked to list connections, call the list_connections tool. "
                "If you are told a codeword, remember it and repeat it when asked."
            )
        },
        "llm": {
            "model": "gpt-5.6-luna",
            "provider": "openai",
            "connection": {"mode": "agenta", "slug": None},
            "extras": {},
        },
        "tools": [{"type": "platform", "op": TOOL, "permission": permission}],
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


def invoke(session_id, messages, permission, timeout=300.0):
    body = {
        "session_id": session_id,
        "data": {
            "inputs": {"messages": messages},
            "parameters": {"agent": template(permission)},
        },
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
                    "tool-output-denied",
                    "tool-result",
                ):
                    out["tool_outputs"].append(
                        {
                            "type": ftype,
                            **{
                                k: f.get(k)
                                for k in ("toolCallId", "output", "errorText")
                            },
                        }
                    )
                elif "approval" in ftype:
                    out["approvals"].append(f)
                elif ftype == "finish":
                    out["finish"] = f.get("finishReason")
                elif ftype in ("error", "error-text"):
                    out["errors"].append(json.dumps(f)[:300])
    out["reply"] = "".join(text)
    return out


def show(tag, t):
    print(f"\n===== {tag} =====")
    print("frames   :", t["frames"])
    print("tool_call:", json.dumps(t["tool_calls"])[:300])
    print("tool_out :", json.dumps(t["tool_outputs"])[:300])
    print("approvals:", json.dumps(t["approvals"])[:300])
    print("finish   :", t["finish"])
    print("reply    :", repr(t["reply"])[:300])
    print("errors   :", t["errors"])


def main():
    sid = str(uuid.uuid4())
    t1 = invoke(sid, [user_msg(TURN1)], "ask")
    show("ASK turn 1 (expect: parks with an approval card)", t1)
    if not t1["tool_calls"]:
        print("FAIL: the model never called the tool; cannot test the resume.")
        return 1
    call = t1["tool_calls"][0]
    parked = bool(t1["approvals"]) and not t1["tool_outputs"]
    print("PASS(parked):", parked)
    print("PARKED TOOL CALL ID:", call["toolCallId"])

    # The real playground shape: unchanged turn-1 text, then the assistant tool part carrying the
    # approval. No trailing user message, so `priorConversation` is exactly what the park recorded.
    resume = [
        user_msg(TURN1),
        {
            "id": str(uuid.uuid4()),
            "role": "assistant",
            "parts": [
                {
                    "type": f"tool-{TOOL}",
                    "toolCallId": call["toolCallId"],
                    "toolName": TOOL,
                    "input": call["input"] or {},
                    "state": "approval-responded",
                    "approval": {"approved": True},
                }
            ],
        },
    ]
    t2 = invoke(sid, resume, "ask")
    show(
        "ASK resume after APPROVE (expect: WARM, same tool-call id, no second card)", t2
    )
    executed = any(o["type"] == "tool-output-available" for o in t2["tool_outputs"])
    same_id = any(o.get("toolCallId") == call["toolCallId"] for o in t2["tool_outputs"])
    print("PASS(tool executed):", executed)
    print(
        "PASS(same tool-call id -> the parked call resumed, model did not re-issue):",
        same_id,
    )
    print("PASS(no second approval card):", not t2["approvals"])
    print("PASS(codeword context survived):", CODEWORD in t2["reply"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
