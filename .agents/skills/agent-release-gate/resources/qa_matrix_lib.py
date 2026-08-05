"""Shared helpers for the W1-W12 adversarial config-editing matrix (matrix_w3/w4/w5/w7.py).
Import-only, no CLI. Uses the smallest workable model (Claude haiku, subscription auth) to keep
these cheap to run repeatedly."""
from __future__ import annotations

import json
import os
import sys
import uuid

import httpx

BASE = os.environ["AGENTA_BASE"]
PROJECT = os.environ["AGENTA_PROJECT_ID"]
KEY = os.environ["AGENTA_API_KEY"]

MODEL = "haiku"
PROVIDER = "anthropic"


def api_call(method: str, path: str, timeout: float = 60.0, **kwargs) -> httpx.Response:
    return httpx.request(
        method,
        f"{BASE}/api{path}",
        params={"project_id": PROJECT},
        headers={"Authorization": f"ApiKey {KEY}", "Content-Type": "application/json"},
        timeout=timeout,
        **kwargs,
    )


def agent_config(tools: list[dict] | None = None, instructions: str = "Be terse.") -> dict:
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
    return {"id": str(uuid.uuid4()), "role": "user", "parts": [{"type": "text", "text": text}]}


def create_workflow(hexid: str, slug_prefix: str = "qa-matrix") -> tuple[str, str]:
    r = api_call(
        "POST",
        "/workflows/",
        json={
            "workflow": {
                "slug": f"{slug_prefix}-{hexid}",
                "name": f"QA matrix {hexid}",
                "flags": {"is_custom": True, "is_evaluator": False, "is_feedback": False},
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
    r = commit_direct(workflow_id, variant_id, params, "seed", f"qa-matrix-seed-{hexid}")
    if r.status_code != 200:
        raise RuntimeError(f"seed commit HTTP {r.status_code}: {r.text[:300]}")
    r = commit_direct(workflow_id, variant_id, params, "baseline", f"qa-matrix-baseline-{hexid}")
    if r.status_code != 200:
        raise RuntimeError(f"baseline commit HTTP {r.status_code}: {r.text[:300]}")
    rev = r.json()["workflow_revision"]
    return rev["id"], rev.get("version")


def read_config_direct(variant_id: str, path: list | None = None) -> httpx.Response:
    body = {"target": {"workflow_variant_id": variant_id}}
    if path is not None:
        body["target"]["path"] = path
    return api_call("POST", "/workflows/revisions/read-config", json=body)


def commit_agent_direct(
    base_revision_id: str, delta: dict, variant_id: str, description: str = ""
) -> httpx.Response:
    """Direct call to the SCOPED agent commit route, bypassing a live model (used where the
    matrix wants a raw-API probe rather than an agent-driven call: W6, W9, W10, W12).

    `workflow_variant_id` is normally injected by the runner from run context
    ($ctx.workflow.variant.id) when a live agent calls commit_revision -- a direct probe has no
    run context, so it must be supplied explicitly or the endpoint 400s asking for it."""
    return api_call(
        "POST",
        "/workflows/revisions/commit/agent",
        json={
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
        self.approval: dict | None = None
        self.finish_reason: str | None = None
        self.errors: list[str] = []
        self.committed_revision = None
        self._segments: list[dict] = []
        self.raw_frames: list[dict] = []

    @property
    def reply(self) -> str:
        return "".join(self.text_parts)

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
                    part["output"] = self.tool_payloads.get(call["toolCallId"], {}).get("output")
                elif outcome == "error":
                    part["state"] = "output-error"
                    part["errorText"] = self.tool_payloads.get(call["toolCallId"], {}).get(
                        "errorText"
                    )
                if self.approval and self.approval["toolCallId"] == call["toolCallId"]:
                    part["state"] = "approval-requested"
                    part["approval"] = {"id": self.approval["approvalId"]}
                parts.append(part)
        if text_buf:
            parts.append({"type": "text", "text": "".join(text_buf)})
        return {"id": str(uuid.uuid4()), "role": "assistant", "parts": parts}


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
            params={"project_id": PROJECT, "application_id": references["application"]["id"]},
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
                    is_new = not any(c["toolCallId"] == call["toolCallId"] for c in t.tool_calls)
                    t.tool_calls = [
                        c for c in t.tool_calls if c["toolCallId"] != call["toolCallId"]
                    ] + [call]
                    if is_new:
                        t._segments.append({"kind": "tool", "id": call["toolCallId"]})
                elif ftype == "tool-approval-request":
                    t.approval = {
                        "approvalId": f.get("approvalId"),
                        "toolCallId": f.get("toolCallId"),
                    }
                    if log:
                        print(f"  !! approval-request: {json.dumps(f)[:400]}", file=sys.stderr)
                elif ftype in ("tool-output-available", "tool-output-error", "tool-output-denied"):
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
                                print(f"  !! {ftype}: {json.dumps(f)[:400]}", file=sys.stderr)
                elif ftype == "data-committed-revision":
                    t.committed_revision = f.get("data")
                    if log:
                        print(f"  !! data-committed-revision: {json.dumps(f)[:400]}", file=sys.stderr)
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
    message = turn.assistant_message()
    for part in message["parts"]:
        if part.get("toolCallId") == turn.approval["toolCallId"]:
            part["state"] = "approval-responded"
            part["approval"] = {"id": turn.approval["approvalId"], "approved": approved}
            return message
    raise ValueError("gated tool call missing from assistant message")


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
            return turns, {"settled": False, "rounds": i + 1, "why": f"wire errors: {t.errors}"}
        if not t.approval:
            return turns, {"settled": True, "rounds": i + 1}
        msgs = msgs + [approval_reply(t, approved=approve)]
    return turns, {"settled": False, "rounds": max_rounds, "why": "max_rounds exhausted, still gated"}
