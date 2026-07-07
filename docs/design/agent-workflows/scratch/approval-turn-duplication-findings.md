# Playground approval flow: duplicate turns + phantom tool failure

Findings from the 2026-07-06 investigation of the two playground bugs Mahmoud reported
(session `67a00253-ac61-48ab-a907-4af49f059bd0`, harness `claude`, runner `sidecar`).
Research only. No code changed.

## The two symptoms

1. After every approval, the UI shows the whole previous assistant turn again as a new
   block: same reasoning, same text, same tool chips, plus the new continuation. After
   two approvals the same content stacks three times, each block with its own
   "Inspect turn" footer and its own token metrics.
2. When the model calls two gated tools in parallel (`commit_revision` +
   `create_subscription`), the second one shows `failed` with the error
   `This app can't handle the "mcp__agenta-tools__create_subscription" request.`
   On the next turn the model retries it and it works.

## How the flow actually runs

1. The model (Claude over ACP in the sidecar runner) emits two tool calls in one turn.
   Both are `ask`-gated.
2. `commit_revision`'s permission request wins the per-turn `PendingApprovalLatch`
   (`services/runner/src/engines/sandbox_agent/acp-interactions.ts:78`). The runner
   pauses the turn, destroys the sandbox session, and never replies to the harness gate.
   This teardown is by design (F-040, documented in
   `services/runner/src/engines/sandbox_agent/pause.ts:1-27`).
3. `create_subscription`'s gate hits `if (!latch.tryAcquire()) return;` and is silently
   dropped. Its `tool_call` announcement had already streamed to the client as
   `tool-input-available` (with empty `input: {}`), but it never gets an approval part,
   an output, or an error from the backend.
4. The stream closes with `finishReason: "other"`
   (`sdks/python/agenta/sdk/agents/adapters/vercel/stream.py:38`). The frontend shows
   the approval prompt for `commit_revision`.
5. The user clicks Approve. `addToolApprovalResponse` (AI SDK) mutates the tool part to
   `approval-responded` and auto-resends the full message history as a brand-new POST
   (`agentApprovalResume.ts:108-138` decides when;
   `agentRequest.ts:292-398` builds the body).
6. The runner cold-starts a fresh sandbox and replays prior turns as flattened
   transcript text (`services/runner/src/engines/sandbox_agent/transcript.ts:43-81`).
   It matches the approved call against the inbound history, executes it, and the model
   continues. Only new events stream out. The backend does not re-emit old parts.

## Root cause 1: duplicate turn blocks (server + client id mismatch)

Two facts combine:

- **Client side:** on a resume, the AI SDK uses the existing last assistant message as
  the streaming target, not an empty one
  (`createStreamingUIMessageState`, `ai/dist/index.js:4444-4459`: if
  `lastMessage.role === "assistant"`, `state.message = lastMessage`). New parts append
  to a clone that already contains the full previous turn. Whether that clone
  **replaces** the original or gets **pushed as a new message** depends on one check:
  `activeResponse.state.message.id === this.lastMessage?.id`
  (`ai/dist/index.js:11329-11337`).
- **Server side:** the Vercel adapter mints a fresh id on every HTTP request:
  `messageId = msg-{trace_id}` (`stream.py:254-279`), and `routing.py:349-353` only ever
  passes `trace_id`, never a continuation id. Each POST gets a new OTel trace, so each
  resume gets a new `messageId`. The stream's `start` chunk overwrites the client-side
  message id (`ai/dist/index.js:4852-4857`).

So on every resume: the client clones the old assistant message (full content), appends
the new parts, the server's fresh `messageId` makes the replace check fail, and the
clone is pushed as a second full message next to the original. Each approval adds one
more cumulative copy. The duplicated text is byte-identical because it is a client-side
clone, not a model re-generation and not a server replay.

Side effect: the token counts per block look weird (`input: 0, output: 0, total: 62749`)
because ACP's `usage_update` only carries a context-tokens figure
(`services/runner/src/tracing/otel.ts:1185-1197`), and the resumed turn's prompt
contains the whole flattened transcript.

The FE has no cross-message dedupe that could hide this; all collapse logic in
`AgentMessage.tsx` works within one message's parts.

### Fix direction

Keep the message id stable across a continuation. Options, roughly in order:

1. **Server echoes the continuation id.** When the inbound request's last message is an
   assistant message (a resume), `routing.py`/`stream.py` should reuse that message's id
   in the `start` chunk instead of minting `msg-{trace_id}`. Then the AI SDK takes the
   replace path and the turn continues in place. Trace id stays separate for
   observability.
2. Alternatively, omit `messageId` from the `start` chunk on resumes; the client then
   keeps the existing id. Riskier: needs the server to know it is a resume anyway.
3. FE-side transport could forward `messageId` explicitly
   (`prepareSendMessagesRequest` receives it but neither transport reads it today:
   `transport.ts:124-162`, `AgentChatTransport.ts:139-142`). Useful as an explicit
   signal, but the server change is what fixes it.

Note the "Inspect turn" and per-turn metrics UI keys off one trace per message. If we
stabilize the message id across resumes, one message will span multiple traces; the
inspector needs to handle that (list of trace ids per turn, or keep per-request metrics
elsewhere).

## Root cause 2: phantom `create_subscription` failure (runner latch + FE misclassification)

Two layers again:

- **Runner:** the one-pause latch correctly serializes approval gates (only one pause
  per turn), but it has no path for the losing sibling. The dropped gate's tool call was
  already announced on the stream, so the client holds an unsettled tool part with no
  approval, no output, no error, and no `providerExecuted` flag.
- **Frontend:** when the turn ends, `meta.ts:52-65` classifies any unsettled,
  non-approval, non-provider-executed tool part with no registered client-tool handler
  as a "parked unknown client tool" (only `request_connection` is registered in
  `registry.tsx`). `UnhandledClientTool.tsx:19-20` then force-settles it with the
  synthetic error `This app can't handle the "<toolName>" request.` That error text is
  ours, generated in the browser. The backend never failed anything.

The error is misleading twice over: the tool is not a client tool, and nothing actually
ran. The accidental saving grace is that the errored part goes back in the history, the
model sees it after the resume, retries `create_subscription` alone, and the second
approval then works. That is why the user sees two approval prompts and a transient
error that "disappears".

### Fix direction

1. **Runner:** when a gate loses the latch, settle its tool call before teardown, e.g.
   emit a deterministic "deferred: waiting on another approval" outcome (or cancel it
   cleanly) so the client never holds an orphan. Better long term: gate all pending
   approvals in one pause so the user approves both at once, but that changes the F-040
   pause contract and needs design.
2. **Frontend:** `mcp__agenta-tools__*` names should never fall into the unknown
   client-tool bucket. The classifier should recognize platform/gateway tools and render
   an honest state ("not executed, will retry after approval") instead of the fake
   app-can't-handle error.

## File index

| Concern | Location |
|---|---|
| One-pause latch drops sibling gates | `services/runner/src/engines/sandbox_agent/acp-interactions.ts:71-95` |
| Pause = destroy session, never reply (F-040) | `services/runner/src/engines/sandbox_agent/pause.ts:1-27` |
| Cold replay of prior turns as text | `services/runner/src/engines/sandbox_agent/transcript.ts:43-81` |
| Fresh `msg-{trace_id}` per request | `sdks/python/agenta/sdk/agents/adapters/vercel/stream.py:254-279` |
| Call site passes only `trace_id` | `sdks/python/agenta/sdk/decorators/routing.py:349-353` |
| Client reuses last assistant msg as stream target | `ai@6.0.0-beta.150 dist/index.js:4444-4459` |
| Replace-vs-push decided by id equality | `ai dist/index.js:11329-11337`; `start` overwrites id at `4852-4857` |
| Approval auto-resend | `web/packages/agenta-playground/src/state/execution/agentApprovalResume.ts:108-138` |
| Request body (full history, no messageId) | `web/packages/agenta-playground/src/state/execution/agentRequest.ts:292-398` |
| Fake error minted in browser | `web/oss/src/components/AgentChatSlice/components/clientTools/UnhandledClientTool.tsx:19-20` |
| Unknown-client-tool classifier | `web/oss/src/components/AgentChatSlice/components/clientTools/meta.ts:52-65` |
| Usage numbers (0/0/62749) | `services/runner/src/tracing/otel.ts:1185-1197` |
