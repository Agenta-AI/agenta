# Protocol

The agent workflow has two public HTTP surfaces and one internal runner surface.

| Surface | Status | Consumer | Purpose |
| --- | --- | --- | --- |
| `POST /invoke` | Implemented | Generic workflow clients | Batch workflow call. Returns one final response. |
| `POST /messages` | Implemented | Browser chat clients | Agent chat call. Accepts Vercel `UIMessage` input and can stream Vercel SSE. |
| `POST /load-session` | Shell implemented | Browser chat clients | Loads saved session history. Returns empty history by default because storage is not wired. |
| `POST /run` | Implemented internal wire | Python SDK backend adapters | Runs one agent turn through the TypeScript runner sidecar or CLI. |

## `/invoke`

`/invoke` keeps the normal workflow contract. The agent handler reads messages from
`data.inputs.messages`, reads config from `data.parameters`, runs one cold turn, and returns:

```json
{
  "role": "assistant",
  "content": "..."
}
```

Usage is recorded on the workflow span. It is not added to the response body.

## `/messages`

`/messages` is registered only for agent routes. It adapts the browser chat contract to the
same runtime that `/invoke` uses.

Request:

```json
{
  "session_id": "sess_abc",
  "data": {
    "messages": [],
    "inputs": {},
    "parameters": {
      "agent": {
        "agents_md": "...",
        "model": "gpt-5.5",
        "harness": "pi",
        "sandbox": "local"
      }
    }
  }
}
```

Important details:

- `session_id` is optional. The server mints one when it is absent.
- Client-supplied ids must match `^[A-Za-z0-9._:-]{1,128}$`.
- The intended storage behavior is create-or-resume: a known id resumes, and a valid unknown
  id creates a new session with that id. This is not observable yet because durable storage
  is not implemented.
- `data.messages` is a Vercel `UIMessage[]`. The adapter folds it into neutral runtime
  `Message` objects before invoking the workflow.
- `data.stream` is not a stored config value. The route sets it from the `Accept` header.

Response modes:

| Accept | Result |
| --- | --- |
| `application/json` or absent | A normal `WorkflowBatchResponse` with the assistant output and `session_id`. |
| `text/event-stream` | A Vercel UI Message Stream framed as SSE. |

Pre-stream failures stay JSON even when the client asked for SSE. This matters because tool
resolution, config parsing, or auth can fail before the stream starts.

## Vercel Stream Parts

The runtime emits neutral `AgentEvent` objects. The Vercel adapter maps them to stream parts.

| Agent event | Vercel part |
| --- | --- |
| `message` | `text-start`, `text-delta`, `text-end` |
| `message_start`, `message_delta`, `message_end` | Matching text lifecycle parts |
| `thought` | `reasoning-start`, `reasoning-delta`, `reasoning-end` |
| `reasoning_start`, `reasoning_delta`, `reasoning_end` | Matching reasoning lifecycle parts |
| `tool_call` | `tool-input-start`, `tool-input-available` |
| `tool_result` | `tool-output-available`, `tool-output-error`, or `tool-output-denied` |
| `interaction_request` | `tool-approval-request` or a `data-*` interaction part |
| `data` | `data-<name>` |
| `file` | `file` |
| `usage` | `messageMetadata.usage` on `finish` |
| `error` | `error` |
| `done` | `finish-step`, then `finish` |

The first `start` part carries `messageMetadata.sessionId`. The SSE stream ends with
`data: [DONE]`.

## `/load-session`

`/load-session` accepts:

```json
{ "session_id": "sess_abc" }
```

It returns:

```json
{ "session_id": "sess_abc", "messages": [] }
```

The route is real, but the default store is `NoopSessionStore`. Until a production
`SessionStore` is injected and completed turns call `save_turn`, the endpoint only confirms
the contract.

Clients that already know a session id should call this endpoint before the first chat turn
if they need history on screen. The normal chat path should not require a separate explicit
create-session call.

## `/run`

`/run` is the internal Python-to-TypeScript boundary. The Python side serializes it in
`sdks/python/agenta/sdk/agents/utils/wire.py`. The TypeScript side mirrors it in
`services/agent/src/protocol.ts`.

Request fields include:

| Field | Meaning |
| --- | --- |
| `backend` | Runner engine: `pi` or `sandbox-agent`. |
| `harness` | Harness id: `pi`, `claude`, or `agenta` depending on backend support. |
| `sandbox` | Sandbox id, usually `local` or `daytona`. |
| `sessionId` | External conversation id. The runtime is still cold and receives history in `messages`. |
| `agentsMd` | Instructions that become `AGENTS.md`. |
| `systemPrompt`, `appendSystemPrompt` | Pi prompt overrides. Not delivered on the sandbox-agent Pi path yet. |
| `model` | Requested model id. |
| `messages` | Conversation history and current turn. |
| `secrets` | Provider env vars resolved by the service. |
| `tools`, `customTools`, `toolCallback`, `mcpServers` | Resolved tool delivery. |
| `permissionPolicy` | `auto` or `deny` for permission-gating harnesses. |
| `trace` | Trace context for nested spans. |

One-shot calls return one JSON result. Streaming calls use NDJSON internally: one
`{"kind":"event"}` record per live event, followed by one `{"kind":"result"}` terminal
record. The browser never sees this NDJSON directly; `/messages` converts it to Vercel SSE.
