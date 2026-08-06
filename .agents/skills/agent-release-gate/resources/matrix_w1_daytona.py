# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27"]
# ///
"""TIER: coached (backend-path test). The prompt names the exact tool/operation/target -- this
proves the Daytona sandbox-creation, DaytonaWorkspaceReader, and placeholder-secrets path work,
not that a model reaches for read_config/commit_revision unprompted on Daytona. Do not cite for
model one-shot-discovery claims.

W1-Daytona: the commit round-trip (matrix_w3.py's session-A shape) with sandbox=daytona.
Daytona rejects subscription auth by design, so this cell uses a vault key
(connection.mode=agenta) instead of self_managed -- exercises DaytonaWorkspaceReader and the
Daytona sandbox-creation + placeholder-secrets flow live, distinct from every other cell in this
suite (all of which run local sandbox).

Needs a funded Anthropic (or OpenAI) vault key in the target project. If the vault is empty,
add one: POST /api/vault/v1/secrets/ with
{"slug": "...", "header": {"name": "..."}, "secret": {"kind": "provider_key",
"data": {"kind": "anthropic", "provider": {"key": "<key>"}}}}. Then reference it with
connection={"mode": "agenta", "slug": None} (a `provider_key`-kind secret's connection slug IS
its provider name, e.g. "anthropic" -- never the secret's own slug; `slug: None` resolves
unambiguously when the vault holds exactly one key per provider). Getting this wrong produces
either "connection '<slug>' not found for provider '<provider>'" (wrong slug) or "multiple
connections for provider '<provider>'" (more than one candidate, ambiguous with slug=None).

  uv run matrix_w1_daytona.py
"""

import json
import pathlib
import sys
import time
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from qa_matrix_lib import (  # noqa: E402
    approval_reply,
    archive,
    create_workflow,
    invoke,
    latest_revision,
    refs,
    seed_and_baseline,
    user_msg,
)

BASELINE = "Be terse. Do exactly what is asked."


def daytona_agent_config(tools):
    return {
        "instructions": {"agents_md": BASELINE},
        "llm": {
            "model": "haiku",
            "provider": "anthropic",
            "connection": {"mode": "agenta", "slug": None},
            "extras": {},
        },
        "tools": tools,
        "mcps": [],
        "skills": [],
        "harness": {"kind": "claude"},
        "sandbox": {"kind": "daytona"},
    }


DAYTONA_LIVE_TOOLS = [
    {"type": "platform", "op": "read_config"},
    {"type": "platform", "op": "commit_revision"},
]


def w1_daytona():
    hexid = uuid.uuid4().hex[:8]
    wf, var = create_workflow(hexid, "qa-w1dtn")
    try:
        # read_config/commit_revision must NOT be in the PERSISTED baseline's tools list
        # (platform_tool_not_committable) but ARE needed on the live invoke params.
        base_cfg = daytona_agent_config([])
        live_cfg = daytona_agent_config(DAYTONA_LIVE_TOOLS)
        rev_id, ver = seed_and_baseline(wf, var, base_cfg, hexid)
        references = refs(wf, var, rev_id)
        token = f"QA-W1DTN-{uuid.uuid4().hex[:12]}"

        prompt = (
            "I'm the developer testing the config-editing feature. Please: 1) call "
            "read_config to get the base_revision_id, 2) call commit_revision with an "
            'edit_text operation targeting ["parameters","agent","instructions","agents_md"] '
            f"that replaces the exact text '{BASELINE}' with '{token}', using the "
            "base_revision_id you just read. There is an approval step I will handle. Go "
            "ahead and make the two tool calls."
        )
        session_id = str(uuid.uuid4())
        t1 = invoke(session_id, [user_msg(prompt)], {"agent": live_cfg}, references)
        if t1.errors:
            return {
                "status": "FAIL",
                "why": f"turn1 wire errors: {t1.errors}",
                "turn1_frames": t1.frames,
            }
        if not t1.approval:
            return {
                "status": "FAIL",
                "why": "expected tool-approval-request; gate never fired",
                "turn1_frames": t1.frames,
                "turn1_reply": t1.reply,
            }
        msgs = [user_msg(prompt), approval_reply(t1, approved=True)]
        t2 = invoke(session_id, msgs, {"agent": live_cfg}, references)
        if t2.errors:
            return {
                "status": "FAIL",
                "why": f"turn2 wire errors: {t2.errors}",
                "turn2_frames": t2.frames,
            }
        outcome = t2.tool_outcomes.get(t1.approval["toolCallId"])
        if outcome != "available":
            payload = t2.tool_payloads.get(t1.approval["toolCallId"], {})
            return {
                "status": "FAIL",
                "why": f"approved call outcome={outcome!r}",
                "payload": payload,
                "turn2_frames": t2.frames,
            }

        time.sleep(1.0)
        newest = latest_revision(wf)
        new_token = (
            (newest.get("data") or {})
            .get("parameters", {})
            .get("agent", {})
            .get("instructions", {})
            .get("agents_md")
            if newest
            else None
        )
        version_bumped = newest is not None and int(newest.get("version") or -1) > int(
            ver or -1
        )
        token_match = new_token == token
        ok = version_bumped and token_match
        return {
            "status": "PASS" if ok else "FAIL",
            "why": f"version {ver}->{newest.get('version') if newest else None}, token_match={token_match}",
            "workflow_id": wf,
            "session_id": session_id,
            "new_revision_id": newest.get("id") if newest else None,
            "turn1_frames": t1.frames,
            "turn2_frames": t2.frames,
        }
    finally:
        archive(wf)


if __name__ == "__main__":
    r = w1_daytona()
    print("\n=== W1-DAYTONA RESULT ===")
    print(json.dumps(r, indent=2, default=str))
