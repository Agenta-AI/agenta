# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27"]
# ///
"""TIER: coached (the prompt names the client tool and tells the model to call it).

L4: a CLIENT TOOL round trip -- the third lifecycle axis, and the one with no coverage at all
before this cell.

WHAT A CLIENT TOOL DOES TO THE SESSION, and why it belongs in a lifecycle matrix. A client tool
(`{"type": "client", ...}`) is fulfilled by the browser across a turn boundary: the model calls
it, the runner emits a `client_tool` interaction request, THE TURN ENDS PAUSED, and the next turn
resumes with the browser's result replayed out of the message history
(`services/runner/src/responder.ts:extractClientToolOutputs`, keyed by
`approvedCallKey(toolName, args)` and read only from the CURRENT turn).

That pause is NOT an approval pause, and the difference is the whole point:

  - An ACP approval gate parks the session ALIVE (`awaiting_approval`), so the human's answer
    resumes the very same process and the gated tool runs with its original byte-exact arguments.
  - A client-tool pause is explicitly NOT parkable. `shouldPark` refuses a `paused` result, and
    `approvalToPark` refuses when the environment recorded no parkable ACP gate, so the
    coordinator takes the `no-park:paused` branch and DESTROYS the environment
    (`lifecycle/session-coordinator.ts`). The warm-hold disposition that would keep the call open
    inside a live turn is declared and deliberately NOT BUILT
    (`engines/sandbox_agent/client-tools.ts`: `"warm-hold": RESERVED, not built`, issue #5384).

So today every client-tool round trip costs a full sandbox rebuild. That is a real warm-reuse
hole, and this cell exists to PIN IT rather than discover it again later: it asserts the round
trip works, and it records the sandbox count so the day the warm hold lands, the number moves and
somebody has to come here and say so deliberately.

The correctness half is what blocks: the browser's result must actually reach the model, and the
`client_tool` interaction must be STORED (a row in `/sessions/interactions/`), not merely
streamed.

OBSERVED NUANCE, recorded but not asserted (2026-08-06): a client-tool row that was FULFILLED
successfully still ends up stored as `cancelled`, not `responded`/`resolved`. The browser answers
in-band through the messages plane, and the next turn's `cancelStaleInteractions` sweep spares
only the tokens it recognises as in-band answers -- which covers approval replies, not client-tool
outputs -- so the row is swept as though it had been abandoned. The round trip itself works, so
this cell asserts only that no row is left `pending`. It is the durable RECORD that lies: anything
reading the stored interactions later (a reconnecting client, an audit) cannot tell a fulfilled
client tool from an abandoned one. Worth fixing, not worth blocking a release on.

FIRST-RUN NOTE. If turn 1 ends without a recognizable paused client-tool call, this cell FAILS
and prints the frames it did see. That is deliberate: a SKIP here would be an untested claim, and
the frame list is exactly what a reader needs to fix the cell.

  uv run matrix_l4_client_tool_lifecycle.py
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
    interactions,
    invoke,
    ledger_ids,
    refs,
    seed_and_baseline,
    user_msg,
)

TOOL_NAME = "qa_ask_browser"
CLIENT_TOOL = {
    "type": "client",
    "name": TOOL_NAME,
    "description": (
        "Ask the user's browser for the current session marker. Takes no arguments and returns "
        "a short string. Call it whenever you are asked for the session marker."
    ),
    "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
}


def fulfil(turn, call_id: str, output: str) -> dict:
    """Build the assistant message that carries the BROWSER'S RESULT for `call_id`.

    The runner reads client-tool outputs only from the CURRENT turn (everything after the last
    user message), so this message is appended with NO new user message after it -- exactly the
    shape the playground sends, and the same shape `approval_reply` uses for a decision."""
    message = turn.assistant_message()
    for part in message["parts"]:
        if part.get("toolCallId") == call_id:
            part["state"] = "output-available"
            part["output"] = output
            return message
    raise ValueError(f"client tool call {call_id} missing from the assistant message")


def l4():
    hexid = uuid.uuid4().hex[:8]
    wf, var = create_workflow(hexid, "qa-l4")
    try:
        cfg = agent_config(
            tools=[CLIENT_TOOL],
            instructions=(
                "Be terse. When the user asks for the session marker, call the "
                f"{TOOL_NAME} tool and then report exactly what it returned."
            ),
        )
        rev_id, _ = seed_and_baseline(wf, var, cfg, hexid)
        params = {"agent": cfg}
        references = refs(wf, var, rev_id)
        session_id = str(uuid.uuid4())
        marker = f"L4MARK{uuid.uuid4().hex[:8].upper()}"

        # Turn 1: the model calls the client tool, and the turn must PAUSE with no output for it.
        msgs = [user_msg("What is the session marker? Use your tool.")]
        t1 = invoke(session_id, msgs, params, references, log=False)
        if t1.errors:
            return {
                "status": "FAIL",
                "why": f"turn 1 errored: {t1.errors[:1]}",
                "workflow_id": wf,
            }

        paused_calls = [
            c
            for c in t1.tool_calls
            if TOOL_NAME in (c.get("toolName") or "")
            and t1.tool_outcomes.get(c["toolCallId"]) is None
        ]
        if not paused_calls:
            return {
                "status": "FAIL",
                "why": (
                    "turn 1 never produced a PAUSED client-tool call, so the round trip could not "
                    "be exercised. Either the model did not call the tool, or the paused call "
                    "reaches the wire in a shape this cell does not recognize -- the frames and "
                    "tool calls below are what to fix it against."
                ),
                "workflow_id": wf,
                "session_id": session_id,
                "turn1_frames": t1.frames,
                "turn1_tool_calls": t1.tool_calls,
                "turn1_tool_outcomes": t1.tool_outcomes,
                "turn1_finish_reason": t1.finish_reason,
                "turn1_reply": t1.reply[:300],
            }
        call_id = paused_calls[0]["toolCallId"]

        # The interaction must be STORED, not merely streamed.
        rows_paused = [
            r for r in interactions(session_id) if r.get("kind") == "client_tool"
        ]

        # Turn 2: the browser answers. No new user message -- the result belongs to this turn.
        msgs2 = msgs + [fulfil(t1, call_id, marker)]
        t2 = invoke(session_id, msgs2, params, references, log=False)
        delivered = marker in t2.reply.upper()

        agents, sandboxes = ledger_ids(session_id)
        rows_after = [
            r for r in interactions(session_id) if r.get("kind") == "client_tool"
        ]
        statuses = [r.get("status") for r in rows_after]
        stored = bool(rows_after)
        no_orphan_pending = all(s != "pending" for s in statuses)

        ok = delivered and stored and no_orphan_pending and not t2.errors

        why_parts = []
        if not delivered:
            why_parts.append(
                f"the browser's result never reached the model: {marker} is absent from the "
                f"resumed reply ({t2.reply[:160]!r})"
            )
        if not stored:
            why_parts.append(
                "no `client_tool` interaction row was stored, so the call existed only on the "
                "stream -- nothing durable for a reconnecting client to render"
            )
        elif not no_orphan_pending:
            why_parts.append(
                f"a `client_tool` row is still `pending` after the round trip completed: {statuses}"
            )
        if t2.errors:
            why_parts.append(f"the resumed turn errored: {t2.errors[:1]}")

        return {
            "status": "PASS" if ok else "FAIL",
            "why": (
                "the client-tool round trip completes, the result reaches the model, and the "
                "interaction is stored"
                if ok
                else " | ".join(why_parts)
            ),
            "workflow_id": wf,
            "session_id": session_id,
            "result_reached_model": delivered,
            "client_tool_rows_while_paused": [r.get("status") for r in rows_paused],
            "client_tool_rows_after": statuses,
            # RECORDED, NOT ASSERTED. Two ids is today's expected cost: a client-tool pause is
            # not parkable, so the environment is destroyed and the resume rebuilds. If this ever
            # reads 1, the warm hold (#5384) landed and this cell's docstring needs updating --
            # that is a deliberate change, not a regression.
            "sandbox_ids": sandboxes,
            "distinct_sandboxes_recorded": len(sandboxes),
            "warm_hold_landed_if_this_is_1": len(sandboxes),
            "agent_session_ids": agents,
            "runner_log_grep": (
                "`[keepalive] non-parkable-gate-no-park key=...` then `[keepalive] evict ... "
                "reason=no-park:paused` on turn 1, and a fresh `[keepalive] miss ...; cold` on "
                "turn 2"
            ),
        }
    finally:
        archive(wf)


if __name__ == "__main__":
    r = l4()
    print("\n=== L4 RESULT ===")
    print(json.dumps(r, indent=2, default=str))
    sys.exit(0 if r["status"] == "PASS" else 1)
