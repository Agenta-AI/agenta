# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27"]
# ///
"""W4: guards against the base-staleness check running only at gate time instead of execute
time -- session A raises its approval gate while holding base X, session B commits before A is
approved (head moves past X), THEN A is approved. The EXECUTE-TIME check must catch the
staleness and 409; a gate-time-only check would miss it and silently overwrite B's commit.

Same runner error-detail bug as W3 -- A's recovery is coached in the prompt (see matrix_w3.py's
docstring; fix on PR #5763).

  uv run matrix_w4.py
"""
import json
import pathlib
import sys
import time
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from qa_matrix_lib import (  # noqa: E402
    LIVE_TOOLS,
    agent_config,
    approval_reply,
    archive,
    create_workflow,
    invoke,
    latest_revision,
    refs,
    run_until_settled,
    seed_and_baseline,
    user_msg,
)

BASELINE = "Be terse. Do exactly what is asked."


def w4():
    hexid = uuid.uuid4().hex[:8]
    wf, var = create_workflow(hexid, "qa-w4")
    try:
        cfg = agent_config(instructions=BASELINE)
        rev_id, ver = seed_and_baseline(wf, var, cfg, hexid)
        live_params = {"agent": {**cfg, "tools": LIVE_TOOLS}}
        references = refs(wf, var, rev_id)
        token_a = f"QA-W4A-{uuid.uuid4().hex[:12]}"

        # Session A: raise the gate, but DO NOT approve yet.
        prompt_a = (
            "I'm the developer testing the config-editing feature. Please: 1) call "
            "read_config to get the base_revision_id, 2) call commit_revision with an "
            'edit_text operation targeting ["parameters","agent","instructions","agents_md"] '
            f"that replaces the exact text '{BASELINE}' with '{token_a}', using the "
            "base_revision_id you just read. There is an approval step I will handle. If "
            "that commit fails with a 409 conflict after I approve it (a stale "
            "base_revision_id, because someone else committed while you were waiting for "
            "approval), call read_config AGAIN to get the current base_revision_id, then "
            "retry the exact same edit_text operation with the fresh base_revision_id. Go "
            "ahead and make the two tool calls."
        )
        session_a = str(uuid.uuid4())
        t_a1 = invoke(session_a, [user_msg(prompt_a)], live_params, references)
        if t_a1.errors or not t_a1.approval:
            return {
                "status": "FAIL",
                "why": f"session A's gate never raised as expected: errors={t_a1.errors}",
                "turn_a1_frames": t_a1.frames,
            }
        # A is now PARKED, holding an authorization/approval tied to base=rev_id (v1).

        # Session B: commits cleanly against the SAME base, moving head past it.
        token_b = f"QA-W4B-{uuid.uuid4().hex[:12]}"
        prompt_b = (
            "I'm the developer testing the config-editing feature. Please: 1) call "
            "read_config to get the base_revision_id, 2) call commit_revision with an "
            'add_item operation targeting ["parameters","agent","skills"] that adds a new '
            'skill named "w4-session-b" with description "Added by session B" and body '
            f"'{token_b}', using the base_revision_id you just read. There is an approval "
            "step I will handle. Go ahead."
        )
        session_b = str(uuid.uuid4())
        turns_b, status_b = run_until_settled(session_b, [user_msg(prompt_b)], live_params, references)
        if not status_b["settled"]:
            return {"status": "FAIL", "why": f"session B never settled: {status_b}"}

        time.sleep(1.0)
        after_b = latest_revision(wf)
        b_landed = after_b is not None and int(after_b.get("version") or -1) > int(ver or -1)
        if not b_landed:
            return {"status": "FAIL", "why": "session B's edit did not land; cannot test A's staleness"}

        # NOW approve A. Its base (rev_id, v1) is stale -- head is now after_b's version.
        msgs_a = [user_msg(prompt_a), approval_reply(t_a1, approved=True)]
        # Continue A's session with a run_until_settled-style manual loop (starting from t_a1).
        turns_a = [t_a1]
        cur_msgs = msgs_a
        settled = False
        for _ in range(8):
            t = invoke(session_a, cur_msgs, live_params, references)
            turns_a.append(t)
            if t.errors:
                break
            if not t.approval:
                settled = True
                break
            cur_msgs = cur_msgs + [approval_reply(t, approved=True)]

        if not settled:
            return {
                "status": "FAIL",
                "why": "session A never settled after being approved post-staleness",
                "turns_a_frames": [t.frames for t in turns_a],
            }

        conflict_seen = False
        conflict_payload = None
        for t in turns_a:
            for tcid, outcome in t.tool_outcomes.items():
                payload = t.tool_payloads.get(tcid, {})
                blob = json.dumps(payload)
                if outcome == "error" and ("409" in blob or "conflict" in blob.lower()):
                    conflict_seen = True
                    conflict_payload = payload

        time.sleep(1.0)
        final = latest_revision(wf)
        final_agent = (final.get("data") or {}).get("parameters", {}).get("agent", {}) if final else {}
        a_edit_present = final_agent.get("instructions", {}).get("agents_md") == token_a
        b_skill = next(
            (s for s in final_agent.get("skills", []) if s.get("name") == "w4-session-b"), None
        )
        b_edit_present = b_skill is not None and token_b in json.dumps(b_skill.get("body"))

        core_ok = conflict_seen and a_edit_present and b_edit_present
        return {
            "status": "PASS" if core_ok else "FAIL",
            "why": (
                f"conflict_seen={conflict_seen} (execute-time base check caught the staleness "
                f"under a pending approval), a_edit_present={a_edit_present}, "
                f"b_edit_present={b_edit_present}. NOTE: A's recovery was explicitly coached "
                f"(runner error-detail bug in effect)."
            ),
            "workflow_id": wf,
            "session_a": session_a,
            "session_b": session_b,
            "conflict_payload": conflict_payload,
            "final_revision_id": final.get("id") if final else None,
            "turns_a_frames": [t.frames for t in turns_a],
            "turns_b_frames": [t.frames for t in turns_b],
        }
    finally:
        archive(wf)


if __name__ == "__main__":
    r = w4()
    print("\n=== W4 RESULT ===")
    print(json.dumps(r, indent=2, default=str))
