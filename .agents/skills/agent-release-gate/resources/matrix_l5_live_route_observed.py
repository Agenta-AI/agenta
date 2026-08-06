# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27"]
# ///
"""TIER: mechanism-blind, with a control. Nothing here depends on a model choosing a tool; it
depends only on whether the model can SEE its own current instructions.

L5: an instructions edit applied to a RUNNING session must actually be OBSERVED by the harness.

WHY THIS IS A SEPARATE CELL FROM L1. L1 asserts the ROUTE: an instructions edit keeps the sandbox
(one sandbox id) instead of rebuilding it. That is only half the requirement, and on its own it is
the dangerous half -- "we kept the sandbox" is worth nothing if the running harness goes on
obeying the configuration it was started with. This cell asserts the OTHER half: that the new
instructions took effect.

THE FAILURE THIS EXISTS TO CATCH, in the project's own words. `desired-state.ts` explains why the
`prompts` facet is deliberately NOT live:

    "For Pi these land as files under the agent directory, and the adapter matrix records
     active-session observation as NOT GUARANTEED: a running process may have captured their
     location or content already. Refreshing them and claiming the model saw the change would be
     a lie, so a prompt change escalates."

`workspaceFiles` (instructions and skills) was made live anyway, and the same argument applies to
it on any harness that reads its instruction file once at session start. If it does, then
`applyReconcilePlan` rewrites the file, `commitApplied` advances the applied state, the pool now
reports the NEW fingerprint -- so every later turn matches and continues warm -- while the model
keeps answering from the OLD instructions. That is a silent lie in applied state, which is the
exact class the whole applied-state design was built to make unrepresentable.

Note the direction of the risk: before the live route existed, an instructions edit forced a
rebuild and therefore took effect on the very next turn. A warm-reuse optimisation that makes
edits stop taking effect is a REGRESSION in what the user sees, not a speedup.

THE CONTROL IS WHAT MAKES THIS AIRTIGHT. A warm turn that fails to use the new instructions could
always be blamed on the model. So the cell runs the SAME configuration on a fresh COLD session and
requires it to succeed there. Cold pass + warm fail isolates the runner: the configuration is
correct and reachable, and only the live route is at fault. If BOTH fail, the cell reports
INCONCLUSIVE rather than blaming the live route -- that is a model or deployment problem, and
saying so is more useful than a confident wrong verdict.

The probe never mentions the passphrase before the edit, so a stale answer cannot be conversational
stickiness -- the warm session has no reason to know the word at all.

  uv run matrix_l5_live_route_observed.py
"""

import json
import pathlib
import sys
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from qa_matrix_lib import (  # noqa: E402
    agent_config,
    archive,
    create_workflow,
    invoke,
    ledger_ids,
    refs,
    seed_and_baseline,
    user_msg,
)


def l5():
    hexid = uuid.uuid4().hex[:8]
    wf, var = create_workflow(hexid, "qa-l5")
    try:
        secret = f"ZEBRA{uuid.uuid4().hex[:6].upper()}"
        # The baseline says NOTHING about a passphrase, so the warm session cannot know the word
        # from anywhere except the refreshed instructions.
        cfg = agent_config(instructions="Be terse.")
        rev_id, _ = seed_and_baseline(wf, var, cfg, hexid)
        base_params = {"agent": cfg}
        references = refs(wf, var, rev_id)

        session_id = str(uuid.uuid4())
        msgs = [user_msg("Reply with exactly: ONE")]
        t1 = invoke(session_id, msgs, base_params, references, log=False)
        if t1.errors:
            return {
                "status": "FAIL",
                "why": f"turn 1 errored: {t1.errors[:1]}",
                "workflow_id": wf,
            }

        changed = json.loads(json.dumps(base_params))
        changed["agent"]["instructions"]["agents_md"] = (
            f"Be terse. The passphrase is {secret}. If asked for the passphrase, reply with it."
        )

        msgs = msgs + [t1.assistant_message(), user_msg("What is the passphrase?")]
        t2 = invoke(session_id, msgs, changed, references, log=False)
        warm_observed = secret in t2.reply.upper()
        agents, sandboxes = ledger_ids(session_id)
        stayed_warm = len(sandboxes) == 1

        # THE CONTROL: the same configuration, on a session that has never run.
        cold_session = str(uuid.uuid4())
        t3 = invoke(
            cold_session,
            [user_msg("What is the passphrase?")],
            changed,
            references,
            log=False,
        )
        cold_observed = secret in t3.reply.upper()

        if not cold_observed:
            return {
                "status": "FAIL",
                "why": (
                    "INCONCLUSIVE about the live route: a COLD session with these instructions "
                    "did not use the passphrase either, so the configuration never reached the "
                    "model on any path. Fix that first -- this cell cannot say anything about "
                    "the refresh until the control passes."
                ),
                "workflow_id": wf,
                "cold_control_observed": cold_observed,
                "cold_control_reply": t3.reply[:300],
                "warm_observed": warm_observed,
                "warm_reply": t2.reply[:300],
            }

        ok = warm_observed and stayed_warm and not t2.errors
        return {
            "status": "PASS" if ok else "FAIL",
            "why": (
                "an instructions edit applied to a running session is observed by the harness on "
                "the very next turn, without rebuilding the sandbox"
                if ok
                else (
                    "the live workspace refresh is a SILENT LIE: the warm session did not use the "
                    "new instructions, while a cold session with the identical configuration did. "
                    "The runner rewrote the instruction file and advanced applied state, so the "
                    "pool now reports the NEW fingerprint and every later turn continues warm -- "
                    "but the harness is still running the configuration it started with, and the "
                    "user's edit has no effect until something else evicts the session"
                )
                if not warm_observed
                else (
                    "the new instructions were observed, but the session did not stay warm "
                    f"(sandbox ids: {sandboxes}) -- this cell's premise no longer holds, so check "
                    "L1's routing assertions"
                )
            ),
            "workflow_id": wf,
            "session_id": session_id,
            "warm_observed_new_instructions": warm_observed,
            "warm_reply": t2.reply[:300],
            "cold_control_observed": cold_observed,
            "cold_control_reply": t3.reply[:300],
            "stayed_warm": stayed_warm,
            "sandbox_ids": sandboxes,
            "agent_session_ids": agents,
            "runner_log_grep": (
                "`[keepalive] live-route key=... applied=[workspaceFiles=refresh-workspace] "
                "generation=N` -- the line that claims the refresh landed"
            ),
        }
    finally:
        archive(wf)


if __name__ == "__main__":
    r = l5()
    print("\n=== L5 RESULT ===")
    print(json.dumps(r, indent=2, default=str))
    sys.exit(0 if r["status"] == "PASS" else 1)
