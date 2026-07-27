# Research — how tools reach the model today

Verified 2026-07-20, **re-verified 2026-07-26** against the code cited — every `file:line` below
was re-checked on `main` and holds. Paths are current (`services/runner/`; some docs still say
`services/agent/`).

## The path a platform op takes, end to end

1. **Overlay injects the op set (Python).** The playground build kit is a per-run overlay, not a
   committed field. `build_agent_template_overlay()` (`api/oss/src/core/workflows/build_kit.py`)
   emits `DEFAULT_BUILD_KIT_OPS` — exactly 13 platform ops (`build_kit.py:27`; `discover_tools`,
   `commit_revision`,
   `annotate_trace`, `query_spans`, `test_run`, `discover_triggers`, `create_schedule`,
   `create_subscription`, `list_schedules`, `list_deliveries`, `test_subscription`,
   `remove_schedule`, `remove_subscription`) plus the `request_connection` / `request_input`
   client tools and the `build-an-agent` skill. It is served as the static workflow
   `__ag__build_kit` and also delivered as read-only `additional_context` at
   `api/oss/src/apis/fastapi/applications/router.py` (~L1916). The frontend merges it per run
   (atom `workflowBuildKitOverlayReadyAtomFamily`, on by default via
   `web/oss/src/lib/helpers/dynamicEnv.ts`).

2. **Resolution (Python SDK).** `resolve_tools`
   (`sdks/python/agenta/sdk/agents/platform/resolve.py` → `tools/resolver.py`) turns each
   declared op into a `CallbackToolSpec` carrying a direct `call{method,path,context,args_into}`.
   The op's `context_bindings` (self-targeting fields) are stripped from the model-visible schema
   by `PlatformOp.resolved_input_schema()` (`.../platform/op_catalog.py`) and re-emitted as
   `call.context`. No HTTP round-trip; the catalog fully describes the op. The resolved set rides
   the `/run` wire as `customTools`.

3. **Runner holds every spec privately.** `buildRunPlan` sets `plan.toolSpecs = request.customTools`
   (`services/runner/src/engines/sandbox_agent/run-plan.ts:352`). The runner indexes them by name
   with `toolSpecsByName(specs)` (`services/runner/src/tools/public-spec.ts:34`) — the ONE index
   the relay execute loop, the internal tool-MCP server, and the ACP approval gate all key on.

4. **Advertisement is a SEPARATE projection.** `advertisedToolSpecs(specs)`
   (`public-spec.ts:57`) maps each spec to `{name, description, inputSchema, kind, render,
   timeoutMs}` (`AdvertisedToolSpec`, `public-spec.ts:12`). `inputSchema` is the token weight.
   It is called at exactly two sites:
   - `services/runner/src/engines/sandbox_agent/pi-assets.ts:353` — Pi path; the specs become
     `AGENTA_TOOL_PUBLIC_SPECS`, which the bundled extension (`extensions/agenta.ts`) reads and
     registers as native Pi tools.
   - `services/runner/src/engines/sandbox_agent/environment.ts:721` — Claude/ACP path; the specs
     back the synthetic `agenta-tools` MCP server (`tools/mcp-bridge.ts`, `tool-mcp-http.ts`).

5. **Execution reads the PRIVATE spec, never the advertisement.** For a platform op (direct
   `call`), the relay path runs `executeRelayedTool` (`services/runner/src/tools/relay.ts:318`):
   `assembleBody(spec.call, args, runContext)` (`relay.ts:384`) merges model args → static body →
   `$ctx` context bindings (last, so a bound field always wins); `directCallUrl(...)`
   (`relay.ts:385`, guard in `tools/direct.ts:286`) host-locks to the run's own Agenta origin and
   confines to the `/api` mount; `callDirect(...)` (`relay.ts:392`) sends with the caller
   credential. All keyed by the private `spec` — advertisement is irrelevant to execution.

   **Argument validation is runner-side, against the private spec.**
   `assertRequiredArguments(spec, req.args)` runs in the relay loop at `relay.ts:327` (client shape)
   and `relay.ts:369` (endpoint and handler shapes), before execution. The harness also validates
   pre-call against the *advertised* schema (Pi at `extensions/agenta.ts:318`, MCP at
   `tool-mcp-http.ts:172`), but that is a second, earlier check — not the only one. **Consequence:
   stubbing the *advertisement* alone does not weaken enforcement** (lazy schema); it moves where a
   malformed call is caught. Shrinking the *private* schema does (the diet), because
   `missingRequiredFields` walks `properties` recursively, so nested `required` is only enforced
   while the private schema still describes it.

6. **Permission keys on the per-spec gate.** `decide(gate, plan, stored)`
   (`services/runner/src/permission-plan.ts:138`) → `effectivePermission` (`:125`) resolves the
   spec's own `permission` first, then rule match, then policy default (`allow_reads` →
   read-only op runs, write asks). The gate is built from the resolved op's spec, so approval
   fidelity lives with the private spec, not the advertised name.

## Advertisement consumers

| Harness | Delivery | Consumes `advertisedToolSpecs` at | Notes |
| --- | --- | --- | --- |
| Pi (`pi_core`/`pi_agenta`) | native, via bundled extension | `pi-assets.ts:353` → `AGENTA_TOOL_PUBLIC_SPECS` | No MCP server attached to Pi. |
| Claude (`claude`) | `agenta-tools` MCP server | `environment.ts:721` | Local: HTTP loopback (`tool-mcp-http.ts`). Daytona: in-sandbox stdio shim (`tool-mcp-stdio.ts`). |
| Codex | MCP, same channel as Claude | `environment.ts:721` | MCP-forwarding per `capabilities.ts:99`. PR #5509 open. |

All paths share one projection function, so a change there covers every harness — which is why the
**schema diet** and **lazy schema** are single-site changes. **Activation** is the exception: it is
per-harness (seam 5). Pi mutates its active-tool list in-process; the MCP harnesses need a
`tools/list_changed` notification over a transport that can push. That asymmetry is the whole reason
lazy activation is out of scope while the schema levers ship.

## Measured token cost

**Re-baselined 2026-07-26** (tiktoken `o200k_base`) — full table, method, and reproduction script
in [baseline.md](baseline.md). The 2026-07-17 figures that earlier drafts carried (~15,454 total)
were ~19% low; the catalog grew.

| Op | Tokens | Note |
| --- | ---: | --- |
| `test_run` | 7,777 | embeds the 6,441-token agent-template delta schema; handler-mode (`callRef`) |
| `commit_revision` | 6,878 | embeds the **same** 6,441-token delta schema |
| `query_spans` | 1,578 | filtering DSL `$defs` |
| others (10 ops) | 2,120 | combined; 7 of them under 400 each |
| **all 13 ops** | **18,353** | the "hi" cost |

Two findings reorder the whole project:

- **Concentration.** The top three ops are 88% of the bill. The catalog's *length* is not the
  problem; two ops' schema *depth* is.
- **Duplication.** `_build_agent_template_delta_schema()` (`op_catalog.py:317`) is 6,441 tokens and
  is embedded twice — 12,882 of 18,353, i.e. **70% of the bill is one object counted twice.**

All 13 ops advertise by default, so 18,353 is the live figure. `test_run` is handler-based and
gated by `AGENTA_AGENT_ENABLE_PLATFORM_HANDLERS`, but that flag **defaults ON** — unset and empty
both resolve to enabled, and the resolver skips the op only for an explicit `off`/`false`/`0`
(`platform_tools.py:41`). Earlier drafts said "default off" and carried an alternate 10,576 figure;
that was wrong (see [baseline.md](baseline.md)).

**Handler-mode ops take a different execution shape.** `test_run` is the only handler-mode op
(`_HANDLER_CALL_REFS`, `op_catalog.py:58`). It resolves via `to_call_ref()` to a **`callRef`**, and
`to_call()` explicitly raises for it (`op_catalog.py:175`). So a platform op is *not* always a
direct-`call` spec. This sank the rejected invoker (it could neither identify nor execute
`test_run` — [alternatives.md](alternatives.md)); under the chosen levers it is a non-issue, since each op
keeps its own name and its own execution branch.

### The diet's replacement already exists

`references/config-schema.md` ships as a `SkillFile` on `BUILD_AN_AGENT_SKILL`
(`agenta_builtins.py:740`) — 3,621 tokens of prose and worked examples covering the same config
shape. The skill body **already** instructs the model to read it before its first `commit_revision`
(`agenta_builtins.py:579`) and again on failure (`:711`, `:716`). That reference also states the
commit endpoint does **not** validate the config shape — so the embedded JSON Schema enforces no
server contract. It is advisory duplication of better, on-demand guidance.

## Seams

Which lever touches which:

| seam | diet | lazy schema | lazy activation *(out of scope)* |
| --- | --- | --- | --- |
| 1 advertisement projection | — | **yes** | — |
| 2 private spec index | — | — | active subset only |
| 3 execution | — | — | — |
| 4 permission | — | — | — |
| 5 activation | — | — | **yes, per harness** |
| 7 harness-side validation | shallower | stubbed | — |

The diet changes `input_schema` values in `op_catalog.py` and nothing on this list.

1. **Advertisement projection** (`advertisedToolSpecs`, `public-spec.ts:57`), consumed at
   `pi-assets.ts:353` and `environment.ts:721`. It projects via `specInputSchema(spec)`
   (`tools/spec-schema.ts:39`), not `spec.inputSchema` directly. **This one site is the whole of
   lazy schema** — every harness reads through it.
2. **Private spec index** (`toolSpecsByName`, `public-spec.ts:34`). Stays complete under every
   lever in scope; only the *active* set would change under lazy activation.
3. **Execution — two shapes.** Endpoint-mode ops carry a direct `call`
   (`assembleBody` → `directCallUrl` → `callDirect`); handler-mode `test_run` carries a `callRef`
   and runs through `callAgentaTool` with `applyContextBindings` (`relay.ts:361`). Both run
   unchanged under every lever, because each op is still called by its own name against its own
   spec.
4. **Permission.** Untouched — real names reach every gate, so `readOnlyHint`, `specPermission`,
   name-matched rules (`ruleMatches`, `permission-plan.ts:214`) and the `allow_reads` default
   (`:248`) all behave as today. (The rejected card/menu invoker broke all four; see
   [alternatives.md](alternatives.md).)
5. **Activation, per harness.** Pi: `getAllTools`/`getActiveTools`/`setActiveTools`
   (`extensions/agenta.ts:215`) — in-process, mid-turn, no transport. MCP harnesses:
   `notifications/tools/list_changed`, which requires a server→client push channel — plumbable on
   the stdio shim, absent on the local HTTP server (*"stateless JSON mode… no SSE… 405 for `GET`"*,
   `tool-mcp-http.ts:22`). `initialize` currently advertises `capabilities: {tools: {}}` (`:124`),
   so `listChanged` is not declared. Whether the pinned ACP clients honor it mid-turn is unverified.
   **This seam is why lazy activation is out of scope.**
6. **Client tools stay advertised.** `request_connection` / `request_input` must remain
   model-visible (the browser fulfils them) and are cheap.
7. **Harness-side schema validation.** Pi registers each tool with its real JSON Schema
   (`extensions/agenta.ts:305`) and checks it at `:318`; the MCP server checks at
   `tool-mcp-http.ts:172`. Both are *earlier* copies of a check the relay repeats against the
   private spec (`relay.ts:327`, `:369`), so the diet shallowing this — or lazy schema stubbing it —
   costs an early error message, not enforcement.
8. **Codex.** MCP-forwarding (`capabilities.ts:99`), so it inherits the MCP activation path. It
   wraps calls as `{server, tool, arguments}`, already handled by `unwrapCodexMcpArgs` in
   `storedDecisionKeyShape` (PR #5509). That fix normalized the **arguments** and left the **tool
   name real** — the same rule every lever here follows.
