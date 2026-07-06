# Fix options and recommendation

Prerequisite reading: `research.md`. The rule every option must satisfy: when the
inbound request's history ends with an assistant message, the AI SDK client WILL
stream into a clone of that message (`ai/dist/index.js:4444-4459`), so the streamed
`messageId` must equal that message's id or be absent. Any other value pushes a
duplicate.

## The detection rule (shared by all server-side options)

"Is this a continuation?" has one reliable signal, and it is the same one the AI
SDK's own server helpers use (`getResponseUIMessageId`, `ai/dist/index.js:4199-4208`):
the request's last message has `role: "assistant"`. Not "has a responded approval".
The client clones on the role check alone, so the server must mirror the role check
alone. This also covers the client-tool resume (`request_connection` via
`addToolOutput`, `ai/dist/index.js:11189-11213`) with zero extra work.

The continuation id is that message's `id` field. It is already on the wire in
`data.inputs.messages` (`agentRequest.ts:394-398`); today the ingress drops it
(`messages.py:44-63`).

## Option A: server echoes the continuation id (recommended)

When the inbound last message is an assistant message with a string id, the `start`
frame carries that id instead of a fresh `msg-{trace_id}`.

Mechanics (all in the SDK, nothing below the routing layer changes):

1. Capture: in `apply_invoke_prelude` (`routing.py:189-228`), the raw vercel
   messages are still intact just before the vercel-to-agenta projection destroys
   their ids (`routing.py:220-228`). Read the last message's `role` and `id` there
   and stash the id on the FastAPI request state (for example
   `req.state.ag_continuation_message_id`). Guard: vercel format only, `role ==
   "assistant"`, id is a non-empty string.
2. Thread: `handle_invoke_success(req, response)` (`routing.py:398`) reads the stash
   and passes it into `_make_stream_response(response, "vercel", message_id=...)`
   (`routing.py:449`, `333-358`).
3. Emit: `agent_stream_to_vercel_stream` ALREADY accepts `message_id` and prefers it
   over minting (`stream.py:254-275`). No adapter change at all.

Why it wins:

- It matches the AI SDK's documented server behavior. We are implementing the half
  of the protocol we skipped, not inventing a workaround.
- No frontend change. It fixes the playground panel, the standalone slice page
  (`transport.ts`), and any future consumer in one place.
- No wire-shape change. No new field, no golden-fixture churn
  (`sdks/python/oss/tests/pytest/unit/agents/golden/`), no runner change.
- `trace_id` keeps flowing separately in the `finish` frame's metadata
  (`stream.py:439-446`), so observability loses nothing.

Edge cases, checked:

- New user message: last message is `user`, no echo, fresh `msg-{trace_id}`. Correct.
- Regenerate/Resend after stop: `regenerate` slices the assistant message off before
  sending (`ai/dist/index.js:11128-11145`), so the last message is `user`. Fresh id.
  Correct: a regenerated answer should be a fresh message.
- Answer-less assistant turns never reach the server; the playground strips them
  (`agentRequest.ts:231-235`, `389`). A parked approval turn has tool parts, so it
  survives the filter (`agentRequest.ts:228`) and its id is present.
- Missing id on the inbound assistant message (defensive): fall back to minting.
  The client then pushes one duplicate, which is today's behavior, not a new failure.
- Track B on the slice page (`toAgentaMessages`) sends `{role, content}` messages
  without ids; the guard finds no id and falls back to minting. No regression.

## Option B: server omits `messageId` on resumes

Same detection, but the `start` frame simply drops the field. The client keeps the
clone's existing id (`ai/dist/index.js:4852-4855` only overwrites when non-null), so
the replace path holds.

Rejected because it needs the exact same detection code as option A and then throws
away information. The server stays silent instead of confirming identity. Silence
also behaves worse under drift: if the client-side clone semantics ever change, an
explicit echoed id keeps client and server agreeing on which message this is. And an
always-omit variant (never send `messageId` at all) would hand id minting back to
the client, breaking the `msg-{trace_id}` correlation that batch replay and thread
tooling already lean on (`AgentChatTransport.ts:139-142`, `stream.py:270-275`).

## Option C: frontend forwards `messageId`; server echoes it

The AI SDK already hands the continuation id to the transport on every auto-resend
(`ai/dist/index.js:11185`, `11210`, delivered to `prepareSendMessagesRequest` at
`10932-10942`). Both hooks could copy it into the body (say a top-level
`message_id`), and routing could echo that.

Rejected as the primary fix, for interface reasons:

- The continuation id is ALREADY in the request, as `messages[-1].id`. A second copy
  of the same fact in the same request invites drift; the design-interfaces rule is
  one source of truth per fact.
- It changes the request contract (a new wire field means golden fixtures, wire.py,
  protocol.ts review) and needs edits in two transports, for no behavior option A
  does not already deliver.
- The server still needs the role check anyway to know the echo is safe, at which
  point it can read the id from the history itself.

Keep it in the back pocket: if the body ever stops carrying full `UIMessage[]`
history (for example a trimmed-transcript mode), an explicit `context.message_id`
field becomes the right channel. Not now.

## Interface review (design-interfaces pass)

- `messageId` on the `start` frame is **protocol context**: the identity join key
  between a streamed response and a client message. Today's value `msg-{trace_id}`
  overloads it with **observability metadata** (trace correlation). The overload is
  harmless on a first request and wrong on a continuation, which is exactly this bug.
  The fix separates the roles: identity comes from the conversation (echoed id when
  continuing, minted once per turn otherwise); trace correlation stays where it
  already lives, `messageMetadata.traceId` on the `finish` frame (`stream.py:443`).
- No new fields, no renamed fields, no ownership changes. The one semantic change:
  `start.messageId` is now "the id of the message this stream builds" (its real
  meaning in the AI SDK protocol), not "a fresh id per HTTP request".

## Handling one-message-spans-many-traces

With a stable id, metadata merges across resumes (`ai/dist/index.js:4563-4573`), so
the single turn block reports the LAST request's `traceId` and `usage`
(`trace.ts:25-34`, `62-76`; rendered in `components/AgentMessage.tsx:61-70`,
`217-232`).

Decision for v1: accept last-request metrics, deliberately.

- Inspect turn: not harmed. The inspector reads the LIVE message parts by assistant
  message id (`TurnInspector.tsx:45-58`) and groups request captures by the
  triggering user message, a model built for "initial send + resumes"
  (`turnCapture.ts:3-13`, `52-57`). One stable id per turn is the shape it expects.
- Trace link and latency: point at the last continuation. Defensible (it is the most
  recent activity) and strictly better than today's three blocks with three partial
  traces. A user who needs every request finds them in the inspector's captures.
- Usage: the last request's numbers are the broken `0/0/~62k` ACP figures
  (`otel.ts:1185-1197`). That is a pre-existing runner bug this fix neither causes
  nor hides; it just becomes the turn's displayed figure. File it as its own issue
  (fix belongs in the runner's usage extraction, not here).

Follow-up (not v1): designed in `trace-continuation.md`. Instead of aggregating many
traces FE-side, the frontend replays the turn's `traceparent` on resumes so the whole
turn lands in ONE trace (the SDK already honors an inbound traceparent), plus an
FE-side per-turn usage sum. Decision pending; do not block the duplication fix on it.

## The batch channel (Accept: application/json)

The playground's batch mode replays the JSON response as a one-shot stream and mints
`msg-batch-{generateId()}` when the response message has no id
(`AgentChatTransport.ts:122-145`), and the server's batch projection assigns
positional `msg-{i}` ids (`messages.py:235-242`). A batch-mode resume therefore
still duplicates after this fix. Same rule applies there: `_make_vercel_json_response`
(`routing.py:305-330`) can stamp the continuation id on the last assistant output
message. Scope it as a second, smaller slice; the streaming path is the one users
hit (stream is the default channel, `agentRequest.ts:371-373`).

## Recommendation

Option A. Roughly ten lines in `routing.py`, zero adapter/frontend/runner changes,
protocol-faithful, and it fixes approval resumes and client-tool resumes in both the
playground and the slice page at once. Implement the streaming path first, the batch
twin second, and file the runner usage bug separately.
