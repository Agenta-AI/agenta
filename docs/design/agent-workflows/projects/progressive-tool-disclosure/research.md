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
direct-`call` spec — which breaks the naive disclosure heuristic (seam 5) and the invoker's
execution path (seam 3).

### The diet's replacement already exists

`references/config-schema.md` ships as a `SkillFile` on `BUILD_AN_AGENT_SKILL`
(`agenta_builtins.py:740`) — 3,621 tokens of prose and worked examples covering the same config
shape. The skill body **already** instructs the model to read it before its first `commit_revision`
(`agenta_builtins.py:579`) and again on failure (`:711`, `:716`). That reference also states the
commit endpoint does **not** validate the config shape — so the embedded JSON Schema enforces no
server contract. It is advisory duplication of better, on-demand guidance.

## Seams the plan must pin

Seams 1–3 and 7 apply to the meta-toolset only. **The schema diet touches none of them** — it
changes `input_schema` values in `op_catalog.py` and nothing else.

1. **Advertisement projection** (`advertisedToolSpecs`, two call sites). Where disclosure hooks.
   Must not alter what execution/permission read. Note it projects via `specInputSchema(spec)`
   (`tools/spec-schema.ts:39`), the single camel/snake accessor — not `spec.inputSchema` directly.
2. **Private spec index** (`toolSpecsByName`, `public-spec.ts:34`). Must stay COMPLETE — the
   invoker looks the target op up here; execution and the approval gate depend on it.
3. **Execution — TWO shapes, not one** (`relay.ts:318` → `executeAllowedRelayedTool`,
   `relay.ts:361`). Endpoint-mode ops carry a direct `call` and go through
   `assembleBody` → `directCallUrl` → `callDirect`. Handler-mode ops (`test_run`) carry a
   **`callRef`** instead and fall through to `callAgentaTool` with `applyContextBindings`. An
   invoker that only forwards `spec.call` cannot execute `test_run` at all. Note also that
   `executeAllowedRelayedTool` re-runs `assertRequiredArguments(spec, req.args)` (`relay.ts:369`) —
   the invoker must pass the **target** spec and the **unwrapped** args, or required-field
   validation silently degrades to the invoker's loose schema.
4. **Permission decision — four sites, not one.** This is the project's dominant risk and has its
   own document: **[security.md](security.md)**. In brief: the gates run *upstream of and
   independently from* the relay execution path, each resolving a spec from the advertised name, in
   `relay-guard.ts:53`, `acp-interactions.ts:516` (Claude), `acp-interactions.ts:456` (Pi,
   fail-closed at `:473`), and `extensions/agenta.ts:318` (in-sandbox). Four inputs to
   `effectivePermission` degrade at once — `readOnlyHint`, `specPermission`, name-matched policy
   rules (`ruleMatches`, `permission-plan.ts:214`), and the `allow_reads` default
   (`permission-plan.ts:248`).
5. **Identifying disclosure-eligible specs — harder than it looks.** Platform ops do **not** share
   one shape: endpoint-mode ops carry a direct `call`, handler-mode `test_run` carries a `callRef`.
   Meanwhile a `reference` (workflow) tool *also* carries a direct `call`, and a gateway (Composio)
   tool *also* carries a `callRef`. So neither field identifies a platform op:

   | | direct `call` | `callRef` |
   | --- | --- | --- |
   | **platform op** | 12 endpoint-mode ops | `test_run` |
   | **not a platform op** | author's `reference` tool | gateway (Composio) tool |

   A "collapse all direct-`call` callback specs" heuristic therefore **misses `test_run`** — 7,777
   tokens, 42% of the bill, the single largest target — while over-collapsing an author's reference
   tools. There is no explicit "this is a platform op" marker on `ResolvedToolSpec` today. See
   Open Question 4; the marker is now the recommended route, not the fallback.
6. **Wire contract mirroring.** If Seam 5 uses a marker, `protocol.ts` + `wire.py` + goldens change
   together (`services/runner/CLAUDE.md`, "The wire contract is mirrored").
7. **Client tools stay advertised.** `request_connection` / `request_input` must remain
   model-visible (the browser fulfils them) and are cheap; disclosure skips them.
8. **Harness-side schema validation.** Pi registers each tool with its real JSON Schema
   (`registerTool({parameters: specInputSchema(spec)})`, `extensions/agenta.ts:305`). Both the diet
   and the meta-toolset weaken this — the diet by shallowing the schema, the meta-toolset by making
   `args` opaque. Bounded for the diet (the server does not validate the config shape either);
   for the meta-toolset it must be recovered by re-validating against the target spec.
