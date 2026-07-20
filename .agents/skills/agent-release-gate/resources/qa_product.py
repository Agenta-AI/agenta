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

Credentials come from the environment (AGENTA_BASE, AGENTA_PROJECT_ID, AGENTA_API_KEY), falling
back to --env-file. Results land in ./qa-gate-runs/<timestamp>/ (override with AGENTA_QA_RUNS_DIR)
as JSON + a markdown table.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import time
import uuid

import httpx

HERE = pathlib.Path(__file__).resolve().parent
# Results land in the CURRENT working directory, never inside the skill, so repeated runs do not
# accumulate in the tree. Override with AGENTA_QA_RUNS_DIR (absolute or relative to the CWD).
RUNS = pathlib.Path(os.environ.get("AGENTA_QA_RUNS_DIR", "qa-gate-runs")).resolve()

# Credentials: read from the environment FIRST, then fall back to an env file. The env vars are
# AGENTA_BASE (deployment origin), AGENTA_PROJECT_ID, and AGENTA_API_KEY — the same three the
# playground needs. This keeps the gate deployment-agnostic: point it at any stack by exporting
# three vars. The file fallback (default below, overridable with --env-file) is only for backward
# compatibility with the original bighetzner QA setup.
REQUIRED_CREDS = ("AGENTA_BASE", "AGENTA_PROJECT_ID", "AGENTA_API_KEY")
DEFAULT_ENV_FILE = pathlib.Path.home() / ".agenta-bighetzner.env"

# Resolved by resolve_credentials() before any journey runs. Left empty so that --help and other
# no-network entry points work with no credentials present at all.
BASE = ""
PROJECT = ""
KEY = ""


def _read_env_file(path: pathlib.Path) -> dict:
    values: dict = {}
    path = pathlib.Path(path).expanduser()
    if not path.exists():
        return values
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            values[k.strip()] = v.strip()
    return values


def resolve_credentials(env_file: str | pathlib.Path | None = None) -> None:
    """Populate BASE/PROJECT/KEY. Environment variables win; the env file only fills what the
    environment did not set. Raises SystemExit with a clear, specific message naming exactly which
    credentials are missing so a first-time runner knows what to set."""
    global BASE, PROJECT, KEY
    file_values = _read_env_file(env_file or DEFAULT_ENV_FILE)
    resolved: dict = {}
    missing: list = []
    for name in REQUIRED_CREDS:
        value = os.environ.get(name) or file_values.get(name)
        if value:
            resolved[name] = value
        else:
            missing.append(name)
    if missing:
        raise SystemExit(
            "Missing credentials: "
            + ", ".join(missing)
            + ".\nSet them as environment variables, e.g.\n"
            "  export AGENTA_BASE=https://your-stack.example.com\n"
            "  export AGENTA_PROJECT_ID=...\n"
            "  export AGENTA_API_KEY=...\n"
            f"or pass --env-file <path> to a file with those lines "
            f"(default: {DEFAULT_ENV_FILE})."
        )
    BASE = resolved["AGENTA_BASE"]
    PROJECT = resolved["AGENTA_PROJECT_ID"]
    KEY = resolved["AGENTA_API_KEY"]


# A public, no-auth, HTTPS Streamable-HTTP MCP server used by the `mcp` journey. DeepWiki is a
# well-known free reference server (tools: read_wiki_structure / read_wiki_contents / ask_question).
# Override with --mcp-url to point at any other public server. The runner/SDK both reject non-https
# and private/loopback hosts (SSRF guard), so a LOCAL server is NOT reachable from the deployment —
# it must be a public HTTPS URL. See STATUS.md "MCP smoke test".
DEFAULT_MCP_URL = "https://mcp.deepwiki.com/mcp"
MCP_URL = DEFAULT_MCP_URL


def api_call(method: str, path: str, timeout: float = 60.0, **kwargs) -> httpx.Response:
    """One REST call to the /api surface (the routes the playground UI drives for config/commits),
    NOT the SSE /services/agent/v0/invoke turn endpoint. Auth is the same ApiKey header, and
    project_id rides the query string (never the body), exactly like the browser."""
    return httpx.request(
        method,
        f"{BASE}/api{path}",
        params={"project_id": PROJECT},
        headers={"Authorization": f"ApiKey {KEY}", "Content-Type": "application/json"},
        timeout=timeout,
        **kwargs,
    )


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
        # VAULT KEY (mode "agenta"), NOT subscription: Daytona rejects runtime-provided
        # (subscription) auth by design — "Use a managed API key … or run this harness on the
        # local sandbox." C2 therefore genuinely needs a funded Anthropic key in the vault.
        "connection": {"mode": "agenta", "slug": None},
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
    # S1: the Codex SUBSCRIPTION path — Pi with provider `openai-codex` (a first-class
    # subscription provider slug, distinct from the vault-key `openai` provider; see
    # sdks/python/agenta/sdk/agents/capabilities.py PI_SUBSCRIPTION_PROVIDERS). Auth comes from
    # the subscription sidecar's ChatGPT/Codex OAuth login (~/.pi/agent/auth.json), never a
    # vault key, so `self_managed` + slug None is the whole connection.
    "S1": {
        "harness": "pi_core",
        "sandbox": "local",
        "model": "gpt-5.6-luna",
        "provider": "openai-codex",
        "connection": {"mode": "self_managed", "slug": None},
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
    mcps: list | None = None,
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
        "mcps": mcps or [],
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
    does (addToolApprovalResponse -> re-POST the history). NOT the out-of-band REST route.

    Reuses assistant_message() so the replay carries EVERY part of the paused turn — any
    preceding text and any other tool call beside the gated one — not just the gated part in
    isolation. A turn routinely holds an auto-approved read-only call next to the gated one
    (see Turn.tool_outcomes); dropping it here would omit a toolCallId from history and trip
    the runner's history fingerprint, evicting the warm session (see assistant_message()).
    """
    message = turn.assistant_message()
    for part in message["parts"]:
        if part.get("toolCallId") == turn.approval["toolCallId"]:
            part["state"] = "approval-responded"
            part["approval"] = {"id": turn.approval["approvalId"], "approved": approved}
            return message
    raise ValueError(
        "approval_reply: gated tool call missing from the assistant message"
    )


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
    ok = tool_ran(t) and bool(BASH_TOKEN_RE.search(t.reply)) and not t.errors
    return {
        "pass": ok,
        "why": "wire shows tool-output-available AND the reply carries a token only a real shell could emit, with no wire errors",
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

    # Require the turn to have actually paused (paused_ok) and the resume to have reached a
    # definite, error-free, non-re-parked state (not t2.errors, not t2.approval) before trusting
    # `outcome` at all — otherwise an indeterminate resume (outcome=None from a failed resume or
    # a re-parked gate) reads as a silent PASS on the deny branch below.
    if approved:
        ok = paused_ok and outcome == "available" and not t2.errors and not t2.approval
        why = f"approved: the gated command executed after approval (outcome={outcome}, paused finish=other: {paused_ok})"
    else:
        # Denied: the gated COMMAND must never have executed. Assert the WIRE, never the reply —
        # a denied model will happily hallucinate the output it never received. Require the
        # precise "denied" outcome (not merely "not available") so an indeterminate or errored
        # resume can't be misread as a successful deny.
        ok = paused_ok and outcome == "denied" and not t2.errors and not t2.approval
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
    # Assert on the ACTUAL tool output, never the reply: turn 2's history (t1.assistant_message())
    # already carries the token inside the write call's `input` (the `echo <token> > ...`
    # command), so a model that never re-reads the file could still echo the token from memory
    # and produce a "passing" reply. Only the `cat` call's own tool-output-available payload
    # proves the token came back FROM DISK.
    tool_output_text = " ".join(
        str(t2.tool_payloads.get(c["toolCallId"], {}).get("output") or "")
        for c in t2.tool_calls
    )
    ok = tool_ran(t2) and token in tool_output_text and not t2.errors
    return {
        "pass": ok,
        "why": f"turn 2's tool-output-available payload (not the reply) carried the token back from the mounted cwd (token={token})",
        "turn_write": t1.summary(),
        "turn_read": t2.summary(),
    }


def j5_commit(cell: dict) -> dict:
    """J5: committing an agent config as a new workflow revision — the playground's Save/Commit.

    This is a WORKFLOW-revision commit (a new version of the agent's configuration), NOT a git
    commit and NOT the in-stream `data-committed-revision` frame. It drives the exact REST route
    the UI's commit button hits: `POST /api/workflows/revisions/commit`
    (web/packages/agenta-entities/src/workflow/api/api.ts commitWorkflowRevisionApi).

    Wire truth, not prose: after committing a changed parameter we FETCH the revision back
    (`GET /api/workflows/revisions/{id}`) and assert the stored config carries the change AND the
    version incremented.

    Two facts that bite (both verified in the API):
    - The FIRST commit on a fresh variant is the v0 SEED: the DAO force-nulls its data/flags/meta
      (`dbs/postgres/git/dao.py` `_null_revision_fields`, `if revision.version == "0"`). So a
      config only persists on the SECOND commit (v1). The UI does the same seed-then-commit dance.
    - `data` is `extra="forbid"` — only {uri,url,headers,runtime,script,schemas,parameters} are
      accepted; the agent config goes under `data.parameters`.

    QA artifacts are namespaced `qa-commit-<hex>` and the whole workflow is archived at the end so
    repeated runs don't pile up.
    """
    hexid = uuid.uuid4().hex[:8]
    token = f"QA-COMMIT-{uuid.uuid4().hex[:12]}"  # unguessable; also gitleaks-allowlisted shape
    workflow_id = None
    try:
        r = api_call(
            "POST",
            "/workflows/",
            json={
                "workflow": {
                    "slug": f"qa-commit-{hexid}",
                    "name": f"QA commit {hexid}",
                    "flags": {
                        "is_custom": True,
                        "is_evaluator": False,
                        "is_feedback": False,
                    },
                }
            },
        )
        if r.status_code != 200:
            return {
                "pass": False,
                "why": f"create workflow HTTP {r.status_code}: {r.text[:200]}",
            }
        workflow_id = r.json()["workflow"]["id"]

        r = api_call(
            "POST",
            "/workflows/variants/",
            json={
                "workflow_variant": {
                    "slug": f"qa-commit-{hexid}-v",
                    "name": f"QA commit {hexid} v",
                    "workflow_id": workflow_id,
                }
            },
        )
        if r.status_code != 200:
            return {
                "pass": False,
                "why": f"create variant HTTP {r.status_code}: {r.text[:200]}",
            }
        variant_id = r.json()["workflow_variant"]["id"]

        # The committed config IS an agent config — the same shape a playground agent commits.
        base_params = {
            "agent": {
                "instructions": {"agents_md": "seed"},
                "llm": {"model": cell["model"], "provider": cell["provider"]},
                "tools": [],
                "harness": {"kind": cell["harness"]},
                "sandbox": {"kind": cell["sandbox"]},
            }
        }

        def commit(parameters: dict, message: str, slug: str) -> httpx.Response:
            return api_call(
                "POST",
                "/workflows/revisions/commit",
                json={
                    "workflow_revision": {
                        "slug": slug,
                        "name": f"QA commit {hexid} rev",
                        "message": message,
                        "data": {
                            "uri": "agenta:builtin:chat:v0",
                            "parameters": parameters,
                        },
                        "workflow_id": workflow_id,
                        "workflow_variant_id": variant_id,
                    }
                },
            )

        # v0 seed (data is intentionally nulled by the API for version 0).
        r = commit(base_params, "seed", f"qa-commit-seed-{hexid}")
        if r.status_code != 200:
            return {
                "pass": False,
                "why": f"seed commit HTTP {r.status_code}: {r.text[:200]}",
            }
        seed_version = r.json()["workflow_revision"].get("version")

        # v1: the real commit — modify one config parameter (the instructions token).
        changed = json.loads(json.dumps(base_params))
        changed["agent"]["instructions"]["agents_md"] = token
        r = commit(
            changed, "QA commit journey: change agents_md", f"qa-commit-real-{hexid}"
        )
        if r.status_code != 200:
            return {
                "pass": False,
                "why": f"real commit HTTP {r.status_code}: {r.text[:200]}",
            }
        committed = r.json()["workflow_revision"]
        revision_id = committed["id"]
        new_version = committed.get("version")

        # Fetch the revision back and compare on the wire (never trust the commit echo alone).
        r = api_call("GET", f"/workflows/revisions/{revision_id}")
        if r.status_code != 200:
            return {
                "pass": False,
                "why": f"fetch revision HTTP {r.status_code}: {r.text[:200]}",
            }
        fetched = r.json()["workflow_revision"]
        fetched_token = (
            (fetched.get("data") or {})
            .get("parameters", {})
            .get("agent", {})
            .get("instructions", {})
            .get("agents_md")
        )
        version_bumped = (
            seed_version == "0" and new_version == "1" and fetched.get("version") == "1"
        )
        ok = fetched_token == token and version_bumped
        return {
            "pass": ok,
            "why": (
                f"committed a new revision and read it back: token match={fetched_token == token}, "
                f"version {seed_version}->{new_version} (bumped={version_bumped})"
            ),
            "workflow_id": workflow_id,
            "revision_id": revision_id,
            "token": token,
        }
    finally:
        # Clean up so repeated runs don't accumulate QA workflows.
        if workflow_id:
            try:
                api_call("POST", f"/workflows/{workflow_id}/archive")
            except Exception:
                pass


# The wire name of an MCP-delivered tool is `mcp__<server>__<tool>` (verified on DeepWiki:
# `mcp__deepwiki__read_wiki_structure`). We give the agent NO builtin tools, so any tool call it
# makes is necessarily the MCP tool — and we still key the assertion on the `mcp__` prefix.
MCP_TOOL_RE = re.compile(r"^mcp__")


def j7_mcp(cell: dict) -> dict:
    """J7: an MCP server declared in the agent config is delivered to the harness, and one of its
    tools actually executes — proven by a `tool-output-available` frame for an `mcp__*` tool.

    Two hard constraints (both verified in the runner):
    - **Claude only.** Pi refuses any run that declares `mcps`
      (`run-plan.ts` PI_USER_MCP_UNSUPPORTED_MESSAGE); user MCP needs a harness with mcpTools
      (Claude). So this journey SKIPS on non-Claude cells.
    - **Public HTTPS only.** The SDK resolver and the runner both run an SSRF guard that rejects
      http:// and private/loopback/metadata hosts, so a local MCP server is unreachable from the
      deployment. --mcp-url must be a public HTTPS Streamable-HTTP endpoint (default: DeepWiki).

    The harness dials the URL directly (on `local`, from the runner host), so the endpoint must be
    reachable from the deployment's network.
    """
    if cell["harness"] != "claude":
        return {
            "skip": True,
            "why": f"MCP requires a Claude harness; Pi rejects any run with mcps (cell harness={cell['harness']}). Run with --cell C1.",
        }

    s = str(uuid.uuid4())
    mcp = {
        "name": "deepwiki",
        "connection": {"type": "http", "url": MCP_URL},
        "policy": {"tools": {"mode": "all"}},
    }
    prompt = (
        "Use the deepwiki MCP tool named read_wiki_structure with repoName 'facebook/react' to "
        "list the wiki topics, then reply with only: DONE."
    )
    t = invoke(
        s,
        [user_msg(prompt)],
        template(
            cell,
            tools=[],
            instructions="Use the available MCP tools when asked. Be terse.",
            permission_default="allow",
            mcps=[mcp],
        ),
    )

    mcp_calls = [c for c in t.tool_calls if MCP_TOOL_RE.match(c.get("toolName") or "")]
    mcp_ran = (
        any(t.tool_outcomes.get(c["toolCallId"]) == "available" for c in mcp_calls)
        and not t.errors
    )
    if not mcp_calls and not mcp_ran:
        why = (
            f"no mcp__* tool call was made against {MCP_URL} — the harness may not have reached "
            "the server, or the server exposed no tools. Check the runner log for MCP errors."
        )
    elif t.errors:
        why = f"an mcp__* tool executed against {MCP_URL} but the turn carried wire errors: {t.errors}"
    else:
        why = f"an mcp__* tool executed against {MCP_URL} (wire shows tool-output-available, no wire errors)"
    return {
        "pass": mcp_ran,
        "why": why,
        "mcp_url": MCP_URL,
        "mcp_tools_called": [c.get("toolName") for c in mcp_calls],
        "turn": t.summary(),
    }


JOURNEYS = {
    "chat": j1_chat,
    "mount": j2_mount,
    "tool": j3_tool,
    "approve": j4_approve,
    "deny": j4_deny,
    "commit": j5_commit,
    "warm": j6_warm,
    "mcp": j7_mcp,
}


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument(
        "--cell",
        action="append",
        choices=sorted(CELLS),
        help=f"one of {sorted(CELLS)} (default C3 if neither --cell nor --all is given)",
    )
    p.add_argument("--all", action="store_true")
    p.add_argument(
        "--only",
        action="append",
        choices=sorted(JOURNEYS),
        help=f"one of {sorted(JOURNEYS)}",
    )
    p.add_argument(
        "--custom-slug", help="vault slug of the custom OpenAI-compatible provider (P2)"
    )
    p.add_argument(
        "--mcp-url",
        help=f"public HTTPS MCP server URL for the `mcp` journey (default: {DEFAULT_MCP_URL})",
    )
    p.add_argument(
        "--model",
        help="override the cell's model (e.g. `haiku` on a Claude cell; aliases only on Claude — F-007)",
    )
    p.add_argument(
        "--env-file",
        help=f"credentials file (fallback when the env vars are unset; default {DEFAULT_ENV_FILE})",
    )
    args = p.parse_args()

    resolve_credentials(args.env_file)

    cells = list(CELLS) if args.all else (args.cell or ["C3"])
    journeys = args.only or list(JOURNEYS)
    if "P2" in cells and not args.custom_slug:
        # Fail fast, before creating a run directory or spending any journeys: P2 (OpenRouter as
        # a custom OpenAI-compatible provider) has no vault slug until --custom-slug is set, so
        # every P2 journey would otherwise just fail downstream and waste the rest of the matrix.
        raise SystemExit(
            "Cell P2 requires --custom-slug <vault slug of the custom OpenAI-compatible "
            "provider>. Pass it explicitly, or drop P2 with --cell (omit --all)."
        )
    if args.custom_slug:
        CELLS["P2"]["connection"]["slug"] = args.custom_slug
    if args.mcp_url:
        global MCP_URL
        MCP_URL = args.mcp_url
    if args.model:
        for cid in cells:
            CELLS[cid]["model"] = args.model

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
            verdict = "SKIP" if r.get("skip") else ("PASS" if r.get("pass") else "FAIL")
            print(verdict, f"— {r.get('why', '')[:90]}")
            (outdir / "results.json").write_text(json.dumps(results, indent=2))

    lines = ["| cell | harness | sandbox | model | " + " | ".join(journeys) + " |"]
    lines.append("|" + "---|" * (4 + len(journeys)))
    for cid, r in results.items():
        c = r["config"]
        cellstr = [
            (
                "SKIP"
                if r["journeys"][j].get("skip")
                else ("PASS" if r["journeys"][j].get("pass") else "FAIL")
            )
            for j in journeys
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
    # A release gate that always exits 0 is invisible to CI and release automation: a real FAIL
    # must fail the process, not just print red text a human might not read.
    failed = any(
        not journey.get("skip") and not journey.get("pass")
        for cell in results.values()
        for journey in cell["journeys"].values()
    )
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
