# Research: the code this builds on

Every claim below was read in the shipped tree on the `gitbutler/workspace` branch. File and
line numbers are from that read and can drift by a few lines.

## The grant list has no reader

`services/runner/src/protocol.ts:423` declares `tools?: string[]` on `AgentRunRequest`,
commented "Built-in tools to enable". A grep across `services/runner/src` for any read of
`request.tools` or `.tools` on the request finds nothing. The SDK still emits it:
`PiAgentTemplate.wire_tools` at `sdks/python/agenta/sdk/agents/dtos.py:829` returns
`"tools": list(self.builtin_names)`. `git show 0e71bd0f7a` confirms that commit removed the
in-process engine (`runner engines/pi.ts`) and its guard, which held the old
`toolAllowlist` that read this field. So the field is emitted and mirrored on the wire but
dead on arrival.

## The one decision module

`services/runner/src/permission-plan.ts` owns the whole decision. `decide(gate, plan,
stored)` at line 99 returns `allow`, `deny`, or `pendingApproval`. It calls
`effectivePermission(gate, plan)` at line 86, which resolves the tool's permission from, in
order: the spec's explicit author permission, the owning MCP server's permission, a matching
pattern rule, then the global default. Under `allow_reads` the default splits on
`gate.readOnlyHint` (line 193): a read runs, anything else asks.

The input is a `GateDescriptor` (line 17). Its fields:

- `executor: "harness" | "relay" | "client"` (line 14): which component runs the tool;
  the file's own comment says this "decides how resume matching anchors names".
- `toolName?`: the stable tool name for resume matching.
- `specPermission?`, `serverPermission?`: explicit author permissions, when present.
- `readOnlyHint?`: the catalog read hint. Absent counts as a write under `allow_reads`.
- `args?`: the real call arguments, used by stored-decision matching and by prefix rules.

Pattern rules can be exact (`bash`) or a prefix (`bash(git:*)`). The prefix path
(`ruleMatches`, line 155) reads the first string argument of `args`, so it needs the real
arguments to work. This is the crux of why Option A was rejected: a gate that only sees a
synthetic call has no real `args`, so prefix rules and read classification break.

## The relay and its permission interface

`services/runner/src/tools/relay.ts` runs the runner-side loop that executes tools the
sandbox cannot run itself. `RelayPermissions` (line 63) is the contract between the relay and
the decision module:

- `enforce: boolean`: true when the relay is the only gate (Pi), false when the harness
  gates first (Claude).
- `decide: (gate) => Verdict`.
- `onPendingApproval(info)`: emit the approval event and pause the turn.

It is constructed at `services/runner/src/engines/sandbox_agent.ts:726`. There, `enforce` is
`plan.isPi`, `decide` is `(gate) => decide(gate, permissionPlan, decisions)`, and
`onPendingApproval` acquires the single-pending latch, marks the paused tool call, emits an
`interaction_request` event with `availableReplies: ["once", "reject"]`, records the durable
interaction, and calls `pause.pause()`.

`executeRelayedTool` (relay.ts:193) is where a custom tool gets decided today. When
`permissions.enforce` is set it builds a `GateDescriptor` with `executor: "relay"`, `toolName:
spec.name`, `specPermission: spec.permission`, `readOnlyHint: spec.readOnly`, `args: req.args`
(line 226), calls `decide`, and on `pendingApproval` calls `onPendingApproval` and returns the
`PAUSED` sentinel. **On `PAUSED` the loop writes no response file** (relay.ts:328,
`if (text === PAUSED) return;`). That is safe for custom tools because the runner is the
executor: withholding the response withholds the result, and the turn is tearing down anyway.
This detail matters for builtins, where the runner is not the executor (see design.md).

## The relay-directory file protocol

The sandbox and the runner talk through files in a relay dir. The sandbox side lives in
`services/runner/src/tools/dispatch.ts`. `relayToolCall` (line 113) writes
`<id>.req.json` with `{ toolName, toolCallId, args }` and polls for `<id>.res.json` with
`{ ok, text?, error? }`, up to `RELAY_TIMEOUT_MS` (60s, relay.ts:42) polling every
`RELAY_POLL_MS` (300ms, relay.ts:39). The record types `RelayRequest` and `RelayResponse`
are at relay.ts:46-55. The runner side is `startToolRelay` (relay.ts:298): it polls the dir,
reads each new `.req.json`, looks up the spec by `req.toolName` in a `specsByName` map
(line 310), executes it, and writes `.res.json`. A request whose `toolName` has no matching
spec throws "unknown tool" (line 319). So the current loop assumes every request names a
resolved spec. A builtin has no spec, so the loop needs a new branch.

The host abstraction (`RelayHost`, relay.ts:148) has `list`, `read`, `write`, with a local
filesystem implementation (line 155) and a Daytona sandbox implementation (line 170). Any new
record type rides the same host, so it works locally and on Daytona for free.

## The relay only starts when custom tools exist

`useToolRelay` is set at `services/runner/src/engines/sandbox_agent/run-plan.ts:329` as
`toolSpecs.length > 0`. The relay loop is started only when that flag is true
(`sandbox_agent.ts:776`), and the relay dir is created only then
(`workspace.ts:95`). So a Pi run with no custom tools has no relay at all. Builtin gating must
also start the relay when gating is active, even with zero custom tools.

## The extension and its env

Our extension is `services/runner/src/extensions/agenta.ts`. It is a Pi `ExtensionFactory`
(default export, line 154) that is fully inert unless Agenta set its env
(line 165). It registers custom tools with `pi.registerTool` (line 128), each executing
through `runResolvedTool` -> the relay. It has no `tool_call` hook today.

The env is built by `buildPiExtensionEnv` in
`services/runner/src/engines/sandbox_agent/pi-assets.ts:33`. It sets
`AGENTA_AGENT_TOOLS_PUBLIC_SPECS` and `AGENTA_AGENT_TOOLS_RELAY_DIR` only when there are
public specs and a relay dir (line 57). The extension is installed per run by
`installPiExtensionLocal` (pi-assets.ts:66) and `uploadPiExtensionToSandbox`
(pi-assets.ts:139), and bundled by `scripts/build-extension.mjs`.

## Pi's `tool_call` hook (from Pi's own docs)

`node_modules/@earendil-works/pi-coding-agent/docs/extensions.md:700` documents the hook.
`pi.on("tool_call", async (event, ctx) => ...)` fires after `tool_execution_start` and
**before the tool executes**, and it **can block** by returning `{ block: true, reason?:
string }`. `event.toolName` covers the native builtins (the docs list "bash", "read",
"write", "edit"). `event.input` is the real, mutable argument object. `event.toolCallId` is
the call id. `isToolCallEventType("bash", event)` narrows the input type. Sibling tool calls
from one assistant message are preflighted sequentially, then executed concurrently
(extensions.md:706), so each concurrent builtin still gets its own `tool_call` before it runs.

## Pi can also restrict the active tool set

`extensions.md:1540-1552` documents `pi.getActiveTools()` and
`pi.setActiveTools([...])` on the extension API, and `--no-builtin-tools` /
`noTools: "builtin"` to start with builtins off. `setActiveTools` takes the full enabled set,
including custom and extension tool names (`sdk.md:553`). This gives a second, cleaner
mechanism for the grant list: set the active set to exactly the granted builtins plus our
registered custom tools, so the model never sees a non-granted builtin at all. See design.md.

## Read-only classification lives runner-side

`effectivePermission` reads `gate.readOnlyHint`. For custom tools it comes from `spec.readOnly`.
Pi ships no read-only flag for its builtins, so the runner must hold the table itself:
`read`, `grep`, `find`, `ls` are reads; `bash`, `edit`, `write` are writes. This table belongs
next to `decide()` so classification stays in the one decision module, not in the sandbox.

## Resume and the paused-call teardown

A pending approval pauses the turn. `PauseController.markPausedToolCall`
(`services/runner/src/engines/sandbox_agent/pause.ts:34`) records the paused call id, and
`isPausedToolCall` (line 39) lets teardown suppress the errors from a call that was
deliberately abandoned. On the user's decision the run resumes and the stored-decision
matcher (`StoredPermissionDecisions.take`, permission-plan.ts:41) replays the answer against
the re-issued call, anchored on `toolName` and canonical `args`. This is the same path the
relay-ask flow already uses and that was live-QA'd for custom tools. Whether Pi re-issues a
builtin call after the block is the one behavior this design has not yet verified live; it is
the top open risk (design.md, plan.md Phase 0).
