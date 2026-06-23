# Sessions

The agent runtime has session ids today. It does not have durable server-owned session
history yet.

## Today: Cold Replay

Each turn is cold:

1. The service creates a harness session.
2. The backend sends one `/run` request to the TypeScript runner.
3. The runner starts the needed process tree.
4. The harness completes one turn.
5. The session is destroyed.

Nothing warm is kept between turns. The model sees prior conversation only because the
client sends message history again.

On `/invoke`, that history is read from `data.inputs.messages`.

On `/messages`, that history is read from `data.messages` in Vercel `UIMessage` shape, then
converted to neutral runtime messages before the same handler runs.

## What The Session Id Does

`session_id` is an opaque conversation id. `/messages` accepts it at the top level. If the
client omits it, the route mints one with a `sess_` prefix. If the client sends one, the
route validates the charset and length and echoes it.

The id flows into:

- `WorkflowInvokeRequest.session_id`
- `_agent(..., session_id=...)`
- `SessionConfig.session_id`
- the `/run` `sessionId` field
- the runner result
- the Vercel stream `start.messageMetadata.sessionId`
- the batch `WorkflowBatchResponse.session_id`

The id groups turns, but it does not make the server authoritative for context yet. The
message history on the request is still what the model sees.

## Intended Id Semantics

The intended behavior is create-or-resume:

- If the client omits `session_id`, the server creates one and returns it.
- If the client supplies a known `session_id`, the server resumes that session.
- If the client supplies an unknown but valid `session_id`, the server creates a session
  using that id.

The current implementation only validates and propagates the id. Because there is no
durable store, it cannot distinguish known from unknown ids yet.

There should not be a required `create-session` endpoint for the normal chat path. The same
implicit creation pattern should cover pre-message operations too. For example, a file
upload before the first typed message can create a session and return the id that later
chat turns use.

If a client already knows a session id and needs to render history, it should call
`/load-session` before sending the first message.

## Streaming

Streaming is implemented without changing the cold lifecycle.

The runner emits live NDJSON records internally. The Python `AgentRun` turns those records
into live `AgentEvent` objects. The Vercel adapter projects each event into Vercel UI
Message Stream parts and the route frames them as SSE.

This means the browser can see text, reasoning, tool calls, tool results, data parts, files,
errors, and finish metadata as they happen. It does not mean the session is warm or
persisted.

## `/load-session`

The route exists and calls a `SessionStore` port. The default store is `NoopSessionStore`.
It returns an empty list:

```json
{ "session_id": "sess_abc", "messages": [] }
```

That makes the protocol testable, but it does not restore history. A production store still
needs to be selected and wired.

## Missing Durable History

To make sessions real, the platform needs:

- A production `SessionStore` implementation.
- A call to `save_turn` after each completed `/messages` turn.
- Ownership checks keyed by project and caller.
- A load path that returns persisted Vercel `UIMessage` history.
- A policy for failed, cancelled, and partially streamed turns.

Until that lands, clients must keep sending full history.

## Missing Session Snapshots

Durable chat history is only the MVP path. Stateful harnesses may also need their own
session state saved before teardown and loaded during setup. This is separate from storing
Vercel `UIMessage` history.

Examples of state that may not be recoverable from messages alone:

- sandbox-agent or ACP session blobs.
- Tool or harness state created during setup.
- Filesystem or process metadata needed to resume a warm-ish session after a cold restart.

The interface is not designed yet. It likely needs explicit `save_session` and
`load_session` semantics around harness cleanup/setup, plus a storage decision after we
understand the size and shape of sandbox-agent/ACP session data. Small JSON blobs may fit in
Postgres. Large opaque blobs may need object storage.

Retention should be short by default, measured in days. Traces may have a different
retention policy.

## Later: Warm Sessions

Warm sessions are separate from durable cold history. A warm model would keep the daemon or
harness state alive and use ACP `session/load` or equivalent state restoration. That can
recover state a transcript cannot, but it also needs a filesystem jail, per-session secret
channels, and clear multi-tenant isolation.

The likely order remains:

1. Add server-owned history while keeping cold replay.
2. Add warm daemon sessions only if long-running stateful agents need them.
