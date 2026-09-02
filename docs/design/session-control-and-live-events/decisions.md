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
