# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27"]
# ///
"""TIER: coached (the prompt names read_config/commit_revision explicitly).

L3: the user ABANDONS a pending approval -- they send a new message instead of answering the
card. This is the single most common way an approval dies in real usage, and until this cell
nothing in the gate covered it.

WHAT MUST HAPPEN, and why each half matters:

  1. THE GATED TOOL MUST NOT RUN. An unanswered approval is not consent. The commit must not
     appear as a revision row. This is the safety half.

  2. THE APPROVAL MUST DIE LOUDLY. At every turn start the runner sweeps prior turns' still-
     pending gates (`services/runner/src/sessions/interactions.ts:cancelStaleInteractions` ->
     `POST /sessions/interactions/cancel-stale`), sparing this turn's own gates by `turn_id` and
     any gate this turn answers in-band by token. The abandoned row must therefore end
     `cancelled`.

     `cancelled` versus `pending` IS the whole assertion. A row left `pending` is an approval
     card that sits on the user's page forever with nothing behind it: no process is waiting on
     the token, the session that raised it is gone, and answering it can only fail. A row moved
     to `cancelled` is a state a client can see and re-render. The runner-side half is already
     coherent -- the dispatch finds an approval-parked session with no matching decision, logs
     `approval-mismatch (unknown)` and evicts with the `session-incompatible` teardown reason,
     which PARKS the sandbox rather than deleting it (`engines/sandbox_agent/teardown.ts`,
     `PARKABLE_REASONS`) because nothing inside it went stale. This cell asserts the DURABLE half.

  3. THE SESSION MUST STILL WORK. The steer reply itself has to complete; an abandoned approval
     must not poison the conversation.

WHAT THIS CELL DELIBERATELY DOES NOT ASSERT: the sandbox id. Whether the abandoned session's
sandbox is stopped-and-reconnected or rebuilt is provider-dependent (a stop is only meaningful
where a sandbox can be restarted), and this matrix runs on `sandbox=local`. The ids are reported
as evidence, never as the verdict -- see L1 for the routing assertions that ARE provider-stable.

  uv run matrix_l3_abandoned_approval.py
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
    check_no_silent_turn,
    create_workflow,
    interactions,
    invoke,
    latest_revision,
    ledger_ids,
    refs,
    seed_and_baseline,
    user_msg,
)

BASELINE = "Be terse. Do exactly what is asked."
# The sweep is fire-and-forget at turn start, so the row transitions a moment after the steer
# turn begins. Poll rather than read once -- a single early read would report `pending` and fail
# the cell for a timing reason instead of a product reason.
CANCEL_POLL_SECONDS = 20.0
CANCEL_POLL_INTERVAL = 1.0


def approval_rows(session_id: str) -> list:
    return [r for r in interactions(session_id) if r.get("kind") == "user_approval"]


def await_terminal_approval(session_id: str) -> list:
    """Poll until no approval row is still `pending`, or the budget runs out."""
    deadline = time.time() + CANCEL_POLL_SECONDS
    rows = approval_rows(session_id)
    while time.time() < deadline:
        rows = approval_rows(session_id)
        if rows and all(r.get("status") != "pending" for r in rows):
            return rows
        time.sleep(CANCEL_POLL_INTERVAL)
    return rows


def l3():
    hexid = uuid.uuid4().hex[:8]
    wf, var = create_workflow(hexid, "qa-l3")
    try:
        cfg = agent_config(instructions=BASELINE)
        rev_id, _ = seed_and_baseline(wf, var, cfg, hexid)
        params = {"agent": {**cfg, "tools": LIVE_TOOLS}}
        references = refs(wf, var, rev_id)
        session_id = str(uuid.uuid4())
        token = f"QA-L3-{uuid.uuid4().hex[:10]}"

        # Turn 1: raise the approval gate and leave it hanging.
        prompt = (
            "I'm the developer testing the config-editing feature. Please: 1) call read_config "
            "to get the base_revision_id, 2) call commit_revision with an edit_text operation "
            'targeting ["parameters","agent","instructions","agents_md"] that replaces the exact '
            f"text '{BASELINE}' with '{token}', using the base_revision_id you just read. There "
            "is an approval step I will handle. Go ahead and make the two tool calls."
        )
        msgs = [user_msg(prompt)]
        t1 = invoke(session_id, msgs, params, references, log=False)
        if t1.errors:
            return {
                "status": "FAIL",
                "why": f"turn 1 errored before any gate: {t1.errors[:1]}",
                "workflow_id": wf,
            }
        gated = t1.approval is not None
        pending_now = approval_rows(session_id)

        # Turn 2: ABANDON it. A new user message, no approval decision anywhere in the payload.
        msgs2 = msgs + [
            t1.assistant_message(),
            user_msg("Never mind. Reply with exactly: MOVED"),
        ]
        t2 = invoke(session_id, msgs2, params, references, log=False)
        steer_ok = not t2.errors and "MOVED" in t2.reply.upper()

        rows = await_terminal_approval(session_id)
        statuses = [r.get("status") for r in rows]
        died_loudly = bool(rows) and all(s == "cancelled" for s in statuses)
        left_pending = any(s == "pending" for s in statuses)

        # The gated commit must NOT have landed: nobody approved it.
        time.sleep(1.0)
        newest = latest_revision(wf)
        leaked = (
            newest is not None
            and (newest.get("data") or {})
            .get("parameters", {})
            .get("agent", {})
            .get("instructions", {})
            .get("agents_md")
            == token
        )

        agents, sandboxes = ledger_ids(session_id)
        # `not leaked` is an absence check: a turn that produced nothing leaks nothing,
        # so it would satisfy it vacuously (ASD-EST100). Both turns were meant to answer.
        silent = check_no_silent_turn([t1, t2])
        ok = (
            gated
            and steer_ok
            and died_loudly
            and not leaked
            and not silent["violations"]
        )

        why_parts = []
        if not gated:
            why_parts.append(
                "turn 1 never raised an approval gate, so the cell tested nothing"
            )
        if leaked:
            why_parts.append(
                "SAFETY: the gated commit landed even though the approval was never answered"
            )
        if left_pending:
            why_parts.append(
                "the abandoned approval row is still `pending` -- it died SILENTLY, leaving a "
                "card on the page that no process is waiting on"
            )
        elif not died_loudly:
            why_parts.append(
                f"the abandoned approval row(s) ended {statuses}, expected all `cancelled`"
            )
        if not steer_ok:
            why_parts.append(
                f"the steer turn did not complete cleanly: errors={t2.errors[:1]} "
                f"reply={t2.reply[:120]!r}"
            )

        return {
            "status": "PASS" if ok else "FAIL",
            "why": (
                "an abandoned approval does not execute, is swept to `cancelled`, and leaves the "
                "session usable"
                if ok
                else " | ".join(why_parts)
            ),
            "workflow_id": wf,
            "session_id": session_id,
            "raised_approval": gated,
            "approval_rows_while_pending": [r.get("status") for r in pending_now],
            "approval_rows_after_abandon": statuses,
            "gated_commit_leaked": leaked,
            "steer_turn_ok": steer_ok,
            "sandbox_ids_evidence_only": sandboxes,
            "agent_session_ids_evidence_only": agents,
            "runner_log_grep": (
                "`[keepalive] approval-mismatch (unknown) key=...; evict + cold` on the steer "
                "turn, and `[interactions] cancel-stale OK session=...` from the sweep"
            ),
        }
    finally:
        archive(wf)


if __name__ == "__main__":
    r = l3()
    print("\n=== L3 RESULT ===")
    print(json.dumps(r, indent=2, default=str))
    sys.exit(0 if r["status"] == "PASS" else 1)
