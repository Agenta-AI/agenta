# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27"]
# ///
"""W3: guards against the optimistic-concurrency base check silently accepting a stale commit or
losing one side of a two-writer conflict -- two sessions, disjoint edits, one must 409 on a stale
base_revision_id and recover; asserts BOTH edits land in the final head.

NOTE per team-lead direction (runner bug: commit-revision errors lose all structured detail on
the wire -- see product-bug report): the prompt EXPLICITLY coaches the retry mechanics (call
read_config again on a 409, retry with the fresh base_revision_id). This tests that the base
check correctly rejects a stale commit and that a coached retry lands cleanly -- it does NOT test
whether the model can discover the retry path from the error text alone (impossible right now,
since the wire only shows a bare HTTP status). A follow-up W3-discovery run (no coaching) is owed
once the runner fix lands (PR #5763).

  uv run matrix_w3.py
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
    archive,
    create_workflow,
    latest_revision,
    refs,
    run_until_settled,
    seed_and_baseline,
    user_msg,
)

BASELINE = "Be terse. Do exactly what is asked."


def w3():
    hexid = uuid.uuid4().hex[:8]
    wf, var = create_workflow(hexid, "qa-w3")
    try:
        cfg = agent_config(instructions=BASELINE)
        rev_id, ver = seed_and_baseline(wf, var, cfg, hexid)
        live_params = {"agent": {**cfg, "tools": LIVE_TOOLS}}
        references = refs(wf, var, rev_id)
        token_a = f"QA-W3A-{uuid.uuid4().hex[:12]}"

        # Session A: edit_text on instructions.agents_md. Commits FIRST -- lands cleanly.
        prompt_a = (
            "I'm the developer testing the config-editing feature. Please: 1) call "
            "read_config to get the base_revision_id, 2) call commit_revision with an "
            'edit_text operation targeting ["parameters","agent","instructions","agents_md"] '
            f"that replaces the exact text '{BASELINE}' with '{token_a}', using the "
            "base_revision_id you just read. There is an approval step I will handle. Go "
            "ahead and make the two tool calls."
        )
        session_a = str(uuid.uuid4())
        turns_a, status_a = run_until_settled(session_a, [user_msg(prompt_a)], live_params, references)
        if not status_a["settled"]:
            return {"status": "FAIL", "why": f"session A never settled: {status_a}"}

        time.sleep(1.0)
        after_a = latest_revision(wf)
        a_landed = after_a is not None and int(after_a.get("version") or -1) > int(ver or -1)
        if not a_landed:
            return {
                "status": "FAIL",
                "why": "session A's edit did not land",
                "turns_a_frames": [t.frames for t in turns_a],
            }

        # Session B: read_config was done AGAINST THE OLD BASE (simulating a session that
        # started concurrently, before A committed) -- add_item a new skill, disjoint from A's
        # edit, but its base_revision_id is now stale (head moved to A's revision).
        prompt_b = (
            "I'm the developer testing the config-editing feature, and testing conflict "
            "recovery specifically. Please: 1) call read_config to get the base_revision_id, "
            "2) call commit_revision with an add_item operation targeting "
            '["parameters","agent","skills"] that adds a new skill named "w3-session-b" with '
            'description "Added by session B" and body "test", using the '
            f"base_revision_id '{rev_id}' (NOT the one from your read_config call -- use this "
            "exact stale id, on purpose, to test conflict handling). If that commit fails "
            "with a 409 conflict (a stale base_revision_id), call read_config AGAIN to get "
            "the current base_revision_id, then retry the exact same add_item operation with "
            "the fresh base_revision_id. There is an approval step for each attempt, which I "
            "will handle. Go ahead."
        )
        session_b = str(uuid.uuid4())
        turns_b, status_b = run_until_settled(
            session_b, [user_msg(prompt_b)], live_params, references, max_rounds=10
        )
        if not status_b["settled"]:
            return {
                "status": "FAIL",
                "why": f"session B never settled: {status_b}",
                "turns_b_frames": [t.frames for t in turns_b],
            }

        # Look for the conflict signal anywhere in session B's tool outcomes.
        conflict_seen = False
        conflict_payload = None
        for t in turns_b:
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
            (s for s in final_agent.get("skills", []) if s.get("name") == "w3-session-b"), None
        )
        b_edit_present = b_skill is not None
        final_version_high_enough = final is not None and int(final.get("version") or -1) >= int(
            after_a.get("version") or -1
        ) + 1

        core_ok = conflict_seen and a_edit_present and b_edit_present and final_version_high_enough
        return {
            "status": "PASS" if core_ok else "FAIL",
            "why": (
                f"conflict_seen={conflict_seen}, a_edit_present={a_edit_present}, "
                f"b_edit_present={b_edit_present}, final_version_high_enough={final_version_high_enough} "
                f"(after_a v{after_a.get('version')}, final v{final.get('version') if final else None}). "
                f"NOTE: retry was explicitly coached in the prompt (runner error-detail bug in "
                f"effect); this tests mechanics, not model-driven discovery of the recovery path."
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
    r = w3()
    print("\n=== W3 RESULT ===")
    print(json.dumps(r, indent=2, default=str))
