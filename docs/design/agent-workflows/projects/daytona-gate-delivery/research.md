# Research

This is grounded in the working tree with PR #5197 (feat/sessions-continuity) applied.
File and line references are to that state.

## The gate path, end to end

### 1. The extension raises a gate for every builtin call

`services/runner/src/extensions/agenta.ts` registers builtin gating when
`AGENTA_AGENT_BUILTIN_GATING` is set. `registerBuiltinGating` (lines 210-239) does two
things:

- On `before_agent_start`, it narrows the model's active builtin set to the granted ones
  (`replaceActiveBuiltinTools`). A builtin the run did not grant is not offered to the
  model at all.
- On every `tool_call` event for a granted builtin, it calls `piDialogAllows` and blocks
  the call unless the answer is allow (lines 224-238).

`piDialogAllows` (lines 102-126) calls `ctx.ui.confirm(PI_GATE_DIALOG_TITLE, message)`,
where `message` is the JSON gate envelope. It passes no `opts`, so Pi arms no reaper and
the dialog waits indefinitely. The comment at lines 94-100 states this on purpose: an
unavailable UI plane blocks, and a cancellation resolves to a fail-closed block.

The key fact: this confirm fires for every builtin call, including calls the policy would
allow. The extension does not know the policy. The runner decides allow, ask, or deny
after the gate surfaces on the runner side. So even a pure allow needs a full round-trip
to the runner and back.

### 2. The confirm becomes an ACP reverse request

`services/runner/src/engines/sandbox_agent/pi-gate-envelope.ts` documents the tunnel. The
`pi-acp` bridge forwards the confirm as an ACP `session/request_permission` with a
synthetic `pi-ui-<uuid>` tool-call id. The real identity (tool name, the model's tool-call
id, the arguments) rides inside the `message` field as the envelope JSON (lines 1-20). The
envelope carries identity only, never policy (lines 16-19). The runner recovers policy
from its own resolved specs.

### 3. The runner classifies and answers the reverse request

`services/runner/src/engines/sandbox_agent/acp-interactions.ts` wires
`session.onPermissionRequest` (line 104). `handleRequest` detects a Pi gate by the dialog
title, parses the envelope, builds a `GateDescriptor` from the envelope identity plus the
run's resolved specs (`buildPiGateDescriptor`, lines 421-450), runs it through the
responder policy, and either answers the reverse request or pauses the turn for a human
(lines 274-326). It logs `[HITL] pi-gate ...` for every Pi gate it handles (lines
297-309).

On a Daytona session this log line never appears. `session.onPermissionRequest` never
fires. The reverse request does not arrive. On an identical local run it fires and
round-trips. That is the whole defect.

### 4. The policy decision

`services/runner/src/permission-plan.ts` computes the decision. For a builtin there is no
`specPermission` or `serverPermission`, so `effectivePermission` (lines 125-136) falls to
a matching rule (`matchingRulePermission`) or the default (`defaultPermission`, lines
248-256):

- Default `allow`: every builtin resolves to allow.
- Default `allow_reads`: read-only builtins (read, grep, find, ls) resolve to allow; write
  builtins (bash, edit, write) resolve to ask.
- Default `ask` or `deny`: as named.
- A rule can override per builtin. A prefix rule like `Bash(git:*)` makes the decision
  depend on the call arguments (`ruleMatches`, lines 214-224).

`decide` (lines 138-151) returns allow, deny, or pendingApproval. A pendingApproval that
no stored decision answers pauses the turn and surfaces an approval prompt.

The QA runs use allow mode, where every builtin resolves to allow. Both read and bash
still hang, because the gate fires before the allow decision is reached.

## Why the reverse request dies on Daytona and not local

Both local and Daytona drive the harness through the same `sandbox-agent` package over
HTTP. The local provider spawns the `sandbox-agent` binary as an HTTP server
(`node_modules/sandbox-agent/dist/providers/local.js`, `spawnSandboxAgent` runs
`server --host --port --token`). The runner connects to it with `AcpHttpClient`. On
Daytona the same server binary runs inside the sandbox, and the runner connects to it
through the Daytona preview proxy, with a cookie jar for the proxy auth
(`createCookieFetch` in `services/runner/src/engines/sandbox_agent/daytona.ts`, lines
143-181).

`AcpHttpClient` (in `acp-http-client@0.4.2`, bundled under `node_modules/.pnpm`) uses two
HTTP channels to one endpoint:

- Client to server: a `POST` per JSON-RPC message. A `200` response body is read inline as
  a direct response (`postMessage`, dist/index.js lines 245-268).
- Server to client: a single persistent `GET` SSE stream, started after the first POST
  (`ensureSseLoop` / `runSseLoop`, lines 271-320). Both server-initiated notifications
  (`session/update`) and server-initiated requests (`session/request_permission`) arrive
  on this one stream. The client answers a server request by POSTing the response envelope
  back.

The reverse-request handler is wired all the way through:
`client.requestPermission -> live.handlePermissionRequest -> onPermissionRequest ->
enqueuePermissionRequest` (chunk-TVCDKGSM.js lines 763-768, 888-914, 2025). Local proves
this path works over HTTP.

So the only variable between local and Daytona is the preview proxy. On Daytona the SSE
stream does deliver `session/update` (the finding confirms the `tool_call` ingests fine),
which means the stream is alive. Yet the `session/request_permission` envelope on that
same stream never reaches the runner. Static analysis cannot pin the exact proxy behavior
that drops or stalls the server-initiated request while passing notifications. Confirming
and fixing it would need live proxy-level inspection and probably a change in the vendored
`sandbox-agent` transport or the proxy itself.

This uncertainty is the strongest argument against fixing the transport as the primary
path, and for options that do not depend on the reverse request at all. See
[options.md](options.md).

### A related transport fragility already documented

F-017 in [../qa/findings.md](../qa/findings.md) records a Daytona proxy idle-stream
timeout around 60s that killed quiet streams before PR #5197 detached the mount process.
That history reinforces the read that server-initiated traffic over the proxy is fragile,
and that a HITL pause (a human-timescale wait with no traffic) is exactly the shape the
proxy handles worst.

## Substrate the fix can reuse

### The file relay already works on Daytona

`services/runner/src/tools/relay.ts` runs a runner-side loop that polls the sandbox
filesystem for request files, executes each, and writes a result file back (lines 16,
317-378). It supports both a local filesystem host and a Daytona sandbox filesystem host
(`host.list(relayDir)`, `host.read`, `sandbox.readFsFile`). This is how custom tool calls
already cross the Daytona boundary. The MCP loopback channel is deliberately skipped on
Daytona and swapped for this relay (`services/runner/src/engines/sandbox_agent/mcp.ts`
lines 164-264). This is the proven precedent an ask-mode surface can follow.

Two caveats for reuse:

- The relay loop starts only when `plan.useToolRelay` is set, which today tracks having
  custom tools (`services/runner/src/engines/sandbox_agent.ts` line 1631). A builtins-only
  run does not start it. Delivering builtin gates over the relay would need the loop
  running whenever builtin gating is active on Daytona.
- Builtin gating passes no relay dir to the extension today. `buildPiExtensionEnv` sets
  `AGENTA_AGENT_BUILTIN_GATING` and `AGENTA_AGENT_BUILTIN_GRANTS` but notes the gate rides
  the confirm dialog, not the file relay
  (`services/runner/src/engines/sandbox_agent/pi-assets.ts` lines 74-79). An option that
  uses the relay for builtins would set the relay dir there too.

### The relay guard already re-decides runner-side

For Pi custom tools the relay guard re-runs `decide()` on the runner before executing a
relayed call (`services/runner/src/engines/sandbox_agent.ts` lines 1594-1630). A forged
execute record cannot run an ask or deny tool. This is the same runner-side enforcement an
ask-mode file-relay gate would use. It shows the pattern is already in the codebase.

### The runner already computes builtin grants up front

`run-plan.ts` computes `builtinGrants` and `builtinGatingActive`
(`normalizePiBuiltinGrants`, `computeBuiltinGatingActive`, lines 289-293) and injects them
into the sandbox env. Adding a per-builtin decision alongside the grant list is a small
extension of an injection that already exists.

## Facts that constrain the approval state machine

Surfaced during the design review ([design-review.md](design-review.md)); verify at the
referenced sites.

- The relay loop stops as soon as the turn pauses (`runTurn` stops the relay,
  `services/runner/src/engines/sandbox_agent.ts` around line 1713), and the loop marks a
  request seen before processing (`services/runner/src/tools/relay.ts` around lines
  336-350). A pending gate file inside a paused turn is not answered later by the same
  loop.
- Live approval parking is ACP-only: a parked gate holds an ACP permission id answered
  via `respondPermission` (`sandbox_agent.ts` around line 427, `server.ts` around line
  590), and a unit test asserts Pi file-relay gates are non-parkable
  (`services/runner/tests/unit/session-keepalive-approval.test.ts` around line 428). A
  file-transport gate cannot park without extending that union.
- Keep-alive is off by default (`session-pool.ts` around line 53), and F-020 records that
  Daytona sandboxes are deleted at turn end regardless. So the default resume path for a
  Daytona ask gate is cold: the sandbox that raised the gate is gone by the time the
  human answers, and the stored decision must answer the reissued call on the next turn.
- The extension trusts relay response JSON as-is (`services/runner/src/tools/dispatch.ts`
  around line 89). That is safe for custom-tool results because execution happens
  runner-side behind the relay guard. It is not safe for a builtin decision file, where
  the file itself would be the authorization: the relay dir is sandbox-writable, so an
  unsigned `allow` is not demonstrably runner-authored.
- `run-limits.ts` freezes every deadline on a HITL pause (`notePaused`) on purpose. Any
  gate timeout must not reap a legitimately parked approval, which forces the
  delivery-versus-human split rather than one timer.

## What the runner can and cannot precompute

The runner can precompute a builtin's decision when it does not depend on the call
arguments: the default mode applied to the builtin's read-only hint, or a plain
name-match rule. The runner cannot precompute a single decision when a prefix rule like
`Bash(git:*)` makes the answer depend on the arguments, and it cannot precompute an ask
that a human must answer per call. Those cases must still reach the runner at call time
(they compile to the `runner` disposition). This split is what shapes the recommended
layering in [options.md](options.md).
