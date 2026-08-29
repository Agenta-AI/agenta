# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27"]
# ///
"""TIER: mechanism-blind (no model behaviour is asserted). Every turn is "reply with exactly X",
so nothing here depends on what a model decides to do -- the cell asserts only what the RUNNER
did with the session between two turns.

L1: the cold -> warm routing matrix. For each kind of mid-conversation config change, assert the
route the runner actually took, read back from the STORED turn ledger.

WHY THIS CELL EXISTS. The v1 lifecycle work made ONE config change applicable to a running
environment, and left every other change escalating to a rebuild
(`services/runner/src/lifecycle/reconciliation-router.ts`):

    facet            change                       action            sandbox survives?
    ---------------- ---------------------------- ----------------- -----------------
    model            the model id alone           apply-live        YES  (live)
    workspaceFiles   instructions / skills        rebuild-sandbox   no   -> rebuild
    prompts          system / append prompts      reopen-session    no   -> rebuild
    harnessFiles     harness-rendered files       reopen-session    no   -> rebuild
    harnessSession   permissions, MCP list, mode  reopen-session    no   -> rebuild
    toolCatalog      custom tools, tool callback  reopen-session    no   -> rebuild
    sandbox          harness kind, sandbox kind   rebuild-sandbox   no   -> rebuild

`reopen-session` is deliberately NOT in `LIVE_ACTION_KINDS`, so those four facets escalate; and
`isLivelyApplicable` is all-or-nothing, so a change that moves a live facet AND an escalating one
rebuilds. That routing table is the whole product promise of "editing your agent no longer throws
your sandbox away", and NOTHING else in the gate asserts it.

`workspaceFiles` WAS LIVE, AND THIS TABLE ASSERTED IT. The route was withdrawn because it was a
silent lie: the refresh rewrote the instruction file, but the harness had already read that file
at session start, so the model kept obeying the old instructions while applied state advanced.
`matrix_l5_live_route_observed.py` is the cell that caught it, and it is why this cell alone was
never enough. Two sandbox ids for an instructions edit is the CORRECTED expectation, not a
regression: it is what an instructions edit cost before the live route existed.

WHAT MAKES THE ASSERTION REAL. Warm-versus-rebuilt never reaches the SSE stream. The turn ledger
does: the runner stamps `sandbox_id` on every turn row. ONE distinct id across the session means
the sandbox was never replaced; TWO means it was deleted and rebuilt. That is a stored row, not a
response echo, which is the standing rule for this gate.

An EMPTY ledger fails the cell. It is missing evidence, not evidence of stability -- the exact
false green the continuity journeys in qa_product.py were rewritten to remove.

THIS CELL ASSERTS ONLY HALF THE REQUIREMENT, AND ON ITS OWN THAT IS THE DANGEROUS HALF. "The
sandbox survived" is worth nothing unless the running harness actually OBSERVED the change. See
`matrix_l5_live_route_observed.py` for the other half; a green here plus a red there means the
runner is keeping a sandbox that is quietly running the old configuration.

THE `model` CASES ARE BLOCKING, AND THERE ARE TWO OF THEM. A same-connection model switch moves
the `model` facet alone (apply-live, warm): an alias switch on claude, and a fully-qualified id
switch on pi_core. The pi_core variant exists because of a caught bug class: the router once
keyed its capability table on the bare literal "pi" while the wire carries "pi_core", so every
playground Pi run fell into the fail-closed all-rebuild row, the live model route never fired,
and a claude-only cell could not see it (#6364). If this case goes red on a facet OTHER than
`model` moving (the shadow line names it), that red is the discovery mechanism working: it names
the next over-eviction to remove, not a reason to demote the case.

  uv run matrix_l1_lifecycle_routes.py
"""

import json
import pathlib
import sys
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from qa_matrix_lib import (  # noqa: E402
    LIVE_TOOLS,
    PI_CORE_HAIKU_MODEL,
    PI_CORE_HARNESS_KIND,
    agent_config,
    archive,
    create_workflow,
    invoke,
    ledger_ids,
    refs,
    seed_and_baseline,
    user_msg,
)

BASELINE = "Be terse. Do exactly what is asked."

# (case, expected distinct sandbox ids, blocking?, why)
#
# "warm" == 1 (the environment was reconfigured in place, or nothing changed).
# "rebuild" == 2 (the old sandbox was torn down and a new one built).
CASES = [
    (
        "no_change",
        1,
        True,
        "nothing moved, so the pool must hit-continue; a rebuild here means warm reuse is broken "
        "outright and every other case in this table is meaningless",
    ),
    (
        "instructions",
        2,
        True,
        "agents_md is the `workspaceFiles` facet -> rebuild-sandbox. It was the flagship LIVE "
        "route and the route was withdrawn: no harness re-reads its instruction file, so a warm "
        "refresh left the model obeying the old instructions. An edit that takes effect is worth "
        "more than a sandbox, so the escalation must actually happen",
    ),
    (
        "harness_permissions",
        2,
        True,
        "permissions are the `harnessSession` facet -> reopen-session, which is NOT live. A "
        "permission change MUST escalate: applying it in place would be a security-relevant "
        "change silently routed through an in-place refresh",
    ),
    (
        "tools",
        2,
        True,
        "custom tools are the `toolCatalog` facet -> reopen-session in v1 (uniform across "
        "harnesses because Codex cannot take a live tool update). A warm result here means a turn "
        "ran against a tool catalog the request never described",
    ),
    (
        "model",
        1,
        True,
        "the `model` facet is the other live route (setModel on the running session). An "
        "alias-to-alias switch on the same self_managed anthropic connection moves no other "
        "facet (the connection shape and the resolved modalities are identical), so a rebuild "
        "here means the live route is broken",
    ),
    (
        "model_pi_core",
        1,
        True,
        "the SAME model-switch assertion on the pi_core harness. This is the standing trap for "
        "the wire-spelling class of bug: the lifecycle router once keyed its capability table "
        "on the bare literal 'pi' while the wire carries 'pi_core', so every playground Pi run "
        "fell into the fail-closed all-rebuild row and every model switch threw the warm "
        "sandbox away (fixed in #6364) -- and the claude-only model case above could not see "
        "it. A same-provider id switch moves only the `model` facet",
    ),
]


def mutate(case: str, params: dict) -> dict:
    """Return a deep copy of `params` with exactly ONE facet moved."""
    p = json.loads(json.dumps(params))
    agent = p["agent"]
    marker = uuid.uuid4().hex[:8]
    if case == "no_change":
        return p
    if case == "instructions":
        agent["instructions"]["agents_md"] = f"{BASELINE} (l1 {marker})"
        return p
    if case == "harness_permissions":
        # A rule for a tool this turn never calls: it moves the facet without changing what the
        # turn is allowed to do, so a routing failure cannot hide behind a behaviour change.
        agent.setdefault("harness", {})["permissions"] = {
            "allow": [],
            "ask": [f"QaNeverCalledTool{marker}"],
            "deny": [],
        }
        return p
    if case == "tools":
        # Drop one platform tool from the catalog. The turn calls neither.
        agent["tools"] = [LIVE_TOOLS[0]]
        return p
    if case == "model":
        agent["llm"]["model"] = "sonnet"
        return p
    if case == "model_pi_core":
        # Same provider, same connection, a different fully qualified id: only `model` moves.
        agent["llm"]["model"] = "claude-sonnet-5"
        return p
    raise ValueError(f"unknown case {case}")


def run_case(case: str, wf: str, var: str, rev_id: str, base_params: dict) -> dict:
    session_id = str(uuid.uuid4())
    references = refs(wf, var, rev_id)

    msgs = [user_msg("Reply with exactly: ONE")]
    t1 = invoke(session_id, msgs, base_params, references, log=False)
    if t1.errors:
        return {"case": case, "ok": False, "why": f"turn 1 errored: {t1.errors[:1]}"}

    msgs = msgs + [t1.assistant_message(), user_msg("Reply with exactly: TWO")]
    t2 = invoke(session_id, msgs, mutate(case, base_params), references, log=False)
    if t2.errors:
        return {"case": case, "ok": False, "why": f"turn 2 errored: {t2.errors[:1]}"}

    agents, sandboxes = ledger_ids(session_id)
    return {
        "case": case,
        "session_id": session_id,
        "agent_session_ids": agents,
        "sandbox_ids": sandboxes,
        "distinct_sandboxes": len(sandboxes),
        "ledger_available": bool(sandboxes),
    }


def l1():
    hexid = uuid.uuid4().hex[:8]
    wf, var = create_workflow(hexid, "qa-l1")
    try:
        cfg = agent_config(instructions=BASELINE)
        rev_id, _ = seed_and_baseline(wf, var, cfg, hexid)
        base_params = {"agent": {**cfg, "tools": LIVE_TOOLS}}
        # The pi_core variant of the model case runs the whole session on pi_core with a fully
        # qualified id (the harness rejects bare aliases; see the module notes in qa_matrix_lib).
        pi_base_params = json.loads(json.dumps(base_params))
        pi_base_params["agent"]["harness"] = {"kind": PI_CORE_HARNESS_KIND}
        pi_base_params["agent"]["llm"]["model"] = PI_CORE_HAIKU_MODEL

        results = []
        blocking_failures = []
        for case, expected, blocking, why in CASES:
            r = run_case(
                case,
                wf,
                var,
                rev_id,
                pi_base_params if case == "model_pi_core" else base_params,
            )
            r["expected_sandboxes"] = expected
            r["blocking"] = blocking
            r["rationale"] = why
            if "ok" in r and not r["ok"]:
                verdict = "ERROR"
            elif not r.get("ledger_available"):
                # Missing evidence is a failure, never a pass. A silent ledger means the cell
                # cannot see the thing it exists to assert.
                verdict = "NO_EVIDENCE"
            elif r["distinct_sandboxes"] == expected:
                verdict = "OK"
            else:
                verdict = "WRONG_ROUTE"
            r["verdict"] = verdict
            if blocking and verdict != "OK":
                blocking_failures.append(
                    f"{case}: expected {expected} sandbox id(s) "
                    f"({'warm' if expected == 1 else 'rebuild'}), got "
                    f"{r.get('distinct_sandboxes')} [{verdict}] -- {why}"
                )
            results.append(r)

        ok = not blocking_failures
        return {
            "status": "PASS" if ok else "FAIL",
            "why": (
                "every blocking route matched the capability table"
                if ok
                else " | ".join(blocking_failures)
            ),
            "workflow_id": wf,
            "cases": results,
            "runner_log_grep": (
                "warm cases: `[keepalive] hit-continue` or `[keepalive] live-route key=... "
                "applied=[model=apply-live]`; rebuild cases: `[keepalive] mismatch (config) ...; "
                "evict + cold`, with the shadow line naming the facet, e.g. "
                "`facets=[workspaceFiles=rebuild-sandbox]`"
            ),
        }
    finally:
        archive(wf)


if __name__ == "__main__":
    r = l1()
    print("\n=== L1 RESULT ===")
    print(json.dumps(r, indent=2, default=str))
    sys.exit(0 if r["status"] == "PASS" else 1)
