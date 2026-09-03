# Session control and live events

> **AGENT-GENERATED, low weight.**

This folder defines how Agenta accepts session work, stops running executions, shares live output,
and recovers durable history across clients and failures.

## Current objective

The documents now form a contract-baseline candidate. They define seven delivery increments. The
first fixes current data-loss and admission bugs. Later increments add durable Stop, durable
history, shared reading, durable approvals, Queue, and Steer.

## Reading order

1. [`rfc.md`](rfc.md) starts with current behavior, then gives the proposal, release increments,
   flags, and remaining choices.
2. [`requirements.md`](requirements.md) maps user problems and issues to system guarantees.
3. [`decisions.md`](decisions.md) records the settled contracts and their reasons.
4. [`architecture.md`](architecture.md) explains command, output, history, ownership, and recovery.
5. [`contracts/public-api.md`](contracts/public-api.md) defines invoke, Stop, snapshot, and events.
6. [`contracts/commands.md`](contracts/commands.md) defines the private delivery port and recovery.
7. [`contracts/events.md`](contracts/events.md) defines temporary frames, durable events, and SSE.
8. [`contracts/persistence.md`](contracts/persistence.md) defines records, settlement, and ordering.
9. [`plan.md`](plan.md) defines the seven increments, flags, dependencies, and checkpoints.
10. [`work-packages/README.md`](work-packages/README.md) coordinates the implementation packages.
11. [`work-packages/stop-and-recovery.md`](work-packages/stop-and-recovery.md) covers increments 1
    and 2.
12. [`work-packages/durable-history.md`](work-packages/durable-history.md) covers increment 3.
13. [`work-packages/live-relay.md`](work-packages/live-relay.md) combines relay and shared-reader
    work for increments 4 and 5.
14. [`work-packages/durable-approvals.md`](work-packages/durable-approvals.md) covers increment 6.
15. [`work-packages/queue-steer.md`](work-packages/queue-steer.md) covers increment 7.
16. [`qa.md`](qa.md) defines release proof and records what prior runs proved.
17. [`status.md`](status.md) records the current candidate, review record, and implementation state.
18. [`open-questions.md`](open-questions.md) presents the seven choices that remain for Mahmoud.
19. [`evidence/README.md`](evidence/README.md) indexes spikes, pull requests, and live runs.
20. [`handoff.md`](handoff.md) explains where the design session stopped.

## Terms

- **Session:** One durable conversation and its workspace.
- **Conversation turn:** One user message and its resulting agent response.
- **Execution:** One runner attempt to advance a session.
- **Runner:** The private service that starts a sandbox and drives a harness.
- **Sandbox:** The environment that holds a session's files and processes.
- **Harness:** Pi, Claude Code, Codex, or another program that drives the model and tools.
- **Command:** Private durable intent that changes an execution, such as Stop.
- **Input:** User content that is pending, promoted, or removed.
- **Temporary frame:** Live text or tool progress that can expire.
- **Durable event:** A committed fact used for snapshots, recovery, and replay.
- **Sequence:** A database-assigned number that orders new durable facts within one session.
- **Lease:** Time-limited evidence that a runner remains healthy and owns current work.
- **Increment:** One ordered release step with its own activation and rollback rule.

## Supporting history

[`context.md`](context.md), [`research.md`](research.md), [`records-invariants.md`](records-invariants.md),
and [`tonight-handoff.md`](tonight-handoff.md) preserve research and pre-spike history. Current
contracts and plans take precedence when those files describe an older proposal.
