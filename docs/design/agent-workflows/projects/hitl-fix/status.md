# Status

**State:** DESIGN ONLY. Not implemented, not merged. Awaiting the decision below.

**Date:** 2026-06-25

## What is done

- Full read-only trace of the HITL path across all four layers (runner, egress, FE, Pi).
- Root cause isolated to a single conflicting runner reply (see research.md).
- Smallest-correct fix designed with two approaches (A recommended, B fallback) and a
  test plan covering runner + SDK + FE + live e2e + a replay pin (see plan.md).

## Root cause (one line)

The runner parks an `ask` gate by replying `reject` to the harness AND emitting the
approval-request event; for Claude, `reject` produces a failed tool call ("User refused
permission") that the egress projects as `tool-output-error` on the same `toolCallId`,
overwriting the `approval-requested` part the FE needs.

## Decisions needed from the user

1. **Park mechanism (Approach A vs B).** A = add a runner-internal `park` outcome and do NOT
   send `reject` on park (clean, no wire change). B = keep `reject` and suppress the resulting
   failed `tool_result` in the otel layer (pattern-matchy). Recommendation: A.
2. **Pi HITL (Option Pi-1 vs Pi-2).** Pi-1 = hide `ask` for Pi now (honest, tiny, ships with
   the Claude fix). Pi-2 = build relay-tool park/resume so Pi can actually gate resolved tools
   (larger, tracked as open-issues S5.2). Recommendation: Pi-1 now, Pi-2 as a follow-up.

## Known empirical unknown (settled by the live test)

Whether ending the parked turn without a `reject` leaves Claude cleanly stopped, and whether a
cold-replayed turn 2 re-raises the gate so the stored decision applies. The plan's live steps
7-9 are the experiment; if turn 2 does not re-raise, the resume falls back to the runner
replaying the approved tool result into the transcript. Capture the outcome here when run.

## Cross-references

- QA finding: `docs/design/agent-workflows/projects/qa/findings.md` (F-024).
- Related open issues: `docs/design/agent-workflows/scratch/open-issues.md`
  ("Relay-tool HITL: resolved code/gateway tools cannot park/emit/resume (S5.2)" and
  "Live multi-turn HITL round-trip is unverified").
- Capability-config project (where `HITLResponder` was built):
  `docs/design/agent-workflows/projects/capability-config/`.
