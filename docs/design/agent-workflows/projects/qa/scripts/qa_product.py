# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27"]
# ///
"""Product-path QA driver for the agent release gate.

Drives the SAME endpoint the playground drives (`/services/agent/v0/invoke`), with the same
headers and the same in-band approval protocol the browser uses. Asserts on the wire (SSE frame
types), never on model prose. Where the model must prove something in text, an unguessable
constant is baked into a tool's return value, so a matching reply PROVES the tool ran.

  uv run qa_product.py --cell C3                 # one cell
  uv run qa_product.py --all                     # every cell
  uv run qa_product.py --cell C3 --only approve  # one journey

Results land in ../runs/<timestamp>/ as JSON + a markdown table.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import time
import uuid

import httpx

HERE = pathlib.Path(__file__).resolve().parent
RUNS = HERE.parent / "runs"


def load_env() -> dict:
    env = {}
    for line in (
        (pathlib.Path.home() / ".agenta-bighetzner.env").read_text().splitlines()
    ):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


ENV = load_env()
BASE, PROJECT, KEY = ENV["AGENTA_BASE"], ENV["AGENTA_PROJECT_ID"], ENV["AGENTA_API_KEY"]

# ---------------------------------------------------------------------------
# Cells: harness x sandbox (core) + provider/auth sub-matrix (Pi only).
# ---------------------------------------------------------------------------
CELLS = {
    # Claude: use the `sonnet` alias — a full model id is dropped to the default on the
    # Claude ACP path (QA finding F-007).
    "C1": {
        "harness": "claude",
        "sandbox": "local",
        "model": "sonnet",
        "provider": "anthropic",
        # SUBSCRIPTION (OAuth), not the vault key: the project's Anthropic key is out of credit,
        # and "Use subscription" is what the playground defaults to anyway.
        "connection": {"mode": "self_managed", "slug": None},
    },
    "C2": {
        "harness": "claude",
        "sandbox": "daytona",
        "model": "sonnet",
        "provider": "anthropic",
        "connection": {"mode": "self_managed", "slug": None},
    },
    "C3": {
        "harness": "pi_core",
        "sandbox": "local",
        "model": "gpt-5.6-luna",
        "provider": "openai",
    },
    "C4": {
        "harness": "pi_core",
        "sandbox": "daytona",
        "model": "gpt-5.6-luna",
        "provider": "openai",
    },
    # Provider sub-matrix: an auth question, not a sandbox question — Pi + local only.
    "P1": {
        "harness": "pi_core",
        "sandbox": "local",
        "model": "openrouter/deepseek/deepseek-v4-flash",
        "provider": "openrouter",
    },
    # P2 (OpenRouter as a CUSTOM OpenAI-compatible provider) needs a `custom_provider` secret in
    # the vault; `connection.slug` points at it. Set --custom-slug to run it.
    "P2": {
        "harness": "pi_core",
        "sandbox": "local",
        "model": "deepseek/deepseek-v4-flash",
        "provider": "custom",
        "connection": {
            "mode": "self_managed",
            "slug": None,
        },  # slug filled from --custom-slug
    },
}

# NOTE: `code` tools are NOT usable on the product path — the sidecar rejects them
# ("Code tools are not supported by the sidecar.", services/runner/src/tools/code.ts). They only
# work against the in-process service, which is what the OLD qa driver (run_matrix.py) targets.
# The product's real tool surface is `builtin` (bash/read/write/...), `gateway` (Composio) and
# `mcp`. So we prove tool execution with builtin bash echoing an unguessable token.
BASH_TOOL = {"type": "builtin", "name": "bash"}

# The token MUST NOT be derivable from the prompt. An early version of this used
# `echo "QA-BASH-$((6*7+1))"` — and the model simply computed 43 and reported it WITHOUT running
# bash, so a DENIED tool call still produced a "passing" reply. The wire said denied; the prose
# lied. Lesson, and the rule for this whole driver: assert on FRAMES, and only ever use a token
# the model cannot compute. The container hostname is random per container.
BASH_PROMPT = (
    'Use the bash tool to run exactly: echo "QA-BASH-$(hostname)-$(uname -m)" '
    "and reply with only its stdout."
)
BASH_TOKEN_RE = re.compile(r"QA-BASH-[0-9a-f]{6,}-\w+")

# For the APPROVAL journeys the command must MUTATE. Claude Code classifies bash commands and
# auto-approves read-only ones (a bare `echo`) no matter what the permission policy says, so
# approving a read-only echo tests nothing on Claude — and a user approving an action is, by
# definition, approving a mutating one. Pi gates all bash via the extension, so a mutating
# command works as the single approval probe on BOTH harnesses.
MUTATE_PROMPT = (
    "Use the bash tool to run exactly: "
    "echo WROTE > /tmp/qa-$(hostname).txt && cat /tmp/qa-$(hostname).txt "
    "and reply with only its stdout."
)


def tool_ran(t: "Turn") -> bool:
    """Did ANY tool execute? The wire, never the reply."""
    return "tool-output-available" in t.frames


def outcome_for_input(t: "Turn", wanted_input: dict) -> str | None:
    """The outcome of the call carrying THIS input ("available"|"error"|"denied"), or None.

    Keyed by the command, NOT the toolCallId or the tool name, because on resume the harness
    RE-ISSUES the gated call under a brand-new toolCallId (and Claude names it `Terminal` while
    Pi names it `Bash`). Keying on either would look at the wrong call. And a turn routinely holds
    several calls — an auto-approved read-only one beside the gated one — so a turn-wide check
    gives false failures.
    """
    for call in t.tool_calls:
        if call.get("input") == wanted_input:
            out = t.tool_outcomes.get(call["toolCallId"])
            if out:
                return out
    return None


def template(
    cell: dict,
    tools: list | None = None,
    instructions: str | None = None,
    permission_default: str | None = None,
) -> dict:
    conn = cell.get("connection") or {"mode": "agenta", "slug": None}
    t = {
        "instructions": {
            "agents_md": instructions
            or "Be terse. Do exactly what is asked, nothing more."
        },
        "llm": {
            "model": cell["model"],
            "provider": cell["provider"],
            "connection": conn,
            "extras": {},
        },
        "tools": tools or [],
        "mcps": [],
        "skills": [],
        "harness": {"kind": cell["harness"]},
        "sandbox": {"kind": cell["sandbox"]},
    }
    if permission_default:
        # Layer-2: the runner's permission posture. `ask` is what makes a tool call raise the
        # approval dock in the product — this is the real approval mechanism a user hits.
        t["runner"] = {
            "kind": "sidecar",
            "permissions": {"default": permission_default},
        }
    return t


def user_msg(text: str) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "role": "user",
        "parts": [{"type": "text", "text": text}],
    }


class Turn:
    """One /invoke round trip, parsed off the wire."""

    def __init__(self) -> None:
        self.frames: list[str] = []
        self.text: list[str] = []
        self.approval: dict | None = None  # {approvalId, toolCallId}
        self.tool_calls: list[dict] = []  # {toolCallId, toolName, input}
        # Outcome per toolCallId: "available" | "error" | "denied". A turn can contain SEVERAL
        # tool calls (an agent often runs an auto-approved read-only call alongside the gated
        # one), so "did the tool run?" MUST be asked of the specific gated call, never of the
        # turn as a whole.
        self.tool_outcomes: dict[str, str] = {}
        # The PAYLOAD behind each outcome (output value or errorText), keyed by toolCallId.
        # Needed to replay a byte-faithful assistant UIMessage: the AI SDK ships the tool's
        # output back to the server on every subsequent turn's history, and the runner's
        # history fingerprint (session-pool.ts historyFingerprint) hashes tool-call ids out of
        # that history. A text-only replay drops them -> mismatch -> warm session evicted.
        self.tool_payloads: dict[str, dict] = {}
        # Parts in the ORDER the model actually produced them (mirrors AI SDK
        # `UIMessage.parts` arrival order): a list of {"kind": "text", "text": str} |
        # {"kind": "tool", "id": toolCallId}, consumed by assistant_message().
        self._segments: list[dict] = []
        self.finish_reason: str | None = None
        self.errors: list[str] = []
        self.committed_revision: dict | None = None
        self.http_status: int = 0
        self.ms: int = 0

    @property
    def reply(self) -> str:
        return "".join(self.text).strip()

    def assistant_message(self) -> dict:
        """Rebuild this turn's reply as a FULL Vercel UIMessage — text AND tool parts, in the
        order the model produced them — so replaying it as history is byte-faithful to what the
        real frontend (AI SDK `useChat`) sends back on the next turn (`agentRequest.ts:401`).

        A text-only replay drops the assistant's tool parts, and the runner's history
        fingerprint (`session-pool.ts` `historyFingerprint`) hashes the ordered, deduped
        tool-call ids out of that history. Missing ids -> `mismatch (history)` on the next
        turn -> the warm session is EVICTED and every following turn runs cold. See
        `sdks/python/agenta/sdk/agents/adapters/vercel/messages.py` `_tool_part_blocks` for
        the exact states the server accepts on ingest — this mirrors them precisely:
        "output-available" + output, "output-error" + errorText, "output-denied" (no payload,
        read by `_approval_decision`'s state fallback as an inline deny).
        """
        by_id = {c["toolCallId"]: c for c in self.tool_calls}
        parts: list[dict] = []
        for seg in self._segments:
            if seg["kind"] == "text":
                if seg["text"]:
                    parts.append({"type": "text", "text": seg["text"]})
                continue
            call = by_id.get(seg["id"], {})
            part = {
                "type": f"tool-{call.get('toolName') or 'tool'}",
                "toolCallId": seg["id"],
                "input": call.get("input") or {},
            }
            outcome = self.tool_outcomes.get(seg["id"])
            payload = self.tool_payloads.get(seg["id"], {})
            if outcome == "available":
                part["state"] = "output-available"
                part["output"] = payload.get("output")
            elif outcome == "error":
                part["state"] = "output-error"
                part["errorText"] = payload.get("errorText")
            elif outcome == "denied":
                part["state"] = "output-denied"
            else:
                # No outcome landed within this turn (e.g. a call still awaiting an approval
                # decision) — mirror the AI SDK's in-flight tool-part state so the id still
                # rides the history, without fabricating a result it never produced.
                part["state"] = "input-available"
            parts.append(part)
        if not parts:
            parts.append({"type": "text", "text": self.reply})
        return {"id": str(uuid.uuid4()), "role": "assistant", "parts": parts}

    def summary(self) -> dict:
        return {
            "http": self.http_status,
            "ms": self.ms,
            "finish": self.finish_reason,
            "frames": self.frames,
            "tools": [t.get("toolName") for t in self.tool_calls],
            "approval": bool(self.approval),
            "errors": self.errors,
            "reply": self.reply[:400],
        }


def invoke(
    session_id: str, messages: list, params: dict, timeout: float = 300.0
) -> Turn:
    t = Turn()
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
    start = time.time()
    with httpx.Client(timeout=timeout) as client:
        with client.stream(
            "POST",
            f"{BASE}/services/agent/v0/invoke",
            params={"project_id": PROJECT},
            json=body,
            headers=headers,
        ) as r:
            t.http_status = r.status_code
            if r.status_code >= 400:
                t.errors.append(f"HTTP {r.status_code}: {r.read().decode()[:500]}")
                t.ms = int((time.time() - start) * 1000)
                return t
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
                t.frames.append(ftype)
                if ftype == "text-delta":
                    delta = f.get("delta", "")
                    t.text.append(delta)
                    # Coalesce consecutive text-delta frames into ONE running text segment;
                    # a tool call between two text runs starts a NEW segment (see below), so
                    # this reproduces the AI SDK's interleaved part order.
                    if t._segments and t._segments[-1]["kind"] == "text":
                        t._segments[-1]["text"] += delta
                    else:
                        t._segments.append({"kind": "text", "text": delta})
                elif ftype == "tool-input-available":
                    # CAREFUL: this frame is emitted REPEATEDLY for one tool call, carrying a
                    # progressively-built PARTIAL input, and `toolName` changes case along the way
                    # ("bash" while streaming -> "Bash" when complete). Only the LAST frame per
                    # toolCallId holds the real command. Keeping the first one approves a
                    # truncated command under the wrong name, the runner's decision key
                    # (name+args) misses the parked gate, and the approval re-parks forever.
                    call = {
                        "toolCallId": f.get("toolCallId"),
                        "toolName": f.get("toolName"),
                        "input": f.get("input"),
                    }
                    is_new_call = not any(
                        c["toolCallId"] == call["toolCallId"] for c in t.tool_calls
                    )
                    t.tool_calls = [
                        c for c in t.tool_calls if c["toolCallId"] != call["toolCallId"]
                    ] + [call]
                    # Segment position is fixed at FIRST appearance (when the call starts),
                    # never moved by later partial-input updates — that's when the AI SDK
                    # would have inserted the tool part into UIMessage.parts.
                    if is_new_call:
                        t._segments.append({"kind": "tool", "id": call["toolCallId"]})
                elif ftype == "tool-approval-request":
                    t.approval = {
                        "approvalId": f.get("approvalId"),
                        "toolCallId": f.get("toolCallId"),
                    }
                elif ftype in (
                    "tool-output-available",
                    "tool-output-error",
                    "tool-output-denied",
                ):
                    tcid = f.get("toolCallId")
                    if tcid:
                        t.tool_outcomes[tcid] = ftype.replace("tool-output-", "")
                        if ftype == "tool-output-available":
                            t.tool_payloads[tcid] = {"output": f.get("output")}
                        elif ftype == "tool-output-error":
                            t.tool_payloads[tcid] = {"errorText": f.get("errorText")}
                elif ftype == "data-committed-revision":
                    t.committed_revision = f.get("data")
                elif ftype == "error":
                    t.errors.append(json.dumps(f)[:300])
                elif ftype == "finish":
                    t.finish_reason = f.get("finishReason")
    t.ms = int((time.time() - start) * 1000)
    return t


def approval_reply(turn: Turn, approved: bool) -> dict:
    """Rebuild the paused assistant message with the decision inline — exactly what the browser
    does (addToolApprovalResponse -> re-POST the history). NOT the out-of-band REST route."""
    call = next(
        (c for c in turn.tool_calls if c["toolCallId"] == turn.approval["toolCallId"]),
        turn.tool_calls[-1] if turn.tool_calls else {},
    )
    return {
        "id": str(uuid.uuid4()),
        "role": "assistant",
        "parts": [
            {
                "type": f"tool-{call.get('toolName')}",
                "toolCallId": turn.approval["toolCallId"],
                "state": "approval-responded",
                "input": call.get("input") or {},
                "approval": {"id": turn.approval["approvalId"], "approved": approved},
            }
        ],
    }


# ---------------------------------------------------------------------------
# Journeys
# ---------------------------------------------------------------------------


def j1_chat(cell: dict) -> dict:
    """J1: the agent answers at all."""
    s = str(uuid.uuid4())
    t = invoke(s, [user_msg("Reply with exactly: PONG")], template(cell))
    ok = t.finish_reason == "stop" and "PONG" in t.reply.upper() and not t.errors
    return {
        "pass": ok,
        "why": "finish=stop and reply contains PONG",
        "turn": t.summary(),
    }


def j3_tool(cell: dict) -> dict:
    """J3: a tool really executed — proven by a token only a real shell can produce."""
    s = str(uuid.uuid4())
    t = invoke(
        s,
        [user_msg(BASH_PROMPT)],
        template(
            cell,
            tools=[BASH_TOOL],
            instructions="Use the bash tool when asked to run a command. Report only its stdout.",
            permission_default="allow",
        ),
    )
    ok = tool_ran(t) and bool(BASH_TOKEN_RE.search(t.reply))
    return {
        "pass": ok,
        "why": "wire shows tool-output-available AND the reply carries a token only a real shell could emit",
        "turn": t.summary(),
    }


def _approval_flow(cell: dict, approved: bool) -> dict:
    """J4: with permission default `ask`, a tool call must PAUSE with a tool-approval-request,
    then resume on the user's decision — the same in-band protocol the browser uses."""
    s = str(uuid.uuid4())
    params = template(
        cell,
        tools=[BASH_TOOL],
        instructions="Use the bash tool when asked to run a command. Report only its stdout.",
        permission_default="ask",
    )
    msgs = [user_msg(MUTATE_PROMPT)]
    t1 = invoke(s, msgs, params)

    if not t1.approval:
        return {
            "pass": False,
            "why": "expected a tool-approval-request frame; the gate never fired",
            "turn": t1.summary(),
        }
    # A paused turn finishes with reason "other", not "stop".
    paused_ok = t1.finish_reason == "other"

    gated_call = next(
        (c for c in t1.tool_calls if c["toolCallId"] == t1.approval["toolCallId"]),
        t1.tool_calls[-1] if t1.tool_calls else {},
    )
    gated_input = gated_call.get("input") or {}
    msgs = msgs + [approval_reply(t1, approved)]
    t2 = invoke(s, msgs, params)
    outcome = outcome_for_input(t2, gated_input)

    if approved:
        ok = outcome == "available" and not t2.errors
        why = f"approved: the gated command executed after approval (outcome={outcome}, paused finish=other: {paused_ok})"
    else:
        # Denied: the gated COMMAND must never have executed. Assert the WIRE, never the reply —
        # a denied model will happily hallucinate the output it never received.
        ok = outcome != "available"
        why = f"denied: the gated command never executed (outcome={outcome})"
    return {
        "pass": ok,
        "why": why,
        "paused_finish_other": paused_ok,
        "turn_paused": t1.summary(),
        "turn_resumed": t2.summary(),
    }


def j4_approve(cell: dict) -> dict:
    return _approval_flow(cell, approved=True)


def j4_deny(cell: dict) -> dict:
    return _approval_flow(cell, approved=False)


def j6_warm(cell: dict) -> dict:
    """J6 (latency half): three turns in one session; turns 2/3 should be faster than turn 1.
    The cold/warm TRUTH lives in the runner log — this only measures. See STATUS.md F-2."""
    s = str(uuid.uuid4())
    params = template(cell)
    msgs: list = []
    times = []
    for i, q in enumerate(
        [
            "Reply with exactly: ONE",
            "Reply with exactly: TWO",
            "Reply with exactly: THREE",
        ]
    ):
        msgs = msgs + [user_msg(q)]
        t = invoke(s, msgs, params)
        times.append(t.ms)
        msgs = msgs + [t.assistant_message()]
        if t.errors:
            return {"pass": False, "why": f"turn {i + 1} errored", "turn": t.summary()}
    warm_gain = times[0] - min(times[1], times[2])
    return {
        "pass": warm_gain > 0,
        "why": f"turn1={times[0]}ms, turn2={times[1]}ms, turn3={times[2]}ms (warm gain {warm_gain}ms)",
        "session_id": s,
        "times_ms": times,
    }


def j2_mount(cell: dict) -> dict:
    """J2: the agent's working directory PERSISTS across turns.

    Turn 1 writes a token to a file. Turn 2 — a separate /invoke on the same session — reads it
    back. This is the journey that silently failed while mounts were 503ing: the agent ran in a
    throwaway /tmp cwd, every turn looked fine, and the file was gone. So the pass condition is
    the token coming back FROM DISK in turn 2, with a real tool call behind it.
    """
    s = str(uuid.uuid4())
    token = f"QA-MOUNT-{uuid.uuid4().hex[:10]}"
    params = template(
        cell,
        tools=[BASH_TOOL],
        instructions="Use the bash tool when asked. Report only the command's stdout.",
        permission_default="allow",
    )
    msgs = [
        user_msg(
            f"Use bash to run exactly: echo {token} > qa-mount.txt ; then reply with only: WROTE"
        )
    ]
    t1 = invoke(s, msgs, params)
    if not tool_ran(t1):
        return {
            "pass": False,
            "why": "turn 1 never executed the write",
            "turn_write": t1.summary(),
        }

    msgs = msgs + [
        t1.assistant_message(),
        user_msg(
            "Use bash to run exactly: cat qa-mount.txt  and reply with only its stdout."
        ),
    ]
    t2 = invoke(s, msgs, params)
    ok = token in t2.reply and tool_ran(t2)
    return {
        "pass": ok,
        "why": f"turn 2 read the token back from the mounted cwd (token={token})",
        "turn_write": t1.summary(),
        "turn_read": t2.summary(),
    }


JOURNEYS = {
    "chat": j1_chat,
    "mount": j2_mount,
    "tool": j3_tool,
    "approve": j4_approve,
    "deny": j4_deny,
    "warm": j6_warm,
}


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--cell", action="append", help="C1..C4, P1, P2")
    p.add_argument("--all", action="store_true")
    p.add_argument("--only", action="append", help=f"one of {list(JOURNEYS)}")
    p.add_argument(
        "--custom-slug", help="vault slug of the custom OpenAI-compatible provider (P2)"
    )
    args = p.parse_args()

    cells = list(CELLS) if args.all else (args.cell or ["C3"])
    journeys = args.only or list(JOURNEYS)
    if args.custom_slug:
        CELLS["P2"]["connection"]["slug"] = args.custom_slug

    stamp = time.strftime("%Y%m%d-%H%M%S")
    outdir = RUNS / stamp
    outdir.mkdir(parents=True, exist_ok=True)

    results: dict = {}
    for cid in cells:
        cell = CELLS[cid]
        results[cid] = {"config": {k: v for k, v in cell.items()}, "journeys": {}}
        for jname in journeys:
            print(f"[{cid}] {jname} ... ", end="", flush=True)
            try:
                r = JOURNEYS[jname](cell)
            except Exception as e:  # a crash is a result, not a reason to lose the run
                r = {"pass": False, "why": f"driver exception: {type(e).__name__}: {e}"}
            results[cid]["journeys"][jname] = r
            print("PASS" if r.get("pass") else "FAIL", f"— {r.get('why', '')[:90]}")
            (outdir / "results.json").write_text(json.dumps(results, indent=2))

    lines = ["| cell | harness | sandbox | model | " + " | ".join(journeys) + " |"]
    lines.append("|" + "---|" * (4 + len(journeys)))
    for cid, r in results.items():
        c = r["config"]
        cellstr = [
            ("PASS" if r["journeys"][j].get("pass") else "FAIL") for j in journeys
        ]
        lines.append(
            f"| {cid} | {c['harness']} | {c['sandbox']} | {c['model']} | "
            + " | ".join(cellstr)
            + " |"
        )
    table = "\n".join(lines)
    (outdir / "summary.md").write_text(table + "\n")
    print("\n" + table)
    print(f"\nresults: {outdir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
