# Context

> AGENT-GENERATED, low weight. Draft for discussion. Mahmoud makes final decisions.

## Current user experience

The browser that sends a message owns the live invoke response. Other clients receive saved
record changes later. Stop uses the session control endpoint, but the runner learns about normal
cancellation through its next heartbeat. Session records use upserts and do not provide a durable
per-session replay cursor.

These behaviors cause several visible problems:

- Stop can update the browser while execution continues in the runner.
- A failed or missing terminal signal can leave a session shown as running.
- A second message can race with the active execution and break the session.
- Another browser cannot receive the same live text stream as the sender.
- A reconnecting browser cannot request all durable changes after a stable cursor.
- Approval, cancellation, and resume races can leave an interaction or session unusable.
- A re-sent record can change the apparent reading order because records are mutable upserts.

## Design scope

The final design must cover four independent paths:

1. **Live output:** runner to API to every connected reader.
2. **Durable facts:** append-only session history with stable ordering and replay.
3. **Commands:** client to API to the execution owner, with durable admission where required.
4. **Ownership:** one active execution owner, renewed through a temporary lease.

The read path and control path can progress in parallel. Stop is not blocked on the live relay.
The live relay is not blocked on the final Stop behavior.

## Goals

- Stop reaches active execution promptly and produces one terminal outcome.
- Normal Stop preserves the resumable session and sandbox when the harness supports this.
- Multiple clients receive live frames from the same execution.
- Refreshing or closing the sender does not stop execution.
- Clients can recover durable changes after a cursor.
- A second message has an explicit server-side delivery policy.
- Steer saves the new message before it interrupts current work.
- Approval state remains correct across pause, Stop, refresh, and resume.
- Records and events have stable ordering that retries cannot change.
- Runner failure eventually releases ownership and leaves a terminal durable outcome.

## Non-goals for the first RFC pass

- Selecting a new broker before current Redis options are evaluated.
- Storing every token permanently in Postgres.
- Replacing every frontend session view in the first implementation.
- Solving all harness limitations through one common behavior.
- Treating the current issue grouping as a confirmed roadmap priority.

## Design process

Each track will follow the same sequence:

1. Review current behavior and linked failures.
2. Agree on the invariant and user-visible requirement.
3. Compare the high-level options.
4. Record the decision and rejected alternatives.
5. Add the approved design to the living RFC.
6. Define one live-stack test that proves the track.
