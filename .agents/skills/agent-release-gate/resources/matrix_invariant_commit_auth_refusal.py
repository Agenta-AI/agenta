# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27"]
# ///
"""TIER: coached (backend-path test) for the trigger scenario; the INVARIANT it checks
(`qa_matrix_lib.check_no_blank_success_on_refusal`) is mechanism-level and harness-agnostic --
it reads the runner's own log line, never model prose, so it is meant to ride along on every
cell that exercises commit_revision with a workspace-file marker (matrix_w7*.py,
matrix_t8_saved_files.py), not just this one.

The generic invariant: no `tool_result` with empty output and `isError:false` may exist for a
call whose runner log says "[commit-auth] refused" -- the silent-blank-success class. Added
after the Codex approve-then-fail P0 triage: the gap was scenario coverage (W7 ran on Claude
only), and the P0's actual FAILURE MODE was a refusal that the wire reported as a normal-looking
empty success. A cell can pass every scenario-specific assertion and still miss that shape
unless something checks the runner log against the wire outcome directly -- this is that check.

This cell's own scenario is a best-effort DETERMINISTIC trigger, not a guarantee: run matrix_w7's
exact flow (bash write -> @ag.file marker commit_revision), let the marker commit execute and
consume its authorization record normally, THEN REPLAY the identical approval-carrying request a
second time (same session, byte-identical message history) -- a duplicate submission (double
click, client retry, forged replay). The record is already consumed, so the second attempt's
`authorizeExecution` should find nothing to verify and refuse with `authorization_missing`,
producing a real "[commit-auth] refused" log line to check the invariant against. If the replay
does not reproduce a refusal (runner behavior changes, e.g. an idempotency layer intercepts the
duplicate before it reaches commit-authorization.ts), this SKIPs rather than reporting a false
PASS on an invariant it never actually exercised -- the sweep with zero refusals proves nothing
by itself.

Needs docker access to the target deployment's runner container (LOCAL/dev-box only); pass
--container to name it (default: agenta-ee-dev-preview-runner-1).

  uv run matrix_invariant_commit_auth_refusal.py [--container NAME]
"""

import argparse
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
    check_no_blank_success_on_refusal,
    create_workflow,
    invoke,
    latest_revision,
    refs,
    runner_log_lines,
    seed_and_baseline,
    user_msg,
)

BASELINE = "Be terse. Do exactly what is asked."


def invariant_cell(container: str) -> dict:
    hexid = uuid.uuid4().hex[:8]
    wf, var = create_workflow(hexid, "qa-inv-ca")
    try:
        cfg = agent_config(instructions=BASELINE)
        rev_id, ver = seed_and_baseline(wf, var, cfg, hexid)
        live_params = {"agent": {**cfg, "tools": LIVE_TOOLS}}
        references = refs(wf, var, rev_id)
        marker = f"QA-INVCA-{uuid.uuid4().hex[:12]}"
        fname = f"qa-invca-{hexid}.md"

        prompt = (
            "I'm the developer testing the config-import feature. Please do this exactly:\n"
            f"1) Use your bash tool to write a file at .agenta-imports/{fname} with exactly "
            f"this one line of content: {marker}\n"
            "2) Call read_config to get the base_revision_id.\n"
            "3) Call commit_revision with an add_item operation targeting "
            '["parameters","agent","skills"] that adds a new skill named "invca-import-test" '
            'with description "Invariant test skill" and body set to '
            f'{{"@ag.file": ".agenta-imports/{fname}"}} (the file marker, not the literal text), '
            "using the base_revision_id you just read.\n"
            "I understand there may be one or more approval steps, which I will handle each "
            "time. Do all three steps now, retrying any step that needed approval once I've "
            "approved it."
        )
        session_id = str(uuid.uuid4())
        turns = []

        msgs = [user_msg(prompt)]
        t1 = invoke(session_id, msgs, live_params, references)
        turns.append(t1)
        if t1.errors or not t1.approval:
            return {
                "status": "FAIL",
                "why": f"setup: expected the bash-write gate to raise, got errors={t1.errors}",
            }

        msgs = msgs + [approval_reply(t1, approved=True)]
        t2 = invoke(session_id, msgs, live_params, references)
        turns.append(t2)
        if t2.errors or not t2.approval:
            return {
                "status": "FAIL",
                "why": f"setup: expected the commit_revision gate to raise, got errors={t2.errors}",
                "turn2_frames": t2.frames,
            }

        # The request that actually consumes the marker's authorization record.
        msgs_final = msgs + [approval_reply(t2, approved=True)]
        t3 = invoke(session_id, msgs_final, live_params, references)
        turns.append(t3)
        commit_call_id = t2.approval["toolCallId"]
        first_outcome = t3.tool_outcomes.get(commit_call_id)
        if t3.errors or first_outcome != "available":
            return {
                "status": "FAIL",
                "why": (
                    "setup: the FIRST (legitimate) commit attempt did not succeed, so a "
                    f"replay proves nothing. errors={t3.errors}, outcome={first_outcome}"
                ),
                "turn3_frames": t3.frames,
            }

        # THE TRIGGER: replay the byte-identical approval-carrying request. The record it
        # would need is already consumed by t3.
        since = time.strftime("%Y-%m-%dT%H:%M:%S")
        t3_replay = invoke(session_id, msgs_final, live_params, references)
        turns.append(t3_replay)

        time.sleep(1.0)  # let the log line land before we scan for it
        try:
            log_lines = runner_log_lines(container, since="2m")
        except RuntimeError as e:
            return {
                "status": "SKIP",
                "why": f"could not read runner logs ({e}); cannot check the invariant at all",
            }

        check = check_no_blank_success_on_refusal(turns, log_lines)
        replay_outcome = t3_replay.tool_outcomes.get(commit_call_id)

        if not check["refusals"]:
            return {
                "status": "SKIP",
                "why": (
                    "the replay did not reproduce a '[commit-auth] refused' log line (runner "
                    f"behavior may have changed since this was written) -- replay_outcome="
                    f"{replay_outcome!r}. The invariant was not exercised this run; this is not "
                    "a pass on it."
                ),
                "replay_frames": t3_replay.frames,
                "since": since,
            }

        core_ok = len(check["violations"]) == 0
        time.sleep(0.5)
        newest = latest_revision(wf)
        version_bumped = newest is not None and int(newest.get("version") or -1) > int(
            ver or -1
        )
        return {
            "status": "PASS" if core_ok else "FAIL",
            "why": (
                f"refusals_observed={check['refusals']}, "
                f"violations={check['violations']}, "
                f"replay_wire_outcome={replay_outcome!r} (must be error/denied, never a blank "
                f"available), version_bumped_once={version_bumped} (only the first, legitimate "
                "commit should have landed)"
            ),
            "session_id": session_id,
            "workflow_id": wf,
            "commit_call_id": commit_call_id,
            "check": check,
        }
    finally:
        archive(wf)


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--container", default="agenta-ee-dev-preview-runner-1")
    args = p.parse_args()
    r = invariant_cell(args.container)
    print("\n=== COMMIT-AUTH REFUSAL INVARIANT RESULT ===")
    print(json.dumps(r, indent=2, default=str))
