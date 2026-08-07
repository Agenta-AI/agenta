# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27"]
# ///
"""TIER: coached (the prompt names read_config/commit_revision explicitly). This cell proves the
LIFECYCLE behaviour around an approval, not that a model reaches for the config tools unprompted.

L2: a pending approval that is answered while a CONFIG CHANGE rides along in the same request --
the combination that used to execute a gated tool against a sandbox running something else.

THE BUG THIS IS THE REGRESSION TEST FOR. The pool used to store a `configFingerprint` its CALLER
supplied, and the caller supplied the INCOMING request's value. On the ordinary path that is
harmless: dispatch has already proved incoming and parked configurations equal. On the
APPROVAL-RESUME path it is not, because that branch never compares configurations at all
(`session-coordinator.ts`, the `awaiting_approval` branch: it checks the parked gate, the history
fingerprint, credentials and the mount -- never the config). So the re-park stamped a
configuration the environment had never applied, the NEXT turn read that stamp, found a match,
and continued warm on an environment running something else.

The fix was structural rather than a patch: `LiveSession.configFingerprint` is now a GETTER that
reads through to `environment.appliedState`, and `AppliedState.commitApplied` is the only way to
advance it (`engines/sandbox_agent/applied-state.ts`). There is no parameter left for a caller to
stamp. This cell asserts the OBSERVABLE consequence of that, so the class cannot come back:

  1. The gated tool still EXECUTES on the resume, with its original byte-exact arguments. The
     config change riding along does not cancel the human's decision.
  2. The approval's stored interaction row ends `resolved` / `responded` -- never `cancelled`,
     never stuck `pending`.
  3. The config change is NOT SWALLOWED. Because the resume ignores config, the change takes
     effect on the FOLLOWING turn instead. That is the tell: if the re-park stamped the incoming
     fingerprint (the old bug), turn 3 would match and continue warm on the old configuration,
     and the new instructions would never take effect at all.

Two variants, because two different facets must both survive the same treatment:

  instructions -- the change is an instructions edit (`workspaceFiles` -> rebuild-sandbox).
  permissions  -- the change is a permissions edit (`harnessSession` -> reopen-session, which is
                  not live).

In both, the gated tool must still land and the escalation must actually happen by turn 3 (TWO
sandbox ids) rather than being lost.

THE `instructions` VARIANT USED TO EXPECT ONE SANDBOX ID, and that was the live workspace refresh.
The route was withdrawn: no harness re-reads its instruction file, so the refresh left the model
obeying the old instructions while applied state claimed the new ones. See
`matrix_l5_live_route_observed.py`. Both variants therefore escalate today, and both now have a
MECHANICAL witness that the change took effect -- the second sandbox id -- instead of the model
prose the live variant had to fall back on.

  uv run matrix_l2_approval_across_config_change.py
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
    interactions,
    invoke,
    latest_revision,
    ledger_ids,
    refs,
    seed_and_baseline,
    user_msg,
)

BASELINE = "Be terse. Do exactly what is asked."
# The instructions the `live` variant switches to mid-approval. The suffix rule is what makes the
# change OBSERVABLE in a reply, so "the new config took effect" is asserted rather than assumed.
ECHO_RULE = "Be terse. End every reply with the exact word {token} on its own line."


def commit_prompt(token: str) -> str:
    return (
        "I'm the developer testing the config-editing feature. Please: 1) call read_config to "
        "get the base_revision_id, 2) call commit_revision with an edit_text operation targeting "
        '["parameters","agent","instructions","agents_md"] that replaces the exact text '
        f"'{BASELINE}' with '{token}', using the base_revision_id you just read. There is an "
        "approval step I will handle. Go ahead and make the two tool calls."
    )


def settle_with_change(
    session_id: str,
    msgs: list,
    base_params: dict,
    changed_params: dict,
    references: dict,
    max_rounds: int = 6,
) -> tuple[list, dict]:
    """Run the approval flow, switching to `changed_params` from the moment the FIRST gate is
    answered. That is the whole point of the cell: the config change and the approval decision
    arrive in the SAME request."""
    turns = []
    params = base_params
    for i in range(max_rounds):
        t = invoke(session_id, msgs, params, references, log=False)
        turns.append(t)
        if t.errors:
            return turns, {"settled": False, "why": f"wire errors: {t.errors[:1]}"}
        if not t.approval:
            return turns, {"settled": True, "rounds": i + 1}
        msgs = msgs + [approval_reply(t, approved=True)]
        # From here on every request carries the NEW configuration alongside the decision.
        params = changed_params
    return turns, {"settled": False, "why": "max_rounds exhausted, still gated"}


def approval_rows(session_id: str) -> list:
    return [r for r in interactions(session_id) if r.get("kind") == "user_approval"]


def run_variant(variant: str, wf: str, var: str, rev_id: str, cfg: dict) -> dict:
    session_id = str(uuid.uuid4())
    references = refs(wf, var, rev_id)
    base_params = {"agent": {**cfg, "tools": LIVE_TOOLS}}
    token = f"QA-L2-{uuid.uuid4().hex[:10]}"
    echo = f"L2ECHO{uuid.uuid4().hex[:6].upper()}"

    changed = json.loads(json.dumps(base_params))
    if variant == "instructions":
        changed["agent"]["instructions"]["agents_md"] = ECHO_RULE.format(token=echo)
        expected_sandboxes, route = 2, "workspaceFiles -> rebuild-sandbox (escalates)"
    else:
        changed["agent"].setdefault("harness", {})["permissions"] = {
            "allow": [],
            "ask": [f"QaNeverCalledTool{uuid.uuid4().hex[:6]}"],
            "deny": [],
        }
        expected_sandboxes, route = 2, "harnessSession -> reopen-session (escalates)"

    msgs = [user_msg(commit_prompt(token))]
    turns, status = settle_with_change(
        session_id, msgs, base_params, changed, references
    )
    gated = any(t.approval for t in turns)

    # (1) the gated tool executed: the commit is a STORED revision row, not a frame.
    time.sleep(1.0)
    newest = latest_revision(wf)
    committed = (
        newest is not None
        and (newest.get("data") or {})
        .get("parameters", {})
        .get("agent", {})
        .get("instructions", {})
        .get("agents_md")
        == token
    )

    # (2) the approval died loudly or not at all -- never silently.
    rows = approval_rows(session_id)
    statuses = [r.get("status") for r in rows]
    approval_ok = bool(rows) and all(s in ("resolved", "responded") for s in statuses)

    # (3) the config change was not swallowed: it takes effect on the turn AFTER the resume,
    # because the resume branch itself never compares configurations.
    last = turns[-1]
    msgs3 = msgs + [last.assistant_message(), user_msg("Say hello.")]
    t3 = invoke(session_id, msgs3, changed, references, log=False)
    agents, sandboxes = ledger_ids(session_id)

    # WHAT BLOCKS, AND WHAT ONLY GETS REPORTED. "The change took effect" is now MECHANICAL for
    # both variants: each facet escalates, so the escalation shows up as a second sandbox id in the
    # stored ledger. Blocking.
    #
    # The prose probe below asks the model to obey a rule the new instructions carry. It is MODEL
    # PROSE -- exactly what this gate refuses to hang a verdict on, since a model that ignores an
    # instruction would fail a healthy product -- so it is reported as corroboration only. The
    # cell that DOES hold the "an edit is observed" line, with a cold control to keep a model
    # failure from being read as a runner failure, is `matrix_l5_live_route_observed.py`.
    prose_probe_saw_new_instructions = echo in t3.reply.upper()
    applied_after = len(sandboxes) >= 2

    ok = (
        gated
        and status.get("settled", False)
        and committed
        and approval_ok
        and bool(sandboxes)
        and len(sandboxes) == expected_sandboxes
        and bool(applied_after)
        and not t3.errors
    )
    return {
        "variant": variant,
        "route": route,
        "ok": ok,
        "raised_approval": gated,
        "settled": status.get("settled", False),
        "settle_why": status.get("why"),
        "gated_commit_landed": committed,
        "approval_row_statuses": statuses,
        "approval_rows_ok": approval_ok,
        "config_applied_on_next_turn": applied_after,
        # Corroboration, never blocking -- see the comment above. Meaningful for the
        # `instructions` variant only; the `permissions` variant changes no reply.
        "prose_probe_saw_new_instructions": prose_probe_saw_new_instructions,
        "expected_sandboxes": expected_sandboxes,
        "sandbox_ids": sandboxes,
        "agent_session_ids": agents,
        "ledger_available": bool(sandboxes),
        "turn3_errors": t3.errors[:1],
        "session_id": session_id,
    }


def l2():
    hexid = uuid.uuid4().hex[:8]
    wf, var = create_workflow(hexid, "qa-l2")
    try:
        cfg = agent_config(instructions=BASELINE)
        rev_id, _ = seed_and_baseline(wf, var, cfg, hexid)
        # Each variant commits an edit_text whose anchor is the BASELINE string, and the first
        # variant's commit replaces it. So the second variant gets its own workflow rather than
        # an anchor that no longer matches the stored text.
        results = [run_variant("instructions", wf, var, rev_id, cfg)]

        hexid2 = uuid.uuid4().hex[:8]
        wf2, var2 = create_workflow(hexid2, "qa-l2b")
        try:
            rev_id2, _ = seed_and_baseline(wf2, var2, cfg, hexid2)
            results.append(run_variant("permissions", wf2, var2, rev_id2, cfg))
        finally:
            archive(wf2)

        failures = [
            f"{r['variant']}: gated={r['raised_approval']} settled={r['settled']} "
            f"commit_landed={r['gated_commit_landed']} approval_rows={r['approval_row_statuses']} "
            f"config_applied_next_turn={r['config_applied_on_next_turn']} "
            f"sandboxes={r['sandbox_ids']} (expected {r['expected_sandboxes']})"
            for r in results
            if not r["ok"]
        ]
        return {
            "status": "PASS" if not failures else "FAIL",
            "why": (
                "a pending approval survives a config change riding along with the answer, the "
                "gated tool lands, and the config change takes effect on the following turn"
                if not failures
                else " | ".join(failures)
            ),
            "variants": results,
            "runner_log_grep": (
                "`[keepalive] resume key=... answered=1 approve=1` on the answering turn, then "
                "`[keepalive] mismatch (config) ...; evict + cold` on the FOLLOWING turn, in both "
                "variants"
            ),
        }
    finally:
        archive(wf)


if __name__ == "__main__":
    r = l2()
    print("\n=== L2 RESULT ===")
    print(json.dumps(r, indent=2, default=str))
    sys.exit(0 if r["status"] == "PASS" else 1)
