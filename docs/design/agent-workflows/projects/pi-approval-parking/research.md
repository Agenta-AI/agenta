# Pi approval parking: research

Everything here is verified against `services/runner/src` as of 2026-07-09 (post the #5178 and
#5183 merges) unless a package path says otherwise. A reader should be able to implement from
this file plus plan.md without re-deriving the mechanics.

Landed note (2026-07-10, PR #5185): the mechanics in §1 describe the code this feature
REPLACED. The relay permission plane (§1's `relayPermissionCheck`, the watcher's permission
handling) is deleted; both Pi gates now ride `ctx.ui.confirm` unconditionally, with no flag
(the §7 flag paragraph is historical).

## 1. How the two Pi gates pause today (the code being replaced)

Pi tools and gates ride a file relay because the in-sandbox Pi process cannot reach Agenta.
The extension (`src/extensions/agenta.ts`, bundled to `dist/extensions/agenta.js` by
`pnpm run build:extension`) writes request files; the runner watches the relay directory and
writes response files (`startToolRelay`, `src/tools/relay.ts:449`). The watcher is started per
turn (`src/engines/sandbox_agent.ts:1355-1360`) and stopped at turn end (`:1428`).

**The custom-tool gate.** The extension registers every resolved tool with Pi
(`agenta.ts:249-286`; requires `AGENTA_AGENT_TOOLS_RELAY_DIR`, so ALL Pi runs, local and
Daytona, execute custom tools through the relay). A tool's `execute` calls `runResolvedTool`
with `relayDir` (`agenta.ts:273-276`), which relays the call (`src/tools/dispatch.ts:66-111`:
write `<id>.req.json`, poll for `<id>.res.json`, deadline `RELAY_TIMEOUT_MS` = 60 s). The
gate lives runner-side: the watcher's `executeRelayedTool` runs `permissions.decide(gate)`
before executing (`relay.ts:240-264`). On `pendingApproval` it calls
`permissions.onPendingApproval` and returns the `PAUSED` sentinel; no response file is
written.

**The builtin gate.** A Pi `tool_call` hook (`agenta.ts:181-207`) blocks on
`relayPermissionCheck` (`dispatch.ts:131-213`), which writes a `kind:"permission"` relay
request and polls. The watcher answers a builtin ask IMMEDIATELY with
`verdict:"pendingApproval"` (`relay.ts:433-446`); the hook has only allow and deny to express
that with, so it returns a `blockReason` (`agenta.ts:199-200`), a deny. Fail-closed by
construction (`dispatch.ts:129`).

**The pause destroys the session.** `onPendingApproval` (`sandbox_agent.ts:1272-1293`) emits
the `interaction_request` event, records the durable pending interaction, and calls
`pause.pause()`. The pause controller's destroy callback (`sandbox_agent.ts:1135-1157`) keeps
a session alive only when `env.parkedApproval` was recorded (`:1152`), and the only code that
records it is the Claude ACP hook (`:1321-1338`). A Pi ask never records one, so the session
(and the in-sandbox poll inside it) dies moments after the ask. The 60-second deadline is
never the mechanism; teardown is.

## 2. The slice-2 park machinery this feature reuses

All merged and live behind `AGENTA_RUNNER_SESSION_KEEPALIVE` (#5156, #5158).

- **The park record.** `env.parkedApproval` (`sandbox_agent.ts` `ParkedApproval`, ~371-381):
  `gateType` (today only `"claude-acp-permission"`), `permissionId`, `toolCallId`, `toolName`,
  `args`, `interactionToken`, plus the held `promptPromise`. Recorded by the
  `onUserApprovalGate` callback (`:1321-1338`) in keep-alive park mode only
  (`opts.approvalParkMode`).
- **The pause exemption.** The destroy callback skips teardown when `approvalParkMode &&
  env.parkedApproval` (`:1145-1152`); the dispatch then parks the session or, if it refuses
  (multi-gate `approvalGateCount > 1`, pool full), calls `env.destroy()`.
- **The pool.** `session-pool.ts`: `park` (`:533`), `checkoutApproval` (`:471`), `repark`
  (`:492`), the approval TTL (`DEFAULT_APPROVAL_TTL_MS = 300_000`, `:46`),
  `approvalDecisionForToolCall` (`:231`, finds the allow/deny for a specific parked tool-call
  id in the incoming request), pool key (`poolKeyFor`, `:366`, runContext-preferred).
- **The resume dispatch.** `server.ts` `awaiting_approval` branch (`:604-693`): validates the
  decision match, the history fingerprint, and the parked mount credentials' expiry
  (deliberately NOT config-fingerprint or credential-epoch equality, `:608-621`), then calls
  `engine.runTurn(live.environment, ..., { approvalParkMode: true, resume: {...} })`
  (`:658-676`). Inside `runTurn`, the resume answers the held request via
  `env.session.respondPermission` (`sandbox_agent.ts:1389`) and awaits the original
  `promptPromise`.
- **The reply mapping needs no change.** `decisionToReply` (`src/responder.ts:485-493`)
  produces `"once"`/`"reject"`, and that is correct for Pi too: the runner talks to the
  sandbox-agent daemon, whose `respondPermission(id, reply)` takes `reply` in
  `{once, always, reject}` and maps it to the request's option BY KIND internally
  (`permissionReplyToResponse`, `sandbox-agent/dist/chunk-TVCDKGSM.js:2811`;
  `PermissionReply`, `index.d.ts:2976`). The raw `yes`/`no` option ids the spike saw came
  from driving `pi-acp` directly, below the daemon. A literal `respondPermission(id, "yes")`
  would fall to the mapper's else branch and select a REJECT option: approvals would become
  denials. Do not map ids; do not widen the reply types.
- **The stored-decisions object is shared but write-closed.** The responder and the relay
  consume the SAME per-turn `ConversationDecisions` object (built once,
  `sandbox_agent.ts:1218`; consumed at `:1225` and `:1268`), which is what makes the
  double-gate bridge possible. But it exposes only `take`/`peek` over private
  `decisionQueues` (`responder.ts:209-237`); the bridge needs a new FIFO append API
  (plan.md, slice 2).

## 3. Where ACP permission requests are classified

`attachPermissionResponder` (`src/engines/sandbox_agent/acp-interactions.ts:53-241`) is the
single entry point for every ACP `session/request_permission`:

- `handleRequest` (`:186-240`) builds a `GateDescriptor` via `buildGateDescriptor`
  (`:263-289`). A request with no embedded spec gets `executor: "harness"` and takes its
  `toolName` from `spec.name -> recorded tool_call name -> name -> title -> kind` (`:269-275`).
  **A Pi dialog request has no spec and its title is the dialog title**, so without envelope
  parsing it would classify as `toolName="agenta-approval"` with dialog-string args. That
  identity would flow to the approval card, the durable interaction row, and the stored
  decision map. Wrong everywhere. Envelope parsing must happen here.
- The verdict comes from `responder.onPermission` -> `decide(gate, plan, stored)`
  (`src/permission-plan.ts:138-158`); a stored decision is consumed by `stored.take(gate)`
  (`:147`), keyed on tool name plus canonical arguments.
- `pendingApproval` routes to `pauseUserApproval` (`:88-120`): fires `onUserApprovalGate`
  (the park recorder), acquires the single-pause latch, emits `interaction_request`, records
  the durable interaction, and calls `onPause` (never replying to the harness; teardown or a
  park resolves the RPC).
- Allow/deny reply immediately via `session.respondPermission` (`:148-166`).

This is the load-bearing integration fact: **the Pi dialog request arrives at exactly the
seam that already knows how to hold, park, and answer a gate.** The work is classification
(the envelope), not mechanism.

## 4. What the spike proved (and its one residual)

Full evidence:
[../session-keepalive/followups/parkable-gates/spike-option-c/report.md](../session-keepalive/followups/parkable-gates/spike-option-c/report.md)
(protocol, extension, client, raw wire transcripts alongside). Summary of the load-bearing
facts:

- **The hop works mid-gate** (Q1). `ctx.ui.confirm` raised inside a `tool_call` hook arrives
  as a real `session/request_permission` while the tool call is pending; the answer resolves
  the blocked hook. Path: extension -> Pi RPC `extension_ui_request` -> `pi-acp`
  `handleExtensionConfirm` -> `conn.requestPermission` (`pi-acp/dist/index.js:1106-1128`).
- **The park is the default** (Q3). Held 180067 ms with no reaper; the late allow ran the
  original call with its original arguments inside one uninterrupted `prompt()`. Pi's dialog
  helper arms a timeout only if the caller passes `opts.timeout` or an aborting signal
  (`pi-coding-agent/dist/modes/rpc/rpc-mode.js:44-80`); pass neither.
- **The payload survives as a JSON envelope** (Q2). Natively the bridge forwards only
  `{method, title, message}` with a synthetic `toolCallId` `pi-ui-<uuid>`
  (`pi-acp/dist/index.js:565, 1130-1144`). A JSON envelope through the `message` field
  round-trips byte-exact (quotes, backslashes, Japanese, newlines tested).
- **Fail-closed on every unhappy path** (Q4). Deny and a rejected ACP request both resolve the
  dialog to `false`; a transport drop kills `pi-acp` and Pi cleanly with nothing executed.
- **The daemon leg is source-verified, not live-run** (Q5). `acp-http-client@0.4.2` forwards
  `requestPermission` unchanged with a fail-closed no-handler fallback
  (`dist/index.js:448-452`). One live run through the sandbox-agent daemon is the recorded
  residual and this plan's slice 0.
- The dialog's ACP options are `[{optionId:"yes", kind:"allow_once"}, {optionId:"no",
  kind:"reject_once"}]` (`CONFIRM_PERMISSION_OPTIONS`). The runner never sees those ids:
  the daemon's kind-based reply mapping (§2) absorbs the difference, so the existing
  `once`/`reject` replies are already correct.

## 5. What the kill-and-resume experiments bound

[../harness-session-resume/experiments/report.md](../harness-session-resume/experiments/report.md):
the pending call survives a hard kill on disk (Pi flushes the assistant message on
`message_end`, before the gate runs), but no load path answers it; every cold resume settles
the parked call and the model re-issues (rubric B). Consequences for this feature: warm
parking is the only byte-exact tier, so this work cannot be replaced by session resume; and a
parked Pi session that dies degrades to a faithful tier-2 continuation, not a lost turn.

## 6. Extension delivery and compatibility

The extension ships INSIDE THE RUNNER, not in a sandbox image. `pi-assets.ts` copies the
esbuild bundle (`dist/extensions/agenta.js`, `pi-assets.ts:27`) into the per-run Pi agent dir:
local at `:117` (`installPiExtensionLocal`), Daytona at `:187` (written into the sandbox).
Runner and extension therefore version together; there is no old-image-new-runner skew for the
extension itself. The gate transport is chosen per run by env vars the runner sets
(`AGENTA_AGENT_TOOLS_RELAY_DIR` etc. today), so the new transport can be gated the same way,
and both transports coexist in one extension during rollout.

## 7. Environment and flags today

- `AGENTA_RUNNER_SESSION_KEEPALIVE` (default off) gates the pool; approval parking is park
  mode within it. The pool does not park Daytona sandboxes (keep-alive slice 3 deferred).
- `AGENTA_AGENT_TOOLS_RELAY_TIMEOUT` sets the relay poll deadline (`relay.ts:61-63`). The
  dialog path never touches it.
- The extension's env is built by `buildPiExtensionEnv` (`pi-assets.ts:67-78`), which is
  where `AGENTA_AGENT_BUILTIN_GATING` is set. (Historical: the plan draft routed the new
  transport through a flag pair here; the landed change has no flag, the dialog transport is
  unconditional for Pi.)
- Whether a run starts the relay at all is `useToolRelay` (`run-plan.ts`); with the dialog
  transport a builtin-only run starts no relay (custom tools only).
