# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27"]
# ///
"""TIER: mechanism-blind, with a control. Nothing here depends on a model choosing a tool; it
depends only on whether the model can SEE its own current instructions.

L5: an instructions edit made mid-conversation must actually be OBSERVED by the harness on the
very next turn.

WHY THIS IS A SEPARATE CELL FROM L1. L1 asserts the ROUTE the runner took. This cell asserts the
thing the user actually cares about: that the edit took effect. The two are independent, and this
cell is the one that found the bug -- L1 was green throughout, because keeping the sandbox was
precisely what the broken behaviour did.

THE FAILURE THIS EXISTS TO CATCH, in the project's own words. `desired-state.ts` explains why the
`prompts` facet is deliberately NOT live:

    "For Pi these land as files under the agent directory, and the adapter matrix records
     active-session observation as NOT GUARANTEED: a running process may have captured their
     location or content already. Refreshing them and claiming the model saw the change would be
     a lie, so a prompt change escalates."

`workspaceFiles` (instructions and skills) was made live anyway, and the same argument always
applied to it: every harness reads its instruction file once, at session start. So
`applyReconcilePlan` rewrote the file, `commitApplied` advanced the applied state, the pool
reported the NEW fingerprint -- so every later turn matched and continued warm -- while the model
kept answering from the OLD instructions. That is a silent lie in applied state, which is the
exact class the whole applied-state design was built to make unrepresentable.

THE FIX, AND WHAT THIS CELL ASSERTS NOW. `workspaceFiles` routes to `rebuild-sandbox`, so an
instructions edit escalates and the next turn runs on an environment built from the new
instructions. The cell therefore expects TWO sandbox ids and REQUIRES the edit to be observed.
Note the direction of the risk it guards: before the live route existed, an instructions edit
forced a rebuild and therefore took effect on the very next turn. A warm-reuse optimisation that
makes edits stop taking effect is a REGRESSION in what the user sees, not a speedup. If someone
makes this facet live again -- the intended shape is refresh THEN reopen the session -- this cell
is what must stay green, and `stayed_warm` below becomes reportable evidence rather than a
failure.

THE CONTROL IS WHAT MAKES THIS AIRTIGHT. A turn that fails to use the new instructions could
always be blamed on the model. So the cell runs the SAME configuration on a fresh COLD session and
requires it to succeed there. Cold pass + mid-conversation fail isolates the runner: the
configuration is correct and reachable, and only the reconciliation route is at fault. If BOTH
fail, the cell reports INCONCLUSIVE rather than blaming the route -- that is a model or deployment
problem, and saying so is more useful than a confident wrong verdict.

The probe never mentions the passphrase before the edit, so a stale answer cannot be conversational
stickiness -- the continued session has no reason to know the word at all.

PER-HARNESS (added 2026-08-06): this cell originally ran on Claude only -- the same
scenario-coverage gap that let the Codex approve-then-fail P0 ship (see
matrix_w7_per_harness.py). This blocker cell now runs on all three harnesses in one invocation.
claude uses subscription auth; codex and pi_core need a funded OpenAI `provider_key` vault
secret and SKIP with the exact reason when it's missing or ambiguous.

  uv run matrix_l5_live_route_observed.py           # all three harnesses
  uv run matrix_l5_live_route_observed.py --only codex
"""

import argparse
import json
import pathlib
import sys
import uuid

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from qa_matrix_lib import (  # noqa: E402
    archive,
    create_workflow,
    invoke,
    ledger_ids,
    refs,
    seed_and_baseline,
    user_msg,
)

HARNESSES = {
    "claude": {
        "kind": "claude",
        "model": "haiku",
        "provider": "anthropic",
        "connection": {"mode": "self_managed", "slug": None},
    },
    "codex": {
        "kind": "codex",
        "model": "gpt-5.6-luna",
        "provider": "openai",
        "connection": {"mode": "agenta", "slug": None},
    },
    "pi_core": {
        "kind": "pi_core",
        "model": "gpt-5.6-luna",
        "provider": "openai",
        "connection": {"mode": "agenta", "slug": None},
    },
}

MISSING_CREDENTIAL_MARKERS = (
    "connection",
    "not found for provider",
    "no connections",
    "multiple connections",
    "requires a mounted subscription",
    "credential",
)


def harness_agent_config(spec: dict, instructions: str) -> dict:
    return {
        "instructions": {"agents_md": instructions},
        "llm": {
            "model": spec["model"],
            "provider": spec["provider"],
            "connection": spec["connection"],
            "extras": {},
        },
        "tools": [],
        "mcps": [],
        "skills": [],
        "harness": {"kind": spec["kind"]},
        "sandbox": {"kind": "local"},
    }


def l5_for(harness_name: str) -> dict:
    spec = HARNESSES[harness_name]
    hexid = uuid.uuid4().hex[:8]
    wf, var = create_workflow(hexid, f"qa-l5-{harness_name}")
    try:
        secret = f"ZEBRA{uuid.uuid4().hex[:6].upper()}"
        # The baseline says NOTHING about a passphrase, so the warm session cannot know the word
        # from anywhere except the refreshed instructions.
        cfg = harness_agent_config(spec, "Be terse.")
        rev_id, _ = seed_and_baseline(wf, var, cfg, hexid)
        base_params = {"agent": cfg}
        references = refs(wf, var, rev_id)

        session_id = str(uuid.uuid4())
        msgs = [user_msg("Reply with exactly: ONE")]
        t1 = invoke(session_id, msgs, base_params, references, log=False)
        if t1.errors:
            why = "; ".join(t1.errors[:1])
            if any(m in why.lower() for m in MISSING_CREDENTIAL_MARKERS):
                return {
                    "status": "SKIP",
                    "why": f"missing credential for harness={harness_name}: {why}",
                }
            return {
                "status": "FAIL",
                "why": f"turn 1 errored: {why}",
                "workflow_id": wf,
            }

        changed = json.loads(json.dumps(base_params))
        changed["agent"]["instructions"]["agents_md"] = (
            f"Be terse. The passphrase is {secret}. If asked for the passphrase, reply with it."
        )

        msgs = msgs + [t1.assistant_message(), user_msg("What is the passphrase?")]
        t2 = invoke(session_id, msgs, changed, references, log=False)
        edit_observed = secret in t2.reply.upper()
        agents, sandboxes = ledger_ids(session_id)
        # REPORTED, NEVER BLOCKING. The route is L1's assertion, and this cell must stay green
        # through any future change of route: what it protects is that the edit takes effect, by
        # whatever mechanism. Today the mechanism is a rebuild, so this reads False.
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
                    "INCONCLUSIVE about the reconciliation route: a COLD session with these "
                    "instructions did not use the passphrase either, so the configuration never "
                    "reached the model on any path. Fix that first -- this cell cannot say "
                    "anything about a mid-conversation edit until the control passes."
                ),
                "workflow_id": wf,
                "cold_control_observed": cold_observed,
                "cold_control_reply": t3.reply[:300],
                "edit_observed": edit_observed,
                "reply_after_edit": t2.reply[:300],
            }

        ok = edit_observed and not t2.errors
        return {
            "status": "PASS" if ok else "FAIL",
            "why": (
                "an instructions edit made mid-conversation is observed by the harness on the "
                "very next turn"
                if ok
                else (
                    "the instructions edit is DEAD: the next turn did not use the new "
                    "instructions, while a cold session with the identical configuration did. "
                    "If the runner took a live route it rewrote the instruction file and advanced "
                    "applied state -- so the pool reports the NEW fingerprint and every later turn "
                    "continues warm -- while the harness still runs the configuration it started "
                    "with, and the user's edit has no effect until something else evicts the "
                    "session. Check the shadow line: `facets=[workspaceFiles=...]` names the route "
                    "the runner chose"
                )
            ),
            "workflow_id": wf,
            "session_id": session_id,
            "edit_observed": edit_observed,
            "reply_after_edit": t2.reply[:300],
            "cold_control_observed": cold_observed,
            "cold_control_reply": t3.reply[:300],
            # Reported, never blocking. See where it is computed.
            "stayed_warm": stayed_warm,
            "sandbox_ids": sandboxes,
            "agent_session_ids": agents,
            "runner_log_grep": (
                "`[keepalive] mismatch (config) key=...; evict + cold` with "
                "`facets=[workspaceFiles=rebuild-sandbox]` on the shadow line -- the escalation "
                "that makes the edit take effect"
            ),
        }
    except Exception as e:  # noqa: BLE001 -- classify infra errors as SKIP, never crash the matrix
        msg = str(e)
        if any(m in msg.lower() for m in MISSING_CREDENTIAL_MARKERS):
            return {
                "status": "SKIP",
                "why": f"missing credential for harness={harness_name}: {msg}",
            }
        return {
            "status": "FAIL",
            "why": f"unhandled exception: {type(e).__name__}: {msg}",
        }
    finally:
        archive(wf)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument(
        "--only",
        choices=list(HARNESSES),
        help="run a single harness instead of the full matrix",
    )
    args = p.parse_args()
    harness_names = [args.only] if args.only else list(HARNESSES)

    results = {}
    for harness_name in harness_names:
        print(f"\n=== L5 x {harness_name} ===", file=sys.stderr)
        results[harness_name] = l5_for(harness_name)

    print("\n=== L5-PER-HARNESS RESULTS ===")
    print(json.dumps(results, indent=2, default=str))

    any_fail = any(r["status"] == "FAIL" for r in results.values())
    skipped = [h for h, r in results.items() if r["status"] == "SKIP"]
    if skipped:
        print(
            f"\nSKIPPED (untested, not passed): {', '.join(skipped)}", file=sys.stderr
        )
    return 1 if any_fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
