"""Shared helpers for the W1-W12 adversarial config-editing matrix (matrix_w3/w4/w5/w7.py).
Import-only, no CLI. Uses the smallest workable model (Claude haiku, subscription auth) to keep
these cheap to run repeatedly."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import uuid
from urllib.parse import parse_qsl, urlsplit, urlunsplit

import httpx

BASE = os.environ["AGENTA_BASE"]
PROJECT = os.environ["AGENTA_PROJECT_ID"]
KEY = os.environ["AGENTA_API_KEY"]

MODEL = "haiku"
PROVIDER = "anthropic"

# Harness-kind and model-id gotchas, found live during the platform-guidance discovery
# verification (2026-08-06). Bake these in so nobody re-derives them the hard way:
#
#   - The Pi harness's kind enum value is "pi_core" -- the short name "pi" 500s at the
#     workflow-invoke layer (see matrix_w7_per_harness.py's HARNESSES dict, which already gets
#     this right).
#   - "pi_core" REJECTS a bare "haiku" model id; unlike codex (which accepts short curated
#     aliases like "gpt-5.6-luna" bare), pi_core needs the fully qualified
#     "claude-haiku-4-5". Passing bare "haiku" on pi_core is a silent footgun, not an obvious
#     400 -- verify against a real run before assuming a short alias carries over from claude.
PI_CORE_HARNESS_KIND = "pi_core"
PI_CORE_HAIKU_MODEL = "claude-haiku-4-5"


def api_call(method: str, path: str, timeout: float = 60.0, **kwargs) -> httpx.Response:
    # httpx REPLACES an URL-embedded query string entirely when `params=` is also given,
    # so a path like "/sessions/streams/?session_id=..." used to silently lose its query
    # to the hardcoded project_id (the endpoint then 422s with "Field required"). Merge
    # the path's query into the params dict instead — explicit `params=` kwargs win,
    # then project_id — so both spellings are safe for every caller. A path WITHOUT a
    # query and no extra params builds the exact same request as before.
    explicit = {"project_id": PROJECT, **(kwargs.pop("params", None) or {})}
    parsed = urlsplit(f"{BASE}/api{path}")
    url = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", parsed.fragment))
    # Keep the path's query as PAIRS (a dict would collapse repeated keys like
    # ?workflow_refs=a&workflow_refs=b); explicit params override any same-named pair.
    path_pairs = parse_qsl(parsed.query, keep_blank_values=True) if parsed.query else []
    params = [(k, v) for k, v in path_pairs if k not in explicit] + list(
        explicit.items()
    )
    return httpx.request(
        method,
        url,
        params=params,
        headers={"Authorization": f"ApiKey {KEY}", "Content-Type": "application/json"},
        timeout=timeout,
        **kwargs,
    )


def agent_config(
    tools: list[dict] | None = None, instructions: str = "Be terse."
) -> dict:
    return {
        "instructions": {"agents_md": instructions},
        "llm": {
            "model": MODEL,
            "provider": PROVIDER,
            "connection": {"mode": "self_managed", "slug": None},
            "extras": {},
        },
        "tools": tools or [],
        "mcps": [],
        "skills": [],
        "harness": {"kind": "claude"},
        "sandbox": {"kind": "local"},
    }


LIVE_TOOLS = [
    {"type": "platform", "op": "read_config"},
    {"type": "platform", "op": "commit_revision"},
]


def user_msg(text: str) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "role": "user",
        "parts": [{"type": "text", "text": text}],
    }


def create_workflow(hexid: str, slug_prefix: str = "qa-matrix") -> tuple[str, str]:
    r = api_call(
        "POST",
        "/workflows/",
        json={
            "workflow": {
                "slug": f"{slug_prefix}-{hexid}",
                "name": f"QA matrix {hexid}",
                "flags": {
                    "is_custom": True,
                    "is_evaluator": False,
                    "is_feedback": False,
                },
            }
        },
    )
    if r.status_code != 200:
        raise RuntimeError(f"create workflow HTTP {r.status_code}: {r.text[:300]}")
    workflow_id = r.json()["workflow"]["id"]

    r = api_call(
        "POST",
        "/workflows/variants/",
        json={
            "workflow_variant": {
                "slug": f"{slug_prefix}-{hexid}-v",
                "name": f"QA matrix {hexid} v",
                "workflow_id": workflow_id,
            }
        },
    )
    if r.status_code != 200:
        raise RuntimeError(f"create variant HTTP {r.status_code}: {r.text[:300]}")
    variant_id = r.json()["workflow_variant"]["id"]
    return workflow_id, variant_id


def commit_direct(
    workflow_id: str, variant_id: str, parameters: dict, message: str, slug: str
) -> httpx.Response:
    """The LEGACY/unscoped commit route -- not confined to parameters.agent. Used to set up
    baselines and to probe unscoped-write behavior (W6, W12)."""
    return api_call(
        "POST",
        "/workflows/revisions/commit",
        json={
            "workflow_revision": {
                "slug": slug,
                "name": f"QA matrix rev {slug}",
                "message": message,
                "data": {"uri": "agenta:builtin:agent:v0", "parameters": parameters},
                "workflow_id": workflow_id,
                "workflow_variant_id": variant_id,
            }
        },
    )


def seed_and_baseline(
    workflow_id: str, variant_id: str, agent_cfg: dict, hexid: str
) -> tuple[str, str]:
    """v0 seed (nulled by the DAO) then v1 baseline. Returns (baseline_revision_id, version)."""
    params = {"agent": agent_cfg}
    r = commit_direct(
        workflow_id, variant_id, params, "seed", f"qa-matrix-seed-{hexid}"
    )
    if r.status_code != 200:
        raise RuntimeError(f"seed commit HTTP {r.status_code}: {r.text[:300]}")
    r = commit_direct(
        workflow_id, variant_id, params, "baseline", f"qa-matrix-baseline-{hexid}"
    )
    if r.status_code != 200:
        raise RuntimeError(f"baseline commit HTTP {r.status_code}: {r.text[:300]}")
    rev = r.json()["workflow_revision"]
    return rev["id"], rev.get("version")


def _handler_call(
    call_ref: str, arguments: dict, timeout: float = 60.0
) -> httpx.Response:
    """Call a platform-tool handler through the generic `/tools/call` seam.

    The agent endpoints (`/workflows/revisions/read-config` and `.../commit/agent`) are
    gone: every detail of both was agent-shaped, so the logic moved behind registered
    handlers reached by call_ref. These probes take the same transport a live agent takes.

    The response is translated back into the shape these helpers have always returned, so
    gate cells keep reading `.status_code` and `.json()`. Note what HTTP status now means:
    the seam answers 200 for a domain FAILURE too, with `STATUS_CODE_ERROR` and the
    canonical error envelope in the content. A failure is surfaced here as a non-200 with
    the envelope as the body, so a cell that checks `status_code != 200` still sees a
    failure, and a cell that reads the body gets `code` / `retryable` / `next_step`.
    """
    response = api_call(
        "POST",
        "/tools/call",
        timeout=timeout,
        json={
            "data": {
                "id": f"qa-{uuid.uuid4().hex[:8]}",
                "function": {"name": call_ref, "arguments": arguments},
            }
        },
    )
    if response.status_code != 200:
        return response

    call = (response.json() or {}).get("call") or {}
    content = ((call.get("data") or {}).get("content")) or "null"
    status_code = ((call.get("status") or {}).get("code")) or "STATUS_CODE_OK"
    try:
        payload = json.loads(content)
    except (TypeError, json.JSONDecodeError):
        payload = {"raw": content}

    return httpx.Response(
        status_code=200 if status_code == "STATUS_CODE_OK" else 422,
        json=payload,
        request=response.request,
    )


def read_config_direct(variant_id: str, path: list | None = None) -> httpx.Response:
    target: dict = {"workflow_variant_id": variant_id}
    if path is not None:
        target["path"] = path
    return _handler_call("tools.agenta.read_config", {"target": target})


def commit_agent_direct(
    base_revision_id: str, delta: dict, variant_id: str, description: str = ""
) -> httpx.Response:
    """Direct call to the SCOPED agent commit route, bypassing a live model (used where the
    matrix wants a raw-API probe rather than an agent-driven call: W6, W9, W10, W12).

    `workflow_variant_id` is normally injected by the runner from run context
    ($ctx.workflow.variant.id) when a live agent calls commit_revision -- a direct probe has no
    run context, so it must be supplied explicitly or the endpoint 400s asking for it."""
    return _handler_call(
        "tools.agenta.commit_revision",
        {
            "description": description,
            "workflow_revision": {
                "base_revision_id": base_revision_id,
                "workflow_variant_id": variant_id,
                "delta": delta,
            },
        },
    )


def latest_revision(workflow_id: str) -> dict | None:
    """Fetch the newest revision for a workflow. `workflow_refs` is the correct parent-scoping
    filter -- `workflow_revision.workflow_id` is silently ignored (that field is an ATTRIBUTE
    filter, not parent-scoping) and returns every revision in the project, which produced a false
    FAIL in early matrix runs when an archived workflow's revision won a stale version tie-break."""
    r = api_call(
        "POST",
        "/workflows/revisions/query",
        json={"workflow_refs": [{"id": workflow_id}]},
    )
    if r.status_code != 200:
        raise RuntimeError(f"revisions query HTTP {r.status_code}: {r.text[:300]}")
    revisions = r.json().get("workflow_revisions") or []
    if not revisions:
        return None
    return max(revisions, key=lambda rv: int(rv.get("version") or -1))


def archive(workflow_id: str) -> None:
    try:
        api_call("POST", f"/workflows/{workflow_id}/archive")
    except Exception as e:  # noqa: BLE001
        print(f"archive failed (non-fatal): {e}", file=sys.stderr)


class Turn:
    def __init__(self) -> None:
        self.frames: list[str] = []
        self.text_parts: list[str] = []
        self.tool_calls: list[dict] = []
        self.tool_outcomes: dict[str, str] = {}
        self.tool_payloads: dict[str, dict] = {}
        # EVERY gate this turn raised, in raise order (a multi-gate turn raises one
        # `tool-approval-request` frame per call). The old single `approval` dict was
        # overwritten per frame, so only the LAST gate ever got answered and the rest
        # sat pending until their TTL.
        self.approvals: list[dict] = []
        self.finish_reason: str | None = None
        self.errors: list[str] = []
        self.committed_revision = None
        self._segments: list[dict] = []
        self.raw_frames: list[dict] = []

    @property
    def reply(self) -> str:
        return "".join(self.text_parts)

    @property
    def approval(self) -> dict | None:
        """The most recent raised gate — the back-compat single-gate view of `approvals`.

        Every existing caller reads truthiness plus `toolCallId`/`approvalId`; none assigns.
        """
        return self.approvals[-1] if self.approvals else None

    def assistant_message(self) -> dict:
        parts = []
        text_buf: list[str] = []
        for seg in self._segments:
            if seg["kind"] == "text":
                text_buf.append(seg["text"])
            else:
                if text_buf:
                    parts.append({"type": "text", "text": "".join(text_buf)})
                    text_buf = []
                call = next(c for c in self.tool_calls if c["toolCallId"] == seg["id"])
                part: dict = {
                    "type": f"tool-{call['toolName']}",
                    "toolCallId": call["toolCallId"],
                    "input": call["input"],
                    "state": "input-available",
                }
                outcome = self.tool_outcomes.get(call["toolCallId"])
                if outcome == "available":
                    part["state"] = "output-available"
                    part["output"] = self.tool_payloads.get(call["toolCallId"], {}).get(
                        "output"
                    )
                elif outcome == "error":
                    part["state"] = "output-error"
                    part["errorText"] = self.tool_payloads.get(
                        call["toolCallId"], {}
                    ).get("errorText")
                gate = next(
                    (
                        g
                        for g in self.approvals
                        if g["toolCallId"] == call["toolCallId"]
                    ),
                    None,
                )
                if gate:
                    part["state"] = "approval-requested"
                    part["approval"] = {"id": gate["approvalId"]}
                parts.append(part)
        if text_buf:
            parts.append({"type": "text", "text": "".join(text_buf)})
        return {"id": str(uuid.uuid4()), "role": "assistant", "parts": parts}


def _upsert_gate(approvals: list, gate: dict) -> None:
    """Refresh a re-raised gate in place; append only a newly raised toolCallId."""
    for i, g in enumerate(approvals):
        if g["toolCallId"] == gate["toolCallId"]:
            approvals[i] = gate
            return
    approvals.append(gate)


def invoke(
    session_id: str,
    messages: list[dict],
    parameters: dict,
    references: dict,
    log: bool = True,
) -> Turn:
    url = f"{BASE}/services/agent/v0/invoke"
    body = {
        "session_id": session_id,
        "references": references,
        "data": {"inputs": {"messages": messages}, "parameters": parameters},
    }
    headers = {
        "Authorization": f"ApiKey {KEY}",
        "Accept": "text/event-stream",
        "x-ag-messages-format": "vercel",
        "Content-Type": "application/json",
    }
    t = Turn()
    with httpx.Client(timeout=180.0) as client:
        with client.stream(
            "POST",
            url,
            params={
                "project_id": PROJECT,
                "application_id": references["application"]["id"],
            },
            json=body,
            headers=headers,
        ) as r:
            if log:
                print(f"  HTTP {r.status_code}", file=sys.stderr)
            if r.status_code >= 400:
                t.errors.append(f"HTTP {r.status_code}: {r.read().decode()[:1000]}")
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
                    t.errors.append(f"malformed SSE frame: {payload[:200]}")
                    continue
                t.raw_frames.append(f)
                ftype = f.get("type", "?")
                t.frames.append(ftype)
                if ftype == "text-delta":
                    delta = f.get("delta", "")
                    t.text_parts.append(delta)
                    if t._segments and t._segments[-1]["kind"] == "text":
                        t._segments[-1]["text"] += delta
                    else:
                        t._segments.append({"kind": "text", "text": delta})
                elif ftype == "tool-input-available":
                    call = {
                        "toolCallId": f.get("toolCallId"),
                        "toolName": f.get("toolName"),
                        "input": f.get("input"),
                    }
                    is_new = not any(
                        c["toolCallId"] == call["toolCallId"] for c in t.tool_calls
                    )
                    t.tool_calls = [
                        c for c in t.tool_calls if c["toolCallId"] != call["toolCallId"]
                    ] + [call]
                    if is_new:
                        t._segments.append({"kind": "tool", "id": call["toolCallId"]})
                elif ftype == "tool-approval-request":
                    gate = {
                        "approvalId": f.get("approvalId"),
                        "toolCallId": f.get("toolCallId"),
                    }
                    # Collect every raised gate; a re-raise for the same call refreshes
                    # its approval id in place without changing the raise order.
                    _upsert_gate(t.approvals, gate)
                    if log:
                        print(
                            f"  !! approval-request: {json.dumps(f)[:400]}",
                            file=sys.stderr,
                        )
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
                            if log:
                                print(
                                    f"  tool-output-available {tcid}: "
                                    f"{json.dumps(f.get('output'))[:300]}",
                                    file=sys.stderr,
                                )
                        else:
                            t.tool_payloads[tcid] = {"errorText": f.get("errorText")}
                            if log:
                                print(
                                    f"  !! {ftype}: {json.dumps(f)[:400]}",
                                    file=sys.stderr,
                                )
                elif ftype == "data-committed-revision":
                    t.committed_revision = f.get("data")
                    if log:
                        print(
                            f"  !! data-committed-revision: {json.dumps(f)[:400]}",
                            file=sys.stderr,
                        )
                elif ftype == "error":
                    t.errors.append(json.dumps(f)[:500])
                    if log:
                        print(f"  !! error: {json.dumps(f)[:500]}", file=sys.stderr)
                elif ftype == "finish":
                    t.finish_reason = f.get("finishReason")
                    if log:
                        print(f"  !! finish: {json.dumps(f)[:400]}", file=sys.stderr)
    return t


def approval_reply(turn: Turn, approved: bool) -> dict:
    """One assistant message answering EVERY gate the turn raised.

    A multi-gate turn (a parallel batch) raises one `tool-approval-request` frame per
    call; answering only one leaves the rest pending until their TTL. Each raised gate
    gets the same `approved` value. A single-gate turn produces the exact message this
    always produced."""
    if not turn.approvals:
        raise ValueError("turn raised no approval gate")
    message = turn.assistant_message()
    by_tool_call = {g["toolCallId"]: g for g in turn.approvals}
    answered = 0
    for part in message["parts"]:
        gate = by_tool_call.get(part.get("toolCallId"))
        if gate is None:
            continue
        part["state"] = "approval-responded"
        part["approval"] = {"id": gate["approvalId"], "approved": approved}
        answered += 1
    if answered != len(by_tool_call):
        raise ValueError("gated tool call missing from assistant message")
    return message


def turn_ledger(session_id: str, limit: int = 20) -> list[dict]:
    """The session's turn rows, newest first.

    THE ONLY CONTINUITY SIGNAL A PURE HTTP CLIENT CAN SEE. Nothing about warm-versus-cold ever
    reaches the SSE stream, so an assertion built on the reply text cannot tell a reused daemon
    from a rebuilt one. The runner writes `agent_session_id` and `sandbox_id` on every turn
    (`services/runner/src/engines/sandbox_agent/run-turn.ts` -> `appendSessionTurn` ->
    `POST /sessions/turns/`), which makes this a STORED outcome rather than an echo.

    Returns [] when the ledger is unavailable, which callers must treat as MISSING EVIDENCE and
    fail on -- never as evidence of stability."""
    r = api_call(
        "POST",
        "/sessions/turns/query",
        json={
            "query": {"session_id": session_id},
            "windowing": {"limit": limit, "order": "descending"},
        },
    )
    if r.status_code != 200:
        return []
    return r.json().get("turns") or []


def ledger_ids(session_id: str) -> tuple[list[str], list[str]]:
    """(agent_session_ids, sandbox_ids) across the session's ledger, de-duplicated.

    ONE sandbox id  = the sandbox was never replaced (warm reuse, an applied-in-place config
                      change, or a park/reconnect -- a stopped sandbox keeps its id).
    TWO sandbox ids = the sandbox was deleted and rebuilt.

    The agent session id deliberately SURVIVES a rebuild (preserving it is the entire job of the
    session-continuity store), so it is corroboration, never the verdict."""
    rows = turn_ledger(session_id)
    agents = list(
        {r.get("agent_session_id") for r in rows if r.get("agent_session_id")}
    )
    sandboxes = list({r.get("sandbox_id") for r in rows if r.get("sandbox_id")})
    return agents, sandboxes


def interactions(session_id: str, limit: int = 50) -> list[dict]:
    """The session's stored interaction rows (approvals, client tools, user input).

    The second STORED outcome this matrix asserts on. Every approval gate and every client-tool
    call writes a row here with a `kind` and a lifecycle `status`
    (`api/oss/src/core/sessions/interactions/dtos.py`):

      pending   -- awaiting a reaction
      responded -- answered through the interactions API plane
      resolved  -- answered in-band, through the messages plane (what the playground does)
      cancelled -- the runner abandoned the gate; nobody is waiting on the token

    `cancelled` is the one that matters for lifecycle testing: it is the difference between an
    approval that died LOUDLY (a row a client can see and re-render) and one that died silently
    while the card sat on the page forever."""
    r = api_call(
        "POST",
        "/sessions/interactions/query",
        json={
            "query": {"session_id": session_id},
            "windowing": {"limit": limit, "order": "descending"},
        },
    )
    if r.status_code != 200:
        return []
    return r.json().get("interactions") or []


def interaction_states(session_id: str) -> list[tuple[str, str]]:
    """[(kind, status)] for the session's interaction rows, newest first. Convenience over
    `interactions` for the common assertion "no approval row was left `pending`"."""
    return [
        (row.get("kind") or "?", row.get("status") or "?")
        for row in interactions(session_id)
    ]


def refs(workflow_id: str, variant_id: str, revision_id: str) -> dict:
    return {
        "application": {"id": workflow_id},
        "application_variant": {"id": variant_id},
        "application_revision": {"id": revision_id},
    }


def run_until_settled(
    session_id: str,
    initial_msgs: list[dict],
    parameters: dict,
    references: dict,
    approve: bool = True,
    max_rounds: int = 6,
) -> tuple[list[Turn], dict]:
    """Some flows raise MORE THAN ONE approval gate in sequence (e.g. W7: a gated bash write,
    THEN a gated commit_revision once the write completes). Keep invoking and auto-answering
    every gate the same way until a turn finishes with no pending approval, or max_rounds is
    hit. Returns (all turns in order, {"settled": bool, "rounds": n})."""
    turns: list[Turn] = []
    msgs = list(initial_msgs)
    for i in range(max_rounds):
        t = invoke(session_id, msgs, parameters, references)
        turns.append(t)
        if t.errors:
            return turns, {
                "settled": False,
                "rounds": i + 1,
                "why": f"wire errors: {t.errors}",
            }
        if not t.approval:
            return turns, {"settled": True, "rounds": i + 1}
        msgs = msgs + [approval_reply(t, approved=approve)]
    return turns, {
        "settled": False,
        "rounds": max_rounds,
        "why": "max_rounds exhausted, still gated",
    }


# ---------------------------------------------------------------------------
# An exhausted provider key is an ENVIRONMENT condition, not a defect. A cell that renders it as
# FAIL spends a reviewer's attention on a topped-up balance, and worse, it teaches the reader that
# this cell's FAIL is sometimes noise -- which is how a real regression gets waved through later.
# Cells already SKIP on a missing or ambiguous vault credential; a key with no credit left belongs
# in the same class, and reads the same way to a human: nothing about the product was tested.
#
# Recognition is deliberately narrow. It matches the runner's own classified copy, never a bare
# 401 or a rate limit. Source of truth for every string below:
# `services/runner/src/engines/sandbox_agent/errors.ts`.

#: The runner's coded classes for a credits refusal at the proxy's admission check.
STARTER_CREDIT_CODES = (
    "starter_credits_exhausted",
    "starter_credits_program_paused",
    "starter_credits_unavailable",
)

#: Billing-stop prose. The first group is the runner's own user-facing credits copy; the second is
#: the upstream provider's billing refusal, which the runner classifies as `runner_error`, so the
#: code alone cannot catch it. Throttling ("rate limit", "too many requests") is deliberately
#: ABSENT: a throttled run was not out of credit and must stay a FAIL.
_OUT_OF_CREDIT_RE = re.compile(
    r"free agenta credits are (?:used up|paused)"
    r"|agenta credits are temporarily unavailable"
    r"|the model provider account has insufficient credit"
    r"|insufficient credit"
    r"|no credits remaining"
    r"|credit balance is too low"
    r"|exceeded your current quota"
    r"|insufficient_quota"
    r"|budget_exceeded"
    r"|budget has been exceeded",
    re.I,
)


def out_of_credit(error_text: str = "", codes: "list | tuple" = ()) -> str | None:
    """The SKIP reason when a run failed ONLY because the provider key has no credit left.

    Returns the explanation to report, or None when the failure is anything else -- in which case
    the caller must keep its FAIL. Pass the run's stored/classified error text and any coded
    `data-agent-error` classes it carried.
    """
    for code in codes or ():
        if code in STARTER_CREDIT_CODES:
            return f"environment: provider key out of credit ({code})"
    if error_text and _OUT_OF_CREDIT_RE.search(error_text):
        return "environment: provider key out of credit"
    return None


# ---------------------------------------------------------------------------
# The generic invariant: no tool_result with empty output and isError:false may exist for a call
# whose runner log says "[commit-auth] refused" (the silent-blank-success class). Added after the
# Codex approve-then-fail P0 triage found that W7 covered only Claude, so this reusable check is
# meant to ride along on EVERY cell that exercises commit_revision with a workspace-file marker
# (matrix_w7*.py, matrix_t8_saved_files.py) rather than living in one standalone script -- the
# condition it guards is a rare defense-in-depth failure (a call that WAS approved still refuses
# at execute time: a stale cold-resume record, a digest/generation mismatch, a lost race), not
# something every run can be relied on to reproduce. A run that never triggers a refusal is not
# a false pass: `refusals` is simply empty and `violations` is trivially empty too. What this
# guards against is the P0's actual shape -- the runner log said refused, but the wire told the
# human (and this suite) a blank success.
def runner_log_lines(container: str, since: str = "5m") -> list[str]:
    """Recent lines from a runner container's docker logs, oldest first. LOCAL/dev-box only --
    needs docker access to the target deployment. On a remote deployment, fetch the log text by
    whatever operator channel exists and pass it straight to `check_no_blank_success_on_refusal`
    instead of calling this."""
    try:
        out = subprocess.run(
            ["docker", "logs", container, "--since", since],
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.SubprocessError) as e:
        raise RuntimeError(f"docker logs {container} failed: {e}") from e
    return (out.stdout + out.stderr).splitlines()


_REFUSED_RE = re.compile(r"\[commit-auth\] refused .*\bcall=(\S+)")


def refused_call_ids(log_lines: list[str]) -> list[str]:
    """Every toolCallId a `[commit-auth] refused ...` log line named, in log order."""
    ids = []
    for line in log_lines:
        m = _REFUSED_RE.search(line)
        if m:
            ids.append(m.group(1))
    return ids


def check_no_blank_success_on_refusal(turns: list[Turn], log_lines: list[str]) -> dict:
    """The invariant itself: for every toolCallId the runner logged as `[commit-auth] refused`,
    the SAME call's wire outcome (across all turns) must NOT be an "available" tool-output with
    empty/falsy content. A refusal must surface as an error or a denial on the wire -- never as a
    blank "available" that reads as success. Returns {"refusals": [...], "violations": [...]}; a
    cell should treat any non-empty `violations` as an automatic FAIL regardless of what its own
    scenario-specific assertions say."""
    refused_ids = refused_call_ids(log_lines)
    violations = []
    for call_id in refused_ids:
        for t in turns:
            if call_id not in t.tool_outcomes:
                continue
            outcome = t.tool_outcomes[call_id]
            payload = t.tool_payloads.get(call_id, {})
            if outcome == "available" and not payload.get("output"):
                violations.append(
                    {
                        "toolCallId": call_id,
                        "outcome": outcome,
                        "payload": payload,
                    }
                )
    return {"refusals": refused_ids, "violations": violations}


# Frame types that carry no content: the stream scaffolding, the model's private reasoning, and
# the error frames. Everything else the adapter emits IS content — text, tool input/output,
# approval requests, `file`, attachment delivery, and every `data-<name>` payload.
#
# This mirrors `content_parts_emitted` in the product's own egress
# (`sdks/python/agenta/sdk/agents/adapters/vercel/stream.py`), which counts message/message_delta,
# tool_call, tool_result, interaction_request, data, file and attachment_delivery, and does NOT
# count reasoning, usage, done, or error. Keep the two definitions in step: if the adapter starts
# counting a new event as content, a turn carrying only that event stops being silent.
#
# It is a deny-list on purpose. `data-<name>` payloads are open-ended, so an allow-list would
# treat an unknown-but-real content frame as silence and FAIL a healthy turn. A deny-list errs the
# other way — an unrecognised frame reads as content — which can only ever under-report.
_NON_CONTENT_FRAMES = frozenset(
    {
        "start",
        "start-step",
        "finish-step",
        "finish",
        "reasoning-start",
        "reasoning-delta",
        "reasoning-end",
        "error",
        "data-agent-error",
    }
)
_TEXT_FRAMES = frozenset({"text-start", "text-delta", "text-end"})


def _turn_produced_content(turn: Turn) -> bool:
    """Did this turn put anything in front of the user (by the product's own definition)?"""
    if turn.reply.strip():
        return True
    for frame in turn.frames:
        if frame in _NON_CONTENT_FRAMES:
            continue
        # Text frames arrived but the reply is blank/whitespace: nothing was actually said.
        if frame in _TEXT_FRAMES:
            continue
        return True
    return False


def check_no_silent_turn(turns: list[Turn]) -> dict:
    """The silent-turn invariant: a turn that said nothing, did nothing, asked nothing, and
    reported nothing must never be treated as a completed turn.

    That combination is the signature of a swallowed provider failure (ASD-EST100): the model
    call is rejected, the error is dropped on the way back, and the turn arrives as a clean
    empty finish. The user sees a blank bubble with no reason anywhere. It is dangerous precisely
    in cells whose PASS depends on something NOT appearing — a turn that produced nothing also
    produced no error, no leak, and no blank success, so it satisfies those cells by doing
    nothing at all.

    A turn is NOT silent when it produced any content frame (text, a tool call or result, an
    approval request, a file, an attachment delivery, any `data-<name>` payload) or carried an
    error. So a parked turn (which raises a gate) and a failed turn (which carries an error) both
    pass. Returns {"violations": [...]}; a cell should treat any non-empty `violations` as an
    automatic FAIL regardless of its own assertions. The one case a cell must filter out itself
    is a turn it deliberately aborted or interrupted, which legitimately ends bare — pass only
    the turns that were meant to answer (see `matrix_w5.py`, which excludes its interrupted turn).
    """
    violations = []
    for index, turn in enumerate(turns):
        if _turn_produced_content(turn) or turn.errors:
            continue
        violations.append(
            {
                "turn": index,
                "finishReason": turn.finish_reason,
                "frames": list(turn.frames),
            }
        )
    return {"violations": violations}
