# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx"]
# ///
"""Codex tool-approval QA matrix: {local, daytona} x {allow, deny, ask-warm, ask-cold1, ask-cold2}.

Drives the product invoke endpoint with a Codex agent under the default `agent-full-access` mode
and a self-contained platform tool, and asserts the behavior the D-008 amendment promises: an
`ask` tool parks and RESUMES IN PLACE, keeping its original tool-call id.

The tool-call id is the whole test. A warm resume answers the parked ACP gate on the live session,
so the resumed output carries the SAME id the approval card carried. Any cold path makes the model
re-issue the call, which mints a NEW id. That one comparison separates warm from cold without
reading runner logs.

The three resume cells:

  ask-warm   The session is still parked in the runner's keep-alive pool. Re-invoke with the
             UNCHANGED history plus the approval, which is what the playground sends. Expect the
             same tool-call id.
  ask-cold1  The parked session is gone but the runner process is alive. Forced by editing the
             transcript (append a nudge), which trips the runner's history guard and evicts to a
             cold replay. Expect a NEW tool-call id, the tool still running, and the codeword
             from turn 1 surviving.
  ask-cold2  The runner process itself is replaced. Forced by SIGKILLing the runner container (see
             `replace_runner_replica` for why SIGKILL, and why it then waits out the session-owner
             key), so the resuming replica is not the one that parked. On LOCAL this must REFUSE:
             a local sandbox lives inside the runner, so another replica cannot adopt it, and the
             single-owner guard says so. On DAYTONA the sandbox outlives the replica, so the new
             replica adopts the session and completes the call. Expect a NEW tool-call id there:
             this is a cold replay, so the model re-issues.

Run the cells ONE AT A TIME when a result matters. Back to back, an earlier cell's sessions stay
in the keep-alive pool and can push a parked approval out of it, which turns a warm resume into a
cold one and looks like a failure. `all` is a smoke sweep; a green cell is a cell run alone.

Env: AGENTA_QA_HOST, AGENTA_QA_API_KEY, AGENTA_QA_PROJECT, RUNNER_CONTAINER (for ask-cold2).
Usage: uv run codex-approval-matrix-qa.py [local|daytona] [all|allow|deny|ask-warm|ask-cold1|ask-cold2]
"""

import json
import os
import subprocess
import sys
import time
import uuid

import httpx

BASE = os.environ["AGENTA_QA_HOST"].rstrip("/")
KEY = os.environ["AGENTA_QA_API_KEY"]
PROJECT = os.environ["AGENTA_QA_PROJECT"]
RUNNER_CONTAINER = os.environ.get(
    "RUNNER_CONTAINER", "agenta-ee-dev-codex-harness-runner-1"
)
MODEL = os.environ.get("MODEL", "gpt-5.6-luna")
# `agenta` = managed vault key; `self_managed` = the operator's ChatGPT/Codex subscription login
# (the runner authenticates from the mounted ~/.codex, credentialMode=runtime_provided). The
# approval plane is identical on both — the patched bridge raises the same native gates — so the
# matrix runs on either; CONNECTION_MODE=self_managed re-proves it on the subscription path.
CONNECTION_MODE = os.environ.get("CONNECTION_MODE", "agenta")
# Mirrors OWNER_TTL_SECONDS in services/runner/src/sessions/contract.ts.
OWNER_TTL_SECONDS = 120

CODEWORD = "FLAMINGO-42"
TOOL = "list_connections"
TURN1 = (
    f"Remember this codeword: {CODEWORD}. "
    "Now list my connections using the list_connections tool, then tell me the codeword."
)

RESULTS: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    RESULTS.append((name, ok, detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}{(' — ' + detail) if detail else ''}")


def template(permission, sandbox):
    return {
        "instructions": {
            "agents_md": (
                "Be terse. When asked to list connections, call the list_connections tool. "
                "If you are told a codeword, remember it and repeat it when asked."
            )
        },
        "llm": {
            "model": MODEL,
            "provider": "openai",
            "connection": {"mode": CONNECTION_MODE, "slug": None},
            "extras": {},
        },
        "tools": [{"type": "platform", "op": TOOL, "permission": permission}],
        "mcps": [],
        "skills": [],
        "harness": {"kind": "codex"},
        "sandbox": {"kind": sandbox},
    }


def user_msg(text):
    return {
        "id": str(uuid.uuid4()),
        "role": "user",
        "parts": [{"type": "text", "text": text}],
    }


def approval_part(call, approved):
    return {
        "id": str(uuid.uuid4()),
        "role": "assistant",
        "parts": [
            {
                "type": f"tool-{TOOL}",
                "toolCallId": call["toolCallId"],
                "toolName": TOOL,
                "input": call["input"] or {},
                "state": "approval-responded",
                "approval": {"approved": approved},
            }
        ],
    }


def invoke(session_id, messages, permission, sandbox, timeout=600.0):
    body = {
        "session_id": session_id,
        "data": {
            "inputs": {"messages": messages},
            "parameters": {"agent": template(permission, sandbox)},
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
                    out["errors"].append(json.dumps(f)[:400])
    out["reply"] = "".join(text)
    return out


def show(tag, t):
    print(f"\n----- {tag} -----")
    print("  frames   :", t["frames"])
    print("  tool_call:", json.dumps(t["tool_calls"])[:220])
    print("  tool_out :", json.dumps(t["tool_outputs"])[:220])
    print("  approvals:", json.dumps(t["approvals"])[:200])
    print("  finish   :", t["finish"], "| reply:", repr(t["reply"])[:160])
    print("  errors   :", t["errors"])


def replace_runner_replica():
    """Kill the runner WITHOUT letting it clean up, then bring it back as a new replica.

    SIGKILL, not `docker restart`, and the difference decides what this cell measures. On SIGTERM
    the runner runs its shutdown handler, which drains the keep-alive pool and DELETES every
    sandbox it owns, parked approvals included (`server.ts` -> `pool.destroyAll`). That is
    deliberate, so a `docker stop` cannot leak a running sandbox. But it means a graceful restart
    destroys the very session this cell wants to resume, and the resume then fails on a sandbox in
    state 'not-found' — an artifact of the test method, not of cross-replica resume.

    SIGKILL skips the handler, which is exactly the production scenario worth testing: a replica
    that crashes, is OOM-killed, or is one of several behind a load balancer. The remote sandbox
    survives, and a different replica must be able to adopt the session.
    """
    print(
        f">>> SIGKILLing {RUNNER_CONTAINER} (no graceful cleanup), then restarting it..."
    )
    subprocess.run(
        ["docker", "kill", RUNNER_CONTAINER], check=True, capture_output=True
    )
    subprocess.run(
        ["docker", "start", RUNNER_CONTAINER], check=True, capture_output=True
    )
    # Wait for the container to report healthy rather than sleeping a guessed interval.
    for _ in range(90):
        probe = subprocess.run(
            ["docker", "inspect", "-f", "{{.State.Health.Status}}", RUNNER_CONTAINER],
            capture_output=True,
            text=True,
        )
        if probe.stdout.strip() == "healthy":
            break
        time.sleep(2)
    time.sleep(3)
    # Then wait out the session OWNER key (OWNER_TTL_SECONDS = 120, sessions/contract.ts). The
    # killed replica never released it, and `claim_owner` deliberately never steals from an owner
    # that still looks live, so until the key lapses the new replica cannot take the session. Its
    # heartbeat comes back `is_current_turn: false`, the runner reads that as "interrupted" and
    # aborts its own fresh turn, and on Daytona that abort kills the in-sandbox shim upload — which
    # surfaces as a confusing "shim could not be delivered" error rather than an ownership message.
    # Resuming before the key lapses therefore measures that window, not cross-replica resume.
    wait = OWNER_TTL_SECONDS + 20
    print(f">>> waiting {wait}s for the dead replica's session-owner key to lapse...")
    time.sleep(wait)


def run_allow(sandbox):
    print(f"\n===== {sandbox} / ALLOW =====")
    t = invoke(
        str(uuid.uuid4()),
        [user_msg("List my connections using the tool.")],
        "allow",
        sandbox,
    )
    show("allow", t)
    check(f"{sandbox}/allow: tool ran", bool(t["tool_outputs"]))
    check(f"{sandbox}/allow: no approval card", not t["approvals"])
    check(f"{sandbox}/allow: turn completed", t["finish"] == "stop")


def run_deny(sandbox):
    print(f"\n===== {sandbox} / DENY =====")
    t = invoke(
        str(uuid.uuid4()),
        [user_msg("List my connections using the tool.")],
        "deny",
        sandbox,
    )
    show("deny", t)
    refused = "tool-output-denied" in t["frames"] or any(
        "deni" in json.dumps(o).lower() for o in t["tool_outputs"]
    )
    check(f"{sandbox}/deny: refused", refused)
    check(
        f"{sandbox}/deny: never executed",
        not any(o["type"] == "tool-output-available" for o in t["tool_outputs"]),
    )
    check(f"{sandbox}/deny: turn completed", t["finish"] == "stop")


def park(sandbox):
    """Turn 1 of an ask run: returns (session_id, parked_call) or (None, None)."""
    sid = str(uuid.uuid4())
    t = invoke(sid, [user_msg(TURN1)], "ask", sandbox)
    show("ask turn 1", t)
    if not t["tool_calls"]:
        check(
            f"{sandbox}/ask: model called the tool",
            False,
            "no tool call; cannot test the resume",
        )
        return None, None
    check(f"{sandbox}/ask: parked with an approval card", bool(t["approvals"]))
    check(f"{sandbox}/ask: did not execute before approval", not t["tool_outputs"])
    return sid, t["tool_calls"][0]


def run_ask_warm(sandbox):
    print(f"\n===== {sandbox} / ASK -> WARM RESUME =====")
    sid, call = park(sandbox)
    if not call:
        return
    t = invoke(sid, [user_msg(TURN1), approval_part(call, True)], "ask", sandbox)
    show("warm resume", t)
    check(
        f"{sandbox}/ask-warm: tool executed",
        any(o["type"] == "tool-output-available" for o in t["tool_outputs"]),
    )
    check(
        f"{sandbox}/ask-warm: SAME tool-call id (resumed in place)",
        any(o.get("toolCallId") == call["toolCallId"] for o in t["tool_outputs"]),
        f"parked {call['toolCallId']}",
    )
    check(f"{sandbox}/ask-warm: no second approval card", not t["approvals"])
    check(f"{sandbox}/ask-warm: codeword survived", CODEWORD in t["reply"])


def run_ask_cold1(sandbox):
    print(f"\n===== {sandbox} / ASK -> COLD 1 (session evicted, runner alive) =====")
    sid, call = park(sandbox)
    if not call:
        return
    # Editing the transcript is what evicts: the history guard refuses to continue a live session
    # whose prior conversation no longer matches. That forces the cold replay path.
    resume = [
        user_msg(TURN1 + " Please be quick."),
        approval_part(call, True),
        user_msg("Now run the approved tool and then tell me the codeword."),
    ]
    t = invoke(sid, resume, "ask", sandbox)
    show("cold 1 resume", t)
    check(
        f"{sandbox}/ask-cold1: tool executed",
        any(o["type"] == "tool-output-available" for o in t["tool_outputs"]),
    )
    check(f"{sandbox}/ask-cold1: codeword survived the replay", CODEWORD in t["reply"])
    check(f"{sandbox}/ask-cold1: no second approval card", not t["approvals"])


def run_ask_cold2(sandbox):
    print(f"\n===== {sandbox} / ASK -> COLD 2 (runner replica replaced) =====")
    sid, call = park(sandbox)
    if not call:
        return
    replace_runner_replica()
    t = invoke(sid, [user_msg(TURN1), approval_part(call, True)], "ask", sandbox)
    show("cold 2 resume", t)
    owner_refusal = any("single runner" in e for e in t["errors"])
    if sandbox == "local":
        # A local sandbox lives inside the runner process, so a different replica genuinely
        # cannot adopt it. Refusing loudly is the correct outcome, not a completed resume.
        check(
            "local/ask-cold2: refuses with the single-owner guard (correct for a local sandbox)",
            owner_refusal,
            t["errors"][0][:160] if t["errors"] else "no error surfaced",
        )
    else:
        check(
            f"{sandbox}/ask-cold2: no owner refusal (a remote sandbox outlives the replica)",
            not owner_refusal,
        )
        check(
            f"{sandbox}/ask-cold2: tool executed",
            any(o["type"] == "tool-output-available" for o in t["tool_outputs"]),
        )
        check(f"{sandbox}/ask-cold2: codeword survived", CODEWORD in t["reply"])


CELLS = {
    "allow": run_allow,
    "deny": run_deny,
    "ask-warm": run_ask_warm,
    "ask-cold1": run_ask_cold1,
    "ask-cold2": run_ask_cold2,
}


def main():
    sandbox = sys.argv[1] if len(sys.argv) > 1 else "local"
    which = sys.argv[2] if len(sys.argv) > 2 else "all"
    if sandbox not in ("local", "daytona"):
        print(f"unknown sandbox '{sandbox}' (expected local|daytona)")
        return 2
    cells = list(CELLS) if which == "all" else [which]
    for cell in cells:
        if cell not in CELLS:
            print(f"unknown cell '{cell}' (expected {'|'.join(CELLS)}|all)")
            return 2
        CELLS[cell](sandbox)

    print(f"\n===== SUMMARY ({sandbox}) =====")
    failed = [r for r in RESULTS if not r[1]]
    for name, ok, detail in RESULTS:
        print(f"  {'PASS' if ok else 'FAIL'}  {name}")
    print(f"\n{len(RESULTS) - len(failed)}/{len(RESULTS)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
