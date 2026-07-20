# Research — how tools reach the model today

Verified 2026-07-20 against the code cited. Paths are current (`services/runner/`; some docs
still say `services/agent/`).

## The path a platform op takes, end to end

1. **Overlay injects the op set (Python).** The playground build kit is a per-run overlay, not a
   committed field. `build_agent_template_overlay()` (`api/oss/src/core/workflows/build_kit.py`)
   emits `DEFAULT_BUILD_KIT_OPS` — ~13 platform ops (`discover_tools`, `commit_revision`,
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

6. **Permission keys on the per-spec gate.** `decide(gate, plan, stored)`
   (`services/runner/src/permission-plan.ts:138`) → `effectivePermission` (`:125`) resolves the
   spec's own `permission` first, then rule match, then policy default (`allow_reads` →
   read-only op runs, write asks). The gate is built from the resolved op's spec, so approval
   fidelity lives with the private spec, not the advertised name.

## Advertisement consumers

| Harness | Delivery | Consumes `advertisedToolSpecs` at | Notes |
| --- | --- | --- | --- |
| Pi (`pi_core`/`pi_agenta`) | native, via bundled extension | `pi-assets.ts:353` → `AGENTA_TOOL_PUBLIC_SPECS` | No MCP server attached to Pi. |
| Claude (`claude`) | synthetic `agenta-tools` MCP server | `environment.ts:721` | Public metadata only; execution relays back. |

Both paths consume the same projection function. Intercepting it once (or wrapping it at both
call sites behind a flag) covers both harnesses with no harness-specific logic.

## Measured token cost (needs Slice 0 re-baseline)

From the 2026-07-17 investigation (tiktoken `o200k_base`); flagged for re-measure because
`test_run` is handler-gated (`AGENTA_AGENT_ENABLE_PLATFORM_HANDLERS`, default off) and may not
advertise live.

| Op | Tokens | Note |
| --- | --- | --- |
| `test_run` | ~6,521 | embeds the ~5,462-token agent-template delta schema; handler-gated |
| `commit_revision` | ~5,844 | embeds the same ~5,462-token delta schema |
| `query_spans` | ~1,283 | filtering DSL `$defs` |
| others (10) | remainder | — |
| **all ~13 ops** | **~15,454** | the "hi" cost |

Two schemas (`commit_revision` + `test_run`) account for ~11K of the ~15K — hence the schema-diet
slice is a large, low-risk win on its own.

## Seams the plan must pin

1. **Advertisement projection** (`advertisedToolSpecs`, two call sites). Where disclosure hooks.
   Must not alter what execution/permission read.
2. **Private spec index** (`toolSpecsByName`). Must stay COMPLETE — the invoker looks the target
   op up here; execution and the approval gate depend on it.
3. **Direct-call execution** (`relay.ts:318` → `direct.ts`). The invoker must reach this
   unchanged, feeding the target op's private `call`.
4. **Permission decision** (`decide`/`effectivePermission`). The invoker must build the gate from
   the TARGET op's spec, not from itself — otherwise `agenta_op` gates as one tool and writes
   lose their approval prompt.
5. **Identifying disclosure-eligible specs.** A platform op is a `callback`-kind spec with a
   direct `call`. So is a `reference` (workflow) tool (`direct.ts` header). There is no explicit
   "this is a platform op" marker on `ResolvedToolSpec` today, so the runner cannot cleanly tell a
   build-kit op from an author's reference tool without one. Two ways out (Open Question 4):
   a heuristic (collapse all direct-`call` callback specs), or a small marker added by the platform
   resolver (a wire add).
6. **Wire contract mirroring.** If Seam 5 uses a marker, `protocol.ts` + `wire.py` + goldens
   change together (`services/runner/CLAUDE.md`, "The wire contract is mirrored").
7. **Client tools stay advertised.** `request_connection` / `request_input` must remain
   model-visible (the browser fulfils them) and are cheap; disclosure skips them.
