# Session event contract

> **AGENT-GENERATED, low weight.**

## What clients receive today

The initiating browser receives invoke frames. The current watch SSE emits notices such as
`records-changed`, then secondary clients reload completed records. It does not carry live content.

## One ingest envelope

Temporary frames and durable events reuse the existing records ingest stream. The envelope is
versioned, and `kind` makes the two valid shapes explicit.

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
```

- `session_id` reuses the current `sessionId`.
- `execution_id` reuses the current `turnId`.
- `frame_or_event_id` is stable across an identical retry.
- `entity_id` reuses `id`, `toolCallId`, or `messageId`. Execution events use `execution_id`.
- `frame_index` increases by one within an execution and orders temporary frames.
- `sequence` is the database-assigned per-session cursor for durable events.
- `created_at` is the producer timestamp in UTC. It does not define order.

Ingress accepts an identical retry and rejects conflicting reuse of an ID or index. It records a
frame gap. Clients order frames by `(execution_id, frame_index)` and durable events by `sequence`.

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

The records worker persists only durable events. The relay consumer forwards temporary frames from
the same stream. Redis trims each session stream approximately with `MAXLEN` and also enforces age.

The measured long case reached 3,161 frames and 201,056 SSE bytes in one turn. The initial limits
are 15 minutes and 100,000 frames per session. At the highest measured average rate, that length
holds about 22 minutes and more than 31 long turns. The size estimate is about 6.36 MB of frame data
before envelope and Redis overhead.

A reader outside either retention bound discards temporary previews, reloads a snapshot, and
follows current frames. The runner never waits for retention or readers.

## Replay and live handoff

The event endpoint subscribes to the wake-up source before its first history query. It queries
Postgres after the supplied sequence, sends rows in order, and queries again when a notification
arrives. Notifications carry no durable truth.

Each reader has a bounded output buffer. The API closes a reader that falls behind. The reader then
reloads the snapshot and resumes from its durable sequence.

## Authorization and privacy

The event route applies the same project access rules as the transcript and invoke stream. It
revalidates access during the connection or ends the connection within 15 minutes so the client
must authenticate again.

Runner ingress verifies the caller's current owner claim for the supplied session and execution.
The shared runner token alone cannot authorize a foreign frame. Logs contain identifiers and reason
codes only. They never contain message content, tool payloads, or tokens.
