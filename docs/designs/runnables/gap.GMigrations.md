# Gap Analysis: GMigrations — Runnables Migration Backlog

> Status: gap analysis (consolidated)
> Date: 2026-03-17
> Gaps covered: URIs, Flags, Data/Schemas, API, Frontend, Adapters
> Companion: [gap-analysis.md](./gap-analysis.md), [gap.GFlags.md](./gap.GFlags.md), [taxonomy.md](./taxonomy.md)

---

## Overview

This document consolidates all migration work required across the runnables system. It does not define new design direction — it catalogues what must be done to move from the current mixed state (legacy + new coexisting) to the target state described in the gap analyses and plans.

Migrations are organized by layer. Each entry states what needs to change, what the current state is, what the target state is, and what it depends on.

Compatibility rule for this backlog:

- if the runnable migration intentionally removes legacy code paths, endpoints, or request/response shapes, the required backward-compatibility handling must be captured here as migration work
- valid handling includes DB/schema migrations, persisted-payload rewrites, read-time normalization, generated-client/type alignment, or an explicit no-migration decision
- codebase-level compatibility wrappers are optional and should only exist when a specific consumer still requires them

---

## M0 — Plan Alignment for Intentional Breaking Changes

**What:** The runnable workstream is not expand-only anymore. Intentional contract breaks must be tracked as migration work rather than assumed to be handled by preserving legacy runtime/API code paths.

**Current state:**
- `plan.md` still described checkpoint 1 as expand-only
- the branch already includes code-level removals and contract simplifications
- review feedback can over-focus on missing wrappers when the real missing artifact is migration coverage

**Target state:**
- `plan.md` explicitly states checkpoint 1 is mixed expand/contract
- every intentional backward-incompatible change has one of:
  - DB/schema migration work
  - persisted-payload rewrite / normalization work
  - generated-type / client-alignment work
  - explicit `wontfix` / no-migration decision
- codebase-level compatibility shims are only added when a concrete consumer still needs them

**Depends on:** none

**Migration type:** Planning / schema-migration coordination

---

## M1 — URI Backfills

### M1a — Human Evaluator URI Backfill

**What:** Human evaluators currently have `uri=None` and `is_human=True` stored as authored flags. All workflows must eventually have a URI.

**Current state:**
- Default platform human evaluator: created with `uri=None`, `is_human=True` (`api/oss/src/core/evaluators/defaults.py:141-144`)
- User-created human evaluators: created with `uri=None` and `is_human=True` propagated from annotation origin
- No URI → no way to derive `is_runnable` from handler/URL presence

**Target state:**
- Default platform evaluator → `uri=agenta:builtin:human:v0`
- User-created human evaluators → `uri=user:custom:{variant_slug}:v{N}`
- `is_runnable` derived from handler/URL presence, not from `is_human` flag

**Depends on:** G16 (URI derivation rules), G15 (`is_human` reclassification as `is_runnable`)

**Migration type:** DB — `UPDATE workflow_revisions SET uri = 'agenta:builtin:human:v0' WHERE uri IS NULL AND flags->>'is_human' = 'true' AND ...` (distinguish platform vs user-created by slug/ownership)

---

### M1b — `user:custom` URI Key Alignment

**What:** User-deployed workflows use URI format `user:custom:{variant_slug}:v{revision_version}`. This must be consistently derived and stored — not authored per-creation.

**Current state:**
- URIs are authored at creation time (passed in or inferred from slug/version at create)
- No guarantee the URI accurately reflects the current variant slug or revision version
- SDK auto-sets `is_custom=True` when no URI given (fallback path, `running.py:202-218`)

**Target state:**
- URI is always `user:custom:{variant_slug}:v{revision_version}` for user workflows
- URI is materialized from variant slug + revision version at commit time
- SDK no longer needs to default-flag `is_custom=True` without a URI

**Depends on:** G16 (URI family rules)

**Migration type:** DB — recompute URIs from variant/revision metadata for all `user:custom:*` rows missing a well-formed URI

---

## M2 — Flag Migrations

### M2a — `is_custom`: Stop Storing, Derive from URI

**What:** `is_custom` is currently stored as an authored flag. It must become a derived property computed at read time from the URI.

**Current state:**
- SDK: `self.flags["is_custom"] = True` for custom URIs (`running.py:202-218`)
- API: `legacy_adapter.py` stores `is_custom=True` for `AppType.CUSTOM`
- API DTO: `WorkflowFlags.is_custom` is a stored field
- Frontend: infers `is_custom` from schema shape (fragile)

**Target state:**
- `is_custom` computed: `is_custom_uri(uri)` — already exists at `sdk/agenta/sdk/engines/running/utils.py:320-326`
- API DTO exposes `is_custom` as a computed/read-only property on `WorkflowFlags`
- SDK stops writing `is_custom` into stored flags
- Frontend reads `is_custom` from API response, not from schema inference

**Depends on:** M1 (URIs must be present before derivation works)

**Migration type:** Code — computed property in API DTO; SDK flag write removal; frontend flag-source migration (M5b)

---

### M2b — `is_human` → `is_runnable`

**What:** `is_human` means "not runnable". The flag name is a misnomer. Runnability should be derived from handler/URL presence, not stored as a flag.

**Current state:**
- `is_human=True` stored on human evaluators (API defaults + annotation origin propagation)
- `WorkflowFlags.is_human` is a stored authored flag
- Frontend filters evaluator lists and annotation drawers by `is_human=True`
- API query filters use `SimpleEvaluatorQueryFlags(is_human=True)`

**Target state:**
- `is_runnable` derived: `agenta:*` URI → always runnable; `user:*` + handler/URL → runnable; `user:*` + no handler/no URL → not runnable; no URI → not runnable
- `is_human` kept as a stored signal **only** for annotation-origin semantics (human vs auto), but NOT for runnability queries
- Frontend filters on `is_runnable` (derived), not `is_human` (stored)
- API query filters updated to accept `is_runnable` as a filter criterion

**Depends on:** M1a (human evaluators need URIs first)

**Migration type:** Code — add `is_runnable` computed field to API DTO; update query filter params; update frontend consumption (M5b)

---

### M2c — `annotate` Param Removal from `@workflow`

**What:** The `annotate` param on `@workflow` stores annotation vs invocation mode in `RunningContext`. It is shaped like an authored flag but is an internal implementation detail. It should be removed from the public decorator API.

**Current state:**
- `@workflow(annotate=True)` stores `annotate=True` in `RunningContext`
- Used as a trace type signal during instrumentation
- Not connected to any public API or request contract

**Target state:**
- Trace type (invocation vs annotation) is an internal routing decision
- `annotate` param removed from `@workflow` decorator signature
- Trace type derived from request context or invocation path, not a decorator-level param

**Depends on:** G4, G9 (evaluation contract rework)

**Migration type:** Code — SDK decorator change; no DB migration needed

---

### M2d — `aggregate` Param: Wire to HTTP Negotiation

**What:** `aggregate` on `@workflow` converts streaming responses to batch. It is currently disconnected from the HTTP negotiation model (G5).

**Current state:**
- `@workflow(aggregate=True/Callable)` activates `NormalizerMiddleware` stream-to-batch conversion
- Not triggered by any request-level signal; activated statically at decorator time
- No connection to `Accept` header negotiation

**Target state:**
- `aggregate` is the implementation mechanism for "batch requested but handler streams natively"
- Activated when `Accept: application/json` is requested and handler return type is streaming
- Decorator-level `aggregate` sets the default; per-invocation `Accept` can override

**Depends on:** G5 (HTTP negotiation model)

**Migration type:** Code — wire `NormalizerMiddleware` activation to request `Accept` header

---

### M2e — `can_*` Flags: Do Not Add

**What:** Capability flags (`can_stream`, `can_evaluate`, `can_chat`, `can_verbose`) must not be added as authored flags. This is a prevention migration — it blocks a design direction that would reproduce existing problems.

**Current state:** `can_*` flags do not exist. Some plans/PRDs imply adding them.

**Target state:**
- `can_stream` → derived from handler return type (streaming generator vs value)
- `can_chat` → derived from schema: `messages` input shape present
- `can_evaluate` → no authored flag; evaluation mode is a request negotiation concern
- `can_verbose` → no authored flag; verbosity is a request negotiation concern

**Depends on:** G4, G5

**Migration type:** Design constraint — enforce in reviews; document in taxonomy

---

## M3 — Data / Schema Migrations

### M3a — `service`/`configuration` → `schemas`/`parameters`

**What:** `WorkflowRevisionData` stores interface and configuration under `service` and `configuration` keys (legacy naming). The canonical names in the current DTO layer are `schemas` and `parameters`. Stored JSONB data uses the old names.

**Current state:**
- DB `data` JSONB on `workflow_revisions` contains: `{"service": {...}, "configuration": {...}}`
- `WorkflowRevisionData` model has `interface` (for service/schemas) and `configuration` (for parameters)
- Read path normalizes on access; write path may still produce old key names in some paths

**Target state:**
- DB `data` JSONB uses: `{"schemas": {...}, "parameters": {...}}`
- `WorkflowRevisionData` consistently maps to `schemas` and `parameters`
- Legacy `service`/`configuration` keys accepted on read (backwards compat adapter), rejected on write

**Migration type:** DB migration — rename JSONB keys; add read-time normalization adapter during transition

---

### M3b — `script` Object → Flat `script` + `runtime` Fields

**What:** Migration `baa02d66a365` converted `data.script` from a plain string to an object `{"content": "...", "runtime": "python"}`. The Python model (`WorkflowServiceConfiguration`) never followed — it still has `script: Optional[str]` and `runtime: Optional[str]` as flat siblings. A new migration is needed to move the DB back to match the model: extract `script.content` → `script` (string) and `script.runtime` → `runtime` (top-level sibling field).

**Current state (after `baa02d66a365`):**
- DB: `data.script = {"content": "def evaluate(): pass", "runtime": "python"}` (object)
- DB: `data.runtime` key does not exist
- Python model: `script: Optional[str]`, `runtime: Optional[str]` (flat siblings — mismatched)

**Target state:**
- DB: `data.script = "def evaluate(): pass"` (plain string — the content)
- DB: `data.runtime = "python"` (top-level sibling key)
- Python model: unchanged — `script: Optional[str]`, `runtime: Optional[str]`

**Migration SQL (upgrade):**
```sql
UPDATE workflow_revisions
SET data = (
    data::jsonb
    - 'script'
    || jsonb_build_object(
        'script',  data->'script'->>'content',
        'runtime', data->'script'->>'runtime'
    )
)::json
WHERE json_typeof(data->'script') = 'object'
  AND (data->'script') ? 'content';
```

**Migration type:** DB migration (new Alembic revision, `down_revision = f0a1b2c3d4e5`)

---

### M3c — Legacy `inputs`/`outputs` Wrapper Normalization

**What:** Older revisions may have stored schema shapes without the explicit `inputs`/`outputs` wrappers now expected by the interface contract. Read path must normalize these.

**Current state:**
- Some legacy revisions have flat input fields at the root schema level
- New system expects `{"inputs": {...}, "outputs": {...}, "parameters": {...}}` shape
- No read-time normalization in current code paths

**Target state:**
- Read-time normalization: if `inputs` key missing but fields present at root, wrap them
- Future write path validates the canonical shape before commit

**Migration type:** Code — normalization adapter in `WorkflowRevisionData` read path

---

### M3d — Human Evaluator Default Data Shape

**What:** The default human evaluator is seeded with `data=SimpleEvaluatorData(service={...})` containing minimal schema data. It should have a complete `WorkflowRevisionData` with explicit `schemas` and `parameters`.

**Current state:**
- `api/oss/src/core/evaluators/defaults.py`: creates with `SimpleEvaluatorData(service={"schemas": {"inputs": ..., "outputs": ...}})`
- Flags are authored (`is_custom=False, is_human=True`); URI is `None`

**Target state:**
- URI: `agenta:builtin:human:v0`
- Complete `WorkflowRevisionData` with `schemas` and `parameters`
- Flags derived at read time; none stored

**Depends on:** M1a, M3a

**Migration type:** Code — update seeding logic; DB migration for existing default evaluator rows

---

### M3e — Legacy Application `AppType` to URI Mapping

**What:** Applications were created with `AppType` enum values (`CHAT_SERVICE`, `SDK_CUSTOM`, `COMPLETION`, etc.) mapped to flags by the legacy adapter. These must be normalised to URIs.

**Current state:**
- `api/oss/src/services/legacy_adapter.py:_template_key_to_flags()`: maps `CHAT_SERVICE` → `is_chat=True`, `SDK_CUSTOM` → `is_custom=True`
- `api/oss/src/services/legacy_adapter.py:_flags_to_app_type()`: reverse mapping
- Some application revision rows in DB have `app_type` set and no `uri`

**Target state:**
- `CHAT_SERVICE` / `COMPLETION` → `uri=agenta:builtin:hook:v0`, `is_chat` derived from schema
- `SDK_CUSTOM` → `uri=user:custom:{slug}:v{N}`
- No `app_type` field in new API DTOs; adapter removed after migration

**Depends on:** M1, G7 (legacy adapter deprecation)

**Migration type:** DB migration — populate `uri` from `app_type` + slug/version; Code — remove adapter after all rows migrated

---

## M4 — API Response / DTO Additions

### M4a — Add Derived Flags to Revision API Responses

**What:** API responses for workflow/application/evaluator revisions must include derived classification fields (`is_custom`, `is_runnable`, `is_chat`) so the frontend does not need to infer them.

**Current state:**
- `WorkflowFlags` in API DTOs: `is_custom`, `is_evaluator`, `is_human`, `is_chat` — all stored, none computed
- No `is_runnable` field in any API response
- Frontend infers `is_custom` and `is_chat` from schema and legacy flags (fragile)

**Target state:**
- `is_custom` → computed property in response DTO (from URI)
- `is_runnable` → computed property in response DTO (from handler/URL presence)
- `is_chat` → computed property in response DTO (from schema: `messages` input shape)
- All three included in revision query and retrieve responses
- Stored flags (`is_human`, `is_evaluator`) kept as authored data for now; may be removed later

**Depends on:** M1, M2a, M2b

**Migration type:** Code — add computed fields to DTO serialization; no DB migration needed

---

### M4b — `AnnotationOrigin` Re-derivation

**What:** `AnnotationOrigin` is currently derived from stored flags (`is_custom`, `is_human`). It must be re-derived from URI + runnability.

**Current state:**
- `api/oss/src/core/annotations/service.py:214-219`:
  ```python
  AnnotationOrigin.CUSTOM if annotation_flags.is_custom
  else AnnotationOrigin.HUMAN if annotation_flags.is_human
  else AnnotationOrigin.AUTO
  ```

**Target state:**
  ```python
  AnnotationOrigin.AUTO    if is_runnable and not is_custom_uri(uri)
  AnnotationOrigin.CUSTOM  if is_runnable and is_custom_uri(uri)
  AnnotationOrigin.HUMAN   if not is_runnable
  ```

**Depends on:** M2a, M2b, M1a (URIs must be present)

**Migration type:** Code — update annotation origin derivation in `annotations/service.py`

---

### M4c — Expose `is_runnable` as API Query Filter

**What:** The frontend and API clients need to query evaluators by runnability. Currently only `is_human` is a query filter, which is the inverted form of runnability.

**Current state:**
- `SimpleEvaluatorQueryFlags(is_human=True)` — primary filter for human evaluator lists
- No `is_runnable` query filter exists

**Target state:**
- `is_runnable: Optional[bool]` added to evaluator and workflow query filters
- `is_human` filter deprecated; kept for backward compat during transition

**Depends on:** M2b, M4a

**Migration type:** Code — add query param to router + DAO filter

---

## M5 — Frontend Migrations

### M5a — Endpoint URL Migration

**What:** Frontend invocation targets legacy endpoints (`/run`, `/test`, `/generate`, `/generate_deployed`). These must migrate to the new `{path}/invoke` family.

**Current state:**
- `web/oss/src/services/workflows/invoke.ts` — legacy endpoints
- `web/packages/agenta-entities/src/legacyAppRevision/api/schemaUtils.ts` — builds legacy endpoint URLs
- `web/oss/src/lib/shared/variant/transformer/` — transforms request body for legacy format

**Target state:**
- All invocations target `POST /applications/invoke` (G12) or `POST /workflows/invoke`
- Request body matches `WorkflowServiceRequest` format
- No legacy endpoint targets in frontend code

**Depends on:** G12 (applications/evaluators invoke endpoints), G18 (web consumer migration plan)

**Migration type:** Code — frontend service layer + request transformer update

---

### M5b — Flag Source Migration: Legacy OpenAPI → API Response

**What:** Frontend reads `is_chat` (and all other flags) from legacy `/openapi.json` via `x-agenta.flags`. Must migrate to API-provided classification in revision responses.

**Current state:**
- `web/packages/agenta-entities/src/legacyAppRevision/api/schemaUtils.ts:359-375`: reads `x-agenta.flags.is_chat` from OpenAPI
- Heuristic fallback: checks for `messages` schema property
- Stores in `RevisionSchemaState.isChatVariant`
- No API-response-based flag source

**Target state:**
- Read `is_chat`, `is_custom`, `is_runnable` from revision query/retrieve API response (M4a)
- No legacy OpenAPI `x-agenta.flags` reading
- No schema heuristic fallback

**Depends on:** M4a

**Migration type:** Code — update `schemaUtils.ts` and runnable bridge flag source

---

### M5c — Request Format Migration: `is_custom` Wiring

**What:** Frontend uses `is_custom` to determine request wire format (flat inputs vs `inputs`-wrapped). Must migrate to schema-driven format selection.

**Current state:**
- `web/oss/src/lib/shared/variant/transformer/transformToRequestBody.ts:60-70`:
  - `isCustom=true` → flat inputs (no `inputs` wrapper), flat parameters
  - `isCustom=false` → `{"inputs": {...}}` wrapper
- `is_custom` inferred from schema shape (`!hasInputsProperty && !hasMessagesProperty && !isChat`)

**Target state:**
- Wire format driven by interface schema: if schema has explicit `inputs` field → wrapped; otherwise → flat
- `is_custom` flag not used for format selection
- Schema shape is canonical truth; `is_custom` is identity, not format

**Depends on:** M4a (reliable `is_custom` from API), M5b (flag source migration)

**Migration type:** Code — update `transformToRequestBody.ts` format selection logic

---

### M5d — Cache Policy Migration: `is_custom` Wiring

**What:** Frontend uses `is_custom` to disable schema caching and set polling interval. Must key on whether the workflow has a remote URL.

**Current state:**
- `is_custom=true` → `staleTime: undefined` (no cache), poll every 1 minute
- `is_custom=false` → `staleTime: 5 minutes`
- Source of `is_custom`: schema heuristic (fragile)

**Target state:**
- Cache policy keyed on: does the workflow have a remote `url`?
- Workflows with a deployed service URL → shorter `staleTime` or polling
- Static builtin workflows → longer `staleTime`
- `is_custom` flag not used for cache policy

**Depends on:** M4a (remote URL presence in API response)

**Migration type:** Code — update query/fetch options in frontend data layer

---

## M6 — Legacy Adapter Deprecation

### M6a — Phase Out `legacy_adapter.py` Flag Mappings

**What:** `api/oss/src/services/legacy_adapter.py` maintains bidirectional flag ↔ AppType mappings. These mappings must be removed once URIs are backfilled and the legacy adapter is no longer needed.

**Current state:**
- `_template_key_to_flags()`: maps legacy template keys to `ApplicationFlags`
- `_flags_to_app_type()`: maps `ApplicationFlags` back to `AppType`
- Used by CRUD paths that bridge legacy and new data models

**Target state:**
- URI is canonical; flags are derived; no adapter mapping needed
- Adapter removed or reduced to a thin compatibility shim for old API versions only

**Depends on:** M3d (AppType → URI backfill), M2a (is_custom derived)

**Migration type:** Code — conditional removal after DB migration completes; keep under feature flag during transition

---

### M6b — Legacy Serving Endpoint Deprecation

**What:** Legacy serving endpoints (`/run`, `/test`, `/generate`, `/generate_deployed`, per-variant `/openapi.json`) must be deprecated and removed after frontend and SDK clients migrate.

**Current state:**
- Both legacy and new endpoints are mounted and reachable (G1)
- No deprecation notices on legacy endpoints
- Frontend still targets legacy paths (M5a)

**Target state:**
- Legacy endpoints return `410 Gone` or redirect to new paths
- Deprecated in a coordinated release after M5a frontend migration
- SDK client lib updated to target new endpoints

**Depends on:** M5a, G1

**Migration type:** API — deprecation headers, then removal; coordinated release with frontend

---

## Migration Dependency Map

```
M1a (human evaluator URIs)
  └─→ M2b (is_human → is_runnable)
  └─→ M3d (default evaluator data shape)
  └─→ M4b (AnnotationOrigin re-derivation)

M1b (user:custom URI alignment)
  └─→ M2a (is_custom derived from URI)
  └─→ M4a (derived flags in API response)

M3e (AppType → URI)
  └─→ M6a (legacy adapter removal)

M4a (derived flags in revision responses)
  └─→ M5b (frontend flag source)
  └─→ M5c (request format from schema)
  └─→ M5d (cache policy from URL)
  └─→ M4c (is_runnable query filter)

M5a (frontend endpoint migration)
  └─→ M6b (legacy serving deprecation)
```

---

## Priority Matrix

| Migration | Category | Severity | Effort | Blocks | Priority |
|-----------|----------|----------|--------|--------|----------|
| M1a — Human evaluator URI backfill | URI | High | Small | M2b, M3d, M4b | 1 — foundational |
| M1b — user:custom URI alignment | URI | Medium | Small | M2a | 1 — foundational |
| M2a — is_custom derived | Flag | High | Small | M4a, M5c | 2 — depends on M1 |
| M2b — is_human → is_runnable | Flag | Medium | Small | M4b, M4c | 2 — depends on M1a |
| M3a — service/configuration → schemas/parameters | Data | Medium | Medium | M3c | 2 — data normalization |
| M3b — script object → flat script + runtime | Data | High | Small | — | 2 — model/DB sync |
| M3d — human evaluator default data shape | Data | Low | Small | — | 3 — cleanup |
| M3e — AppType → URI mapping | Data | Medium | Medium | M6a | 3 — depends on M1 |
| M4a — derived flags in API responses | API | High | Medium | M5b, M5c, M5d | 3 — depends on M2 |
| M4b — AnnotationOrigin re-derivation | API | Medium | Small | — | 3 — depends on M2 |
| M4c — is_runnable query filter | API | Low | Small | — | 4 — depends on M4a |
| M5b — frontend flag source | Frontend | High | Medium | M5c, M5d | 4 — depends on M4a |
| M5a — frontend endpoint URLs | Frontend | High | Large | M6b | 4 — depends on G12 |
| M5c — request format from schema | Frontend | Medium | Medium | — | 5 — depends on M5b |
| M5d — cache policy from URL | Frontend | Low | Small | — | 5 — depends on M5b |
| M2c — annotate param removal | Flag | Low | Small | — | 5 — depends on G4/G9 |
| M2d — aggregate wired to Accept | Flag | Medium | Medium | — | 5 — depends on G5 |
| M2e — can_* prevention | Design | High | None | — | ongoing constraint |
| M6a — legacy adapter removal | Adapter | Medium | Medium | — | 6 — after M3e |
| M6b — legacy serving deprecation | Serving | High | Small | — | 6 — after M5a |
