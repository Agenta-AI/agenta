# Agent usage telemetry

This project defines how agent harnesses report token usage, context utilization, and monetary
cost from the harness boundary through the runner and Python service into Agenta tracing.

The immediate symptom is inaccurate cost in traces for Pi and Claude. The underlying problem is
broader: the current four-number usage object conflates billable token usage, ACP context-window
occupancy, and cost from sources with different authority. It also loses cache detail and places
the same totals on several span levels without an attribution rule.

The proposal starts with the pre-production runner and runner-to-service contracts. It also
documents a service-to-API semantic-convention proposal for review. That later boundary requires
CTO approval before implementation.

## Files

- [context.md](context.md): problem, scope, goals, and constraints.
- [research.md](research.md): current path, information-loss points, existing API behavior, and
  broader tracing gaps.
- [trace-inventory.md](trace-inventory.md): end-to-end inventory of runner trace fields, adapter
  handling, known gaps, and this project's scope.
- [interface-design.md](interface-design.md): proposed canonical usage model, source mappings,
  aggregation rules, and semantic-convention proposal.
- [plan.md](plan.md): phased implementation and review sequence.
- [qa.md](qa.md): contract, trace, API, and live verification matrix.
- [status.md](status.md): current state, decisions, approvals, and blockers.

## Recommended reading order

Read `context.md`, then `research.md`, `trace-inventory.md`, `interface-design.md`, and `plan.md`. Reviewers deciding
the service-to-API boundary should also read the semantic-convention section in
`interface-design.md` and the approval gate in `status.md`.
