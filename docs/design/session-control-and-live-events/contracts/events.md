# Session event contract

> **AGENT-GENERATED, low weight.**

## Two event categories

Temporary frames provide live animation. Durable events provide recovery and replay.

| Property | Temporary frame | Durable event |
|---|---|---|
| Examples | text delta, tool progress | completed message, tool result, execution outcome |
| Storage | bounded Redis Stream | Postgres record |
| Sequence | none | numeric per-session sequence |
| Replay guarantee | bounded window only | durable retention |
| Client role | preview | canonical state |

## Shared envelope

Both categories carry stable object identity:

```text
session_id
execution_id
frame_or_event_id
type
entity_id
payload
created_at
```

Durable events also carry `session_sequence`. Message and tool frames use the same entity ID as
their completed checkpoint so the client replaces a preview rather than adding another object.

## Durable lifecycle vocabulary

The first contract includes:

- `execution.accepted`
- `execution.started`
- `execution.waiting`
- `execution.completed`
- `execution.stopped`
- `execution.failed`
- `execution.lost`
- `message.completed`
- `tool.completed`
- `interaction.pending`
- `interaction.responded`
- `interaction.cancelled`
- `input.pending`
- `input.promoted`
- `input.removed`

The implementation specification will define exact payload fields before code changes begin.

## Replay and live handoff

The event endpoint subscribes to the wake-up source before its first history query. It then queries
Postgres after the supplied sequence, sends those rows in order, and queries again whenever a
notification arrives. A notification carries no durable truth.

This order prevents a commit between replay and live following from being lost.

## Slow readers

Each reader has a bounded output buffer. The API closes a reader that falls behind. The runner and
other readers continue. The disconnected client reloads a snapshot and follows from its returned
sequence.

## Multiple API replicas

Redis and Postgres hold shared state. Runner ingress and client SSE may connect to different API
replicas. No API process owns durable session truth.

## Authorization

The event connection applies the same project access rules as the current session transcript and
invoke stream. The new path does not introduce a separate rule based on which client started work.
