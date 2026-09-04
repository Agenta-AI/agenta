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

### D-011: Keep queued inputs immutable

**Status:** Confirmed by Mahmoud on 2026-09-02.

Clients can view and remove a pending input. They cannot edit or reorder it. To change pending
content, a client removes the old input and submits a replacement. The API rejects removal after
the input has been promoted into active work.

### D-012: Keep design discussions at the architectural level

**Status:** Confirmed by Mahmoud on 2026-09-02.

The discussion focuses on resource boundaries, execution ownership, event flow, recovery, and
user-visible behavior. Routine endpoint naming, status codes, defaults, and validation details use
established API conventions during RFC drafting unless they materially change those properties.

### D-013: A successful submission means durable acceptance

**Status:** Confirmed by Mahmoud on 2026-09-02.

The API confirms a submitted input only after it has durably saved the input, its idempotency
identity, its session, and the intent to execute it. Acceptance does not wait for a runner to claim
the work, the harness to start, or the first output frame. If no runner is available, accepted work
remains queued rather than disappearing.

### D-014: Do not preserve sender-only live visibility as a requirement

**Status:** Confirmed by Mahmoud on 2026-09-02.

The shared session stream is available to authorized session viewers. The design does not treat
raw live output as secret to the browser that started the execution. Existing configured
redaction and authorization behavior must be understood, but sender-only visibility is not a
target product rule.

### D-015: Add the new session interface beside the current endpoints

**Status:** Confirmed as a fair first draft by Mahmoud on 2026-09-02.

The new snapshot and replayable event interface is introduced without changing the meaning of the
current stream and watch endpoints. Desktop and mobile migrate before obsolete endpoints are
deprecated. Final endpoint names remain open for a later interface review.

### D-016: Separate command delivery state from execution state

**Status:** Confirmed by Mahmoud on 2026-09-02.

The internal command lifecycle starts with `pending`, `claimed`, `applied`, and `obsolete`.
Claims are temporary and can expire or retry. An execution terminal outcome is durable and cannot
change. Public clients follow execution states such as `running`, `stopping`, `stopped`, `failed`,
and `lost`; they do not infer execution state from internal delivery acknowledgements.

Accepting Stop durably saves the command and moves the matching execution from `running` to
`stopping` in one transaction. A runner outcome settles both the execution and the command. A
watchdog settles an execution whose runner disappears, but its timeout remains open until the
sandbox cancellation spike.

Postgres is the admission-state store for both the durable command row and the execution
projection. The API inserts the command and updates the matching execution in one Postgres
transaction. Redis ownership is not part of that transaction. A crash before commit accepts
nothing. A crash after commit leaves a retryable `pending` command that long polling or heartbeat
discovery can deliver until the runner applies it.

### D-017: Keep current Redis execution ownership for the first version

**Status:** Confirmed by Mahmoud on 2026-09-02.

The first version keeps the existing Redis `alive`, `running`, `owner`, and `superseded` model.
It does not add Postgres execution authority, ownership generations, or full stale-writer fencing.
Those changes have low current value because Agenta operates one runner and does not plan near-term
runner scaling.

Durable commands and direct API-to-runner delivery are in scope. Stop no longer depends on deleting
ownership and waiting for a heartbeat. The current execution keeps its Redis ownership while
stopping and releases it after cancellation settles. Long polling is deferred behind the same
control-delivery port.

### D-018: Use runner-initiated HTTP long polling for immediate control

**Status:** Selected for the milestone 1 implementation on 2026-09-04.

The runner uses HTTP long polling behind a control-delivery port. Durable commands remain
recoverable across disconnection, and the Stop path does not depend on Redis, WebSockets, or direct
runner routing. Heartbeat command discovery remains the fallback delivery path.

Redis remains an execution lease and routing hint. Postgres command and execution rows are the
durable recovery source after process or Redis failure.

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

### P-004: Require one active execution and fence stale writers

**Status:** Proposed. Direction confirmed, mechanism not approved.

At most one execution can be active for a session. Admission must be atomic. Each accepted owner
receives an increasing ownership generation, also called a fencing token. Every durable write and
effect-producing command carries that generation. The API rejects a write from an older
generation even if the old runner is still alive.

Redis heartbeats remain useful for leases and crash detection. A lease alone is not the final
correctness guarantee because it can expire during a network partition while the old runner keeps
working.

## Open decision gates

### O-001: Vocabulary

Settle the meanings of `session`, `conversation turn`, and `execution`. Decide how existing
`turn_id` and `turn_index` map to those terms.

### O-002: Stop behavior inside sandbox-agent

Verify whether the vendored sandbox-agent can cancel one execution while preserving its harness
session. Warm resume is the required outcome. If current behavior cannot provide it, define the
required patch and whether Daytona needs a rebuilt snapshot.

### O-003: Durable ordering

Choose between:

- A new append-only durable event log with a per-session sequence.
- Append-only records with a new ordering contract.
- Separate record storage and replay-event storage.

Do not add a sequence column to mutable upserts and call the result append-only.

### O-004: Raw live transport

Choose the Redis Stream layout, retention limit, redaction boundary, and browser fan-out model.

### O-005: Stable record-ID semantics spike

Before immutable event insertion is implemented, inventory every runner and backend path that
reuses a `record_id`. Separate exact delivery retries from progressive updates and resume
re-emissions. Add regression tests for the final state of tools, interactions, terminal events,
and harness reconstruction.

### O-006: Immediate runner control

**Status:** Resolved for version one on 2026-09-03.

Use a direct API-to-runner HTTP call through the replaceable control-delivery port. Durable storage
precedes the call, so transport failure costs promptness rather than command correctness. Defer
runner-initiated long polling until multi-runner or user-operated routing requires it.

### O-007: Command boundary

Decide which actions enter a general command inbox. The working boundary is execution-affecting
intent: Send, Cancel, interaction response, Queue, and Steer. Attach is a read operation. Kill,
rename, archive, and delete remain explicit resource or lifecycle operations unless discussion
shows a need to change that boundary.

### O-008: Public resource API versus internal command transport

Decide whether public callers submit every execution action to one command collection or use
clear resource endpoints that translate into internal commands. The current proposal favors clear
public resources with one internal command envelope.

### O-009: Public Cancel target

Choose whether Cancel publicly targets:

- The current work in a session, with no execution ID.
- A specific execution resource.
- The current work in a session plus `expected_execution_id` as a stale-request guard.

The selected direction combines the first and third options. Cancel targets the current work in a
session. `expected_execution_id` is an optional stale-request guard supplied by clients that know
the current execution.

### O-010: Busy-message policy names

Choose the public names and defaults for a message submitted while work is active. The current
working set is `reject`, `queue`, and `steer` under an `on_busy` field.

### O-011: Pending input ordering

Pending inputs remain visible in the session snapshot and event stream. The initial contract uses
server-assigned FIFO order. Clients cannot edit or reorder queued inputs.
