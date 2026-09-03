# Implementation plan

> **AGENT-GENERATED, LOW WEIGHT, DRAFT.** This sequence is a provisional AI proposal. Human review
> and spike results can change it.

## Independent programs

### Fast Stop and command delivery

1. Trace current Stop, kill, heartbeat, abort, sandbox, and interaction paths.
2. Prove warm cancellation and identify sandbox-agent or Daytona work.
3. Add the durable command repository and state transitions.
4. Add runner-initiated long polling behind the command-delivery adapter.
5. Make public Stop create a durable command with an optional execution guard.
6. Keep current Redis ownership until cancellation settles.
7. Add heartbeat command discovery as fallback.
8. Emit stopped or lost outcomes and notify existing clients.

### Shared live reading

1. Define a stable runner frame envelope.
2. Add the bounded Redis frame stream and live relay.
3. Let secondary clients render live frames while the sender keeps its existing stream.
4. Prove that live delivery does not block the runner.
5. Detach execution from the sender request.
6. Move the sender to the shared session stream.

### Durable snapshot and replay

1. Complete the stable record-ID spike.
2. Review the provisional separate-event-table choice.
3. Add the selected append-only event store and per-session commit order.
4. Build session projections and snapshots through an opaque cursor.
5. Add replay followed by live delivery.
6. Migrate desktop and mobile before removing the old watch path.

### Durable input, Queue, Steer, and approvals

1. Add durable input admission and visible pending state.
2. Move the browser queue to the server.
3. Promote one queued input after normal completion.
4. Implement Steer as saved input, Stop, then promotion.
5. Move interaction continuation through the durable command path.
6. Test Stop, Steer, and approval races.

## Work that can start immediately

The following tasks do not require the final event-store decision:

- Sandbox cancellation spike.
- Current Stop path map.
- Durable command and long-poll design.
- Stable record-ID spike.
- Live frame envelope and ingress spike.

## First releasable slice

The first release contains durable Stop, long-poll delivery, heartbeat fallback, honest terminal
outcomes, and warm resume. It keeps existing Redis ownership and existing client watch behavior.

## Completion evidence

Each program needs:

- One stated invariant.
- Automated concurrency and failure tests.
- A live-stack test.
- Exact current and changed API behavior.
- Known limitations.

The draft RFC contains the complete test matrix.
