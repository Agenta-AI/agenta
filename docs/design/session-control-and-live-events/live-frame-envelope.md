# Live frame envelope

> **AGENT-GENERATED, low weight.**

## Measurement

The sample used `agenta-ee-dev-session-integration` at `http://localhost:8580` on 3 September
2026. It ran Pi (`pi_core`) with `gpt-5.6-luna` and the local sandbox. Each case ran three times.
The Pi key came from `~/.agenta-qa-openai.env` under `OPENAI_API_KEY`. Its value was not recorded.

A frame is one JSON `data:` SSE frame. Counts exclude the terminal `[DONE]` sentinel. Byte counts
include the `data:` prefix and frame delimiter. Run length starts before the invoke request and ends
when the response body closes. Raw bodies and the machine-readable results are in
`~/agenta-qa-evidence/2026-09-03-session-night/trackC/`.

`base` below means `start:1`, `start-step:1`, `message-metadata:1`, `data-agent-status:2`,
`text-start:1`, `text-end:1`, `finish-step:1`, and `finish:1`.

| Case | Run | Length | Frames | Frames/s | Bytes/frame min/median/max | Total bytes | Event counts |
|---|---:|---:|---:|---:|---:|---:|---|
| Short | 1 | 10.456 s | 104 | 9.947 | 30 / 63 / 190 | 6,830 | base; `text-delta:95` |
| Short | 2 | 9.406 s | 116 | 12.333 | 30 / 63 / 202 | 7,589 | base; `text-delta:107` |
| Short | 3 | 9.501 s | 105 | 11.052 | 30 / 64 / 202 | 6,938 | base; `text-delta:96` |
| Long | 1 | 39.210 s | 2,866 | 73.093 | 30 / 63 / 191 | 182,626 | base; `text-delta:2763`; reasoning start/delta/end `1/92/1` |
| Long | 2 | 41.795 s | 3,161 | 75.632 | 30 / 63 / 192 | 201,056 | base; `text-delta:3069`; reasoning start/delta/end `1/81/1` |
| Long | 3 | 46.149 s | 2,745 | 59.481 | 30 / 63 / 192 | 175,156 | base; `text-delta:2649`; reasoning start/delta/end `1/85/1` |
| Tool-heavy | 1 | 18.074 s | 674 | 37.291 | 30 / 62 / 514 | 58,983 | base; text `387`; reasoning `2/180/2`; tool start/input/output/error `7/80/2/5` |
| Tool-heavy | 2 | 17.956 s | 664 | 36.979 | 30 / 62 / 514 | 50,988 | base; text `361`; reasoning `3/240/3`; tool start/input/output/error `6/36/2/4` |
| Tool-heavy | 3 | 15.360 s | 566 | 36.850 | 30 / 61 / 514 | 39,685 | base; text `366`; reasoning `2/164/2`; tool start/input/output/error `6/11/2/4` |

Tool input snapshots repeat under one `toolCallId`. The relay must keep that identity so the client
updates one tool preview instead of creating a tool for every snapshot.

## Envelope

Every temporary frame uses these fields:

- `version` (`metadata`): Identifies the compatible envelope version.
- `kind` (`metadata`): Is `frame` for temporary output. Durable records use `event`.
- `session_id` (`identity`): Identifies the conversation. It reuses the current `sessionId` value.
- `execution_id` (`identity`): Identifies one admitted turn. It reuses the current `turnId` value.
- `frame_or_event_id` (`identity`): Identifies this frame for duplicate suppression.
- `frame_index` (`ordering`): Increases by one within an execution. It is not a durable replay cursor.
- `type` (`payload`): Reuses the current invoke event type without renaming it.
- `entity_id` (`identity`): Reuses `id`, `toolCallId`, or `messageId`. Execution-level frames use `execution_id`.
- `payload` (`payload`): Carries the current event-specific fields with their existing names.
- `created_at` (`metadata`): Records when the producer created the frame in UTC.

The producer assigns `frame_index` before ingress. `frame_or_event_id` is stable for that index on
a retry. Redis Stream IDs order storage operations only. Clients order frames by
`(execution_id, frame_index)` and use `entity_id` to update previews.

## Existing invoke vocabulary

The envelope wraps the current invoke projection. It does not define a second content protocol.

| Current event family | Existing names and fields to retain |
|---|---|
| Stream lifecycle | `start.messageId`, `start.messageMetadata.sessionId`, `start-step`, `finish-step`, `finish.finishReason`, `finish.messageMetadata.traceId`, `finish.messageMetadata.usage` |
| Execution correlation | `message-metadata.messageMetadata.turnId` |
| Text and reasoning | `text-start`, `text-delta.delta`, `text-end`, `reasoning-start`, `reasoning-delta.delta`, `reasoning-end`; all reuse `id` |
| Tools | `tool-input-start`, `tool-input-available`, `tool-output-available`, `tool-output-error`, and `tool-output-denied`; all reuse `toolCallId` and existing input or output fields |
| Other content | `data-*`, `file`, `error`, and the measured `data-agent-status` frames |

The current `/sessions/streams/watch` SSE is not a content source. It sends `ready`,
`records-changed`, `lifecycle`, `interaction`, and heartbeat notifications. The new relay carries
the invoke frames above and can keep the existing watch notifications separate.

## Redis transport and retention

The records ingest HTTP endpoint accepts both temporary frames and durable records. It publishes
frames to the dedicated `streams:session-live-frames` Redis Stream and leaves durable records on
`streams:records`. Both keys use the same durable Redis deployment, but their acknowledgement and
retention policies are independent.

The live-frame stream applies both limits across the deployment:

- Maximum age: **15 minutes**.
- Maximum length: **100,000 frames**, trimmed exactly when a frame is appended.

The highest observed run-average rate was 75.632 frames/s. Fifteen minutes at that rate is
`75.632 * 900 = 68,069` frames. A 100,000-frame cap leaves 47 percent headroom for one run and
represents 22.0 minutes at that rate. It also holds 31.6 times the largest measured run of 3,161
frames. Concurrent sessions share this disposable capacity. If relay lag crosses either bound,
clients reload the durable snapshot and follow current frames.

The largest measured run used 201,056 frame bytes. Scaling its 63.6-byte average to 100,000 frames
gives about 6.36 MB of SSE frame bytes. This excludes the envelope and Redis overhead. Each
serialized frame is limited to 64 KiB before it reaches Redis.
