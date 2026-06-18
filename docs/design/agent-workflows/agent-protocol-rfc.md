# RFC: Agenta Agent Protocol (`POST /messages`, Sessions and Streaming)

| | |
| --- | --- |
| **Status** | Draft |
| **Version** | 0.1 |
| **Layer** | Frontend to backend, over HTTP/1.1 |
| **Defines** | `POST /messages`, `POST /load-session` |
| **Reuses** | The workflow response envelope (`WorkflowServiceResponse`) and revision resolution (`references`) |
| **Companion** | [streaming-and-sessions.md](streaming-and-sessions.md) (design rationale and trade-offs) |

## Abstract

This document specifies the wire protocol between an Agenta client (typically a browser
running the Vercel AI SDK `useChat` hook) and the Agenta backend for running an **agent**
workflow. It defines a new endpoint, `POST /messages`, for stateful, streaming chat. The
endpoint carries a session identifier in the request and response bodies, offers two response
modes (a single JSON response and a Server-Sent Events stream in the Vercel UI Message Stream
format), and takes the agent's inputs as a conversation (`messages`) plus named input
variables (`inputs`). A second endpoint, `POST /load-session`, returns a conversation's
history.

`/messages` is a sibling of the existing workflow `/invoke`, not a change to it. The generic,
stateless `/invoke` is untouched. `/messages` exists because the chat contract differs: the
conversation is a first-class top-level member in the Vercel `UIMessage` shape, the response
can stream, and a turn belongs to a session.

## 1. Conventions and terminology

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**, **SHOULD**,
**SHOULD NOT**, **RECOMMENDED**, **MAY**, and **OPTIONAL** in this document are to be
interpreted as described in RFC 2119 and RFC 8174 when, and only when, they appear in all
capitals.

JSON is defined in RFC 8259. Server-Sent Events (SSE) follow the WHATWG HTML `text/event-
stream` definition. All request and response bodies are UTF-8 encoded JSON unless a streaming
content type is negotiated.

| Term | Definition |
| --- | --- |
| **Agent** | A workflow that runs a multi-step loop (model, tool, model, ...) and emits a stream of events before producing a final answer. |
| **Turn** | One request to `/messages`. A turn supplies new input and produces one assistant response (streamed or whole). |
| **Session** | A server-named conversation that groups turns. Identified by a `session_id`. |
| **`session_id`** | An opaque string that identifies a session within a project. Carried in the request and response bodies. |
| **`UIMessage`** | A message in Vercel AI SDK v5/v6 form: `{ id, role, parts[] }`. See Appendix B. |
| **Part** | One element of the UI Message Stream (for example `text-delta`, `tool-input-available`). See Section 6.2. |
| **`inputs`** | The agent's inputs for a turn: the conversation `messages` plus named input variables. See Section 5. |
| **Streaming edge** | The backend component that encodes the agent's internal `AgentEvent` stream into the UI Message Stream. |

## 2. Protocol overview

The protocol defines two endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/messages` | Run one agent turn. Returns one JSON response or an SSE stream, by content negotiation. |
| `POST` | `/load-session` | Return the history of a session. |

A turn carries an OPTIONAL `session_id`. The server resolves it per Section 4. A turn's
response mode is selected by the `Accept` request header per Section 6.

The agent's input for a turn is the conversation `data.messages` in `UIMessage` form, plus the
named input variables in `data.inputs`. The agent configuration travels as on `/invoke`,
either inline in `data.parameters` or resolved from `references` (Section 5).

```
            ┌─────────────────────────── client (useChat) ───────────────────────────┐
            │                                                                          │
   POST /messages  (Accept: text/event-stream)               POST /load-session        │
            │                                                          │               │
            ▼                                                          ▼               │
   ┌──────────────────┐   AgentEvent stream    ┌───────────────────────────────────┐  │
   │ agent run         │ ─────────────────────▶│ streaming edge → UI Message Stream │──┘
   │ (harness loop)    │                        └───────────────────────────────────┘
   └──────────────────┘                                   persists per turn
            │                                                     │
            └──────────────── trace store (ag.session.id) ◀───────┘   load-session reads here
```

## 3. Relationship to `/invoke`

`/messages` is a new endpoint. It does not change `/invoke`. The generic, stateless workflow
invoke keeps its exact request and response, and a client that does not run a chat agent never
touches `/messages`.

`/messages` reuses two things from the workflow contract so the backend does not fork: the
response envelope (`WorkflowServiceResponse`, with the answer in `data.outputs`) and revision
resolution (`references`). It diverges from `/invoke` in three ways, which is why it is its own
endpoint:

1. The conversation is a first-class member, `data.messages`, in the `UIMessage` shape, rather
   than nested in `data.inputs.messages` as `{role, content}`.
2. The response can stream as a UI Message Stream (Section 6.2).
3. A turn belongs to a session (`session_id`, Section 4).

A server **SHOULD** map a `/messages` request onto the same internal agent invocation that
`/invoke` uses, after lifting `data.messages` and `data.inputs` into the handler's `messages`
and `inputs` arguments.

## 4. Session model

### 4.1 Identity

A `session_id` is an opaque string scoped to a project. The pair `(project_id, session_id)`
**MUST** be unique. A bare `session_id` is not a global identifier.

A client-supplied `session_id`:

- **MUST** be treated as an opaque token. A server **MUST NOT** interpolate it into a storage
  path, a query, or a trace attribute without escaping.
- **SHOULD** be constrained by the server to a bounded length and a restricted character set.
  A server **MAY** reject an id outside those bounds with `400 Bad Request`.

### 4.2 Resolution

On receiving a turn, the server resolves the session as follows:

1. If the request omits `session_id`, the server **MUST** mint a new unique id, associate the
   turn with it, and return that id (Section 6).
2. If the request supplies a `session_id` that does not exist for the caller's project, the
   server **MUST** create a session with that id and associate the turn with it.
3. If the request supplies a `session_id` that exists for the caller's project, the server
   **MUST** associate the turn with that existing session.
4. If the request supplies a `session_id` that exists under a **different** project, the
   server **MUST NOT** resume it. The server **MUST** treat it as case 2 within the caller's
   own project, or reject the turn. A server **MUST NOT** disclose the existence of a session
   the caller does not own.

Rule 4 is the ownership boundary. "Resume if it exists" means "resume if it exists and
belongs to the caller."

### 4.3 Continuation semantics for this version

In this version, associating a turn with a session records the turn under that session for
tracing and later retrieval. The conversation context the model sees is supplied by the
`messages` in the request (Section 5.2), not reconstructed from the server's record.

A future version MAY make the server's record authoritative, at which point a turn carries
only the new message and the server supplies the prior history. The request field is
unchanged by that evolution. See [streaming-and-sessions.md](streaming-and-sessions.md).

### 4.4 Concurrency

Two turns that create the same new `(project_id, session_id)` concurrently **MUST** resolve
to a single session. A server **SHOULD** enforce this with a unique constraint and treat the
losing creation as a resume (case 3).

## 5. Request format (`POST /messages`)

### 5.1 Envelope

```jsonc
{
  "session_id": "sess_123",       // OPTIONAL (Section 4)
  "references":  { ... },         // OPTIONAL: selects the workflow revision (as on /invoke)
  "data": {
    "messages":   [ /* UIMessage[] */ ],    // REQUIRED: the conversation (Section 5.2)
    "inputs":     { "<name>": <value> },     // OPTIONAL: named input variables (Section 5.3)
    "parameters": { /* agent config */ }     // OPTIONAL (Section 5.4)
  }
}
```

`session_id` sits at the envelope top level, alongside the existing `trace_id` and `span_id`.
It **MUST NOT** be required in a request header.

`data.messages`, `data.inputs`, and `data.parameters` are siblings. They map onto the agent
handler's `messages`, `inputs`, and `parameters` arguments. On `/invoke` the conversation is
nested at `data.inputs.messages`; on `/messages` it is lifted out to `data.messages`, because
the conversation is the primary input of this endpoint.

### 5.2 `data.messages`

`data.messages` is the conversation as an array of `UIMessage` objects (Appendix B). It is
REQUIRED. The last element is the new user turn.

In this version the client **MUST** send the full conversation in `data.messages`. Each
element uses the parts-based `UIMessage` shape (Appendix B), not the `{role, content}` shape
of `/invoke`.

### 5.3 `data.inputs`

`data.inputs` carries the agent's named input variables for the turn: the workflow's declared
inputs and any per-turn context the caller supplies (for example a retrieved document or a
record id). Keys are input names; values are arbitrary JSON. This is the same `inputs` as the
workflow contract, with the conversation no longer nested inside it.

`data.inputs` is OPTIONAL and MAY be sent on every turn, since its values can change between
turns.

### 5.4 `data.parameters` and `references`

The agent configuration (instructions, model, tools, harness, sandbox, permission policy)
travels as on `/invoke`: inline in `data.parameters.agent`, or resolved by the platform from
`references` when the request targets a stored revision. This protocol does not change that
resolution.

### 5.5 Content negotiation

The response mode is selected by the `Accept` request header:

| `Accept` | Response |
| --- | --- |
| `application/json` (or absent) | Single JSON response (Section 6.1) |
| `text/event-stream` | UI Message Stream over SSE (Section 6.2) |

A server that cannot satisfy the `Accept` header **MUST** respond `406 Not Acceptable`.

## 6. Response formats

### 6.1 Single JSON response

For `Accept: application/json`, the server returns `200 OK` with a body extending
`WorkflowServiceResponse`:

```jsonc
{
  "trace_id":   "...",
  "span_id":    "...",
  "session_id": "sess_123",                 // the resolved id (minted or echoed)
  "status":     { "code": 200 },
  "data":       { "outputs": { "role": "assistant", "content": "Berlin." } }
}
```

The response **MUST** include `session_id`, set to the resolved session (Section 4). The
assistant answer rides in `data.outputs` as today. Token usage is not in the body; it is
recorded on the trace.

### 6.2 UI Message Stream (SSE)

For `Accept: text/event-stream`, the server returns `200 OK` and streams the run in the
Vercel UI Message Stream format (AI SDK v5/v6).

#### 6.2.1 Response headers

The response **MUST** set:

```
content-type: text/event-stream
x-vercel-ai-ui-message-stream: v1
```

and **SHOULD** set:

```
cache-control: no-cache
connection: keep-alive
x-accel-buffering: no
```

`x-accel-buffering: no` disables proxy buffering so parts flush immediately.

#### 6.2.2 Framing

Each part is one SSE event: the literal bytes `data: `, followed by the part as compact JSON
(no insignificant whitespace), followed by `\n\n`.

```
data: {"type":"text-delta","id":"t1","delta":"Hello"}\n\n
```

The stream **MUST** terminate with the literal line `data: [DONE]\n\n`.

#### 6.2.3 Part registry

The parts a server emits, with their REQUIRED fields. Fields not listed are OPTIONAL and MAY
be omitted.

| `type` | Required fields | Meaning |
| --- | --- | --- |
| `start` | none | Begin a message. Carries `messageId` and `messageMetadata` (Section 6.2.4). |
| `start-step` | none | Begin a step of the agent loop. |
| `finish-step` | none | End the current step. |
| `finish` | none | End the message. Carries `finishReason`, `messageMetadata`. |
| `text-start` | `id` | Begin a text block. |
| `text-delta` | `id`, `delta` | Append `delta` to the text block `id`. |
| `text-end` | `id` | End the text block. |
| `reasoning-start` | `id` | Begin a reasoning block. |
| `reasoning-delta` | `id`, `delta` | Append to the reasoning block. |
| `reasoning-end` | `id` | End the reasoning block. |
| `tool-input-start` | `toolCallId`, `toolName` | A tool call begins. |
| `tool-input-delta` | `toolCallId`, `inputTextDelta` | Append a fragment of the tool arguments (note: `inputTextDelta`, not `delta`). |
| `tool-input-available` | `toolCallId`, `toolName`, `input` | The full tool arguments are known. |
| `tool-output-available` | `toolCallId`, `output` | The tool result. |
| `tool-output-error` | `toolCallId`, `errorText` | The tool failed. |
| `file` | `url`, `mediaType` | A file or image. `url` MAY be an `https:` or `data:` URL. |
| `data-<name>` | `data` | An application-defined part (generative UI). MAY carry `id` and `transient`. |
| `error` | `errorText` | A stream-level error (Section 8.2). |

A server **MUST** order parts so that for any `id` or `toolCallId`, a `*-start` precedes its
deltas, which precede its `*-end` or `*-available`. Text and reasoning deltas are
concatenated by `id`. Tool parts are keyed by `toolCallId`.

#### 6.2.4 Session id in the stream

The server **MUST** convey the resolved `session_id` as `messageMetadata.sessionId` on the
`start` part, which is the first part of the stream:

```
data: {"type":"start","messageId":"msg_1","messageMetadata":{"sessionId":"sess_123"}}
```

A server **MAY** additionally mirror `session_id` to a response header. The body remains the
normative source.

#### 6.2.5 Mapping from agent events

The streaming edge consumes the agent's internal `AgentEvent` stream
(`services/agent/src/protocol.ts:74`) and emits parts as follows:

| `AgentEvent` | Parts |
| --- | --- |
| run start (synthesized) | `start` (with `messageId`, `messageMetadata.sessionId`), then `start-step` |
| `message` | `text-start`, one or more `text-delta`, `text-end` |
| `thought` | `reasoning-start`, `reasoning-delta`, `reasoning-end` |
| `tool_call` | `tool-input-start`, then `tool-input-available` |
| `tool_result` with `isError=false` | `tool-output-available` |
| `tool_result` with `isError=true` | `tool-output-error` |
| `usage` | `messageMetadata` on the `finish` part |
| `error` | `error` (Section 8.2) |
| `done` | `finish-step`, then `finish` (`finishReason` = `stopReason`), then `[DONE]` |

A harness that reports `capabilities.streamingDeltas` produces token-level `text-delta`
parts. A harness that does not produces one `text-delta` carrying the whole text. The wire
shape is identical, so the client does not distinguish them.

The protocol streams deltas only. There is no full-message snapshot part. The client
assembles the final `UIMessage` from the parts. The server **SHOULD** record the assembled
turn on the trace (`ag.session.id`), which is the source `load-session` reads.

## 7. The `load-session` endpoint (`POST /load-session`)

Returns the history of a session so a client can rebuild a conversation it does not hold
locally.

### 7.1 Request

```jsonc
{ "session_id": "sess_123" }
```

`session_id` is REQUIRED. The server **MUST** apply the ownership rule of Section 4.2: if the
session does not exist for the caller's project, the server **MUST** respond `404 Not Found`
and **MUST NOT** reveal a session owned by another project.

### 7.2 Response (default, `Accept: application/json`)

The server returns `200 OK` with the conversation as `UIMessage` objects, the shape `useChat`
accepts as its initial `messages`:

```jsonc
{
  "session_id": "sess_123",
  "messages": [
    { "id": "m1", "role": "user",      "parts": [ { "type": "text", "text": "capital of France?" } ] },
    { "id": "m2", "role": "assistant", "parts": [ { "type": "text", "text": "Paris." } ] }
  ]
}
```

### 7.3 Response (negotiated replay, `Accept: text/event-stream`)

A server **MAY** support a delta replay of the stored history under
`Accept: text/event-stream`, re-emitting the session as a UI Message Stream (Section 6.2).
This is OPTIONAL. Whether the folded form or the replay is the primary form is left open by
this draft; a conformant client **SHOULD** request `application/json` for rebuilding a static
view.

## 8. Error handling

### 8.1 Request and endpoint errors (JSON)

Before a stream begins, the server reports errors with an HTTP status and the existing
`status` envelope (`WorkflowServiceStatus`: `code`, `message`, `type`, `stacktrace`):

| Status | Condition |
| --- | --- |
| `400 Bad Request` | Malformed body, or a `session_id` that violates Section 4.1. |
| `401 Unauthorized` / `403 Forbidden` | Missing or invalid credentials. |
| `404 Not Found` | `load-session` on a session the caller does not own. |
| `406 Not Acceptable` | The `Accept` header cannot be satisfied. |
| `5xx` | Server failure before streaming starts. |

### 8.2 In-stream errors

A failure after the stream has started **MUST** be reported as an `error` part:

```
data: {"type":"error","errorText":"the agent run failed: ..."}
```

After emitting an `error` part, the server **SHOULD** terminate the stream. It **MAY** omit
the `finish` part. It **SHOULD** still emit `[DONE]` to close the SSE channel cleanly. The
client surfaces the error to the user.

## 9. Security considerations

- **Session ownership.** Section 4.2 rule 4 is a security requirement, not a convenience.
  Because a client may supply a `session_id` for an unknown id (case 2), a server that keys
  sessions on `session_id` alone would let a caller read or extend another tenant's
  conversation. Servers **MUST** key on `(project_id, session_id)` and scope every resume,
  every `load-session`, and every existence check to the caller's project.
- **Opaque ids.** A client-supplied `session_id` is untrusted input. See Section 4.1.
- **Secrets.** Provider keys and tool credentials travel and resolve as in the current
  contract. This protocol adds no new secret-bearing field. `inputs` is caller-supplied
  input and **MUST NOT** be used to smuggle credentials in place of the existing `secrets`
  and signed-credential mechanisms.
- **Content negotiation and buffering.** A streaming response disables proxy buffering
  (Section 6.2.1). Operators **MUST** ensure intermediaries do not re-buffer `text/event-
  stream` responses, or streaming degrades to a single delayed flush.

## 10. Interaction sequences

### 10.1 New session, streaming turn

```
client                                  server
  │  POST /messages                        │
  │  Accept: text/event-stream             │
  │  { data:{ messages:[...] } }           │   (no session_id)
  │───────────────────────────────────────▶│
  │                                         │  mint sess_123
  │  200 text/event-stream                  │
  │  data: {"type":"start",                 │
  │         "messageMetadata":              │
  │           {"sessionId":"sess_123"}}     │
  │◀───────────────────────────────────────│
  │  data: {"type":"start-step"} ...        │
  │  ... tool / text parts ...              │
  │  data: {"type":"finish"}                │
  │  data: [DONE]                           │
  │◀───────────────────────────────────────│
  │  (client stores sess_123 for next turn) │
```

### 10.2 Returning to a known session

```
client                                  server
  │  POST /load-session                     │
  │  { "session_id": "sess_123" }           │
  │───────────────────────────────────────▶│  check ownership
  │  200 { messages: [ UIMessage, ... ] }   │
  │◀───────────────────────────────────────│
  │  (render history; hold it)              │
  │                                         │
  │  POST /messages                         │
  │  Accept: text/event-stream              │
  │  { session_id:"sess_123",               │
  │    data:{ messages:[...full] } }        │
  │───────────────────────────────────────▶│  resolve existing sess_123
  │  200 text/event-stream → parts → [DONE] │
  │◀───────────────────────────────────────│
```

## Appendix A: Full stream transcript

One turn: the agent calls a weather tool, reads the result, and answers. Every `data:` line
in order, each followed by a blank line.

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

## Appendix B: `UIMessage` schema

A message accumulated by the client and accepted by `load-session`:

```jsonc
{
  "id":   "m2",
  "role": "user | assistant | system",
  "parts": [
    { "type": "text",        "text": "..." },
    { "type": "reasoning",   "text": "..." },
    { "type": "tool-<name>", "toolCallId": "...", "state": "output-available", "input": {}, "output": {} },
    { "type": "file",        "url": "...", "mediaType": "image/png" },
    { "type": "data-<name>", "data": { } },
    { "type": "step-start" }
  ],
  "metadata": { }
}
```

A `UIMessage` carries no top-level `content` string in v5/v6. All content lives in `parts`.

## Appendix C: References

- RFC 2119, RFC 8174: requirement keywords.
- RFC 8259: JSON.
- WHATWG HTML, Server-Sent Events: `text/event-stream`.
- Vercel AI SDK UI Message Stream (v5/v6): https://ai-sdk.dev, and the chunk schema at
  https://github.com/vercel/ai/blob/main/packages/ai/src/ui-message-stream/ui-message-chunks.ts
- Current contract: `sdks/python/agenta/sdk/models/workflows.py`,
  `sdks/python/agenta/sdk/decorators/routing.py` (Accept negotiation at `:236`).
- Agent events and session id: `services/agent/src/protocol.ts:74`,
  `services/oss/src/harness/ports.py`, `services/oss/src/agent/app.py`.
- Design rationale and trade-offs: [streaming-and-sessions.md](streaming-and-sessions.md).
```
