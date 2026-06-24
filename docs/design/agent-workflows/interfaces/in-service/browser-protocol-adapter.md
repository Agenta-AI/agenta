# Browser Protocol Adapter

The Vercel adapter is the translation layer between the browser's protocol and the neutral
runtime. It exists so Vercel names stay out of the runtime DTOs: the adapter converts
`UIMessage[]` to neutral `Message[]` on the way in, and neutral `AgentEvent`s to Vercel UI
Message Stream parts on the way out. It owns the public [`/messages`](../public-edge/agent-messages.md)
and [`/load-session`](../public-edge/agent-load-session.md) contracts, so a change here is
usually a change a browser will notice.

## The contract

**Inbound (`messages.py`).** Each Vercel part maps to a neutral content block:

| Vercel part | Neutral block |
|---|---|
| `text` | `ContentBlock(type="text")` |
| `file` | `ContentBlock(type="image"` or `"resource")` with uri and mime |
| `tool-{name}` state `input-available` | `ContentBlock(type="tool_call")` |
| `tool-{name}` state `output-available`/`output-error` | `ContentBlock(type="tool_result")` |
| `tool-approval-response` | `tool_result` carrying `{approved}` |
| `tool-approval-request` | dropped (it is permission state, not history) |

**Outbound (`stream.py`).** Each neutral event becomes one or more strict Vercel parts:

| Neutral event | Vercel parts |
|---|---|
| `message` / `message_*` | `text-start` / `text-delta` / `text-end` |
| `thought` / `reasoning_*` | `reasoning-start/delta/end` |
| `tool_call` | `tool-input-start`, `tool-input-available` (+ optional `data-render`) |
| `tool_result` | `tool-output-available` / `-error` / `-denied` |
| `interaction_request` (permission) | `tool-approval-request` (strict `{type, approvalId, toolCallId}`) |
| `interaction_request` (input) | `data-input-request` |
| `usage`, `done` | collected, stamped on `finish` |

**Finish.** Stop reasons map to the AI SDK enum (`end_turn` to `stop`, `max_tokens` to
`length`, `tool_use` to `tool-calls`, and so on; unmapped falls back to `unknown`). The final
`finish` part carries `usage` and `traceId` in `messageMetadata`.

**SSE framing (`sse.py`).** Headers include `x-vercel-ai-ui-message-stream: v1`,
`cache-control: no-cache`, and `x-accel-buffering: no` to stop proxies buffering the stream.
The stream ends with `data: [DONE]`.

## Appendix: the Vercel UIMessage, all cases

A `UIMessage` is `{id, role, parts}`, where `parts` is a typed list. The mapping above is the
summary; this is the exact shape of each part, in both directions. These are the
history-message parts that `messages.py` converts. The live SSE stream uses a related but
distinct set of streaming parts (`text-delta`, `tool-input-available`, and so on), covered in
the outbound table above.

```jsonc
{ "id": "msg-1", "role": "user", "parts": [ /* Part[] */ ] }
```

**Inbound parts (browser to neutral), handled by `_part_to_blocks`:**

```jsonc
// text -> text block
{ "type": "text", "text": "hello" }

// file -> image block when mediaType starts with "image/", else resource
{ "type": "file", "mediaType": "image/png", "url": "https://...", "data": "<base64>" }

// any "tool-<name>" / "dynamic-tool" / "tool-output-available" -> tool_call and/or tool_result
{ "type": "tool-search", "toolCallId": "call_1", "state": "input-available",
  "input": { "q": "..." } }
{ "type": "tool-search", "toolCallId": "call_1", "state": "output-available",
  "output": { "...": "..." } }
{ "type": "tool-search", "toolCallId": "call_1", "state": "output-error",
  "errorText": "..." }

// tool-approval-response -> a tool_result keyed by toolCallId (or approvalId)
{ "type": "tool-approval-response", "toolCallId": "call_1", "approved": true, "reason": "..." }

// tool-approval-request -> dropped (permission state, not history)
{ "type": "tool-approval-request", "toolCallId": "call_1" }
```

When a tool part has no `toolName`, the adapter recovers it from the `tool-<name>` type
suffix. An approval response with no explicit `output` becomes `{"approved": <bool>}`, or the
`reason` string.

**Outbound parts (neutral to browser), handled by `_block_to_parts`:** a batch
`message_to_vercel_ui_message` renders an `AgentResult` as a single text part, and a neutral
`Message` block by block:

```jsonc
{ "type": "text", "text": "..." }                       // from a text block
{ "type": "file", "url": "...", "mediaType": "...", "data": "<base64>" }   // image/resource
{ "type": "tool-search", "toolCallId": "call_1", "state": "input-available",
  "input": { "...": "..." } }                            // from a tool_call block
{ "type": "tool-search", "toolCallId": "call_1",
  "state": "output-available", "output": { "...": "..." } }   // tool_result (or "output-error")
```

The neutral side of this mapping is in
[Neutral runtime DTOs](neutral-runtime-dtos.md#appendix-the-message-representation-all-cases).

## Owned by

- `sdks/python/agenta/sdk/agents/adapters/vercel/routing.py`: routes, validation, negotiation.
- `sdks/python/agenta/sdk/agents/adapters/vercel/messages.py`: message conversion both ways.
- `sdks/python/agenta/sdk/agents/adapters/vercel/stream.py`: event-to-part projection.
- `sdks/python/agenta/sdk/agents/adapters/vercel/sse.py`: SSE framing and headers.

## Watch for when changing

- **Part shape is strict.** The browser validates every part. A `render` field cannot ride a
  tool part inline; it rides a sibling `data-render`. A malformed part throws in `useChat`.
- **Tool approval round trips.** The request-drop and response-to-`tool_result` mapping are
  what make cross-turn approval work.
- **Finish reason mapping.** An unmapped reason becomes `unknown`, not an error, so a missing
  mapping is easy to miss.
- **Usage and trace metadata.** Both ride the `finish` part only, not earlier parts.
- **Keep Vercel names out of the runtime.** The whole point of this layer is that the DTOs
  stay neutral.
