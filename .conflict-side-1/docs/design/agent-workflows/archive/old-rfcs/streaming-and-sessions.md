# RFC: Streaming and sessions for the agent interface

Status: **Proposed**. Audience: the frontend lead who will build against this, and the
backend engineer who will implement it. This RFC adds two things to the existing workflow
interface. It does not replace it.

This is the design document: the why, the options, and the trade-offs. The normative wire
spec (endpoints, message formats, MUST/SHOULD rules) lives in the
[Agent protocol RFC](agent-protocol-rfc.md). Read this for the reasoning, that one to build.

## Why this exists

Today every workflow, including the agent, runs behind one request and one response. The
playground sends `POST /invoke`, waits, and renders the final answer. That works for a
prompt that calls a model once. It does not work for an agent.

An agent runs a loop. It thinks, calls a tool, reads the result, and calls the model again,
sometimes for a minute or more before it has a final answer. Two things break under the
single-response model:

1. **The user sees nothing until the end.** No tokens, no "the agent is calling a tool
   now," no thinking. For a long run this reads as a hang.
2. **Multi-turn conversation is the client's job.** The client holds the whole history and
   replays it on every turn (see [sessions.md](sessions.md)). The platform does not own the
   conversation, so the client cannot reconnect, reload, or share it.

This RFC addresses both. It streams the agent's work to the browser as it happens, in the
[Vercel AI SDK](https://ai-sdk.dev) wire format so the frontend can use `useChat` directly.
And it gives the agent a named **session** so a conversation can be grouped, reloaded, and
later moved server-side. The streaming piece lands in full. The session piece lands as the
identifier and the load endpoint now, with server-owned history as the next step.

## What we are adding, in one paragraph

We add a new endpoint, `POST /messages`, for the chat agent. It sits next to the existing
`/invoke`, which does not change. `/messages` carries an optional `session_id` and offers two
response modes. Ask for JSON and you get a single response, like `/invoke` gives today. Ask
with `Accept: text/event-stream` and the same call streams the run as Vercel UI-message parts
over SSE. Pass a `session_id`, and the platform ties the turn to a named conversation: it
records the turn under that id and returns the id. A second endpoint, `load-session`, returns
a session's history so the client can rebuild the conversation in the UI.

Why a new endpoint and not a flag on `/invoke`? The chat contract differs enough to stand on
its own. The conversation is a first-class `messages` input in the Vercel `UIMessage` shape,
the response can stream, and a turn belongs to a session. Overloading `/invoke` with all of
that would blur the simple, stateless workflow call. A sibling endpoint keeps each contract
clean.

For now the client still sends the full message history on every turn, exactly as it does
today. The `session_id` rides alongside that history. It names the conversation, it lets
turns be grouped and reloaded, and it is the foothold for the larger step of moving history
into the platform so the client sends only the new turn. That larger step is the
[next direction](#what-stays-client-side-for-now), not part of this RFC.

Three pieces, each additive:

| Piece | Endpoint | What it does |
| --- | --- | --- |
| Session id | `POST /messages` | Names the conversation a turn belongs to; returns the id |
| Streaming | `POST /messages` with `Accept: text/event-stream` | Streams the run in Vercel format |
| Load | `POST /load-session` | Returns a session's history for the UI to rebuild |

## Background: the contract we are extending

The shapes below are the current contract. The RFC adds fields, it does not rename them.

**Request** is `WorkflowInvokeRequest` (`sdks/python/agenta/sdk/models/workflows.py:257`).
The body that matters is the `data` envelope (`workflows.py:206`): `inputs` (the template
variables, including `messages` for a chat workflow), `parameters` (the agent config), and
`trace`. The agent app reads `inputs.messages` and `parameters.agent`
(`services/oss/src/agent/app.py:65`).

**Response** is `WorkflowServiceResponse` (`workflows.py:321`). The assistant reply rides in
`data.outputs` as `{"role": "assistant", "content": ...}`. The envelope also carries
`trace_id` and `span_id` at the top level (`workflows.py:289`). Token usage is **not** in
the response. It lives on the trace span and the client reads it from tracing.

**The agent run** already produces a structured event stream internally. The runner emits
`AgentEvent`s as the run proceeds (`services/agent/src/protocol.ts:74`):

```ts
type AgentEvent =
  | { type: "message";     text: string }
  | { type: "thought";     text: string }
  | { type: "tool_call";   id?: string; name?: string; input?: unknown }
  | { type: "tool_result"; id?: string; output?: string; isError?: boolean }
  | { type: "usage";       input?; output?; total?; cost? }
  | { type: "error";       message: string }
  | { type: "done";        stopReason?: string };
```

Today the runner buffers these and returns the whole log on the result, because `/invoke`
is request-and-response. An `on_event` sink already exists to receive them live
(`Harness.invoke(..., on_event=...)`, `ports-and-adapters.md`). **Streaming is the act of
wiring that sink to the HTTP edge and encoding each event as a Vercel part.** The event
kinds line up with the Vercel parts almost one to one, which is why this is an encoder, not
a rewrite.

`session_id` already flows through the agent runner (`SessionConfig.session_id`,
`AgentResult.session_id`) and rides on the trace as `ag.session.id`. It just never reached
the HTTP body. The new `/messages` endpoint carries it in the request and response body.

## The session model

A session is a named conversation identified by a `session_id`. The id appears in the
request body and the response body, never in a header. For now it names and records the
conversation. It does not yet hold the context the model sees, because the client still
sends the full history (see [what stays client-side](#what-stays-client-side-for-now)).

### How a session id is resolved

```
client sends session_id?
├── no  → server mints a new id, records the turn under it, returns the id
└── yes → does a session with this id exist for this project?
          ├── no  → create the session with the client's id, record the turn
          └── yes → record the turn under the existing session
```

This is an upsert keyed by `(project_id, session_id)`. The same call creates or continues.
"Continue" means the turn is recorded under that session. The conversation context still
comes from the messages the client sends, not from the server's record. That changes when
history moves server-side.

### Client lifecycle

```
New conversation
  1. client generates session_id (or omits it and adopts the one the server returns)
  2. POST /messages { session_id, full history }   → stream
  3. reuse session_id for every later turn

Returning to a known conversation (new page load, another device)
  1. POST /load-session { session_id }           → history
  2. render it, and hold it to send on the next turn
  3. POST /messages { session_id, full history } → stream continues it
```

A fresh client holds no history. `load-session` is how it gets the conversation back, both
to render it and to have it to resend on the next turn.

### What stays client-side for now

The client still sends the full message history on every turn, the same as today. The
`session_id` rides alongside it. The server does not yet read its own record to build the
model's context, so today the history on the wire is authoritative.

Moving that history into the platform is the next step, not this RFC. When it lands, a
request with a `session_id` carries only the new turn and the platform supplies the rest.
That is what makes reconnect and sharing cheap, and it is why the `session_id` belongs in
the contract now even though the payload has not shrunk yet. [sessions.md](sessions.md)
covers the server-owned-history work in full.

### My notes on the session decisions

The four rules you proposed are sound and they match how `useChat` already works. Three
things to lock down before building:

- **Scope every id to the project, and check ownership on resume.** "Resume if it exists"
  must mean "resume if it exists *and belongs to this caller*." Otherwise a client can pass
  another tenant's `session_id` and read their conversation. If the id exists under a
  different project, treat it as not found, do not resume. The unique key is
  `(project_id, session_id)`, not `session_id` alone.
- **Validate client-supplied ids.** Accepting a client id means the client controls that
  part of the id space. Bound the length and the charset and treat the id as an opaque
  token, never interpolate it into a storage path or a query without escaping. The Vercel
  docs raise the same path-traversal warning.
- **Prefer a client-generated id for the `useChat` path, keep server-minting for the
  rest.** `useChat` takes a fixed `id` up front and round-trips it. If the server mints a
  *different* id, the client has to adopt it after the first turn, which is awkward in that
  hook. So for the browser, let the client generate the id and send it from turn one. Keep
  server-minting for callers that do not care (curl, the SDK, a script). Both paths are
  supported. This is the one place I would steer the frontend rather than leave it open.

## Streaming: the Vercel UI Message Stream

We stream in the format `useChat` consumes, so the frontend gets messages, tool calls,
reasoning, and status with no custom parser. This section is the part to build against.

### How a client asks for a stream

Negotiation uses the standard `Accept` header, which the SDK route already honors
(`routing.py:236`):

- `Accept: application/json` (or no header): the current single JSON response. Unchanged.
- `Accept: text/event-stream`: the Vercel stream described below.

The `useChat` transport sets this header in one line (see [the frontend
wiring](#frontend-wiring)). The header `x-vercel-ai-ui-message-stream: v1` is a **response**
header the server sets, not something the client sends. You were right that headers are the
wrong place for `session_id`. They are the right place for content negotiation.

### What the format is

The Vercel UI Message Stream (AI SDK v5 and v6) is plain SSE. Each part is one event:

```
data: <compact json>\n\n
```

and the stream ends with a literal `data: [DONE]\n\n`. A message is a list of **parts**, and
the part types are:

| Part family | Parts | Carries |
| --- | --- | --- |
| Lifecycle | `start`, `start-step`, `finish-step`, `finish` | message id, step boundaries, finish reason |
| Text | `text-start`, `text-delta`, `text-end` | streamed assistant text, grouped by an `id` |
| Reasoning | `reasoning-start`, `reasoning-delta`, `reasoning-end` | the model's thinking |
| Tool input | `tool-input-start`, `tool-input-delta`, `tool-input-available` | `toolCallId`, `toolName`, the arguments |
| Tool output | `tool-output-available`, `tool-output-error` | `toolCallId`, the result or an error |
| File | `file` | `url`, `mediaType` (a data: URL works) |
| Data / generative UI | `data-<name>` | any JSON, rendered by a custom component on the client |
| Error | `error` | `errorText` |

One field name to not get wrong: text and reasoning deltas use `delta`, but tool input
deltas use `inputTextDelta`.

**Tool calls** stream as a start, optional argument deltas, then the assembled input:

```
data: {"type":"tool-input-start","toolCallId":"call_1","toolName":"getWeather"}
data: {"type":"tool-input-available","toolCallId":"call_1","toolName":"getWeather","input":{"city":"Paris"}}
```

**Tool results** come back as their own part, keyed by the same `toolCallId`:

```
data: {"type":"tool-output-available","toolCallId":"call_1","output":{"weather":"sunny"}}
```

or, on failure, `{"type":"tool-output-error","toolCallId":"call_1","errorText":"..."}`.

**Files** stream as a `file` part: `{"type":"file","url":"...","mediaType":"image/png"}`.
The url can be an `https://` link or an inline `data:` URL.

**Generative UI** is the `data-<name>` part. The server emits
`{"type":"data-plan","data":{...}}` and the client renders a component for parts of type
`data-plan`. Mark a part `"transient": true` to deliver it only to the `onData` callback
without storing it on the message. This is the extension point for agent-specific UI (a plan
view, a diff, a progress card). We do not need it for v1, but the format gives it to us for
free.

### Does the stream also send the whole message at the end?

No. This was your open question, so to be precise: the protocol streams deltas only. There
is no final full-snapshot event. The client assembles the parts into the final `UIMessage`
as they arrive, and `finish` then `[DONE]` close it out. The complete message exists
server-side too (we need it to persist the turn), but we do not re-emit it on the wire.

So the two modes differ cleanly:

- **Non-streaming** (`Accept: application/json`): one JSON response with the whole answer in
  `data.outputs`, exactly as today.
- **Streaming** (`Accept: text/event-stream`): deltas, no final snapshot, the client
  assembles. The turn is recorded on the trace as it is today, which is also what
  `load-session` reads back.

### Mapping our events to Vercel parts

The streaming edge consumes the `on_event` sink and encodes each `AgentEvent` as one or more
parts. The mapping:

| Our `AgentEvent` | Vercel parts emitted |
| --- | --- |
| run starts (synthesized) | `start` (carries `messageId` and `messageMetadata.sessionId`), then `start-step` |
| `message` | `text-start` → `text-delta` → `text-end` |
| `thought` | `reasoning-start` → `reasoning-delta` → `reasoning-end` |
| `tool_call` | `tool-input-start` then `tool-input-available` |
| `tool_result` (`isError` false) | `tool-output-available` |
| `tool_result` (`isError` true) | `tool-output-error` |
| `usage` | `messageMetadata` on the `finish` part |
| `error` | `error` |
| `done` | `finish-step`, then `finish` (`finishReason` = `stopReason`), then `[DONE]` |

Two implementation notes:

- **Steps.** The agent loop's turns map to `start-step` / `finish-step` pairs. Each model
  call that ends in a tool call closes one step; the post-tool continuation opens the next.
  The edge synthesizes these boundaries around our native events.
- **Deltas when we have them.** Our `message` event today carries whole text, not token
  deltas. When the harness reports `capabilities.streamingDeltas`, the edge forwards real
  deltas. When it does not, it emits `text-start`, one `text-delta` with the full text, and
  `text-end`. The wire shape is identical either way, so the frontend does not care.

### Where the session id rides in the stream

The stream's "body" is the event sequence, so `session_id` cannot be a plain top-level
field the way it is in the JSON response. It rides on the first event, as metadata on
`start`:

```
data: {"type":"start","messageId":"msg_abc","messageMetadata":{"sessionId":"sess_123"}}
```

The client reads it from the assembled message's metadata. For the server-minted case, this
is how the client learns the id. For the client-generated case, it is a confirming echo. We
will also mirror it to a response header at no cost for non-`useChat` callers, but the body
is the source of truth.

## The contract

### `POST /messages`

Carries `session_id` (optional) at the envelope top level, alongside `trace_id` and
`span_id`. The conversation is a first-class `data.messages` member in the `UIMessage` shape;
`data.inputs` holds the named input variables.

Request:

```jsonc
{
  "session_id": "sess_123",          // optional; omit to let the server mint one
  "data": {
    "messages":   [ /* the full conversation so far, as UIMessage[] */ ],
    "inputs":     { /* named input variables, no longer holds messages */ },
    "parameters": { "agent": { "instructions": "...", "model": "...", "tools": [ ... ] } }
  }
}
```

For now `data.messages` carries the full history, the same as today, and the `session_id`
rides alongside it. When history moves server-side, this shrinks to the new turn only and
the platform supplies the rest. The field stays the same either way.

Non-streaming response (`Accept: application/json`) adds `session_id` to the envelope:

```jsonc
{
  "trace_id": "...",
  "span_id":  "...",
  "session_id": "sess_123",
  "status":   { "code": 200 },
  "data":     { "outputs": { "role": "assistant", "content": "Berlin." } }
}
```

Streaming response (`Accept: text/event-stream`) sets these headers:

```
content-type: text/event-stream
cache-control: no-cache
x-vercel-ai-ui-message-stream: v1
x-accel-buffering: no
```

and emits the part sequence above, with `session_id` in the `start` metadata. The
[appendix](#appendix-a-stream-transcript) shows a full transcript.

### `POST /load-session`

Returns a session's history so the client can rebuild the conversation before its next turn.

Request:

```jsonc
{ "session_id": "sess_123" }
```

Response: the conversation as Vercel `UIMessage`s, the exact shape `useChat` takes as its
initial `messages`:

```jsonc
{
  "session_id": "sess_123",
  "messages": [
    { "id": "m1", "role": "user",      "parts": [ { "type": "text", "text": "capital of France?" } ] },
    { "id": "m2", "role": "assistant", "parts": [ { "type": "text", "text": "Paris." } ] }
  ]
}
```

**Open: folded messages or a delta replay?** You described it as "all events from the
beginning," and the return shape is not settled. Two options:

- **Folded `UIMessage`s** (shown above). The client renders them at once, and `useChat`
  takes them directly as its initial `messages`. Fast, no animation. This is the simpler
  path and the natural fit for rebuilding the UI on load.
- **A delta replay** behind `Accept: text/event-stream` on this same endpoint: re-emit the
  stored stream part by part. This reuses the streaming encoder and matches "all events,"
  but it animates the whole history on every load, which is rarely what a reload wants. It
  earns its keep mainly when resuming a run that is still in flight.

Leaving this open. The endpoint can serve both by content negotiation, the same way
`/messages` does, so we do not have to choose now.

**Where the history comes from.** Every turn's events are already persisted as spans keyed
by `ag.session.id` (`api/.../tracing`). So `load-session` can fold those spans into its
response with no new storage. A dedicated session store is the durable evolution
([sessions.md](sessions.md), path one), and it slots in behind the same response shape.

### Frontend wiring

The frontend points `useChat` at our endpoint and customizes the body and headers through
the transport. This is the whole integration:

```ts
const transport = new DefaultChatTransport({
  api: "/messages",
  headers: { Accept: "text/event-stream" },
  prepareSendMessagesRequest: ({ id, messages }) => ({
    body: {
      session_id: id,                  // client-generated, stable across turns
      data: {
        messages,                      // full history for now; shrinks to the new turn later
        inputs: { /* named variables */ },
        parameters: { agent: agentConfig },
      },
    },
  }),
});

const { messages, sendMessage, status } = useChat({ id: sessionId, transport });
```

To rebuild a known conversation on load, fetch `load-session` and pass the result to
`useChat({ id, messages })`.

## Out of scope for v1

We are forward-compatible with these, but they are not in this RFC:

- **Resuming an in-flight stream** after a dropped connection. Vercel supports it with a
  `GET /messages/{session_id}/stream` and resumable-stream storage. Worth adding once runs
  get long, but the reload-and-load-session path covers the common case first.
- **Client file and image input.** Our `ContentBlock` already models `image` and `resource`
  (`protocol.ts:10`), and Vercel sends files in the body, so the plumbing exists. Turning it
  on is its own change.
- **Generative UI components.** The `data-<name>` part is ready on the wire. Designing the
  agent-specific parts (plan, diff, progress) and their React components is a later step.
- **Session deletion and forking.** A `DELETE` for cleanup and a `fork` for branching a
  conversation (`session/fork`, [sessions.md](sessions.md), path two) come with the warm
  daemon, not here.

## Appendix A: stream transcript

One agent turn: the model calls a weather tool, reads the result, and answers. Every `data:`
line in order, blank line (`\n\n`) after each.

```
data: {"type":"start","messageId":"msg_1","messageMetadata":{"sessionId":"sess_123"}}

data: {"type":"start-step"}

data: {"type":"tool-input-start","toolCallId":"call_1","toolName":"getWeather"}

data: {"type":"tool-input-available","toolCallId":"call_1","toolName":"getWeather","input":{"city":"Paris"}}

data: {"type":"tool-output-available","toolCallId":"call_1","output":{"weather":"sunny","temp":24}}

data: {"type":"finish-step"}

data: {"type":"start-step"}

data: {"type":"text-start","id":"t1"}

data: {"type":"text-delta","id":"t1","delta":"It is sunny "}

data: {"type":"text-delta","id":"t1","delta":"and 24°C in Paris."}

data: {"type":"text-end","id":"t1"}

data: {"type":"finish-step"}

data: {"type":"finish","messageMetadata":{"usage":{"input":820,"output":36,"cost":0.004}}}

data: [DONE]
```

## Appendix B: sources

- The current contract: `sdks/python/agenta/sdk/models/workflows.py`,
  `sdks/python/agenta/sdk/decorators/routing.py` (SSE negotiation at `:236`),
  `api/oss/src/core/workflows/service.py`.
- The agent events and session id: `services/agent/src/protocol.ts:74`,
  `sdks/python/agenta/sdk/agents/dtos.py`, `services/oss/src/agent/app.py`.
- Sessions today and tomorrow: [sessions.md](sessions.md).
- Vercel UI Message Stream (v5/v6): the `useChat`, stream-protocol, tool-usage,
  generative-UI, persistence, and transport pages at https://ai-sdk.dev, and the chunk
  schema at
  https://github.com/vercel/ai/blob/main/packages/ai/src/ui-message-stream/ui-message-chunks.ts.
```
