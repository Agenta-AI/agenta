# Session event contract

> **AGENT-GENERATED, low weight.**

## What clients receive today

The initiating browser receives invoke frames. The current watch SSE emits notices such as
`records-changed`, then secondary clients reload completed records. It does not carry live content.

## Sender on the shared path

For `x-ag-session-response: shared`, invoke emits one transient `data-session-accepted` event with
`{sessionId, turnId, executionId}`. The current contract uses the same ID for the turn and execution.
The sender consumes invoke only for this acceptance, protocol lifecycle, and errors. It renders text,
reasoning, and tool progress from the session event route. Session responses advertise
`shared_reader` from the global environment switch so clients can select this route. Version one
does not add a project allowlist.

## One ingest envelope

Temporary frames and durable events reuse the existing records ingest HTTP endpoint. The API routes
them to separate Redis Streams in the same deployment. The envelope is versioned, and `kind`
makes the two valid shapes explicit.

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

- `session_id` reuses the current `sessionId`.
- `execution_id` reuses the current `turnId`.
- `frame_or_event_id` is stable across an identical retry.
- `entity_id` reuses `id`, `toolCallId`, or `messageId`. Execution events use `execution_id`.
- `frame_index` increases by one within an execution and orders temporary frames.
- `sequence` is the database-assigned per-session record cursor for this durable event. It can skip
  values because every record receives a sequence, while the relay exposes only the six typed events.
- `watermark` is the session's latest committed record sequence when the event is published or
  replayed. On a live event it is the highest sequence committed in the publishing batch. On the
  replay's final `ready` event it is the session cursor after the replay. A client that receives a
  `ready` event without it keeps the `after` cursor it requested.
- `created_at` is the producer timestamp in UTC. It does not define order.

Ingress accepts an identical retry and rejects conflicting reuse of an ID or index. It records a
frame gap. Clients order frames by `(execution_id, frame_index)`. Clients apply durable events with
a `sequence` greater than the last event they applied and discard duplicate or older events. They do
not wait for a contiguous sequence. After applying an event, they advance their reconnect cursor to
the greater of `sequence` and `watermark`.

## Temporary frame payloads

The envelope wraps the current invoke vocabulary. It does not rename the content protocol.

| Family | Existing types and fields |
|---|---|
| Stream | `start.messageId`, `start.messageMetadata.sessionId`, `start-step`, `finish-step`, `finish.finishReason`, `finish.messageMetadata.traceId`, `finish.messageMetadata.usage` |
| Correlation | `message-metadata.messageMetadata.turnId` |
| Text and reasoning | `text-start`, `text-delta.delta`, `text-end`, `reasoning-start`, `reasoning-delta.delta`, `reasoning-end`; all reuse `id` |
| Tools | `tool-input-start`, `tool-input-available`, `tool-output-available`, `tool-output-error`, `tool-output-denied`; all reuse `toolCallId` and current input or output fields |
| Other | `data-*`, `file`, `error`, and `data-agent-status` |

Repeated tool input snapshots keep one `toolCallId`, so the reducer updates one preview.

## Six durable events

Version one freezes only these event types and payloads:

| Type | Typed payload |
|---|---|
| `execution.started` | `{started_at}` |
| `execution.stopped` | `{stopped_at, reason, command_id}` |
| `execution.failed` | `{failed_at, error: {code, message, retryable, details?}}` |
| `execution.lost` | `{lost_at, reason, history_complete: false}` |
| `message.completed` | `{message_id, role, content, finish_reason?}` |
| `tool.completed` | `{tool_call_id, name, input, output?, error?, status}` |

The envelope carries session, execution, entity, sequence, and creation fields, so payloads do not
repeat them. The reducer ignores an unknown event type and continues from the next sequence. New
approval and pending-input events ship with their packages and a new compatible contract version.

## Storage and retention

The records worker reads durable records from `streams:records`, persists them, and then
acknowledges and deletes them with its existing policy. The relay worker reads only temporary frames
from `streams:session-live-frames`. It publishes each accepted frame to the session channel, then
acknowledges and deletes it. Neither consumer inspects or coordinates with the other stream.

The live-frame stream enforces a 15-minute age limit and an exact 100,000-frame count limit across
the deployment. The measured long case reached 3,161 frames and 201,056 SSE bytes in one turn. At
the highest measured average rate, 100,000 frames represent about 22 minutes for one active run.
Concurrent sessions share the cap because frames are disposable.

A reader that misses temporary frames discards its preview, reloads the durable snapshot, and
follows current frames. The runner never waits for retention or readers.

## Replay and live handoff

The event endpoint subscribes to the wake-up source before its first history query. It queries
Postgres after the supplied sequence, sends rows in order, and queries again when a notification
arrives. Notifications carry no durable truth.

Each replay is bounded by the current database watermark. Replayed events carry that watermark. The
replay's final `ready` event also carries it, including when no typed event follows the supplied
sequence.

Each reader has a bounded output buffer. The API closes a reader that falls behind. The reader then
reloads the snapshot and resumes from its durable sequence.

## Authorization and privacy

The event route applies the same project access rules as the transcript and invoke stream. It
revalidates access during the connection or ends the connection within 15 minutes so the client
must authenticate again.

Runner ingress verifies the caller's current owner claim for the supplied session and execution.
The shared runner token alone cannot authorize a foreign frame. Logs contain identifiers and reason
codes only. They never contain message content, tool payloads, or tokens.
