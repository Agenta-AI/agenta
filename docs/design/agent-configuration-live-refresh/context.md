# Context

## What happens today

The agent service resolves configuration once before it sends a `/run` request to the
runner. During that resolution, the service and SDK parse the agent template, resolve tools
and MCP servers, resolve the model connection, compile private policies, and create the
runner wire request.

The agent can later call `commit_revision` inside the same active run. The API stores the
new revision and returns a successful tool result. The active runner does not receive the
new configuration. It continues with the values resolved before the run began.

The gateway connection rework made this visible. An agent can add Google Drive and commit
the new `gateway_connection`, but its active runner keeps the old private gateway policy.
The same problem applies to every other configuration value the runtime could update.

## Why the gateway-only proposal is too narrow

The first proposal marked only `gatewayPolicy` stale. The runner would call a new service
endpoint and replace that table before the next gateway call. That solves one symptom, but
it creates a second configuration path:

```text
Run start: service and SDK resolve the complete configuration, then call the runner.
Refresh:   runner calls the service for one policy table.
```

The runner would gain a new service dependency, and every later live configuration feature
would need another special refresh. The proposal also coupled commit latency to the next
gateway call and assumed that a successful commit added the intended integration.

The platform already has a more general event: a configuration revision was committed. The
follow-up should resolve that complete revision once and offer every changed facet to the
runtime.

## Goal

After an agent commits configuration, update the mutable state of the active runtime on a
best-effort basis without delaying the commit and without creating model activity.

The expected sequence is:

```text
commit succeeds
    -> runner returns the tool result immediately
    -> service receives a private commit notification
    -> service retrieves and resolves the exact complete revision
    -> service sends a complete resolved snapshot to the active runner
    -> runner installs every supported facet
```

## User-visible contract

`commit_revision` reports whether the revision was saved. It does not claim that the active
runtime installed every committed value.

The refresh is asynchronous. A model action issued immediately after the commit may still
observe the old state. The platform does not block that action, insert a message, or start a
new model invocation to close the race.

The next normal run still resolves the complete selected revision. It remains the eventual
recovery path when an asynchronous refresh is lost, fails, or reaches a runtime that has
already ended.

The exact committed revision becomes the desired source even when the active run began from
unsaved draft parameters. A supported facet may therefore replace a draft-derived value with
the committed value. Unsupported facets keep their current value. The refresh does not merge
the committed revision with the old draft because that would create a configuration that was
never committed.

## Goals

- Reuse the complete run-start resolution path for committed configuration refreshes.
- Keep commit latency independent from configuration retrieval and installation.
- Keep private control records out of model, UI, trace, and session event surfaces.
- Apply supported facets independently while preserving atomicity inside each dependency
  group.
- Record announced ordering separately from desired, last-known-installed, installed-trust,
  failed, unsupported, and optionally observed state per facet.
- Reject duplicate and out-of-order deliveries without rolling state backward.
- Keep secret values protected by the same transport and redaction rules as `/run`.
- Support the gateway execution policy as the first live-installed facet.

## Non-goals

- Guarantee that the first action after a commit sees the new configuration.
- Guarantee that a harness notices a changed file or tool list.
- Create a message, turn, continuation, or model invocation after a commit.
- Rebuild or reopen a harness automatically when a facet cannot change live.
- Make all configuration fields live-updatable in the first implementation.
- Replace the ordinary run-start resolution path.
- Replay configuration deltas inside the runner.
- Store a durable run-scoped configuration record in the API.

## Safety boundary

Best effort does not mean field-by-field mutation. Fields that jointly define one behavior
form an atomic dependency group. For example, gateway routing and gateway permission policy
must swap together. A group either installs completely or keeps its previous value.

An adapter operation that can mutate external state and then fail is not atomic. Every live
adapter operation must be generation-fenced so a superseded attempt cannot become visible.
It must separately provide atomic publication, rollback, or a `dirty` result that forces later
reconciliation to distrust the last known installed state.

Calls whose authenticated execution callback was already dispatched to the API finish under
one immutable execution generation. A call that has not dispatched that callback, including a
parked approval, must pass the current generation and fail-closed overlay immediately before
dispatch. Callback dispatch is the runner's irreversible linearization point: it cannot recall
the API request afterward. This makes tightening effective at the last boundary the runner
controls without mixing old authorization with new routing inside a call.

## Related work

- [Gateway connection rework](../composio-tools-rework/README.md) provides the first
  motivating facet.
- [Agent config editing](../agent-config-editing/README.md) defines `commit_revision`,
  revisions, and the runner desired-state architecture.
- [Harness reconciliation matrix](../agent-config-editing/contracts/adapter-matrix.md)
  defines optional harness observation and tool-catalog delivery behavior.
- [Commit transaction](../agent-config-editing/contracts/commit-transaction.md) defines
  exactly when a commit reports `committed` rather than `no_change`.
