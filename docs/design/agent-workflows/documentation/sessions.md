# Sessions

This page describes how sessions behave today, then how they would behave with a real session
store. The two parts are kept separate on purpose.

## Today

### Every turn is cold

The runtime has session ids but no durable server-owned history. Each turn is cold:

1. The service creates a harness session.
2. The backend sends one `/run` request to the sidecar.
3. The runner starts the process tree (the sandbox-agent daemon and an ACP harness, or
   in-process Pi).
4. The harness completes one turn.
5. The session is destroyed.

Nothing warm is kept between turns. The model sees prior conversation only because the client
sends message history again on every turn.

- On `/invoke`, history is read from `data.inputs.messages`.
- On `/messages`, history is read from `data.messages` in Vercel `UIMessage` shape, then
  converted to neutral runtime messages before the same handler runs.

The sandbox-agent engine creates an `InMemorySessionPersistDriver`
(`services/agent/src/engines/sandbox_agent.ts:150`), but it exists only for the one `/run`
process. It does not survive across turns, so it does not make the runtime warm.

### What the session id does

`session_id` is an opaque conversation id. `/messages` accepts it at the top level. If the
client omits it, the route mints one with a `sess_` prefix
(`sdks/python/agenta/sdk/agents/adapters/vercel/routing.py:43`). If the client sends one, the
route validates it against `^[A-Za-z0-9._:-]{1,128}$` and echoes it; an invalid id is a 400.

The id flows through the run:

- `WorkflowInvokeRequest.session_id`
- `_agent(..., session_id=...)`
- `SessionConfig.session_id`
- the `/run` `sessionId` field
- the runner result
- the Vercel stream `start.messageMetadata.sessionId`
- the batch `WorkflowBatchResponse.session_id`

The id groups turns. It does not make the server authoritative for context. The message
history on the request is still what the model sees.

### Streaming

Streaming is implemented without changing the cold lifecycle. The runner emits live NDJSON
records internally: one `{"kind":"event"}` record per event, then one `{"kind":"result"}`
terminal record. The Python `AgentRun` turns those records into live `AgentEvent` objects. The
Vercel adapter projects each event into Vercel UI Message Stream parts, and the route frames
them as SSE.

So the browser can see text, reasoning, tool calls, tool results, data parts, files, errors,
and finish metadata as they happen. This is live delivery, not a warm or persisted session.

### `/load-session`

The route exists and calls a `SessionStore` port. The default store is `NoopSessionStore`
(`sdks/python/agenta/sdk/agents/interfaces.py:112`), and the route registration passes no
other store (`sdks/python/agenta/sdk/decorators/routing.py:515`). So it always returns an
empty list:

```json
{ "session_id": "sess_abc", "messages": [] }
```

That makes the protocol testable. It does not restore history.

## Intended (not implemented)

### Create-or-resume

The intended id behavior is create-or-resume:

- If the client omits `session_id`, the server creates one and returns it.
- If the client supplies a known `session_id`, the server resumes that session.
- If the client supplies an unknown but valid `session_id`, the server creates a session using
  that id.

The current code only validates and propagates the id. With no durable store, it cannot tell a
known id from an unknown one. So create-or-resume is intent, not behavior.

There should not be a required `create-session` endpoint for the normal chat path. The same
implicit creation should cover pre-message operations too. For example, a file upload before
the first typed message can create a session and return the id later chat turns use.

A client that already knows a session id and needs to render history should call
`/load-session` before the first message.

### A real session store

To make sessions real, the platform needs:

- A production `SessionStore` implementation, injected where `NoopSessionStore` is today.
- A call to `save_turn` after each completed `/messages` turn.
- Ownership checks keyed by project and caller.
- A load path that returns persisted Vercel `UIMessage` history.
- A policy for failed, cancelled, and partially streamed turns.

Until that lands, clients must keep sending full history.

### Harness session snapshots

Durable chat history is the MVP. Stateful harnesses may also need their own session state saved
before teardown and loaded during setup. This is separate from storing `UIMessage` history.

Examples of state that may not be recoverable from messages alone:

- A sandbox-agent or ACP session blob.
- Tool or harness state created during setup.
- Filesystem or process metadata needed to resume a warm session after a cold restart.

This interface is not designed yet. The `SessionStore` port covers message history only; a
snapshot port would be a separate addition. It likely needs explicit `save_session` and
`load_session` semantics around cleanup and setup, plus a storage decision after we measure the
size and shape of sandbox-agent/ACP session data. Small JSON blobs may fit in Postgres. Large
opaque blobs may need object storage. Retention should be short by default, measured in days.

### Warm sessions

Warm sessions are separate from durable cold history. A warm model would keep the daemon or
harness state alive and use ACP `session/load` or equivalent state restoration. That can
recover state a transcript cannot, but it also needs a filesystem jail, per-session secret
channels, and clear multi-tenant isolation.

The likely order:

1. Add server-owned history while keeping cold replay.
2. Add warm daemon sessions only if long-running stateful agents need them.
