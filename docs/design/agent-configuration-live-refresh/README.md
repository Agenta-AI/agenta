# Active agent configuration refresh

An agent can commit a new configuration revision while it is running. The commit is
durable immediately, but the active runner continues with configuration resolved at run
start. This project adds a private, asynchronous path that resolves the complete committed
revision and installs every configuration facet the active runtime can change.

The commit never waits for the refresh. The platform never creates a user message, an
assistant message, a continuation, or another model invocation. Unsupported and failed
facets keep their prior installed state unless a partially mutating adapter reports it
untrusted.

Tracking issue: [#6336](https://github.com/Agenta-AI/agenta/issues/6336).

## Reading order

1. [context.md](context.md) explains the current behavior, goals, and boundaries.
2. [research.md](research.md) traces the existing code paths and records the gaps.
3. [architecture.md](architecture.md) defines the complete asynchronous flow and ownership.
4. [contracts.md](contracts.md) pins the private event, snapshot, and apply interfaces.
5. [facet-matrix.md](facet-matrix.md) defines atomic groups and initial support.
6. [plan.md](plan.md) orders the implementation into independently reviewable slices.
7. [qa.md](qa.md) defines the required automated and live proof.
8. [status.md](status.md) records the project state and decided behavior.

## Terms

**Agent configuration.** The committed configuration under `parameters.agent`, including
the model, instructions, tools, skills, MCP servers, harness, and permissions.

**Revision.** One immutable committed version of a workflow configuration.

**Service.** The Python agent service under `services/oss/src/agent`. It uses the Python SDK
to turn authored configuration into runner-ready configuration.

**Runner.** The TypeScript service under `services/runner`. It owns active sandboxes,
harness sessions, tool execution, and mutable runtime state.

**Harness.** The coding agent process driven by the runner, such as Pi, Claude Code, or
Codex.

**Resolved configuration snapshot.** The complete runner-safe configuration produced by
the same service and SDK pipeline used at run start. It contains resolved references and
private runtime bindings, but no messages or current-turn telemetry.

**Facet.** One coherent part of resolved configuration with one application lifecycle, for
example gateway execution policy or workspace files.

**Announced revision.** The latest committed revision the active runner has learned about.
It is an ordering watermark even when retrieval or resolution later fails.

**Desired facet value.** The value from the latest complete snapshot the runner validated
for that facet. Unsupported facets still record this desired value.

**Installed revision.** The revision whose value the runner successfully installed for one
facet.

**Observed revision.** An optional report from the consumer of a facet that it noticed an
installed value. For a runner-owned facet, the runner is the consumer. For a harness-owned
facet, the harness or its adapter is the consumer. Refresh never waits for this report.

## Decided behavior

- A successful commit and an active-runtime refresh are separate outcomes.
- A successful commit returns to the model without waiting for resolution or installation.
- The service retrieves the exact committed revision, never the latest revision by variant.
- Initial runs and refreshes use one complete configuration resolver.
- The service sends full snapshots. It never sends configuration patches.
- The runner applies supported facets independently and applies each dependency group
  atomically.
- A facet is supported only when its application mechanism is generation-fenced. A mechanism
  that can partially mutate must also roll back or report the installed state as untrusted.
- An unsupported facet and a failure before mutation keep the previous installed value; a
  partial external mutation records the last known value as untrusted.
- No component creates model activity to make a configuration change take effect.
- Gateway policy is the first supported facet, not a special refresh architecture.
