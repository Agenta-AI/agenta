# Plan — client-tool cleanup + Claude `request_connection` delivery

Status: DRAFT for review (revised after Codex xhigh review). No code yet. Evidence in `research.md`.

## Goal

1. Make `client` tools (browser-fulfilled, e.g. `request_connection`) work on the **Claude**
   harness, not Pi only — advertise to the model, park on call, resume from the browser result.
2. Guarantee **no silent drop**: a combo that genuinely cannot deliver a client tool (Claude +
   Daytona) carries a permanent, honest error — nothing breaks quietly.
3. Collapse the duplication the feature left behind: one set of schema helpers, one client-tool
   park seam, one emit site; delete the dead ACP branch (last, once tests prove the new path).
4. Land the owner's decisions: typed `connect` render hint, required-field validation stays on,
   `publicToolSpecs` renamed.

## Decisions baked in (not up for re-debate)

- `render: {kind: "connect"}` becomes a **first-class typed member** of the `RenderHint` union.
- **Required-field validation stays ON** for client tools. A client tool's `required` fields are
  the model-supplied inputs that *start* the browser flow; fields the browser fills must simply
  not be in the model-visible `required` set. Fix is correct schema authoring, not special-casing.
- Rename `publicToolSpecs` → `advertisedToolSpecs` (it now returns ALL advertisable specs,
  including client, not just executable ones).
- **No interim stopgap gate for local Claude.** Build the real local-Claude delivery directly.
- **Permanent narrow guard for Claude + Daytona only** (loopback MCP is skipped on Daytona,
  `mcp.ts:230`, so client tools cannot be delivered there). See "Gate decision" below — flagged
  for the owner to confirm.  [[NO. THERE SHOULD BE NO DIFFERENCE BETWEEN DAYTONA AND LOCAL CLAUDE]]

## The Claude delivery mechanism (the core design)

### The problem in one line

Pi advertises tools through its bundled extension and parks via the runner's file relay; Claude
takes tools over an internal loopback **MCP** server (`tool-mcp-http.ts`) and has no park step.
MCP `tools/call` is a synchronous request/response — there is no "pause across a turn" built in,
and a normal MCP result must NOT be sent for a parked call.

### Fulfillment point: the MCP `tools/call` handler (Codex-confirmed)

Deliver client tools to Claude over the existing internal loopback MCP server, and **fulfill the
park inside the `tools/call` handler** via one shared client-tool seam (Phase 3) that the Pi
file-relay loop also uses. Steps:

1. **Advertise.** Stop filtering `client` out of the Claude channel, and fix the schema bug:
   - `tools/tool-mcp-http.ts:96-97` — include `client` specs in `tools/list`.
   - `tools/tool-mcp-http.ts:101-102` — advertise via the shared `specInputSchema(s)` accessor,
     NOT `s.inputSchema`. Today snake-case `input_schema` (every platform-catalog tool, incl.
     `request_connection` AND `commit_revision`) advertises an EMPTY schema to Claude — a live
     bug independent of client tools. Folded into the Phase 2 schema cleanup.
   - `tools/mcp-bridge.ts:93` — `buildToolMcpServers` must start the server when the run carries
     client tools too (today an all-`client` list returns `{servers: [], close}` → delivers
     nothing).

2. **Park on call (the crux — redesigned).** In `tool-mcp-http.ts` `tools/call` (108-147), branch
   on `spec.kind` BEFORE relaying:
   - First, `assertRequiredArguments(spec, params.arguments)` (shared helper) so an under-specified
     call returns a normal MCP tool error and the model retries — same guard the Pi path has.
   - `client` → call the injected `clientToolRelay.onClientTool(...)` **directly** (NOT through
     `runResolvedTool` → file relay). Outcomes:
     - **`park`** → the handler must emit **NO JSON-RPC result**. It returns a dedicated
       `MCP_PARKED` sentinel; the request listener, seeing it, **deterministically aborts the
       in-flight HTTP request** (`res.destroy()` / socket destroy) with no body written, then
       returns. The shared seam has already emitted the `interaction_request` and called `onPark`
       (→ `destroySession`, the proven Claude park, `sandbox_agent.ts:488-497`). Because the
       socket is destroyed by US (not left to later teardown) and no result is sent, Claude cannot
       settle or clobber the pending widget, and the turn ends `paused`.
     - **`{output}`** (resume turn, if the model re-calls) → return the browser's structured output
       as MCP `content`.
     - **`deny`** → return an `isError` MCP result with a refusal string.
   - non-`client` → unchanged (`runResolvedTool` relay).

   **Why a result is never sent on park, and why we abort rather than hang:** Codex flagged that
   `destroySession` does NOT reliably abort an in-flight loopback `tools/call` (the HTTP handler
   awaits its own work, has no abort signal; returning a result risks double-resolve; relying on
   later `close()` is racey, and ANY normal result lets Claude settle/clobber the pending widget
   before the paused turn is observed). So the handler aborts its own request synchronously on
   park. For robustness we also thread an **`AbortSignal`** into `startInternalToolMcpServer` that
   the engine fires on park/teardown, so any in-flight handler that has not yet returned is
   cancelled — belt and suspenders.

3. **Resume.** The browser result returns next turn as a `tool_result`. A **separate client-tool
   output store** (Phase 3, not the approval map) feeds it back. Whether Claude re-calls the tool
   on cold-replay (MCP handler returns `{output}`) or sees the result already in replayed history
   (no re-call) is a live-verification item — the store is correct either way.

### Correlation (Codex point 2)

Do not rely on name+args alone. Maintain an **optional correlation index** populated from ACP
`tool_call` updates in the engine's `session.onEvent` (`sandbox_agent.ts:463-467`): map the live
tool-call's name (and/or canonical name+args key) → the real ACP `toolCallId`. The shared emit
helper consults it so the `client_tool` interaction attaches to Claude's real tool-call bubble
when the stream surfaced it; the MCP-minted `randomUUID` / name+args is the **cold-replay
fallback** only. Enforce **first-park-wins** (already guaranteed by the idempotent `onPark`,
`sandbox_agent.ts:489`; assert it in the seam too).

### Resume storage (Codex point 3)

`ApprovalDecisions = Map<string, unknown>` (`responder.ts:113`) currently overloads BOTH permission
decisions (`"allow"`/`"deny"`) and client-tool outputs, so (a) a client output whose value is the
string `"allow"`/`"deny"` collides with permission semantics (`responder.ts:218-223, 387-410`), and
(b) two identical name+args calls overwrite each other. Fix:
- Add `extractClientToolOutputs(request)` producing a **separate store**, distinct from
  `extractApprovalDecisions`. Value is the raw browser output (no allow/deny coercion).
- Key by `parkedCallKey(name, args)` but store a **FIFO list per key** so duplicate identical
  calls are consumed in order instead of overwriting.
- `HITLResponder` takes `decisions` (permissions) AND `clientOutputs` (client tools) as two
  distinct maps; `onClientTool` reads only `clientOutputs`, `onPermission` only `decisions`.

### Why this and not the alternatives

- **vs. "just remove the filters."** Routes Claude through `runResolvedTool` → file relay → the
  existing loop park, but leaves a 60 s zombie `relayToolCall` poll after teardown and a broken
  toolCallId correlation, and the file-relay loop's park sends no MCP result anyway only by
  accident of hanging. Parking directly in the handler (deterministic abort) avoids all of this.
- **vs. park at the ACP permission gate (Option 1).** Could fix `clientToolSpecOf` to look the
  spec up by NAME and park in `permissions.ts`, but resume still needs the MCP handler to return
  output, so it needs both hooks. Kept as the documented fallback if the in-handler abort proves
  unclean in live testing.

---

## Phases (Codex-revised order)

Dependency spine: typed `connect` → schema cleanup (incl. tool-mcp-http) → extract the shared
client-tool helper → implement Claude → **delete the dead permission branch LAST**. Phase 4
depends on the helper (Phase 3), NOT on deleting the dead branch.

### Phase 1 — Typed `connect` render hint (small, independent)

Add `| { kind: "connect" }` to `RenderHint` (`protocol.ts:283-286`) with a one-line comment that
client tools use it to request a connect widget. No `wire.py`/golden change (render is opaque
there; confirmed no golden references `connect` or `render`).
Risk: minimal.

### Phase 2 — Schema cleanup + rename (pure refactor, includes the empty-schema bug fix)

**2a. New `services/agent/src/tools/spec-schema.ts`** exporting `objectSchema`, `requiredFields`,
`specInputSchema`, `missingRequiredFields`, `assertRequiredArguments`. Importers delete their copies:
- `tools/dispatch.ts:51-107` → import.
- `tools/relay.ts:68-124` → import.
- `extensions/agenta.ts:52-72` → import (keep `promptSnippet`/`promptGuidelines` local).
- `tools/public-spec.ts:24-27` → use `specInputSchema(spec)`.
- **`tools/tool-mcp-http.ts:101-102` → use `specInputSchema(s)`** (the empty-schema advertisement
  bug). This is the line that makes Claude see real schemas for platform-catalog tools.

**2b. Normalize `input_schema` → `inputSchema` at ingestion.** Where `request.customTools` is read
into `ResolvedToolSpec[]` (`run-plan.ts:184`, `pi-assets.ts:55`), normalize snake→camel once
(`normalizeToolSpecs()` in spec-schema.ts) so no consumer needs the fallback. If this perturbs the
wire-contract goldens, defer 2b and keep `specInputSchema` as the single shared accessor (2a +
the tool-mcp-http fix already eliminate the live bug).

**2c. Rename `publicToolSpecs` → `advertisedToolSpecs`** (`public-spec.ts:38`, caller
`pi-assets.ts:54`). Keep `executableToolSpecs` (still the gatekeeper for execute paths).

Risk: low; `tsc` + `pnpm test` catch breakage. **This phase alone fixes the empty-schema bug for
all platform-catalog tools over Claude.**

### Phase 3 — Extract the shared client-tool seam (new `client-tools.ts`)

**3a. New `engines/sandbox_agent/client-tools.ts`** (NOT `permissions.ts` — that owns ACP
permission reverse-RPC only). Exports:
- `buildClientToolRelay({ responder, run, onPark, toolCallIndex })` → returns the `ClientToolRelay`
  shape; on `park` calls `emitClientToolInteraction` then `onPark` (first-park-wins).
- `emitClientToolInteraction(run, { id, toolCallId, toolName, input, render })` — the single
  definition of the `interaction_request kind=client_tool` payload (consulting the correlation
  index for the real toolCallId).

**3b. Move the `ClientToolRelay` type OUT of `relay.ts`** (currently `relay.ts:62-65`) into
`client-tools.ts` (or `protocol.ts`/`responder.ts`), so the MCP path does not conceptually depend
on the file-relay module. `relay.ts` imports the type from the new home.

**3c. Rewire the Pi relay loop** (`sandbox_agent.ts:555-588`) to use `buildClientToolRelay(...)`
instead of the inline callback — behavior-preserving for Pi.

**3d. Separate resume store + correlation index** (designs above): `extractClientToolOutputs`,
`HITLResponder` two-map constructor, the `toolCallIndex` from `session.onEvent`.

Do NOT delete the dead ACP branch yet.
Risk: low-medium; existing relay/permission tests + new seam tests guard it.

### Phase 4 — Deliver client tools to Claude (the feature)

Plumb the Phase-3 `clientToolRelay` + correlation index + abort signal through
`buildSessionMcpServers` (`mcp.ts:204`) → `buildToolMcpServers` (`mcp-bridge.ts:85`) →
`startInternalToolMcpServer` (`tool-mcp-http.ts:181`). Un-filter client tools (Phase 2 fixed the
schema), add the `kind === "client"` branch to `tools/call` with required-arg validation and the
**no-result park + deterministic abort** (design above).

**Gate decision — Claude + Daytona permanent guard:** on Daytona the loopback MCP server is skipped
(`mcp.ts:230`), so client tools cannot be delivered to Claude there. Add a **permanent** fail-loud
gate (`run-plan.ts`, beside the `*_UNSUPPORTED_MESSAGE` gates ~224-234): a run with a `client` tool
on Daytona+non-Pi (a harness that consumes tools over MCP) errors with
`CLIENT_TOOL_DAYTONA_UNSUPPORTED_MESSAGE` ("client tools require the local Claude path; not
deliverable on Daytona"). This is the only honest guard — NOT a stopgap for local Claude.
**Owner to confirm:** is hard-erroring Claude+Daytona-with-client-tools acceptable, or must it be
supported later (larger work — a Daytona client-tool delivery channel)? [[[IT MUST BE SUPPORTED NOW. WHY IS DAYTONA NOT SUPPORTED?]]]

Risk: medium — the in-handler abort / no-result-before-finish behavior is the live unknown.

### Phase 5 — Delete the dead ACP permission branch (LAST)

Only after Phase 4 tests prove the new path covers BOTH Pi and Claude: delete
`permissions.ts:64-97` plus `clientToolSpecOf` / `clientToolName` / `clientToolReply` (142-158),
now unreferenced. (Confirmed unreachable + untested in `research.md`.)
Risk: low (removing proven-dead code after the replacement is green).  [[ I DONT UNDERSTAND THIS. PLEASE PROVIDE MORE INFORMATIN ABOUT WWHAT THIS DONE]]

### Phase 6 — Polish (lower priority)

**6a. Daytona relay poll backoff.** `useToolRelay = toolSpecs.length>0` makes the loop poll for
client-only runs; on Daytona that's a remote `ls` ~3×/s (`relay.ts:178-188, 38-40`). Add a modest
backoff (grow `RELAY_POLL_MS` after N idle polls, cap ~1-2 s) at `relay.ts:321-336`.  [[[WHAT IS THIS POLL BACKOFF EXPLAIN IT BETTER]]]

**6b. Parked-relay comment.** One line at the relay early-return (`relay.ts:309`) that a parked
client tool deliberately writes no `.res.json`; the child poll is reclaimed by teardown.

---

## Risks & open questions

1. **No-result-before-finish (Phase 4, the crux).** The in-handler deterministic abort must emit
   no MCP tool result for a parked call and leave the widget pending. VERIFY live + a unit test
   (below). Fallback: park at the ACP permission gate (Option 1).
2. **Abort reliability.** `destroySession` alone does not abort an in-flight loopback `tools/call`;
   the handler aborts its own request (socket destroy) and an `AbortSignal` cancels any other
   in-flight handler. Confirm no double-resolve / no `unhandledRejection`.
3. **Resume re-call vs replayed history (Phase 3/4).** Whether Claude re-calls the client tool on
   cold-replay or sees the result in history. The separate client-output store is correct either
   way; confirm which path fires.
4. **Correlation availability.** The MCP `tools/call` lacks Claude's ACP tool-call id; the
   correlation index supplies it when the ACP stream surfaced the call, else the widget renders
   standalone (Vercel synthesizes a tool part, `stream.py:454-460`). Confirm UX.
5. **Claude + Daytona.** Permanent guard, not built. Owner to confirm acceptability.
6. **Phase 2b wire-contract.** If snake→camel normalization perturbs goldens, defer 2b.

## Verification (this becomes implement-feature + debug-local-deployment)

Unit (`services/agent`, `pnpm test` + `pnpm run typecheck`):
- spec-schema helpers (Phase 2): required-field detection incl. nested objects; snake/camel input.
- **tool-mcp-http advertisement (Phase 2): a snake-case `input_schema` platform tool advertises a
  NON-empty schema in `tools/list`** (regression for the empty-schema bug).
- **No-tool-result-before-finish (Phase 4): a parked Claude client tool produces NO JSON-RPC
  `result` for that `tools/call` and the request is aborted, with `onPark` called exactly once,
  before the turn finishes.**
- **Required-arg validation in the MCP client branch (Phase 4): an under-specified client call
  returns a normal MCP tool error, not a park.**
- **Resume-collision handling (Phase 3): two identical name+args client calls each resolve from
  the FIFO store; a client output literally `"allow"` is returned as output, never read as a
  permission decision.**
- `emitClientToolInteraction` payload + correlation: attaches to the indexed toolCallId when
  present, falls back to name+args; first-park-wins.
- Pi relay-loop park unchanged after the Phase-3 rewire (behavior-preserving).
- Wire/golden contract unchanged (or deliberately updated for `connect` if pinned — it isn't).

Live (`debug-local-deployment`, EE dev stack; QA-credit + sandbox-hygiene rules — cheap models,
local + sidecar, no Daytona without confirmed credits):
- **Pi regression:** `request_connection` still parks, widget renders, resume completes.
- **Claude (local sidecar) — the acceptance test:** model calls `request_connection`; connect
  widget renders; turn ends paused; the parked call shows NO tool result; fulfilling in the
  browser resumes and the agent continues with the connection.
- **Claude `commit_revision` over MCP:** now advertises a real (non-empty) schema (Phase 2 win).
- **Claude with NO client tool:** unchanged (gateway tools over MCP still work).
- **Claude + Daytona + client tool:** permanent honest error, not a silent empty delivery.
- Capture one green Claude run as an `agent-replay-test` to pin the round-trip.  [[NONO DAYTONA SHOULD WORK]]

## Out of scope

- Building a Claude + Daytona client-tool delivery channel (guarded, pending owner decision).
- Any change to the `commit_revision` / patch-commit logic in #4936 beyond the schema-advertisement
  fix it benefits from.
