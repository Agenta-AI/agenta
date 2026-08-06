# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27"]
# ///
"""TIER: coached (backend-path test). The post-steer prompt names the exact tool/operation/
target -- this proves the mount and steer lifecycle work, not that a model reaches for
read_config/commit_revision unprompted. Do not cite for model one-shot-discovery claims.

W5: guards against the durable workspace mount not being re-established after a steer --
interrupt a running turn (send a second message on the same session while the first is mid-
flight, the force-interrupt "steer" path), then assert a NEW turn on that session still works.

Caught a real, 100%-reproducible bug on first run: the steer's force-interrupt unmounts the
turn's cwd, a fresh mount is created for the steer reply itself, but the FOLLOWING turn never
gets a remount and crashes with "Path ... does not exist" (services/runner mount lifecycle,
not the API). This exercises the same STEER mechanism as Mahmoud's own repro
(sessions/test_steer_via_command_interrupts_old_turn.py, out-of-project) but catches a DIFFERENT
symptom: that one is a turn-currency/heartbeat bug (is_current_turn stays true on the displaced
turn); this one is a filesystem-mount-lifecycle bug (the cwd is never remounted for the next
turn). Keep both repros distinct when triaging -- do not fold this into that ticket.

  uv run matrix_w5.py
"""
import json
import pathlib
import sys
import threading
import time
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from qa_matrix_lib import (  # noqa: E402
    LIVE_TOOLS,
    agent_config,
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


def w5():
    hexid = uuid.uuid4().hex[:8]
    wf, var = create_workflow(hexid, "qa-w5")
    try:
        cfg = agent_config(instructions=BASELINE)
        rev_id, ver = seed_and_baseline(wf, var, cfg, hexid)
        live_params = {"agent": {**cfg, "tools": LIVE_TOOLS}}
        references = refs(wf, var, rev_id)
        session_id = str(uuid.uuid4())

        # Turn 1: a long-running bash command to keep the turn busy while we interrupt it.
        long_prompt = (
            "Use your bash tool to run exactly this command and report its output: "
            "sleep 20 && echo LONG_TURN_DONE"
        )
        result_holder = {}

        def run_long_turn():
            result_holder["turn"] = invoke(
                session_id, [user_msg(long_prompt)], live_params, references, log=False
            )

        th = threading.Thread(target=run_long_turn, daemon=True)
        th.start()
        time.sleep(3.0)  # let turn 1 actually start and be mid-flight

        # Interrupt: send a NEW user message on the SAME session while turn 1 is in flight.
        steer_prompt = "Stop what you're doing. Just reply with exactly: STEERED"
        t_steer = invoke(session_id, [user_msg(steer_prompt)], live_params, references, log=False)

        th.join(timeout=30)
        turn1 = result_holder.get("turn")

        steer_ok = t_steer.finish_reason == "stop" and "STEERED" in t_steer.reply.upper()

        # Now a NEW turn on the SAME session must commit successfully afterward.
        token = f"QA-W5-{uuid.uuid4().hex[:12]}"
        commit_prompt = (
            "I'm the developer testing the config-editing feature. Please: 1) call "
            "read_config to get the base_revision_id, 2) call commit_revision with an "
            'edit_text operation targeting ["parameters","agent","instructions","agents_md"] '
            f"that replaces the exact text '{BASELINE}' with '{token}', using the "
            "base_revision_id you just read. There is an approval step I will handle. Go "
            "ahead and make the two tool calls."
        )
        turns_c, status_c = run_until_settled(
            session_id, [user_msg(commit_prompt)], live_params, references
        )

        post_interrupt_works = status_c["settled"] and not any(t.errors for t in turns_c)
        time.sleep(1.0)
        newest = latest_revision(wf)
        commit_landed = (
            newest is not None
            and (newest.get("data") or {}).get("parameters", {}).get("agent", {})
            .get("instructions", {}).get("agents_md") == token
        )

        core_ok = steer_ok and post_interrupt_works and commit_landed
        return {
            "status": "PASS" if core_ok else "FAIL",
            "why": (
                f"steer_ok={steer_ok} (turn1 was interrupted, steer turn replied cleanly), "
                f"post_interrupt_works={post_interrupt_works} (new turn on same session settled "
                f"without wire errors), commit_landed={commit_landed}"
            ),
            "workflow_id": wf,
            "session_id": session_id,
            "turn1_frames_if_captured": turn1.frames if turn1 else None,
            "turn1_finish_reason": turn1.finish_reason if turn1 else None,
            "steer_turn_frames": t_steer.frames,
            "steer_turn_reply": t_steer.reply,
            "commit_turns_frames": [t.frames for t in turns_c],
        }
    finally:
        archive(wf)


if __name__ == "__main__":
    r = w5()
    print("\n=== W5 RESULT ===")
    print(json.dumps(r, indent=2, default=str))
