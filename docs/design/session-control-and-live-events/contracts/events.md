# Session event contracts

> **AGENT-GENERATED, low weight.**

This file separates the live-frame contract shipped in the current increment from the durable-event
contract planned for later increments. The target section does not describe current behavior.

## Shipped live-frame contract

### Client behavior

The initiating browser continues to render the invoke response. A second browser subscribes to the
session event route only when the session advertises `shared_reader` and the run belongs to another
browser. The global environment switch controls both the route and the advertised capability.

The event route sends a `ready` event after subscribing, then sends live frames as unnamed SSE data
events. It does not send durable events, sequences, watermarks, or replayed Postgres rows. The
existing watch SSE continues to send low-frequency notices such as `records-changed`; clients use
those notices to reload completed records.

Each execution must start at `frame_index: 0`, and each later frame must increment the index by one.
The client ignores duplicate and older indices. If the first index is above zero or a later index
skips a value, the client clears and suppresses the preview tail and refreshes durable records. A
reconnect also clears the disposable preview and refreshes durable records because Redis Pub/Sub has
no replay.

### Live-frame envelope

Frames use the existing records ingest HTTP endpoint. The API validates the frame and publishes it
to the dedicated live-frame Redis Stream.

```text
version: 1
kind: frame
session_id
execution_id
frame_or_event_id
frame_index
entity_id
type
payload
created_at
```

- `session_id` reuses the current `sessionId`.
- `execution_id` reuses the current `turnId`.
- `frame_or_event_id` combines the execution ID and frame index.
- `entity_id` reuses the message ID or tool-call ID.
- `frame_index` starts at zero and increases by one within an execution.
- `created_at` is the producer timestamp in UTC. It does not define order.

### Live-frame payloads

The envelope wraps the current invoke vocabulary. It does not rename the content protocol.

| Family | Shipped types and fields |
|---|---|
| Text | `text-start`, `text-delta.delta`, `text-end`; all reuse `id` |
| Reasoning | `reasoning-start`, `reasoning-delta.delta`, `reasoning-end`; all reuse `id` |
| Tools | `tool-input-start`, `tool-input-available`, `tool-output-available`, `tool-output-error`, `tool-output-denied`; all reuse `toolCallId` and current input or output fields |

Repeated tool input snapshots keep one `toolCallId`, so the reducer updates one preview.

### Storage and retention

The runner publishes frames asynchronously through a bounded 256-frame buffer. Publication errors
and buffer overflow do not block the run. Frames enter `streams:session-live-frames`, which has an
exact 100,000-entry count limit across the deployment and a 15-minute age limit. Concurrent sessions
share the count limit because frames are disposable.

The relay worker reads only the live-frame stream. It discards expired frames, publishes accepted
frames to the project-and-session Pub/Sub channel, then acknowledges and deletes them. The measured
long case reached 3,161 frames and 201,056 SSE bytes in one turn. At the highest measured average
rate, the 100,000-entry count bound would fill in about 22 minutes for one active run, but the
15-minute age limit caps effective retention at 15 minutes.

Durable records remain on `streams:records`. Publication preserves the existing approximate
100,000-entry retention bound. The records worker persists, acknowledges, and deletes those entries.
The live relay does not inspect or coordinate with the durable stream.

### Authorization and reader limits

Frame ingress verifies `RUN_SESSIONS` access and the caller's current owner claim for the supplied
session and execution. The shared runner token alone cannot authorize a foreign frame. The API also
enforces the serialized frame-size limit before publishing.

The event route requires `VIEW_SESSIONS` access for the current project and revalidates access during
the connection. Each reader has one bounded output queue. The API sends `relay-close` and ends a
connection when the reader falls behind, authorization is revoked, or the relay fails. The response
uses `Cache-Control: no-store` and disables proxy buffering.

Logs contain identifiers and reason codes only. They do not contain message content, tool payloads,
or tokens.

## Target durable-event contract

> **Not shipped in this increment.** The sections below define the target for later sender and
> replay increments.

### Sender on the shared path

For `x-ag-session-response: shared`, invoke will emit one transient `data-session-accepted` event
with `{sessionId, turnId, executionId}`. The target contract uses the same ID for the turn and
execution. The sender will consume invoke only for this acceptance, protocol lifecycle, and errors.
It will render text, reasoning, and tool progress from the session event route.

### Durable event envelope

Temporary frames and durable events will reuse the records ingest HTTP endpoint while continuing to
use separate Redis Streams. `kind` will distinguish the two versioned shapes.

```text
version
kind: frame | event
session_id
execution_id
frame_or_event_id
entity_id
type
payload
created_at

when kind = frame:
  frame_index

when kind = event:
  sequence
  watermark
```

- `sequence` will be the database-assigned per-session record cursor. It can skip values because
  every record receives a sequence while the relay exposes only the typed events.
- `watermark` will be the session's latest committed record sequence when the event is published or
  replayed. On a live event it will be the highest sequence committed in the publishing batch. On
  the replay's final `ready` event it will be the session cursor after replay.

Clients will apply durable events whose `sequence` is greater than the last event they applied and
discard duplicate or older events. They will not wait for a contiguous durable sequence. After
applying an event, they will advance the event-deduplication cursor to `sequence` and track the
greater of `sequence` and `watermark` separately as the reconnect cursor. A replay's final `ready`
event can advance both cursors after every event through its watermark has been applied.

### Durable event types

The target contract defines these event types and payloads:

| Type | Typed payload |
|---|---|
| `execution.started` | `{started_at}` |
| `execution.stopped` | `{stopped_at, reason, command_id}` |
| `execution.failed` | `{failed_at, error: {code, message, retryable, details?}}` |
| `execution.lost` | `{lost_at, reason, history_complete: false}` |
| `message.completed` | `{message_id, role, content, finish_reason?}` |
| `tool.completed` | `{tool_call_id, name, input, output?, error?, status}` |
| `interaction.requested` | `{interaction_id, kind?}` |
| `interaction.responded` | `{interaction_id, kind?}` |

The envelope will carry session, execution, entity, sequence, and creation fields, so payloads will
not repeat them. The reducer will ignore an unknown event type and continue from the next sequence.
Interaction events carry no answer data. Readers use them to refresh records and the current
interaction state.

### Replay and live handoff

The target event endpoint will subscribe to the wake-up source before its first history query. It
will query Postgres after the supplied sequence, send rows in order, and query again when a
notification arrives. Notifications will carry no durable truth.

Each replay will be bounded by the current database watermark. Replayed events will carry that
watermark. The replay's final `ready` event will also carry it, including when no typed event follows
the supplied sequence.

If a reader falls behind, the API will close the connection. The reader will then reload the durable
snapshot and resume from its durable sequence.
