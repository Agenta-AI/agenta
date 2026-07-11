## Context

On a Daytona sandbox, every Pi builtin tool call hangs. Bash, read, all of them, even in
allow mode. The turn stalls until the 300s run-limits guard kills it, with no approval
prompt ever shown. Chat-only turns work. This is F-018 in the QA findings, and it breaks
the build-kit default agent on Daytona: its "read the skill first" instruction makes the
model open with a read, so the first turn dies whenever the model obeys.

Root cause: with builtin gating on, the Pi extension raises `ctx.ui.confirm` inside the
sandbox for every builtin call and blocks on the ACP `session/request_permission`
reverse-RPC. One-way `session/update` notifications cross the Daytona proxy fine, but the
reverse permission request never reaches the runner (no `[HITL] pi-gate` log line ever
appears for a Daytona session; identical local runs log and round-trip it). The confirm
is deliberately reaper-less, so the tool waits forever.

## What this PR adds

A design-only planning workspace at
`docs/design/agent-workflows/projects/daytona-gate-delivery/`. No code changes.

The plan evaluates three fix directions and recommends a combination:

- Before: every builtin call round-trips a permission gate to the runner, and on Daytona
  that round-trip never completes.
- After (per the plan): the runner compiles each granted builtin's policy into a
  disposition (`allow`, `deny`, or `runner`) and injects the versioned map into the
  sandbox. Allow and deny resolve with no round-trip, which alone fixes the failing
  allow-mode scenario. Only a `runner`-disposition builtin (ask, or an arg-dependent
  prefix rule) raises a gate, and on Daytona that gate rides the file-relay channel the
  runner already polls, with a delivery acknowledgment, an HMAC-authenticated decision
  file, and defined cold and live resume paths so an ask still surfaces a real UI prompt.
  Custom tools get no second gate channel; their existing execution relay request becomes
  the authorization seam. A short delivery deadline fails an undeliverable gate closed
  instead of stalling to the 300s guard.

Fixing the reverse-RPC over the remote transport (the ideal long-term shape) is
evaluated and deferred to the sandbox-agent fork plan, with the reasoning documented.

## The workspace

- `context.md`: the symptom, the mechanism, goals, non-goals, constraints.
- `research.md`: the gate path and transport mechanics with file and line references,
  including why the reverse request dies on Daytona and the facts that constrain the
  approval state machine.
- `options.md`: the three directions with trade-offs, and the recommendation.
- `plan.md`: phased implementation as one release unit, with the two new interface
  shapes (the disposition map and the file-gate protocol) reviewed by semantic role.
- `design-review.md`: an independent critical review of the first draft and how each
  finding was folded in (the approval state machine, the relay-seam custom-tool
  authorization, the two-lifetime timeout, decision-file integrity, release-unit
  phasing).
- `status.md`: decisions and the open questions that need an owner call.

## Notes

- Open questions for review are listed in `status.md`: the delivery-deadline default,
  whether the live keep-alive parking variant lands in the first cut, and whether local
  should also use the disposition fast path.
- No live Daytona runs were made for this plan.
