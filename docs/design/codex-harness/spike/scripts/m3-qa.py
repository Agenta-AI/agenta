# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx"]
# ///
"""Milestone 3 QA driver: the runner-side tool approval gate on Codex (default agent-full-access).

Drives the product invoke endpoint (POST /services/agent/v0/invoke) with a Codex agent and a
SELF-CONTAINED custom callback tool (the platform op `list_connections`, a direct call to the
deployment's own API, no Composio). Varies the tool's permission to exercise the gate:

  allow  -> the tool runs without pausing (scenario 1)
  deny   -> the tool is refused cleanly and the turn continues (scenario 3)
  ask    -> the call parks (interaction/approval frame, turn pauses) (scenario 2)

For scenario 2 it then RESUMES from the parked state by re-invoking with the approval folded into
the message history (the AI SDK `approval-responded` shape), and checks that the tool executes and
the reply still knows a CODEWORD established in turn 1 (context survives the resume).

NOTE: this driver only ever exercises the COLD resume. It rewrites the turn-1 text and appends a
nudge message, so the request's prior conversation no longer matches what the parked session
recorded and the runner's history guard correctly evicts to a cold replay. For the WARM
keep-alive resume (the parked ACP gate answered on the live session, same tool-call id, no
re-issue) use `codex-warm-approval-qa.py`, which re-invokes the way the playground does.

Env (worktree .env): AGENTA_QA_HOST, AGENTA_QA_API_KEY, AGENTA_QA_PROJECT.
Usage: uv run m3-qa.py allow | deny | ask | all
"""

import json
import os
import sys
import uuid

import httpx

BASE = os.environ["AGENTA_QA_HOST"].rstrip("/")
KEY = os.environ["AGENTA_QA_API_KEY"]
PROJECT = os.environ.get("AGENTA_QA_PROJECT", "019f93b7-8660-7cf0-bf03-b4061c049dd5")

CODEWORD = "FLAMINGO-42"
TOOL = "list_connections"


MODE = os.environ.get(
    "M3_MODE"
)  # None = default agent-full-access; "agent" | "read-only"


def template(permission):
    harness = {"kind": "codex"}
    if MODE:
        harness["permissions"] = {"mode": MODE}
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
        # Self-contained platform op (direct call to the deployment API; no Composio). The
        # per-tool `permission` drives the runner-side gate's effective decision.
        "tools": [{"type": "platform", "op": TOOL, "permission": permission}],
        "mcps": [],
        "skills": [],
        "harness": harness,
        "sandbox": {"kind": "local"},
    }


def user_msg(text):
    return {
        "id": str(uuid.uuid4()),
        "role": "user",
        "parts": [{"type": "text", "text": text}],
    }


def approval_resume_messages(turn1_text, tool_call_id, tool_input, approved):
    """The FE's post-approval re-invoke: turn-1 user text + an assistant tool part carrying the
    inline `approval-responded` decision (AI SDK shape). The vercel ingress folds this into a
    tool_call + an {approved} tool_result the runner keys by name+args to resume the parked gate."""
    return [
        user_msg(turn1_text),
        {
            "id": str(uuid.uuid4()),
            "role": "assistant",
            "parts": [
                {
                    "type": f"tool-{TOOL}",
                    "toolCallId": tool_call_id,
                    "toolName": TOOL,
                    "input": tool_input or {},
                    "state": "approval-responded",
                    "approval": {"approved": approved},
                }
            ],
        },
    ]


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
                    "tool-result",
                ):
                    out["tool_outputs"].append(
                        {k: f.get(k) for k in ("toolCallId", "output", "errorText")}
                    )
                elif "approval" in ftype or ftype in (
                    "tool-approval-request",
                    "tool-input-approval",
                ):
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
    print("approvals:", json.dumps(t["approvals"])[:400])
    print("finish   :", t["finish"])
    print("reply    :", repr(t["reply"])[:300])
    print("errors   :", t["errors"])


def run_allow():
    t = invoke(
        str(uuid.uuid4()), [user_msg("List my connections using the tool.")], "allow"
    )
    show("SCENARIO 1 ALLOW (should run, no approval frame)", t)
    ran = bool(t["tool_calls"]) and not t["approvals"]
    print("PASS(allow: tool ran, no pause):", ran)
    return t


def run_deny():
    t = invoke(
        str(uuid.uuid4()), [user_msg("List my connections using the tool.")], "deny"
    )
    show("SCENARIO 3 DENY (should refuse, turn continues)", t)
    # Since the codex-acp approval patch (2026-07-31) the denial lands at codex's own gate,
    # BEFORE the tool call is issued, so the stream carries `tool-output-denied` — the same
    # decline frame Claude produces. Under the old runner-side-only gate the call reached the
    # MCP seam and came back as a `tool-output-error` saying "denied by policy", so matching on
    # the word "denied" in the reply text no longer holds (the model says "rejected" just as
    # often). Assert on the frame, which is the contract.
    denied = "tool-output-denied" in t["frames"] or any(
        "deni" in json.dumps(o).lower() for o in t["tool_outputs"]
    )
    print("PASS(deny: refused + continued):", denied and t["finish"] is not None)
    return t


def run_ask():
    sid = str(uuid.uuid4())
    turn1 = (
        f"Remember this codeword: {CODEWORD}. "
        "Now list my connections using the list_connections tool."
    )
    t1 = invoke(sid, [user_msg(turn1)], "ask")
    show("SCENARIO 2 ASK - turn 1 (should PARK: approval frame, no completion)", t1)
    parked = bool(t1["approvals"]) or (
        bool(t1["tool_calls"]) and not t1["tool_outputs"]
    )
    print("PARKED:", parked)
    if not t1["tool_calls"]:
        print("NOTE: model did not call the tool; cannot test resume.")
        return
    call = t1["tool_calls"][-1]
    # 2b forced-cold: evict the warm daemon by restarting the runner before resuming, so the
    # resume cold-starts and replays the transcript instead of reusing a pooled daemon.
    if os.environ.get("M3_COLD") == "1":
        import subprocess
        import time

        print(">>> M3_COLD: restarting runner to force a cold resume...")
        subprocess.run(
            ["docker", "restart", "agenta-ee-dev-codex-harness-runner-1"],
            check=False,
            capture_output=True,
        )
        time.sleep(25)
        # Warm the fresh runner with a real TOOL run: the first MCP-tool session after a runner
        # restart is flaky (the codex daemon re-establishes its MCP connection), so absorb that on
        # a throwaway allow-tool call rather than the resume-under-test.
        print(">>> M3_COLD: warming the fresh runner (tool path)...")
        for _ in range(2):
            w = invoke(
                str(uuid.uuid4()),
                [user_msg("List my connections using the tool.")],
                "allow",
            )
            if w["tool_calls"] and not w["errors"]:
                break
            time.sleep(5)
        time.sleep(2)
    # Resume: fold the approval into history and re-invoke (same session for warm-ish path).
    resume_msgs = approval_resume_messages(
        turn1 + " After the tool runs, tell me the codeword.",
        call["toolCallId"],
        call["input"],
        approved=True,
    )
    resume_msgs.append(
        user_msg("Now run the approved tool and then tell me the codeword.")
    )
    t2 = invoke(sid, resume_msgs, "ask")
    show("SCENARIO 2 ASK - resume after APPROVE", t2)
    executed = bool(t2["tool_outputs"])
    context_ok = CODEWORD in t2["reply"]
    print("PASS(resume executed tool):", executed)
    print("PASS(codeword context survived):", context_ok)
    # Also show a rejection resume.
    reject_msgs = approval_resume_messages(
        turn1, call["toolCallId"], call["input"], approved=False
    )
    reject_msgs.append(user_msg("The tool was rejected. Acknowledge and stop."))
    t3 = invoke(str(uuid.uuid4()), reject_msgs, "ask")
    show("SCENARIO 2 ASK - resume after REJECT", t3)


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    if which in ("allow", "all"):
        run_allow()
    if which in ("deny", "all"):
        run_deny()
    if which in ("ask", "all"):
        run_ask()
