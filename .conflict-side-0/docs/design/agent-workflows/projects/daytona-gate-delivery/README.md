# Daytona gate delivery (F-018)

Plan to fix the Daytona Pi builtin-gate hang. The first draft blamed the Daytona preview
proxy and proposed a second file-based permission channel. Review and follow-up research
found a smaller, concrete cause: local runs use `pi-acp` 0.0.29, while the Daytona snapshot
inherits 0.0.23. Version 0.0.23 predates the bridge from Pi extension dialogs to ACP
`session/request_permission`, so the permission request is never created.

The revised plan makes adapter parity the correctness fix. It keeps the existing ACP
permission plane for both local and Daytona, treats the file-gate design as a contingency
only, and separates live approval continuation from cold replay.

This workspace is design only. It does not change runner code or rebuild the snapshot.

## Read in this order

1. [context.md](context.md): the failure, impact, goals, and corrected mechanism.
2. [research.md](research.md): the adapter version proof, the real preview-proxy and ACP
   paths, lifecycle behavior, and harness scope.
3. [options.md](options.md): the revised choices and recommendation.
4. [plan.md](plan.md): the snapshot fix, verification, and fallback decision gate.
5. [design-review.md](design-review.md): the review findings and how the revision answers
   them.
6. [status.md](status.md): current state, decisions, remaining validation, and next steps.

## The finding

F-018 in [../qa/findings.md](../qa/findings.md) records the live failure. This workspace
corrects its initial transport diagnosis and turns it into an implementation plan.

## Related work

- [../approval-boundary/](../approval-boundary/): the builtin gate and durable approval
  model this fix preserves.
- [../warm-daytona-sessions/](../warm-daytona-sessions/): hot, warm, cold, and dead sandbox
  lifecycle behavior.
- [../qa/findings.md](../qa/findings.md): F-017, F-018, and F-020.
- [../../../sandbox-agent-fork/](../../../sandbox-agent-fork/): longer-term ownership of
  sandbox-agent packaging and dependency parity.
