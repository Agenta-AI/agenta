# Research: what actually happens when one turn raises two approval gates

Everything below was verified against source on 2026-07-06. Paths are relative to the
repo root. Vendored package paths are under `services/runner/node_modules/` and
`web/node_modules/`. This doc corrects the earlier findings doc in one place; see
"Corrections" at the bottom.

## 1. The layers

```
Claude model (API)
  └─ claude CLI  (cli.js, spawned by the Claude Agent SDK inside the sandbox)
      └─ Claude Agent SDK 0.2.83 (stdio control protocol: can_use_tool, hooks)
          └─ claude-agent-acp 0.23.1 (SDK messages -> ACP session updates;
             canUseTool -> ACP session/request_permission)
              └─ sandbox-agent daemon 0.4.2 (ACP over HTTP; holds pending permissions)
                  └─ runner (services/runner; latch, pause, egress events)
                      └─ SDK Vercel adapter (stream.py; events -> UI message parts)
                          └─ playground (AI SDK v6 client + AgentChatSlice)
```

## 2. The wire trace: two gated tool calls in one turn

### 2a. Announcement: both calls stream before anything executes

The CLI streams the assistant message. Each `tool_use` block's `content_block_start`
becomes an ACP `session/update` with `sessionUpdate: "tool_call"`, `status: "pending"`,
and `rawInput` taken from the block's input at that moment
(`@zed-industries/claude-agent-acp/dist/acp-agent.js:1500-1518`). For a streamed call
that input is `{}`: the adapter ignores `input_json_delta` chunks entirely
(`acp-agent.js:1576-1582`).

When the complete assistant message arrives, the adapter sees each `tool_use` id again
(`alreadyCached`) and sends `sessionUpdate: "tool_call_update"` with the real
`rawInput` (`acp-agent.js:1484-1499`). So the real arguments normally reach the runner
in a second frame, before execution starts.

The runner records both frames: the announcement emits a `tool_call` event immediately
(`services/runner/src/tracing/otel.ts:1147-1152`), and the update refreshes the
recorded input when the args genuinely change (`otel.ts:1159-1183`). The egress
projects the refresh as a repeat `tool-input-available` for the same `toolCallId`
(`sdks/python/agenta/sdk/agents/adapters/vercel/stream.py:330-368`).

### 2b. Scheduling: write tools execute one at a time

This is the crux fact. The CLI groups consecutive `tool_use` blocks by
`isConcurrencySafe` and runs them group by group (`VS8` and `nF_` in the minified
`@anthropic-ai/claude-agent-sdk/cli.js`; found via
`grep -o "async function\*VS8.\{1200\}" cli.js`):

- A concurrency-safe group runs in parallel, capped by `MAX_TOOL_USE_CONCURRENCY`
  (default 10).
- An unsafe group runs strictly serially (`rF_`: `for (const block of blocks)` with an
  awaited inner loop per tool).

An MCP tool is concurrency-safe only when its `readOnlyHint` annotation is true:
`isConcurrencySafe(){return z.annotations?.readOnlyHint??!1}` (cli.js, MCP tool
wrapper). `commit_revision` and `create_subscription` are write tools, so they are in
one serial group. **The CLI does not ask permission for tool B until tool A's
permission resolves and tool A finishes.**

### 2c. The gate: canUseTool becomes session/request_permission

Before executing each tool, the CLI sends a `can_use_tool` control request over stdio.
The SDK dispatches control requests fire-and-forget (`readMessages` calls
`handleControlRequest` without awaiting, `sdk.mjs`), so the SDK layer CAN hold several
at once; the serialization in 2b comes from the CLI's scheduler, not the protocol.

`claude-agent-acp` answers `can_use_tool` by calling `client.requestPermission({...})`,
one ACP `session/request_permission` reverse-RPC per gate
(`acp-agent.js:697-820`, the generic path at 772-788). The request carries
`toolCall.toolCallId` (the `tool_use` id) and `toolCall.rawInput` (the real args, from
`canUseTool`'s `toolInput`), plus the options `allow_always` / `allow` / `reject`.

The sandbox-agent daemon holds each pending gate in a Map keyed by a random
`pendingId`, with no one-at-a-time constraint
(`sandbox-agent/dist/chunk-TVCDKGSM.js:2215-2247`, `enqueuePermissionRequests` map at
1098). Nothing at the ACP or daemon layer forbids concurrent unanswered gates.

### 2d. The runner: one latch, first gate wins

`attachPermissionResponder` handles each gate: it builds a `GateDescriptor`, asks the
`ApprovalResponder` (`decide()` ladder in `services/runner/src/permission-plan.ts:138-151`),
and on `pendingApproval` calls `pauseUserApproval`
(`services/runner/src/engines/sandbox_agent/acp-interactions.ts:161-215`).

`pauseUserApproval` starts with `if (!latch.tryAcquire()) return;`
(`acp-interactions.ts:78`). The winner:

- marks its tool-call id as paused (`onPausedToolCall`, so later teardown frames for
  it are suppressed, `sandbox_agent.ts:176-187` + `pause.ts:34-41`),
- emits the `interaction_request` event (kind `user_approval`) that the egress turns
  into a `tool-approval-request` part (`stream.py:449-527`),
- records a durable interaction (`sandbox_agent.ts:747-768`),
- calls `onPause` -> `PendingApprovalPauseController.pause()`, which resolves the pause
  signal and destroys the sandbox session (`pause.ts:22-27`,
  `sandbox_agent.ts:710-715`). The prompt race then returns `stopReason: "paused"`
  (`sandbox_agent.ts:858-871`) and the egress maps it to `finishReason: "other"`
  (`stream.py:35-40`).

The loser hits the same `tryAcquire` and returns. No approval interaction, no reply, and
no terminal `tool_result` (the earlier `tool_call` announcement stays in the event log).
That silent return is the bug.

### 2e. Teardown: every unanswered gate resolves as "cancelled"

Destroying the session makes the daemon resolve every pending permission for that
session with `cancelledPermissionResponse()`
(`chunk-TVCDKGSM.js:2257-2265`, and again on dispose at 1189-1191). Back in
`claude-agent-acp`, a cancelled outcome makes `canUseTool` throw `"Tool use aborted"`
(`acp-agent.js:789-791`). The harness never sees a `reject`, which is what F-040
requires: a reject would make Claude emit a failed `tool_result` that clobbers the
approval part (the F-024 clobber, `acp-interactions.ts:68-72`).

## 3. Answer: does the harness send two concurrent request_permission requests?

**For write tools (our case): no.** The CLI serializes them (2b). Gate B is raised
only after gate A resolves. Under F-040 the runner never answers gate A; the only
thing that "resolves" it is the teardown cancel (2e). So gate B is raised, if at all,
inside the teardown race window: cancel A -> CLI unblocks -> tries tool B ->
`can_use_tool` B -> `session/request_permission` B arrives at a runner that is mid
teardown but still has its listener attached. That is exactly what the incident shows:
the second gate reached `handleRequest`, lost the latch, and vanished.

**For read-only-annotated tools: concurrency is possible.** Two gated tools with
`readOnlyHint: true` land in one parallel group, and their `can_use_tool` requests can
genuinely overlap (2b, 2c). The latch drops the loser the same way.

Two consequences for the design:

1. The runner cannot "wait and collect all gates of the turn". For serial tools the
   second gate does not exist until the first is answered or cancelled. Holding gate A
   open forever just blocks the CLI.
2. The loser's gate arrival is a race, not a guarantee. Any fix that depends on
   receiving gate B on the wire is unreliable. The reliable inventory of sibling calls
   is the runner's own event log: every announced `tool_call` without a `tool_result`
   (`otel.ts:904`, `run.events()` at 1337).

## 4. Why the losing call shows empty input

The FE part for `create_subscription` held `input: {}`. Per 2a the `{}` comes from the
streamed announcement, and the real args ride the later `tool_call_update`. The
adapter's prompt loop sends session updates sequentially over stdio -> daemon -> HTTP,
while the gate RPC travels a separate async path. In the incident the pause destroyed
the session before the refresh for `create_subscription` was delivered, so the client
kept `{}`. The refresh is therefore best-effort at pause time. This matters for
Option B: you should not ask a human to approve a call whose args you do not have.

## 5. What the client holds after the pause

Stream received by the client (see [flows.md](flows.md) for the full sequence):

- tool A: `tool-input-start`/`available`, then a refreshed `tool-input-available` with
  real args plus `tool-approval-request` (from `_interaction_parts`,
  `stream.py:495-526`). Part state: `approval-requested`.
- tool B: `tool-input-start`/`available` with `{}`. Nothing else, ever. Part state:
  `input-available`. No approval, no output, no error, no `providerExecuted`.
- `finish` with `finishReason: "other"`.

When the turn is no longer streaming, the app-layer classifier treats B as a client
tool because it is unsettled, non-approval, non-provider-executed, and the turn ended
(`meta.ts:52-66`). The registry knows only `request_connection`
(`registry.tsx:26-28`), so B falls to the generic fallback, which force-settles it:
`settle({errorText: 'This app can't handle the "<toolName>" request.'})`
(`UnhandledClientTool.tsx:17-21`). That synthetic error is what the user saw, and it
enters the message history as a real tool error.

## 6. The resume machinery (and why it already supports multiple approvals)

On approve, the AI SDK flips the part to `approval-responded`
(`addToolApprovalResponse`, `ai@6.0.0-beta.150 dist/index.js:11162-11188`) and calls
`sendAutomaticallyWhen`. Ours is `agentShouldResumeAfterApproval`
(`web/packages/agenta-playground/src/state/execution/agentApprovalResume.ts:108-138`),
wired at `web/oss/src/components/AgentChatSlice/AgentChatPanel.tsx:368`. It resumes
only when at least one gate was freshly resolved AND every non-provider-executed tool
part on the turn is settled (`output-available`, `output-error`, or
`approval-responded`). So with two pending gates, approving the first does not resume;
approving the last does. The predicate was already designed for this.

The resume POST carries the full history. The SDK ingress folds each
`approval-responded` part into a `tool_result` block with an `{approved: bool}`
envelope keyed by `toolCallId`
(`sdks/python/agenta/sdk/agents/adapters/vercel/messages.py:152-182`). The runner
indexes every such envelope by `approvedCallKey(name, args)` (name + canonical args,
recovered from the matching `tool_call` block by id):
`extractApprovalDecisions` at `services/runner/src/responder.ts:247-259`,
`coldReplayKey` at 322-332, key shape at 65-76. **The store is a Map. It already holds
any number of decisions per turn** — for distinct calls. Two IDENTICAL calls (same tool,
same canonical args) collapse to one key, so the second stored approval used to overwrite
the first and only one re-raised gate got answered from history. Fixed in this PR: the
store keeps a FIFO list per key (mirroring the client-tool output store right below it),
so each identical re-raised gate consumes the next stored decision in order.

The resumed run cold-starts a fresh sandbox and replays prior turns as flattened text
(`services/runner/src/engines/sandbox_agent/transcript.ts:43-81`; an approval envelope
renders as `[<tool> returned: {"approved":true}]`). The model re-issues the approved
call; the re-raised gate matches the stored decision by name+args and is answered
`"once"` silently (`decide()` at `permission-plan.ts:147-149`, reply mapping at
`responder.ts:370-378`). Two stored decisions would answer two re-raised gates in
sequence with zero extra prompts.

## 7. Frontend and AI SDK readiness for multiple pending approvals

Checked for Option B; all of it already exists:

- **Wire**: `tool-approval-request` is a per-toolCallId chunk; nothing limits one per
  message (`stream.py:522-526`; chunk handler in `ai dist/index.js:4775-4781` just
  flips the matching part). Two approval parts in one assistant message are valid
  today.
- **Dock**: `getPendingApprovals` collects ALL `approval-requested` parts on the last
  turn (`web/oss/src/components/AgentChatSlice/components/ApprovalDock.tsx:35-47`).
  The dock renders a queue ("1 of N", `ApprovalDock.tsx:148-155`) and has an
  "Approve all" action (119-123). It was explicitly written for "a turn can request
  several at once".
- **Resume predicate**: holds the auto-resend until no gate is pending (section 6).
- **Ingress + runner store**: fold and match N decisions (section 6).

What does NOT exist: the runner never emits more than one `interaction_request` per
turn (the latch), and, per section 3, it will never receive the sibling's gate
reliably. That is the only missing piece for batching.

## 8. Pi relay: same latch, partially better behavior

Pi gates through the relay instead of ACP. The builtin-gating path already answers the
latch loser deterministically: `"Another approval is pending; retry after it
resolves."` goes back to the tool child (`services/runner/src/tools/relay.ts:433-446`,
`emitted:false` from `sandbox_agent.ts:774-796`). The relayed-tool path does not check
`emitted` and returns `PAUSED` regardless (`relay.ts:255-263`). Pi announces its calls
through its own extension, so the orphan shape differs; parity is an open question in
[plan.md](plan.md), not part of the incident.

## 9. Corrections to the earlier findings doc

`docs/design/agent-workflows/scratch/approval-turn-duplication-findings.md` is accurate
on the runner and FE mechanics. Two refinements:

1. It leaves open how the second gate reaches the runner. Verified: for write tools the
   harness serializes gates; the second one arrives only in the teardown race after the
   first is cancelled (section 3). It is not a stable concurrent pair of RPCs.
2. Its "Fix direction" item 2 suggests the FE should recognize `mcp__agenta-tools__*`
   names. That direction is rejected by decision: the frontend must not special-case
   tool names. The fix belongs where the orphan is created (the runner).

## 10. File index

| Concern | Location |
|---|---|
| One-pause latch, loser dropped | `services/runner/src/engines/sandbox_agent/acp-interactions.ts:73-95` (line 78) |
| Latch | `services/runner/src/permission-plan.ts:173-185` |
| F-040 pause = destroy, never reply | `services/runner/src/engines/sandbox_agent/pause.ts:1-27` |
| Pause controller wiring, suppression | `services/runner/src/engines/sandbox_agent.ts:710-729` |
| Pi relay pause + loser reason | `services/runner/src/tools/relay.ts:255-263`, `433-446`; `sandbox_agent.ts:771-797` |
| Event log the runner keeps | `services/runner/src/tracing/otel.ts:904`, `1097-1224`, `1337` |
| tool_use -> ACP tool_call / update | `claude-agent-acp/dist/acp-agent.js:1433-1518`; deltas ignored at 1576-1582 |
| canUseTool -> request_permission | `claude-agent-acp/dist/acp-agent.js:697-820`; cancelled -> throw at 789-791 |
| CLI serial/parallel scheduler | `@anthropic-ai/claude-agent-sdk/cli.js` (`VS8`/`nF_`/`rF_`; MCP `isConcurrencySafe` = `readOnlyHint ?? false`) |
| Daemon pending-permission map + cancel | `sandbox-agent/dist/chunk-TVCDKGSM.js:2215-2265`, `1189-1191` |
| Egress: events -> parts, approval part | `sdks/python/agenta/sdk/agents/adapters/vercel/stream.py:330-368`, `449-527` |
| finishReason mapping (`paused` -> `other`) | `stream.py:22-54` |
| Ingress: parts -> blocks, `{approved}` fold | `sdks/python/agenta/sdk/agents/adapters/vercel/messages.py:91-208` |
| Decision store, cold-replay key | `services/runner/src/responder.ts:65-76`, `247-332`, `370-378` |
| Transcript replay | `services/runner/src/engines/sandbox_agent/transcript.ts:43-81` |
| FE classifier (parked unknown client tool) | `web/oss/src/components/AgentChatSlice/components/clientTools/meta.ts:52-66` |
| FE registry (only `request_connection`) | `.../clientTools/registry.tsx:26-28` |
| FE fake error | `.../clientTools/UnhandledClientTool.tsx:17-21` |
| Resume predicate | `web/packages/agenta-playground/src/state/execution/agentApprovalResume.ts:108-138` |
| Approval response + auto-send | `ai@6.0.0-beta.150 dist/index.js:11162-11188`; chunk handler 4775-4781 |
| ApprovalDock queue + Approve all | `web/oss/src/components/AgentChatSlice/components/ApprovalDock.tsx:35-47`, `119-155` |
| Dock wiring | `web/oss/src/components/AgentChatSlice/AgentChatPanel.tsx:359-368`, `625-629`, `1394-1397` |
