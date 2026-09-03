# Session control and live events

> **AGENT-GENERATED, low weight.**

This folder defines how Agenta accepts session work, controls running executions, shares live
output, and recovers durable history across clients and failures.

## Current objective

Finish the contract baseline, review it by responsibility, then deliver two independent programs:
reliable session control and shared live output. Later milestones add durable replay, one client
reader model, and durable Queue, Steer, and approval continuation.

## Reading order

1. [`rfc.md`](rfc.md) gives the high-level problem, system shape, and milestones.
2. [`requirements.md`](requirements.md) maps user problems and issues to system guarantees.
3. [`decisions.md`](decisions.md) records settled choices and their reasoning.
4. [`architecture.md`](architecture.md) explains the four runtime paths and failure recovery.
5. [`contracts/public-api.md`](contracts/public-api.md) defines client operations and responses.
6. [`contracts/commands.md`](contracts/commands.md) defines private command delivery.
7. [`contracts/events.md`](contracts/events.md) defines temporary frames, durable events, and SSE.
8. [`contracts/persistence.md`](contracts/persistence.md) defines record and sequence invariants.
9. [`plan.md`](plan.md) defines milestones, dependencies, and checkpoints.
10. [`work-packages/README.md`](work-packages/README.md) coordinates parallel implementation.
11. [`qa.md`](qa.md) defines release validation.
12. [`status.md`](status.md) records current work and the latest tested commit.
13. [`open-questions.md`](open-questions.md) lists decisions that still block work.
14. [`evidence/README.md`](evidence/README.md) indexes spikes, pull requests, and live runs.
15. [`handoff.md`](handoff.md) explains where this design session stopped.

## Terms

- **Session:** One durable conversation and its workspace.
- **Conversation turn:** One user message and its resulting agent response.
- **Execution:** One runner attempt to advance a session.
- **Runner:** The private service that starts a sandbox and drives a harness.
- **Sandbox:** The environment that holds a session's files and processes.
- **Harness:** Pi, Claude Code, Codex, or another program that drives the model and tools.
- **Command:** Durable intent that changes execution, such as Stop.
- **Input:** User content that is pending, promoted, or removed.
- **Temporary frame:** Live text or tool progress that can expire.
- **Durable event:** A committed fact used for snapshots, recovery, and replay.
- **Sequence:** A database-assigned number that orders new durable facts within one session.
- **Lease:** Time-limited evidence that a runner remains healthy and owns current work.

## Supporting history

[`context.md`](context.md), [`research.md`](research.md), [`records-invariants.md`](records-invariants.md),
and [`tonight-handoff.md`](tonight-handoff.md) preserve the research and pre-spike history. Current
contracts and plans take precedence when those files describe an older proposal.
