# Research — client-tool cleanup and Claude delivery

All line numbers are against the working tree at the time of this writing (post PR #4936).
This file is the evidence base; `plan.md` is the actionable plan.

## What a "client" tool is

A `client` tool (executor `kind: "client"`, e.g. `request_connection`) is **browser-fulfilled
across a turn boundary**: it is advertised to the model, never executed in the sandbox, and
when the model calls it the runner "parks" the call — emits an `interaction_request`
(`kind: "client_tool"`) so the frontend renders a widget (e.g. a connect dialog), ends the turn
`paused`, and the agent resumes on the next turn carrying the browser's result.

The shape is defined in:
- `services/agent/src/protocol.ts:114` — `kind?: "callback" | "code" | "client"`.
- `services/agent/src/responder.ts:52` — `ClientToolOutcome = "deny" | "park" | { output: unknown }`.
- `api/oss/src/core/workflows/static_catalog.py` — the `request_connection` spec, `render: {kind: "connect"}`.

## Two parking implementations; one is dead

The "park a client tool → emit `interaction_request kind=client_tool`" logic exists twice:

1. **LIVE — the relay callback.** `services/agent/src/engines/sandbox_agent.ts:555-588` passes an
   inline `onClientTool` callback into `startToolRelay`. Pi calls the tool → extension `execute`
   (`extensions/agenta.ts:136`) → `runResolvedTool` (`dispatch.ts:171`) writes a relay file →
   runner relay loop → `executeRelayedTool` (`relay.ts:208`) → `clientToolRelay.onClientTool` →
   this callback → `responder.onClientTool` → on `park`, emits the interaction and calls `onPark`.
   This is the path the merged `request_connection` Pi feature actually uses.

2. **DEAD — the ACP permission branch.** `services/agent/src/engines/sandbox_agent/permissions.ts:64-97`
   handles `kind === "client"` inside `attachPermissionResponder`, but only fires when the ACP
   permission request's `toolCall` carries a resolved spec: `clientToolSpecOf(toolCall)` reads
   `toolCall.spec ?? .toolSpec ?? .resolvedTool ?? .tool` (lines 142-144). **Nothing in the runner
   ever attaches a resolved spec to an ACP `toolCall`** — resolved specs are runner-private
   (`public-spec.ts` header), Pi tools never raise an ACP permission request (they execute
   in-extension), and Claude MCP tool calls don't carry the spec. The permissions unit test
   (`tests/unit/sandbox-agent-permissions.test.ts:49,116`) builds `toolCall: { toolCallId, name }`
   with no `spec`, so the branch is never exercised. It is dead code. [[DOUBLE CHECK IT DOES NOT HAVE ANY VALUE]]

The two emit sites also use **different payload shapes** (permissions.ts emits the raw ACP
`toolCall`; sandbox_agent.ts synthesizes one), which is why the Vercel adapter
(`sdks/python/.../adapters/vercel/stream.py:441-470`) defensively reads both `payload.*` and
`payload.toolCall.*`. [[LETS SOLVE THAT ]]

## Why client tools work on Pi only today

Tool **advertisement** differs by harness:

- **Pi** loads tools through the bundled extension. `buildPiExtensionEnv`
  (`engines/sandbox_agent/pi-assets.ts:54`) calls `publicToolSpecs(customTools)`, which after
  #4936 returns ALL specs including `client` (`tools/public-spec.ts:38-40`). So Pi advertises
  `request_connection` and the live relay-park path handles the call. Works.

- **Claude** takes tools over MCP only, via the INTERNAL loopback HTTP MCP server
  (`tools/tool-mcp-http.ts`), built by `buildToolMcpServers` (`tools/mcp-bridge.ts:85-111`) and
  wired in `buildSessionMcpServers` (`engines/sandbox_agent/mcp.ts:230-232`). Client tools are
  **filtered out in two places**:
  - `tools/mcp-bridge.ts:93` — `buildToolMcpServers` keeps only `kind !== "client"`.
  - `tools/tool-mcp-http.ts:96-97` — `tools/list` filters out `client` again.
  So Claude's model never SEES `request_connection`, and the dead ACP branch never parks it.
  Net effect: a Claude run carrying a client tool delivers it to nobody.

## The silent-drop hazard

`assertRequiredCapabilities` (`engines/sandbox_agent/capabilities.ts:169-203`) keys on
`toolSpecs.length` (ALL specs, line 185), and Claude reports `mcpTools: true`, so a Claude run
carrying ONLY `request_connection` passes the capability gate, then `buildToolMcpServers` returns
zero servers (all-client filtered out) — the tool silently vanishes. This is exactly the failure
mode the `*_UNSUPPORTED_MESSAGE` fail-loud gates in `run-plan.ts` exist to prevent. There is no
gate for "client tool on a harness that cannot deliver it." (Confirmed: no such gate exists.)

## How the Claude MCP path executes a tool today

`tool-mcp-http.ts` `tools/call` handler (lines 108-147): looks up the spec by name, then runs
`runResolvedTool(spec, params.arguments, { toolCallId: randomUUID(), relayDir })` (122-125) and
returns the text as MCP `content`. Two facts matter for the plan:
- The handler **mints its own `randomUUID()` toolCallId** — it does NOT know Claude's ACP
  tool-call id (the MCP `tools/call` JSON-RPC params carry only `name` + `arguments`). So an
  `interaction_request` emitted from this path cannot correlate by id to the tool-call the ACP
  event stream surfaced. (The Vercel adapter already synthesizes a standalone tool part when the
  id is unseen — `stream.py:454-460` — and cross-turn resume keys by name+args, not id, so the
  round-trip still closes; only the widget's attachment to the exact tool bubble is affected.)
- The handler has **no access** to the responder / run / `onPark` — it only gets `specs` +
  `relayDir`. Delivering park here needs that wiring plumbed in.

## Live bug: Claude sees an EMPTY schema for platform-catalog tools

`tools/list` advertises `inputSchema: (s.inputSchema as …) ?? EMPTY_OBJECT_SCHEMA`
(`tool-mcp-http.ts:101-102`) — it reads camelCase `inputSchema` only. Platform-catalog tools
carry snake_case `input_schema` (`static_catalog.py` for `request_connection`, `op_catalog.py`
for `commit_revision`), so `s.inputSchema` is `undefined` and Claude is advertised
`EMPTY_OBJECT_SCHEMA`. This is a real, currently-shipping bug for ALL platform tools over Claude
(not just client tools): the model gets no argument schema. Fixed by routing this line through the
shared `specInputSchema` accessor (Phase 2).

## Resume store overload (`ApprovalDecisions`)

`ApprovalDecisions = Map<string, unknown>` (`responder.ts:113`) is reused for BOTH permission
decisions and client-tool outputs. `HITLResponder.onClientTool` (`responder.ts:218-223`) guards
with `!isPermissionDecision(output)` and `parkedCallResultOf` (`responder.ts:395-410`) coerces an
`{approved}` envelope to `"allow"`/`"deny"`. Two hazards: (a) a client tool whose real output is
literally the string `"allow"`/`"deny"` is mis-read as a permission decision and skipped; (b)
`Map.set` by `parkedCallKey(name, args)` means two identical client calls overwrite each other.
Codex's fix: a separate client-output store keyed safely, value a FIFO list per key (Phase 3).

## Claude park mechanics already proven

The user-approval cross-turn park already works for Claude: `onPark` (`sandbox_agent.ts:488-497`)
calls `destroySession`, which resolves the pending RPC with `cancelled` (no F-024 clobber) and
cancels the in-flight `prompt()`; the turn ends `paused` and the egress emits a clean `finish`.
The resume cold-replays and `extractApprovalDecisions` (`responder.ts:332`) recovers the stored
result keyed by `parkedCallKey(name, args)`. The same machinery carries a client tool's browser
output (a `tool_result` whose `output` is NOT an `{approved}` envelope — `responder.ts:395-410`).

## Duplicated / triplicated helpers (cleanup target)

Byte-identical copies of `objectSchema` / `requiredFields` / `specInputSchema` /
`missingRequiredFields` / `assertRequiredArguments`:
- `tools/dispatch.ts:51-107` (assert called at 167).
- `tools/relay.ts:68-124` (assert called at 207).
Subset (`objectSchema`/`requiredFields`/`specInputSchema`) again in `extensions/agenta.ts:52-72`.
The `spec.inputSchema ?? (spec as …).input_schema` fallback (the body of `specInputSchema`) also
inline in `tools/public-spec.ts:24-27`.

Root cause of the fallback: the platform tool catalog emits **snake_case `input_schema`**
(`static_catalog.py`, `op_catalog.py`), while the wire type `ResolvedToolSpec.inputSchema` is
camelCase (`protocol.ts:94`). `customTools` is read in at `run-plan.ts:184` and `pi-assets.ts:55`
with no normalization, so every consumer re-implements the fallback.

## RenderHint contract drift

`static_catalog.py` ships `render: {kind: "connect"}`, but `RenderHint` (`protocol.ts:283-286`)
is only `component | source | spec`. `connect` is off-contract; it flows through untyped because
TS does not runtime-validate inbound JSON. `wire.py` does NOT pin RenderHint as a typed union
(render rides as an opaque dict; no golden fixture references `connect` or `render`), so typing
this is primarily a `protocol.ts` change plus a comment — no golden/`wire.py` churn required.

## `useToolRelay` cost note (#4936 change)

`run-plan.ts:311` changed `useToolRelay` from `executableToolSpecsForRun.length > 0` to
`toolSpecs.length > 0` — required so the relay loop runs for pure-client-tool runs (the loop is
what parks them). On Daytona the loop's `list` is `sandbox.runProcess({command:"ls"})`
(`relay.ts:178-188`) every `RELAY_POLL_MS` (300 ms, `relay.ts:38-40`) — a remote exec ~3×/s for
the whole turn, now also on client-only runs that previously did zero polling.
