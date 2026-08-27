# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27"]
# ///
"""TIER: coached (backend-path test). Both prompts name the mechanism verbatim (which tool,
which operation, which target path) for the INITIAL action in each session -- this cell proves
the base-check and error-detail plumbing work, not that a model discovers the mechanism from a
plain-language ask. The one mechanism-blind sliver inside it: session B's RECOVERY from the 409
is not coached (see below) -- but that is a narrow claim about recovering from a named failure,
not evidence a model can find commit_revision/read_config unprompted in the first place. Do not
cite this cell for "the model can edit its own config one-shot from a human ask" -- that claim
needs a mechanism-blind cell (Tier B, the one-shot benchmark).

W3: guards against the optimistic-concurrency base check silently accepting a stale commit,
AND against the instructive-error design regressing (a 409 must let the model find its own way
back without being coached). Two sessions, disjoint edits: session A commits cleanly; session B
is deliberately given a stale base_revision_id and ZERO coaching on what to do if it fails.

Two-tier pass, per team-lead ruling 2026-08-06 (post PR #5763, which passes the change-set
engine's structured error detail through to the model instead of a bare HTTP status):
  - STAGE 1 (autonomous correct recovery): session B hits the 409, retries on its own
    initiative with a fresh base_revision_id, and both edits land. PASS outright.
  - STAGE 2 (diagnose-and-ask): session B hits the 409, correctly explains the conflict and
    names the recovery step in its reply, but stops and asks before re-attempting a config
    write. This is DESIRABLE behavior, not a failure -- the guarded failure mode is a silent
    WRONG retry, not a model that checks before mutating config on a rejected commit. Send one
    bare permission nudge ("yes, retry") with no mechanics coached; if both edits land after
    that, PASS.
  - Anything else -- the model doesn't recognize the conflict, gives up, corrupts the edit, or
    fails to land even after being told to retry -- FAILS.

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
    approval_reply,
    archive,
    check_no_silent_turn,
    create_workflow,
    invoke,
    latest_revision,
    refs,
    run_until_settled,
    seed_and_baseline,
    user_msg,
)

BASELINE = "Be terse. Do exactly what is asked."


def _edits_present(wf, token_a, skill_name):
    final = latest_revision(wf)
    final_agent = (
        (final.get("data") or {}).get("parameters", {}).get("agent", {})
        if final
        else {}
    )
    a_present = final_agent.get("instructions", {}).get("agents_md") == token_a
    b_skill = next(
        (s for s in final_agent.get("skills", []) if s.get("name") == skill_name), None
    )
    b_present = b_skill is not None
    return a_present, b_present, final


def w3():
    hexid = uuid.uuid4().hex[:8]
    wf, var = create_workflow(hexid, "qa-w3")
    try:
        cfg = agent_config(instructions=BASELINE)
        rev_id, ver = seed_and_baseline(wf, var, cfg, hexid)
        live_params = {"agent": {**cfg, "tools": LIVE_TOOLS}}
        references = refs(wf, var, rev_id)
        token_a = f"QA-W3A-{uuid.uuid4().hex[:12]}"
        skill_name = "w3-session-b"

        # Session A: commits cleanly first, establishing the stale base for session B.
        prompt_a = (
            "I'm the developer testing the config-editing feature. Please: 1) call "
            "read_config to get the base_revision_id, 2) call commit_revision with an "
            'edit_text operation targeting ["parameters","agent","instructions","agents_md"] '
            f"that replaces the exact text '{BASELINE}' with '{token_a}', using the "
            "base_revision_id you just read. There is an approval step I will handle. Go "
            "ahead and make the two tool calls."
        )
        session_a = str(uuid.uuid4())
        turns_a, status_a = run_until_settled(
            session_a, [user_msg(prompt_a)], live_params, references
        )
        if not status_a["settled"]:
            return {"status": "FAIL", "why": f"session A never settled: {status_a}"}
        time.sleep(1.0)
        after_a = latest_revision(wf)
        if not (after_a and int(after_a.get("version") or -1) > int(ver or -1)):
            return {"status": "FAIL", "why": "session A's edit did not land"}

        # Session B: NO coaching. Told to use a specific stale base_revision_id, on purpose,
        # and left to handle any failure entirely on its own.
        prompt_b = (
            "I'm the developer testing the config-editing feature. Please call commit_revision "
            'with an add_item operation targeting ["parameters","agent","skills"] that adds a '
            f'new skill named "{skill_name}" with description "Added by session B" and body '
            f"\"test\", using the base_revision_id '{rev_id}' exactly (do not call read_config "
            "first -- use that exact id). There is an approval step I will handle. Go ahead."
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

        conflict_seen = any(
            outcome == "error"
            and (
                "409" in json.dumps(t.tool_payloads.get(tcid, {}))
                or "conflict" in json.dumps(t.tool_payloads.get(tcid, {})).lower()
            )
            for t in turns_b
            for tcid, outcome in t.tool_outcomes.items()
        )
        if not conflict_seen:
            return {
                "status": "FAIL",
                "why": "expected a 409 conflict on session B's stale base_revision_id; never saw one",
                "turns_b_frames": [t.frames for t in turns_b],
            }

        a_present, b_present, final = _edits_present(wf, token_a, skill_name)
        if a_present and b_present:
            # Both edits landing says nothing about HOW the sessions got there: a session can
            # land its edit and still hand the user a bare turn (ASD-EST100). Stage 2 folds the
            # same invariant in, and this cell is the only one with a second PASS path -- an
            # unguarded early return here would be a hole the gate cannot see.
            silent = check_no_silent_turn(turns_a + turns_b)
            stage1_ok = not silent["violations"]
            return {
                "status": "PASS" if stage1_ok else "FAIL",
                "why": (
                    "STAGE 1: session B recovered autonomously (no coaching) and both edits "
                    f"landed; silent_turns={silent['violations']}"
                ),
                "stage": 1,
                "workflow_id": wf,
                "session_a": session_a,
                "session_b": session_b,
                "final_revision_id": final.get("id") if final else None,
            }

        # STAGE 2: session B likely diagnosed the conflict and asked rather than auto-retrying.
        # Confirm the diagnosis is coherent (names the conflict), then send ONE bare permission
        # nudge -- no mechanics, no mention of read_config -- and see if it completes.
        last_reply = turns_b[-1].reply if turns_b else ""
        diagnosed = any(
            kw in last_reply.lower()
            for kw in ("conflict", "stale", "409", "base_revision")
        )
        if not diagnosed:
            return {
                "status": "FAIL",
                "why": (
                    "session B hit the 409 but its reply does not show a coherent diagnosis "
                    "(no mention of conflict/stale/base_revision) and neither edit landed"
                ),
                "last_reply": last_reply,
                "turns_b_frames": [t.frames for t in turns_b],
            }

        t_nudge = invoke(
            session_b, [user_msg("Yes, please retry.")], live_params, references
        )
        cur_msgs = [user_msg("Yes, please retry.")]
        cur_t = t_nudge
        nudge_turns = [t_nudge]
        settled2 = not t_nudge.approval and not t_nudge.errors
        for _ in range(8):
            if cur_t.errors or not cur_t.approval:
                break
            cur_msgs = cur_msgs + [approval_reply(cur_t, approved=True)]
            cur_t = invoke(session_b, cur_msgs, live_params, references)
            nudge_turns.append(cur_t)
            if not cur_t.approval:
                settled2 = True
                break

        a_present2, b_present2, final2 = _edits_present(wf, token_a, skill_name)
        # `settled2` is satisfied by a turn with no approval and no error — which a turn
        # that produced nothing also satisfies (ASD-EST100).
        silent = check_no_silent_turn(turns_a + turns_b + nudge_turns)
        ok = settled2 and a_present2 and b_present2 and not silent["violations"]
        return {
            "status": "PASS" if ok else "FAIL",
            "why": (
                f"STAGE 2 (diagnose-and-ask, then a bare 'yes, retry' with zero mechanics "
                f"coached): settled2={settled2}, a_present={a_present2}, b_present={b_present2}, "
                f"silent_turns={silent['violations']}"
            ),
            "stage": 2,
            "workflow_id": wf,
            "session_a": session_a,
            "session_b": session_b,
            "diagnosis_reply": last_reply,
            "final_revision_id": final2.get("id") if final2 else None,
            "nudge_frames": [t.frames for t in nudge_turns],
        }
    finally:
        archive(wf)


if __name__ == "__main__":
    r = w3()
    print("\n=== W3 RESULT ===")
    print(json.dumps(r, indent=2, default=str))
