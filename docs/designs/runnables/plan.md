# Runnables — Implementation Plan

> Status: draft
> Date: 2026-03-05
> Companion: [gap-analysis.md](./gap-analysis.md), [taxonomy.md](./taxonomy.md)

This document breaks the gap analysis into ordered checkpoints using an **expand-and-contract** migration strategy. The current runnable workstream is no longer expand-only: checkpoint 1 now includes selected contract removals and code-path contractions where the target runnable model replaces legacy surfaces.

---

## Strategy: Expand and Contract

**Expand:** Add new code, new endpoints, new flags, new URI patterns. The old system continues to work. Nothing breaks.

**Contract:** Remove the old code, old endpoints, old flags, old patterns. Only after the new system is proven and consumers have migrated.

**Compatibility rule:** When checkpoint 1 introduces a backward-incompatible change, the compatibility obligation must be handled at the data schema / migration level: DB migrations, persisted-payload rewrites, read-time normalization, generated-type alignment, or an explicit no-migration decision. Preserving every legacy code path or API wrapper in the codebase is not the default compatibility mechanism.

Checkpoint 1 is a mixed migration checkpoint, not an expand-only checkpoint. Later checkpoints may continue contraction once the required migration work is complete.

---

## Checkpoint 1: Mixed Migration

The goal is to get the new system to feature parity where needed while allowing targeted removals and contract simplifications already adopted by the branch. When those changes are backward-incompatible, compatibility must be handled through schema/data migration work rather than mandatory legacy code-path preservation.

### 1a. URI Taxonomy and Derived Classification (G14, G15, G16)

**What:** Establish URI-derived classification so that authored identity flags disappear from the primary contract.

- [ ] Add URI-derived classification helpers for builtin vs custom families
- [ ] Derive `is_custom` from URI family rather than from authored revision flags
- [ ] Derive `is_human` from the `agenta:custom:annotation:v0` family rather than from authored revision flags
- [ ] Introduce `agenta:custom:invocation:v0` for Agenta-managed custom invocation definitions created through the simple-trace path
- [ ] Backfill URIs for human/custom annotation families, Agenta-managed custom invocation families, and any remaining no-URI rows
- [ ] Expose derived classification in inspect/query/revision responses
- [ ] Treat stored workflow revision flags as materialized metadata only, never as the primary authored source of truth

**Does not remove:** Materialized legacy flags may remain stored during expand, but they are no longer the contract input.

### 1b. HTTP Content Negotiation for Streaming and Batching (G4, G5, G9)

**What:** Remove stream/batch command flags from the primary contract and use HTTP media types instead.

- [ ] Define supported response media types:
  - `application/json`
  - `text/event-stream`
  - `application/x-ndjson`
  - `application/jsonl`
- [ ] Make runtime invoke honor `Accept` header negotiation
- [ ] Fail explicitly when a runnable cannot satisfy the requested response media type
- [ ] Remove stream/batch command semantics from workflow request flags
- [ ] Keep caller-side batching / aggregation utilities for consumers that want batched behavior on top of streaming responses
- [ ] Ensure SDK programmatic invoke exposes the same response-mode choices as HTTP runtime invoke

**Does not remove:** Existing default JSON invocation still works during expand.

### 1c. Schema-Derived Chat / Message Semantics (G4, G8, G17)

**What:** Remove chat/verbose command and capability flags from the primary contract and infer chat/message behavior from schemas and OpenAPI.

- [ ] Add explicit `x-` schema parameters for fields that represent `message` or `messages`
- [ ] Define one shared heuristic for input schemas and output schemas:
  - direct top-level `message` / `messages`
  - or top-level object properties annotated with the same `x-` schema parameter
- [ ] Use that heuristic to drive rolling conversation behavior in the frontend and SDK helpers
- [ ] Stop treating `is_chat`, `can_chat`, `chat`, `is_verbose`, and `verbose` as primary authored contract flags
- [ ] Keep any remaining materialized chat metadata derived from schema/OpenAPI truth only

**Does not remove:** Existing chat-oriented rows can still be recognized during migration, but from schemas/URI rather than from authored flags.

### 1d. Evaluation / Annotation Semantics (G4, G9)

**What:** Remove evaluator/evaluate command flags from the primary contract and separate runtime observability classification from URI/schema classification.

- [ ] Stop treating `is_evaluator`, `can_evaluate`, and `evaluate` as primary authored contract flags
- [ ] For builtins, derive evaluator identity/capability from URI family / registry truth
- [ ] For `agenta:custom:annotation:v0`, resolve/create evaluator-backed simple traces
- [ ] For `agenta:custom:invocation:v0`, resolve/create application-backed simple traces
- [ ] For `user:custom` and `agenta:custom` families, allow evaluator-related metadata to remain user-owned or URI-owned materialized metadata as appropriate
- [ ] Keep trace type terminology as:
  - `invocation` when no trace links are present
  - `annotation` when the trace has links
- [ ] Move annotation detection to trace ingestion / trace parsing rather than evaluator flags

**Does not remove:** Lower-level runtime/tracing can still use `annotation` terminology internally during expand.

### 1e. Route Isolation (G13)

**What:** Make each workflow its own namespace with isolated `invoke` and `inspect`.

- [ ] Modify `route()` in `routing.py` to create an isolated sub-application per workflow
- [ ] Ensure multiple `route()` calls on the same codebase produce isolated namespaces

**Not included:** Per-route `openapi.json` is dropped — `/inspect` is the sole discovery surface.
**Does not remove:** Legacy shared `/openapi.json` still exists. Legacy `serving.py` routes still mounted.

### 1f. Catalogs for Predefined Workflows, Applications, and Evaluators (G12a)

**What:** Split the legacy evaluator templates payload into a proper catalog surface, make the workflow catalog the canonical source, and expose application/evaluator catalog views as filtered workflow catalogs.

- [ ] Add canonical workflow catalog endpoints: `/workflows/catalog/`, `/workflows/catalog/{entry_key}/presets/`
- [ ] Add evaluator catalog endpoints modeled as filtered workflow catalog views: `/evaluators/catalog/`, `/evaluators/catalog/{entry_key}/presets/`
- [ ] Add application catalog endpoints with the same filtered shape: `/applications/catalog/`, `/applications/catalog/{entry_key}/presets/`
- [ ] Back both domain surfaces with shared workflow catalog primitives so predefined workflows, applications, and evaluators stay symmetric
- [ ] Replace the current `EvaluatorTemplate` DTO with explicit catalog entry data plus preset bundles
- [ ] Define the concrete catalog shape:
  - list response with `count` and `items`
  - entry fields including `uri`, optional compatibility `key`, optional precomputed `url`, optional `headers`, `name`, `description`, `categories`, workflow flags, and `schemas.inputs` / `schemas.parameters` / `schemas.outputs`
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
- [ ] If normalized flat fields already exist, prefer them as the source of truth and drop the redundant nested legacy fields
- [ ] If only nested legacy fields exist in stored data, hydrate the normalized flat fields from them during migration
- [ ] Update evaluator creation/defaulting paths that still construct legacy `SimpleEvaluatorData(service=..., configuration=...)`
- [ ] Update or add data migrations if stored legacy revision payloads need normalization
- [ ] Remove the legacy fields from workflow/application/evaluator revision DTOs and generated client types once compatibility coverage is no longer needed

**Does not remove:** Temporary compatibility adapters may remain during the migration window, but the target runnable contract no longer includes these fields.

### 1g. API Control-Plane Dispatch to Runtime Services (G10)

**What:** Treat the API as a control plane that resolves targets and calls the runtime `/services` surface instead of making the API container the long-running execution engine or exposing runnable `/invoke` or `/inspect` routes itself.

- [ ] Call the target runtime `/services/.../invoke` endpoint directly from API and worker containers
- [ ] Route runnable builtin invoke requests toward the runtime `/services` surface
- [ ] Expose all Agenta builtin runtime routes through the `/services` family, not just the current narrow subset
- [ ] Review and standardize the service URL shape
- [ ] Make non-runnable custom targets fail invoke explicitly
- [ ] Call the target runtime `/services/.../inspect` endpoint directly when live discovery is needed
- [ ] Keep inspect working for both runnable and non-runnable targets
- [ ] Refresh builtin service URLs from URI on reads and writes
- [ ] Refresh builtin input/output schemas from URI/inspect on reads and writes, with caching
- [ ] Avoid blindly overwriting user-owned parameter schema during builtin refresh

**Does not remove:** Legacy compatibility routes may remain during migration, but the target runnable contract is runtime `/services`, not API-owned runnable endpoints.

### 1h. Domain-Level Invoke/Inspect (G12)

**What:** Do not add runnable invoke/inspect endpoints to applications and evaluators routers. Domain-level services may still offer filtered helpers over workflow discovery and persistence, but runtime execution and live inspect belong to `/services`.

- [ ] Keep applications and evaluators as filtered projections over workflow persistence/query surfaces
- [ ] Route runtime execution and live inspect through `/services` instead of adding API endpoints
- [ ] Keep SDK-side application/evaluator helpers aligned with the services-backed workflow path

**Does not remove:** Workflow-level control-plane helpers may remain in the API service layer while they hand off to `/services`.

### 1i. Passive Incoming Trace Context Support in SDK Runtime

**What:** Keep trace-context handling limited to SDK routing/running so workflow-to-workflow propagation is possible when parent context is already present.

- [ ] Ensure SDK routing/running can accept incoming trace context if present
- [ ] Ensure workflow-to-workflow calls can preserve parent-child trace relationships inside the SDK/runtime layer
- [ ] Do not add any new API-to-SDK propagation work in this checkpoint

**Does not remove:** Nothing — this is purely about preserving passive support in the SDK runtime.

### 1j. Frontend: Inspect/OpenAPI Truth and Content Negotiation (G11, G17)

**What:** Frontend stops depending on primary execution flags and instead uses inspect/OpenAPI truth plus explicit response media-type negotiation.

- [ ] Add frontend code to read derived metadata from `/inspect` and revision/query responses
- [ ] Add frontend code to read message/chat affordances from schemas / OpenAPI `x-` parameters
- [ ] Send the correct `Accept` header for JSON, SSE, NDJSON, or JSONL responses
- [ ] Handle streaming responses in playground (progressive rendering, abort/cancel)
- [ ] Fail explicitly and clearly when the runnable cannot satisfy the requested response media type
- [ ] Add client-side batching / aggregation utilities where the frontend wants batched semantics on top of a streaming-capable runnable
- [ ] Use schema/OpenAPI heuristics to drive rolling chat conversation behavior

**Does not remove:** Legacy `x-agenta.flags` reading may remain as a temporary fallback during expand.

---

## Checkpoint 1 Exit Criteria

After checkpoint 1, all of the following are true:

1. Every workflow has a URI (including human evaluators)
2. `is_custom` / `is_human` style identity is derived from URI families and exposed in API responses as derived truth or materialized metadata
3. Invoke supports explicit response media-type negotiation for JSON, SSE, NDJSON, and JSONL
4. Unsupported requested media types fail explicitly
5. Chat/message behavior is derivable from schemas / OpenAPI rather than authored primary flags
6. Trace ingestion can classify `annotation` from trace links independently of runnable flags
7. Each workflow has its own `{path}/invoke` and `{path}/inspect` as isolated namespaces
8. Workflows expose the canonical catalog for predefined runnables, and applications/evaluators expose filtered catalog views over the same source
9. Code evaluators and AI-critique evaluators have equivalent output-schema definition support
10. Using workflow/application/evaluator catalog data in normal creation flows persists explicit shared evaluator input schema, optional parameter schema, and full output schema
11. Catalog entries expose revision-like discovery fields (`uri`, optional precomputed `url`, optional `headers`, and schemas), while presets stay separate override bundles (`parameters`, optional `script`, optional `headers`, and other presettable fields)
12. Legacy `WorkflowRevisionData.service` and `WorkflowRevisionData.configuration` are removed from the target contract and migrated off concrete code paths
13. Runnable targets are invoked and inspected through the runtime `/services` surface, while non-runnable targets fail invoke but still support discovery
14. Builtin service URLs and builtin input/output schemas are refreshed from URI/inspect with caching, without blindly overwriting user-owned parameter schema
15. Applications and evaluators remain filtered workflow projections; runtime invoke/inspect are not API-owned domain endpoints
16. SDK routing/running can honor incoming trace context when present for workflow-to-workflow propagation
17. Frontend can read from inspect truth and send negotiated response headers
18. **The legacy system still works** — nothing has been removed

---

## Checkpoint 2: Contract (future)

Once checkpoint 1 is validated and consumers have migrated:

- Remove legacy `serving.py` endpoints (`/run`, `/test`, `/generate`, `/openapi.json`)
- Remove `legacy_adapter.py`
- Remove legacy invoke proxy path
- Remove authored identity/capability/command flag reliance from the runnable contract
- Remove frontend legacy `x-agenta.flags` reading path
- Remove `create_app()` workaround for route isolation

This checkpoint is intentionally left as a placeholder. The specific contraction steps depend on migration progress and consumer readiness.
