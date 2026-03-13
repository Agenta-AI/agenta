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

### 1b. Workflow Service Flags: Identity and Capability (G4, G8)

**What:** Keep `WorkflowFlags` as the static workflow flag type for identity and capability truth, then add capability flags (`can_stream`, `can_evaluate`, `can_chat`, `can_verbose`) and populate them from handler inspection.

- [ ] Add `can_stream`, `can_evaluate`, `can_chat`, `can_verbose` to `WorkflowFlags`
- [ ] Populate capability flags during `inspect_workflow()` — derive from handler metadata (decorator params, interface schema)
- [ ] For builtins: set capability flags in `INTERFACE_REGISTRY` or `CONFIGURATION_REGISTRY`
- [ ] For custom workflows: derive from handler inspection (does it yield? → `can_stream`. Has evaluate-oriented behavior today wired via `annotate=True`? → `can_evaluate`. Has `messages` schema? → `can_chat`. Can return either verbose or concise chat payloads? → `can_verbose`)
- [ ] Ensure custom workflows produce explicit schemas during registration (G8) — parity with builtins
- [ ] Store capability flags on revision data so they're available without re-inspecting
- [ ] Expose capability flags in API responses alongside identity flags

**Does not remove:** Existing identity flags remain available during expand. `is_evaluator` stays the product/domain identity. Frontend still reads from legacy source.

### 1c. Workflow Request Flags in Invoke Request (G5, G9)

**What:** Introduce a dedicated `WorkflowRequestFlags` type and use it on `WorkflowServiceRequest.flags` as the per-invocation request-flag surface.

- [ ] Add `WorkflowRequestFlags` as a new type
- [ ] Define `WorkflowServiceRequest.flags: WorkflowRequestFlags`
- [ ] Define per-invocation request flags on `WorkflowRequestFlags`: `stream`, `evaluate`, `chat`, `verbose`
- [ ] Keep `WorkflowFlags` reserved for static workflow identity/capability truth
- [ ] Wire `flags.stream` to the `aggregate` mechanism — `stream=true` returns a stream, `stream=false` forces batch via aggregation
- [ ] Wire `flags.evaluate` to the existing evaluate-oriented runtime mechanism (implemented today through `annotate`) — this may set annotation/evaluation mode on the tracing context internally while keeping the external contract named `evaluate`
- [ ] Wire `flags.chat` to input format selection — chat-style messages vs completion-style inputs
- [ ] Wire `flags.verbose` to response shaping — `verbose=true` returns the full structured chat payload, `verbose=false` returns the concise output when available
- [ ] Define fallback behavior: request flag asks for a capability the workflow doesn't have → graceful fallback to default mode (batch, no evaluation, completion, workflow-default verbosity)
- [ ] Keep decorator-level `aggregate` and current internal `annotate` param as defaults during migration — request flags override per invocation

**Does not remove:** Existing invoke requests without request flags still work (default behavior).

### 1d. SDK Local vs Remote Execution Choice

**What:** SDK programmatic invoke methods should accept an explicit execution-location argument so an SDK caller can choose between local execution and remote execution through the configured API/services path.

- [ ] Add an explicit SDK invoke argument for execution location
- [ ] Keep that argument separate from `WorkflowRequestFlags`
- [ ] Support local execution for builtins from the SDK process
- [ ] Support remote execution through the configured API/services path
- [ ] Decide the default mode; current leaning is local-by-default

**Does not remove:** Existing local in-process behavior can remain the default during expand.

### 1e. Route Isolation and Per-Workflow OpenAPI (G3, G13)

**What:** Make each workflow its own namespace with isolated `invoke`, `inspect`, and `openapi.json`.

- [ ] Modify `route()` in `routing.py` to create an isolated sub-application per workflow
- [ ] Add `{path}/openapi.json` endpoint per workflow — OpenAPI 3.x spec reflecting only that workflow's invoke request/response schemas
- [ ] Add SDK discovery helpers for the same documents: `get_workflow_openapi()`, `get_application_openapi()`, `get_evaluator_openapi()`
- [ ] Include capability flags and identity flags in the per-workflow OpenAPI spec (as extensions or in the schema)
- [ ] Ensure multiple `route()` calls on the same codebase produce isolated namespaces

**Does not remove:** Legacy shared `/openapi.json` still exists. Legacy `serving.py` routes still mounted.

### 1f. Catalogs for Predefined Workflows, Applications, and Evaluators (G12a)

**What:** Split the legacy evaluator templates payload into a proper catalog surface, make the workflow catalog the canonical source, and expose application/evaluator catalog views as filtered workflow catalogs.

- [ ] Add canonical workflow catalog endpoints: `/workflows/catalog/`, `/workflows/catalog/{entry_key}`, `/workflows/catalog/{entry_key}/presets/`
- [ ] Add evaluator catalog endpoints modeled as filtered workflow catalog views: `/evaluators/catalog/`, `/evaluators/catalog/{entry_key}`, `/evaluators/catalog/{entry_key}/presets/`
- [ ] Add application catalog endpoints with the same filtered shape: `/applications/catalog/`, `/applications/catalog/{entry_key}`, `/applications/catalog/{entry_key}/presets/`
- [ ] Back both domain surfaces with shared workflow catalog primitives so predefined workflows, applications, and evaluators stay symmetric
- [ ] Replace the current `EvaluatorTemplate` DTO with explicit catalog entry data plus preset bundles
- [ ] Define the concrete catalog shape:
  - list response with `count` and `items`
  - entry fields including `uri`, optional compatibility `key`, optional precomputed `url`, optional `headers`, `name`, `description`, `categories`, workflow flags, and `schemas.inputs` / `schemas.parameters` / `schemas.outputs`
  - optional single-entry fetch returning the same shape for one item
  - presets response that returns override bundles with `parameters`, optional `script`, optional `headers`, and other presettable workflow fields when relevant
- [ ] Make evaluator identity/capability differences visible through workflow flags and URI-driven classification rather than template-key conventions
- [ ] Give `custom code` evaluators the same schema-definition capability as `LLM-as-a-judge` / `ai_critique` evaluators for `schemas.outputs`
- [ ] Define one shared evaluator-workflow `schemas.inputs` contract and persist it explicitly on created evaluator revisions
- [ ] Treat `schemas.parameters` as optional for evaluator catalog entries: supported when needed, omitted when settings are simple or UI-only
- [ ] When clients use catalog entries or presets to populate normal workflow/application/evaluator creation flows, persist full `schemas.inputs`, `schemas.parameters`, and `schemas.outputs` on the revision data
- [ ] Treat `settings_template` as a UI helper only; revision schemas become the source of truth

**Does not remove:** Existing `/simple/evaluators/templates` can remain as a compatibility endpoint until consumers migrate.

### 1fa. Remove Legacy `service` / `configuration` from Workflow Revision Data

**What:** Remove `WorkflowRevisionData.service` and `WorkflowRevisionData.configuration` from the target contract, and migrate remaining code paths to the normalized revision fields (`uri`, `url`, `headers`, `schemas`, `script`, `parameters`, `runtime`).

- [ ] Audit API, SDK, generated client types, migrations, and tests that still read or write `data.service` / `data.configuration`
- [ ] Replace those usages with normalized workflow revision fields
- [ ] Update evaluator creation/defaulting paths that still construct legacy `SimpleEvaluatorData(service=..., configuration=...)`
- [ ] Update or add data migrations if stored legacy revision payloads need normalization
- [ ] Remove the legacy fields from workflow/application/evaluator revision DTOs and generated client types once compatibility coverage is no longer needed

**Does not remove:** Temporary compatibility adapters may remain during the migration window, but the target runnable contract no longer includes these fields.

### 1g. API Control-Plane Dispatch to Runtime Services (G10)

**What:** Treat the API as a control plane that classifies targets and hands runnable execution/discovery toward the runtime `/services` surface instead of making the API container the long-running execution engine.

- [ ] Decide the API-to-services handoff strategy for runnable targets: redirect, gateway/proxy, or another explicit dispatch pattern
- [ ] Route runnable builtin invoke requests toward the runtime `/services` surface
- [ ] Expose all Agenta builtin runtime routes through the `/services` family, not just the current narrow subset
- [ ] Review and standardize the service URL shape
- [ ] Make non-runnable custom targets fail invoke explicitly
- [ ] Keep inspect working for both runnable and non-runnable targets
- [ ] Define whether `openapi.json` is runtime-backed, API-synthesized, or split by target kind
- [ ] Refresh builtin service URLs from URI on reads and writes
- [ ] Refresh builtin input/output schemas from URI/inspect on reads and writes, with caching
- [ ] Avoid blindly overwriting user-owned parameter schema during builtin refresh

**Does not remove:** Current in-process invoke still exists during expand while the target handoff path is added and validated.

### 1h. Domain-Level Invoke/Inspect (G12)

**What:** Add invoke and inspect endpoints to applications and evaluators routers.

- [ ] Add `POST /applications/invoke` and `POST /applications/inspect` — thin wrappers delegating to `WorkflowsService`
- [ ] Add `POST /evaluators/invoke` and `POST /evaluators/inspect` — thin wrappers delegating to `WorkflowsService`
- [ ] Wire SDK-side `invoke_application`, `inspect_application`, `invoke_evaluator`, `inspect_evaluator` to these routes
- [ ] Consider whether simple routers also need invoke/inspect

**Does not remove:** Workflows-level invoke/inspect still works. Legacy invoke paths still work.

### 1i. Passive Incoming Trace Context Support in SDK Runtime

**What:** Keep trace-context handling limited to SDK routing/running so workflow-to-workflow propagation is possible when parent context is already present.

- [ ] Ensure SDK routing/running can accept incoming trace context if present
- [ ] Ensure workflow-to-workflow calls can preserve parent-child trace relationships inside the SDK/runtime layer
- [ ] Do not add any new API-to-SDK propagation work in this checkpoint

**Does not remove:** Nothing — this is purely about preserving passive support in the SDK runtime.

### 1j. Frontend: New Flag Source and Command Support (G11, G17)

**What:** Frontend reads flags from the new system and supports request-time invocation flags.

- [ ] Add frontend code to read flags from `/inspect` response or API-provided classification in revision responses
- [ ] Support reading capability flags (`can_stream`, `can_evaluate`, `can_chat`, `can_verbose`) alongside identity flags
- [ ] Add stream toggle to playground when `can_stream=true` — handle both streaming and batch responses
- [ ] Add evaluate toggle to playground when `can_evaluate=true` and `is_evaluator=false`
- [ ] Add chat/completion mode toggle when `can_chat=true` and `is_chat=false`
- [ ] Add verbose/concise response toggle when `can_verbose=true` and `is_verbose=false`
- [ ] Handle streaming responses in playground (progressive rendering, abort/cancel)
- [ ] Handle evaluation-mode requests and responses distinctly from standard invocation mode
- [ ] Handle both concise chat rendering and verbose structured payload rendering
- [ ] Send request flags in `WorkflowServiceRequest.flags` from playground

**Does not remove:** Legacy `x-agenta.flags` reading still works as fallback. Existing playground behavior unchanged for workflows without capability flags.

---

## Checkpoint 1 Exit Criteria

After checkpoint 1, all of the following are true:

1. Every workflow has a URI (including human evaluators)
2. `is_custom` and `is_runnable` are derivable from URI + handler/URL and exposed in API responses
3. Capability flags (`can_stream`, `can_evaluate`, `can_chat`, `can_verbose`) exist and are populated
4. Request flags (`stream`, `evaluate`, `chat`, `verbose`) are accepted in invoke requests
5. `WorkflowFlags` and `WorkflowRequestFlags` exist as distinct contract types
6. SDK invoke methods expose a local-versus-remote execution choice separate from request flags
7. Each workflow has its own `{path}/invoke`, `{path}/inspect`, `{path}/openapi.json`, and matching SDK OpenAPI getter
8. Workflows expose the canonical catalog for predefined runnables, and applications/evaluators expose filtered catalog views over the same source
9. Code evaluators and AI-critique evaluators have equivalent output-schema definition support
10. Using workflow/application/evaluator catalog data in normal creation flows persists explicit shared evaluator input schema, optional parameter schema, and full output schema
11. Catalog entries expose revision-like discovery fields (`uri`, optional precomputed `url`, optional `headers`, and schemas), while presets stay separate override bundles (`parameters`, optional `script`, optional `headers`, and other presettable fields)
12. Legacy `WorkflowRevisionData.service` and `WorkflowRevisionData.configuration` are removed from the target contract and migrated off concrete code paths
13. Runnable targets can be handed off from the API control plane to the runtime `/services` surface, while non-runnable targets fail invoke but still support discovery
14. Builtin service URLs and builtin input/output schemas are refreshed from URI/inspect with caching, without blindly overwriting user-owned parameter schema
15. Applications and evaluators have invoke/inspect endpoints as filtered wrappers over the workflow family
16. SDK routing/running can honor incoming trace context when present for workflow-to-workflow propagation
17. Frontend can read from the new flag source and send request flags
18. **The legacy system still works** — nothing has been removed

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
