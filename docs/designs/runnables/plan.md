# Runnables — Implementation Plan

> Status: draft
> Date: 2026-03-05
> Companion: [gap-analysis.md](./gap-analysis.md), [taxonomy.md](./taxonomy.md)

This document breaks the gap analysis into ordered checkpoints using an **expand-and-contract** migration strategy. Checkpoint 1 focuses on the expand phase — adding new capabilities alongside the existing system without removing anything.

---

## Strategy: Expand and Contract

**Expand:** Add new code, new endpoints, new flags, new URI patterns. The old system continues to work. Nothing breaks.

**Contract:** Remove the old code, old endpoints, old flags, old patterns. Only after the new system is proven and consumers have migrated.

Checkpoint 1 is expand-only. Later checkpoints will handle contraction.

---

## Checkpoint 1: Expand

The goal is to get the new system to feature parity with the legacy system — and beyond — without removing anything. After this checkpoint, the new system is fully functional and the legacy system is still running but no longer needed.

### 1a. URI Taxonomy and Classification (G14, G15, G16)

**What:** Establish URI-derived classification so that `is_custom` and `is_runnable` can be computed from URI + handler/URL presence.

- [ ] Add `is_runnable` as a computed property on workflow DTOs — derived from URI provider + handler/URL presence
- [ ] Add `is_custom` as a computed property on workflow DTOs — derived from `is_custom_uri(uri)`
- [ ] Backfill URIs for human evaluators: default → `agenta:builtin:human:v0`, user-created → `user:custom:{variant_slug}:v{N}`
- [ ] Align URI key with variant slug, URI version with revision version
- [ ] Expose derived classification (`is_custom`, `is_runnable`, `is_builtin`) in API query and revision responses
- [ ] Keep existing `is_custom` and `is_human` flags — they still work, just now redundant with the derived values

**Does not remove:** Stored `is_custom`/`is_human` flags remain. Legacy adapter still runs. Frontend still reads from legacy source.

### 1b. Capability Flags (G4, G8)

**What:** Add capability flags (`can_stream`, `can_annotate`, `can_chat`, `can_verbose`) to `WorkflowFlags` and populate them from handler inspection.

- [ ] Add `can_stream`, `can_annotate`, `can_chat`, `can_verbose` to `WorkflowFlags`
- [ ] Populate capability flags during `inspect_workflow()` — derive from handler metadata (decorator params, interface schema)
- [ ] For builtins: set capability flags in `INTERFACE_REGISTRY` or `CONFIGURATION_REGISTRY`
- [ ] For custom workflows: derive from handler inspection (does it yield? → `can_stream`. Has `annotate=True`? → `can_annotate`. Has `messages` schema? → `can_chat`. Can return either verbose or concise chat payloads? → `can_verbose`)
- [ ] Ensure custom workflows produce explicit schemas during registration (G8) — parity with builtins
- [ ] Store capability flags on revision data so they're available without re-inspecting
- [ ] Expose capability flags in API responses alongside identity flags

**Does not remove:** Identity flags (`is_chat`, `is_evaluator`) remain unchanged. Frontend still reads from legacy source.

### 1c. Command Flags in Invoke Request (G5, G9)

**What:** Add a `commands` dict to the invoke request so callers can specify per-invocation behavior.

- [ ] Add `commands` field to invoke request schema: `{ stream?: boolean, annotate?: boolean, chat?: boolean, verbose?: boolean }`
- [ ] Wire `commands.stream` to the `aggregate` mechanism — `stream=true` returns a stream, `stream=false` forces batch via aggregation
- [ ] Wire `commands.annotate` to the `annotate` mechanism — sets annotation mode on the tracing context
- [ ] Wire `commands.chat` to input format selection — chat-style messages vs completion-style inputs
- [ ] Wire `commands.verbose` to response shaping — `verbose=true` returns the full structured chat payload, `verbose=false` returns the concise output when available
- [ ] Define fallback behavior: command requests a capability the workflow doesn't have → graceful fallback to default mode (batch, no annotation, completion, workflow-default verbosity)
- [ ] Keep decorator-level `aggregate` and `annotate` params as defaults — commands override per-invocation

**Does not remove:** Existing invoke requests without commands still work (default behavior).

### 1d. Route Isolation and Per-Workflow OpenAPI (G3, G13)

**What:** Make each workflow its own namespace with isolated `invoke`, `inspect`, and `openapi.json`.

- [ ] Modify `route()` in `routing.py` to create an isolated sub-application per workflow
- [ ] Add `{path}/openapi.json` endpoint per workflow — OpenAPI 3.x spec reflecting only that workflow's invoke request/response schemas
- [ ] Include capability flags and identity flags in the per-workflow OpenAPI spec (as extensions or in the schema)
- [ ] Ensure multiple `route()` calls on the same codebase produce isolated namespaces

**Does not remove:** Legacy shared `/openapi.json` still exists. Legacy `serving.py` routes still mounted.

### 1e. Catalogs for Predefined Applications and Evaluators (G12a)

**What:** Split the legacy evaluator templates payload into a proper catalog surface, and use the same catalog model for predefined applications/workflows.

- [ ] Add evaluator catalog endpoints modeled after the tools catalog: `/evaluators/catalog/`, `/evaluators/catalog/{entry_key}`, `/evaluators/catalog/{entry_key}/presets/`
- [ ] Add application catalog endpoints with the same shape: `/applications/catalog/`, `/applications/catalog/{entry_key}`, `/applications/catalog/{entry_key}/presets/`
- [ ] Back both domain surfaces with shared workflow catalog primitives so predefined applications and predefined evaluators stay symmetric
- [ ] Split the current `EvaluatorTemplate` DTO into separate catalog-entry, preset, UI-metadata, and runtime-schema contracts
- [ ] Put `uri`, type/discriminator, `is_runnable`, and spec discovery metadata (`inspect_path`, `openapi_path`, or no runtime surface) on catalog entries
- [ ] Define explicit special types for evaluator entries such as human, webhook, custom code, and LLM-as-a-judge instead of inferring from template keys
- [ ] Give `custom code` evaluators the same schema-definition capability as `LLM-as-a-judge` / `ai_critique` evaluators for `schemas.outputs`
- [ ] Define one shared evaluator-workflow `schemas.inputs` contract and persist it explicitly on created evaluator revisions
- [ ] Treat `schemas.parameters` as optional for evaluator catalog entries: supported when needed, omitted when settings are simple or UI-only
- [ ] When creating workflows/evaluators/applications from catalog entries or presets, persist full `schemas.inputs`, `schemas.parameters`, and `schemas.outputs` on the revision data
- [ ] Treat `settings_template` as a UI helper only; revision schemas become the source of truth

**Does not remove:** Existing `/simple/evaluators/templates` can remain as a compatibility endpoint until consumers migrate.

### 1f. Domain-Level Invoke/Inspect (G12)

**What:** Add invoke and inspect endpoints to applications and evaluators routers.

- [ ] Add `POST /applications/invoke` and `POST /applications/inspect` — thin wrappers delegating to `WorkflowsService`
- [ ] Add `POST /evaluators/invoke` and `POST /evaluators/inspect` — thin wrappers delegating to `WorkflowsService`
- [ ] Wire SDK-side `invoke_application`, `inspect_application`, `invoke_evaluator`, `inspect_evaluator` to these routes
- [ ] Consider whether simple routers also need invoke/inspect

**Does not remove:** Workflows-level invoke/inspect still works. Legacy invoke paths still work.

### 1g. Trace Propagation (G6)

**What:** Pass trace context from API to SDK execution.

- [ ] Pass `traceparent` from API request context into SDK invocation
- [ ] For the HTTP path: pass `traceparent` as an HTTP header to the SDK service
- [ ] For the programmatic path: inject trace context into `TracingContext` before invoking
- [ ] Ensure SDK tracing respects incoming parent context

**Does not remove:** Nothing — this is purely additive.

### 1h. Frontend: New Flag Source and Command Support (G11, G17)

**What:** Frontend reads flags from the new system and supports command flags.

- [ ] Add frontend code to read flags from `/inspect` response or API-provided classification in revision responses
- [ ] Support reading capability flags (`can_stream`, `can_annotate`, `can_chat`, `can_verbose`) alongside identity flags
- [ ] Add stream toggle to playground when `can_stream=true` — handle both streaming and batch responses
- [ ] Add chat/completion mode toggle when `can_chat=true` and `is_chat=false`
- [ ] Add verbose/concise response toggle when `can_verbose=true` and `is_verbose=false`
- [ ] Handle streaming responses in playground (progressive rendering, abort/cancel)
- [ ] Handle both concise chat rendering and verbose structured payload rendering
- [ ] Send `commands` dict in invoke requests from playground

**Does not remove:** Legacy `x-agenta.flags` reading still works as fallback. Existing playground behavior unchanged for workflows without capability flags.

---

## Checkpoint 1 Exit Criteria

After checkpoint 1, all of the following are true:

1. Every workflow has a URI (including human evaluators)
2. `is_custom` and `is_runnable` are derivable from URI + handler/URL and exposed in API responses
3. Capability flags (`can_stream`, `can_annotate`, `can_chat`, `can_verbose`) exist and are populated
4. Command flags (`stream`, `annotate`, `chat`, `verbose`) are accepted in invoke requests
5. Each workflow has its own `{path}/invoke`, `{path}/inspect`, `{path}/openapi.json`
6. Applications and evaluators expose catalog endpoints for predefined runnables and presets
7. Code evaluators and AI-critique evaluators have equivalent output-schema definition support
8. Creating from evaluator/application catalog entries persists explicit shared evaluator input schema, optional parameter schema, full output schema, and spec discovery metadata
9. Applications and evaluators have invoke/inspect endpoints
10. Trace context propagates from API to SDK
11. Frontend can read from the new flag source and send command flags
12. **The legacy system still works** — nothing has been removed

---

## Checkpoint 2: Contract (future)

Once checkpoint 1 is validated and consumers have migrated:

- Remove legacy `serving.py` endpoints (`/run`, `/test`, `/generate`, `/openapi.json`)
- Remove `legacy_adapter.py`
- Remove legacy invoke proxy path
- Remove stored `is_custom`/`is_human` flags — use derived values only
- Remove frontend legacy `x-agenta.flags` reading path and schema heuristics
- Remove `create_app()` workaround for route isolation

This checkpoint is intentionally left as a placeholder. The specific contraction steps depend on migration progress and consumer readiness.
