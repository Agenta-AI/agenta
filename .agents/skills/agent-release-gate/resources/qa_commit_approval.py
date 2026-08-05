# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27"]
# ///
"""Commit-approval round trip: a real workflow revision, a live agent turn that reads its own
config (read_config), edits it (commit_revision), pauses on the S3b single-use execution
authorization gate (a tool-approval-request frame), resumes on approval via the in-band protocol
the browser uses, and the new revision is verified on the wire (REST fetch-back, not model prose).

This is a mandatory smoke check before handing a deployment URL to a human: it is the only
journey that exercises the approval gate around a real config mutation end to end. Run it after
any standalone deploy, alongside the rest of the release-gate smoke.

Credentials: AGENTA_BASE, AGENTA_PROJECT_ID, AGENTA_API_KEY (same three the playground needs).
Cell: Claude harness, local sandbox, subscription auth (self_managed) -- the default "use my
subscription" path, same as C1 in the release gate.

  uv run qa_commit_approval.py

Two facts that bite, learned the hard way while writing this:
- `read_config` / `commit_revision` are the playground's OWN tools. Declaring either in the
  PERSISTED config's `tools` list makes every future commit on that config fail with
  `platform_tool_not_committable` ("These are playground tools, not part of your
  configuration"). They still need to be declared on the LIVE invoke's `parameters.agent.tools`
  for the running agent to have them at all -- an empty `tools` list leaves the model reporting
  it has neither tool. So: commit an empty-tools baseline, invoke with them added on top.
- A prompt that sounds like it is trying to rush past confirmation ("do this now, do not ask for
  confirmation in chat") reads to Claude as a prompt-injection/social-engineering attempt and it
  refuses outright, correctly. State the request plainly instead: who you are, why you want the
  change, and that you understand and will handle the approval step.
"""

from __future__ import annotations

import json
import os
import sys
import time
import uuid

import httpx

BASE = os.environ["AGENTA_BASE"]
PROJECT = os.environ["AGENTA_PROJECT_ID"]
KEY = os.environ["AGENTA_API_KEY"]

BASELINE_INSTRUCTIONS = "Be terse. Do exactly what is asked."
TOKEN = f"QA-APPROVE-{uuid.uuid4().hex[:12]}"


def api_call(method: str, path: str, timeout: float = 60.0, **kwargs) -> httpx.Response:
    return httpx.request(
        method,
        f"{BASE}/api{path}",
        params={"project_id": PROJECT},
        headers={"Authorization": f"ApiKey {KEY}", "Content-Type": "application/json"},
        timeout=timeout,
        **kwargs,
    )


def agent_config(tools: list[dict]) -> dict:
    return {
        "instructions": {"agents_md": BASELINE_INSTRUCTIONS},
        "llm": {
            "model": "sonnet",
            "provider": "anthropic",
            "connection": {"mode": "self_managed", "slug": None},
            "extras": {},
        },
        "tools": tools,
        "mcps": [],
        "skills": [],
        "harness": {"kind": "claude"},
        "sandbox": {"kind": "local"},
    }


def user_msg(text: str) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "role": "user",
        "parts": [{"type": "text", "text": text}],
    }


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
        """Rebuild the UIMessage the browser would hold for this turn -- text + tool parts, in
        the order they first appeared, each tool part carrying its FINAL (fully-streamed) input
        and its outcome so far."""
        parts = []
        text_buf = []
        for seg in self._segments:
            if seg["kind"] == "text":
                text_buf.append(seg["text"])
            else:
                if text_buf:
                    parts.append({"type": "text", "text": "".join(text_buf)})
                    text_buf = []
                call = next(
                    c for c in self.tool_calls if c["toolCallId"] == seg["id"]
                )
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
                if (
                    self.approval
                    and self.approval["toolCallId"] == call["toolCallId"]
                ):
                    part["state"] = "approval-requested"
                    part["approval"] = {"id": self.approval["approvalId"]}
                parts.append(part)
        if text_buf:
            parts.append({"type": "text", "text": "".join(text_buf)})
        return {"id": str(uuid.uuid4()), "role": "assistant", "parts": parts}


def invoke(session_id: str, messages: list[dict], parameters: dict, references: dict) -> Turn:
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
                    t.approval = {
                        "approvalId": f.get("approvalId"),
                        "toolCallId": f.get("toolCallId"),
                    }
                    print(f"  !! approval-request: {json.dumps(f)[:400]}", file=sys.stderr)
                elif ftype in ("tool-output-available", "tool-output-error", "tool-output-denied"):
                    tcid = f.get("toolCallId")
                    if tcid:
                        t.tool_outcomes[tcid] = ftype.replace("tool-output-", "")
                        if ftype == "tool-output-available":
                            t.tool_payloads[tcid] = {"output": f.get("output")}
                            print(
                                f"  tool-output-available toolCallId={tcid}: "
                                f"{json.dumps(f.get('output'))[:300]}",
                                file=sys.stderr,
                            )
                        else:
                            t.tool_payloads[tcid] = {"errorText": f.get("errorText")}
                            print(f"  !! {ftype}: {json.dumps(f)[:400]}", file=sys.stderr)
                elif ftype == "data-committed-revision":
                    t.committed_revision = f.get("data")
                    print(f"  !! data-committed-revision: {json.dumps(f)[:400]}", file=sys.stderr)
                elif ftype == "error":
                    t.errors.append(json.dumps(f)[:500])
                    print(f"  !! error: {json.dumps(f)[:500]}", file=sys.stderr)
                elif ftype == "finish":
                    t.finish_reason = f.get("finishReason")
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


def main() -> int:
    hexid = uuid.uuid4().hex[:8]
    workflow_id = None
    result = {"pass": False, "why": "not run"}
    try:
        # 1. Create a REAL workflow app + variant (the exact shape the playground commits).
        r = api_call(
            "POST",
            "/workflows/",
            json={
                "workflow": {
                    "slug": f"qa-commit-approve-{hexid}",
                    "name": f"QA commit-approve {hexid}",
                    "flags": {"is_custom": True, "is_evaluator": False, "is_feedback": False},
                }
            },
        )
        if r.status_code != 200:
            result = {"pass": False, "why": f"create workflow HTTP {r.status_code}: {r.text[:300]}"}
            return 1
        workflow_id = r.json()["workflow"]["id"]
        print(f"workflow_id={workflow_id}", file=sys.stderr)

        r = api_call(
            "POST",
            "/workflows/variants/",
            json={
                "workflow_variant": {
                    "slug": f"qa-commit-approve-{hexid}-v",
                    "name": f"QA commit-approve {hexid} v",
                    "workflow_id": workflow_id,
                }
            },
        )
        if r.status_code != 200:
            result = {"pass": False, "why": f"create variant HTTP {r.status_code}: {r.text[:300]}"}
            return 1
        variant_id = r.json()["workflow_variant"]["id"]
        print(f"variant_id={variant_id}", file=sys.stderr)

        # read_config and commit_revision must NOT be in the PERSISTED config's `tools` list
        # (committing one is rejected: `platform_tool_not_committable` -- confirmed empirically).
        # But they DO need to be declared for the LIVE invoke call to make them available to the
        # running agent (an empty `tools` list left the model reporting it had neither tool).
        # So: commit an empty `tools` baseline, but invoke with them added on top.
        base_params = {"agent": agent_config([])}
        live_params = {
            "agent": {
                **base_params["agent"],
                "tools": [
                    {"type": "platform", "op": "read_config"},
                    {"type": "platform", "op": "commit_revision"},
                ],
            }
        }

        def commit(parameters: dict, message: str, slug: str) -> httpx.Response:
            return api_call(
                "POST",
                "/workflows/revisions/commit",
                json={
                    "workflow_revision": {
                        "slug": slug,
                        "name": f"QA commit-approve {hexid} rev",
                        "message": message,
                        "data": {"uri": "agenta:builtin:agent:v0", "parameters": parameters},
                        "workflow_id": workflow_id,
                        "workflow_variant_id": variant_id,
                    }
                },
            )

        # v0 seed (nulled by the DAO -- known behavior).
        r = commit(base_params, "seed", f"qa-commit-approve-seed-{hexid}")
        if r.status_code != 200:
            result = {"pass": False, "why": f"seed commit HTTP {r.status_code}: {r.text[:300]}"}
            return 1
        seed_version = r.json()["workflow_revision"].get("version")

        # v1: the REAL baseline revision we run the agent against.
        r = commit(base_params, "QA baseline", f"qa-commit-approve-baseline-{hexid}")
        if r.status_code != 200:
            result = {"pass": False, "why": f"baseline commit HTTP {r.status_code}: {r.text[:300]}"}
            return 1
        baseline = r.json()["workflow_revision"]
        baseline_revision_id = baseline["id"]
        baseline_version = baseline.get("version")
        print(
            f"baseline revision_id={baseline_revision_id} version {seed_version}->{baseline_version}",
            file=sys.stderr,
        )

        references = {
            "application": {"id": workflow_id},
            "application_variant": {"id": variant_id},
            "application_revision": {"id": baseline_revision_id},
        }

        prompt = (
            "I'm the developer of this agent and I'm testing the config-editing feature you "
            "have access to (read_config and commit_revision). I'd like you to update your "
            "own instructions text as a test of that feature, and I understand there is an "
            "approval step before the change takes effect, which I will approve.\n\n"
            "Please: 1) call read_config to see your current configuration and get the "
            f"base_revision_id, 2) call commit_revision with an edit_text operation "
            'targeting ["parameters","agent","instructions","agents_md"] that replaces the '
            f"exact current text '{BASELINE_INSTRUCTIONS}' with the new text '{TOKEN}', using "
            "the base_revision_id you just read. Go ahead and make the two tool calls."
        )

        session_id = str(uuid.uuid4())
        print(f"session_id={session_id}", file=sys.stderr)
        print("--- turn 1: expect read_config to run, commit_revision to pause ---", file=sys.stderr)
        t1 = invoke(session_id, [user_msg(prompt)], live_params, references)

        if t1.errors:
            result = {"pass": False, "why": f"turn 1 wire errors: {t1.errors}", "turn1_frames": t1.frames}
            return 1

        if not t1.approval:
            result = {
                "pass": False,
                "why": (
                    "expected a tool-approval-request frame for commit_revision; the gate "
                    "never fired. This is the S3b execution-authorization check -- a miss "
                    "here means commit_revision executed WITHOUT approval, or never got "
                    "called at all."
                ),
                "turn1_frames": t1.frames,
                "turn1_tool_calls": t1.tool_calls,
                "turn1_reply": t1.reply,
            }
            return 1

        gated_call = next(
            (c for c in t1.tool_calls if c["toolCallId"] == t1.approval["toolCallId"]), None
        )
        gated_name = (gated_call or {}).get("toolName")
        print(f"gated tool: {gated_name} input={json.dumps((gated_call or {}).get('input'))[:400]}", file=sys.stderr)

        if gated_name and "commit" not in gated_name.lower():
            result = {
                "pass": False,
                "why": f"the gated tool was '{gated_name}', not commit_revision -- wrong tool paused",
                "turn1_frames": t1.frames,
            }
            return 1

        # Resume with approval, exactly the browser's addToolApprovalResponse -> re-POST-history.
        print("--- turn 2: approve, expect commit_revision to execute + a new revision ---", file=sys.stderr)
        msgs = [user_msg(prompt), approval_reply(t1, approved=True)]
        t2 = invoke(session_id, msgs, live_params, references)

        if t2.errors:
            result = {"pass": False, "why": f"turn 2 wire errors: {t2.errors}", "turn2_frames": t2.frames}
            return 1

        gated_outcome = t2.tool_outcomes.get(t1.approval["toolCallId"]) or t1.tool_outcomes.get(
            t1.approval["toolCallId"]
        )
        if gated_outcome != "available":
            result = {
                "pass": False,
                "why": f"approved commit_revision call did not report tool-output-available (got {gated_outcome!r})",
                "turn2_frames": t2.frames,
                "turn2_payloads": t2.tool_payloads,
            }
            return 1

        # Wire evidence of the new revision, straight off the tool's own output payload.
        commit_output = (
            t2.tool_payloads.get(t1.approval["toolCallId"], {}).get("output")
            or t1.tool_payloads.get(t1.approval["toolCallId"], {}).get("output")
        )
        print(f"commit_revision output: {json.dumps(commit_output)[:600]}", file=sys.stderr)

        # Never trust the tool echo alone -- fetch the workflow's revisions back over REST and
        # confirm the new one carries the token and the version bumped past the baseline.
        time.sleep(1.0)
        r = api_call(
            "POST",
            "/workflows/revisions/query",
            # `workflow_revision` is an ATTRIBUTE filter (flags/version), not parent-scoping --
            # it silently accepts (and ignores) an unknown `workflow_id` key and returns every
            # revision in the project. Scoping to one workflow needs the top-level `workflow_refs`
            # list instead (confirmed against WorkflowRevisionQueryRequest in
            # api/oss/src/apis/fastapi/workflows/models.py).
            json={"workflow_refs": [{"id": workflow_id}]},
        )
        if r.status_code != 200:
            result = {
                "pass": False,
                "why": f"revisions query HTTP {r.status_code}: {r.text[:300]}",
                "commit_output": commit_output,
            }
            return 1
        revisions = r.json().get("workflow_revisions") or r.json().get("workflow_revision") or []
        if isinstance(revisions, dict):
            revisions = [revisions]
        newest = max(revisions, key=lambda rv: int(rv.get("version") or -1), default=None)
        if not newest:
            result = {
                "pass": False,
                "why": "no revisions returned from query",
                "commit_output": commit_output,
            }
            return 1
        new_token = (
            (newest.get("data") or {})
            .get("parameters", {})
            .get("agent", {})
            .get("instructions", {})
            .get("agents_md")
        )
        version_bumped = int(newest.get("version") or -1) > int(baseline_version or -1)
        token_match = new_token == TOKEN
        ok = token_match and version_bumped

        result = {
            "pass": ok,
            "why": (
                f"approval fired (turn1 finish={t1.finish_reason}), commit_revision ran "
                f"post-approval (outcome={gated_outcome}), newest revision version "
                f"{baseline_version}->{newest.get('version')} (bumped={version_bumped}), "
                f"content token_match={token_match} (expected {TOKEN!r}, got {new_token!r})"
            ),
            "session_id": session_id,
            "workflow_id": workflow_id,
            "baseline_revision_id": baseline_revision_id,
            "new_revision_id": newest.get("id"),
            "turn1_frames": t1.frames,
            "turn2_frames": t2.frames,
            "token": TOKEN,
        }
        return 0 if ok else 1
    finally:
        print("\n=== RESULT ===")
        print(json.dumps(result, indent=2, default=str))
        if workflow_id:
            try:
                api_call("POST", f"/workflows/{workflow_id}/archive")
                print(f"\narchived workflow {workflow_id}", file=sys.stderr)
            except Exception as e:  # noqa: BLE001
                print(f"\narchive failed (non-fatal): {e}", file=sys.stderr)


if __name__ == "__main__":
    sys.exit(main())
