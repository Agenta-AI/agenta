# Daytona gate delivery (F-018)

Plan to fix the Daytona builtin-gate hang. On a Daytona sandbox, every Pi builtin tool
call (bash, read, and the rest) stalls until the 300s run-limits guard kills the turn.
The gate the Pi extension raises inside the sandbox never round-trips to the runner over
the remote transport, so the tool waits for an answer that never comes.

This workspace is design only. It does not change code. It exists so a fixer can pick up
F-018 cold, understand the mechanism, weigh the fix directions, and implement the
recommended one.

## Read in this order

1. [context.md](context.md): what breaks, who it affects, goals and non-goals.
2. [research.md](research.md): the exact code path and transport mechanics, grounded in
   file and line references. Read this before proposing any change.
3. [options.md](options.md): the three fix directions with honest trade-offs, and the
   recommendation.
4. [plan.md](plan.md): the phased implementation of the recommendation, including the
   two new interface shapes reviewed by semantic role.
5. [design-review.md](design-review.md): the independent critical review of the first
   draft and how each finding was folded in.
6. [status.md](status.md): current state, decisions, and open questions. This is the
   source of truth for progress.

## The finding

The authoritative write-up is F-018 in
[../qa/findings.md](../qa/findings.md). This workspace expands it into a plan.

## Related work

- [../approval-boundary/](../approval-boundary/): introduced builtin gating and the
  approval model this fix must preserve.
- [../qa/findings.md](../qa/findings.md): F-017 (the remote-mount fix that made chat work
  on Daytona), F-020 (session resume recreates sandboxes), and F-018 itself.
- The sandbox-agent fork plan (PR #5172) is the natural home for any change to the
  vendored `sandbox-agent` transport, which option A in [options.md](options.md) would
  need.
