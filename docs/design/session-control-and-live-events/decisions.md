# Decisions

> AGENT-GENERATED, low weight. Draft for discussion. Mahmoud makes final decisions.

## Confirmed process decisions

### D-001: Start from bugs and system requirements

**Status:** Confirmed by Mahmoud on 2026-09-02.

The design starts with the open issue inventory and the requirements the final system must
satisfy. Architecture options must link back to these requirements.

### D-002: Discuss one track at a time

**Status:** Confirmed by Mahmoud on 2026-09-02.

For each track, first present the high-level design and important questions. Record the answers
and decisions in the RFC after discussion.

### D-003: Keep the read path and control path independent

**Status:** Confirmed direction on 2026-09-02.

Shared reading and immediate control touch different directions and can progress in parallel:

- Read path: runner to API to clients.
- Control path: client to API to runner.

Stop must not wait for the live relay, replay, or sender-as-reader work to finish.

### D-004: Preserve live token output in the target experience

**Status:** Confirmed direction on 2026-09-02.

Moving readers behind the API must not reduce the sender to paragraph-only updates. The final
system must deliver live frames to every connected reader.

### D-005: Keep temporary frames separate from permanent facts

**Status:** Confirmed direction on 2026-09-02.

Live text fragments can have bounded retention. Completed messages, lifecycle facts, tools, and
interactions require durable recovery. One raw ingress can feed both consumers.

### D-006: Investigate sandbox-agent cancellation before selecting Stop semantics

**Status:** Confirmed process decision on 2026-09-02.

The Stop track starts with a focused sandbox-agent investigation. It must determine whether one
execution can be cancelled while the harness session and sandbox remain resumable. It must also
identify any required vendored patch and Daytona snapshot rebuild. This investigation can proceed
in parallel with the API control-path design.

### D-007: Use five seconds as the provisional Stop delivery target

**Status:** Provisional product direction from Mahmoud on 2026-09-02.

Within five seconds of an accepted Stop request, the active execution must stop starting new model
requests and new tool actions. The exact deadline for terminating an already-running provider or
tool operation remains open until harness and tool cancellation capabilities are verified.

### D-008: Separate Stop from Delete

**Status:** Confirmed by Mahmoud on 2026-09-02.

Stop preserves the session, its history, and its resumable sandbox state. Delete permanently
removes the session and its session-scoped resources. The public interface must not overload one
operation to mean both.

### D-009: Let first-party and external clients use the same session API

**Status:** Confirmed direction from Mahmoud on 2026-09-02.

Desktop, mobile, integrations, and external API consumers should use the same public session
contract. Private API-to-runner delivery remains an implementation detail behind that contract.

### D-010: Make the expected execution guard optional

**Status:** Confirmed direction from Mahmoud on 2026-09-02.

A Cancel request can include `expected_execution_id`. When supplied, the API cancels only that
execution and rejects a stale request. When omitted, the API cancels the session's current active
execution.

## Proposed design decisions

### P-001: Use one raw runner event ingress

**Status:** Proposed. Not approved.

The runner sends raw frames once. A shared Redis Stream can feed both the live relay and a durable
projector. The projector combines raw frames into durable events. The live relay forwards raw or
briefly batched frames without waiting for message completion.

The current sender response and current persistence path can remain during migration.

### P-002: Keep ownership heartbeats but remove normal control delivery from them

**Status:** Proposed. Not approved.

Heartbeats continue to renew runner ownership and detect failures. Immediate control delivery
handles Stop and Steer. Heartbeat detection remains a fallback when direct delivery fails.

### P-003: Use append-only durable events for replay

**Status:** Proposed. Requires an explicit decision reversal or separation from records.

The existing records specification decided to use UUIDv7 ordering and no stored per-session
sequence. The new replay requirement may need an append-only event log with a per-session cursor.
The design must either reopen the existing decision or introduce a separate event-log concept.

## Open decision gates

### O-001: Vocabulary

Settle the meanings of `session`, `conversation turn`, and `execution`. Decide how existing
`turn_id` and `turn_index` map to those terms.

### O-002: Stop behavior inside sandbox-agent

Verify whether the vendored sandbox-agent can cancel one execution while preserving its harness
session. If it cannot, define the required patch and whether Daytona needs a rebuilt snapshot.

### O-003: Durable ordering

Choose between:

- A new append-only durable event log with a per-session sequence.
- Append-only records with a new ordering contract.
- Separate record storage and replay-event storage.

Do not add a sequence column to mutable upserts and call the result append-only.

### O-004: Raw live transport

Choose the Redis Stream layout, retention limit, redaction boundary, and browser fan-out model.

### O-005: Immediate runner control

Choose direct runner HTTP, per-runner Redis control delivery, or a persistent runner connection.
The current API knows the logical owner `replica_id`, but its configured runner URL is not a
replica-specific route.

### O-006: Command boundary

Decide which actions enter a general command inbox. The working boundary is execution-affecting
intent: Send, Cancel, interaction response, Queue, and Steer. Attach is a read operation. Kill,
rename, archive, and delete remain explicit resource or lifecycle operations unless discussion
shows a need to change that boundary.

### O-007: Public resource API versus internal command transport

Decide whether public callers submit every execution action to one command collection or use
clear resource endpoints that translate into internal commands. The current proposal favors clear
public resources with one internal command envelope.

### O-008: Public Cancel target

Choose whether Cancel publicly targets:

- The current work in a session, with no execution ID.
- A specific execution resource.
- The current work in a session plus `expected_execution_id` as a stale-request guard.

The selected direction combines the first and third options. Cancel targets the current work in a
session. `expected_execution_id` is an optional stale-request guard supplied by clients that know
the current execution.

### O-009: Busy-message policy names

Choose the public names and defaults for a message submitted while work is active. The current
working set is `reject`, `queue`, and `steer` under an `on_busy` field.

### O-010: Pending input management

Decide whether clients can edit, remove, and reorder messages that the server accepted with
`on_busy: queue`. Pending messages must at least be visible in the session snapshot and event
stream so all clients show the same queue.
