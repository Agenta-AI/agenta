# Simple Traces Unification Plan

> Status: design proposal
> Date: 2026-03-15
> Companion: [plan.md](./plan.md), [taxonomy.md](./taxonomy.md), [runnables-system-layer.md](./runnables-system-layer.md)

This document isolates the remaining differences between the current **invocation** and **annotation** stacks and turns them into an explicit unification plan.

The goal is not to erase the domain difference between the two concepts. The goal is to remove accidental duplication and keep only the differences that are genuinely about:

- application-backed simple traces
- evaluator-backed simple traces

Everything else should move toward one shared **simple trace** stack.

---

## 1. New Baseline

After the trace-ingestion change, the system-level baseline is now:

- trace type is inferred at ingestion
  - any linked span in a trace -> `annotation`
  - otherwise -> `invocation`
- trace type is no longer authored by SDK/runtime/service code
- invocation vs annotation as a runnable/domain concept should therefore no longer be modeled by trace-type assignment logic

That means the remaining split between invocations and annotations must be justified by one of these:

1. different backing workflow family
2. different reference namespace
3. different payload validation rules
4. different external response/request naming for compatibility

If a difference does not fall into one of those buckets, it should be removed.

---

## 2. Target URI Families

The URI split for simple traces should be:

- `agenta:custom:invocation:v0`
  - Agenta-managed custom invocation definitions
  - resolve/create as **application** / variant / revision
- `agenta:custom:annotation:v0`
  - Agenta-managed custom annotation definitions
  - resolve/create as **evaluator** / variant / revision

These URIs replace the old ambiguity where:

- human evaluators had no URI
- simple-trace custom definitions were partially inferred from flags
- some design notes treated them as `user:custom:*`

Under this plan:

- the URI decides the backing workflow family
- ingestion decides the emitted trace type
- flags become materialized metadata only

---

## 3. Current Differences and Planned Changes

The table below lists each real difference between the current invocation and annotation stacks, plus the intended fix.

| Area | Current invocation behavior | Current annotation behavior | Why it differs today | Planned change |
|---|---|---|---|---|
| Backing workflow family | Resolves/creates **applications** via `ApplicationsService` and `SimpleApplicationsService` | Resolves/creates **evaluators** via `EvaluatorsService` and `SimpleEvaluatorsService` | The API treats invocations as app-backed and annotations as evaluator-backed | Keep this difference. Make it explicit through URI family: `agenta:custom:invocation:v0` -> application-backed, `agenta:custom:annotation:v0` -> evaluator-backed |
| URI family | No explicit simple-trace invocation URI family today | Human/custom annotations are moving from no-URI or legacy custom families | Historical migration debt | Add the two canonical URI families above and route creation/resolution through them |
| Reference namespace | `references.application`, `application_variant`, `application_revision` | `references.evaluator`, `evaluator_variant`, `evaluator_revision` | Backing workflow families differ | Keep this difference, but isolate it behind one domain adapter layer |
| Create-time auto-provisioning | Can auto-create a simple application shell if revision lookup misses | Can auto-create a simple evaluator shell if revision lookup misses | Both paths need a backing workflow record | Unify the provisioning flow shape. Only the backing service and DTO family should differ |
| Generated workflow data on auto-create | Should create a simple application with generated normalized schema contract, including outputs schema derived from the simple-trace payload shape | Creates a simple evaluator with generated `schemas.outputs` plus compatibility `service.format` | The backing workflow created by the simple-trace path must be self-describing in both domains | Apply the same normalized schema bootstrapping policy to both application-backed and evaluator-backed simple traces. Compatibility `service` can remain temporarily, but normalized schemas must be the source of truth |
| Payload validation against backing workflow schema | Should validate invocation payload against the normalized backing application schema whenever the backing workflow already exists | Validates annotation payload against evaluator `service.format` schema | Once the backing workflow exists, both domains should enforce its contract | Move both sides to normalized revision-schema validation via shared helpers. Remove annotation dependence on legacy `service.format` and add the equivalent application-side validation |
| Derived origin | Invocation fetch/query always reconstructs `origin=CUSTOM` | Annotation fetch/query reconstructs `origin` from `is_custom` / `is_feedback` flags into `CUSTOM`, `HUMAN`, or `AUTO` | Invocation path never modeled origin carefully; annotation path did | Define one shared simple-trace origin derivation helper, with domain-configurable mapping rules. Invocation should stop hardcoding `CUSTOM` |
| Derived kind | `kind` derived from `is_evaluation` flag | Same | Shared simple-trace concept | Unify into one shared helper |
| Derived channel | `channel` derived from `is_sdk` / `is_web` flags | Same | Shared simple-trace concept | Unify into one shared helper |
| Query flags type | Uses `InvocationFlags`, which doubles as query flags | Uses `AnnotationQueryFlags` separately from `AnnotationFlags` | Annotation side already split write-flags from query-flags | Normalize both sides to distinct query-flag DTOs or remove that distinction in favor of one shared simple-trace query filter model |
| Annotation-specific flags | No `is_custom` / `is_feedback` materialization on create/edit/query | Annotation create/edit/query materialize `is_custom`, `is_feedback`, `is_evaluator`, `is_evaluation` | Annotation stack was compensating for missing URI/family truth | Replace authored identity with URI-derived/materialized metadata. Keep only the metadata that must still be queryable |
| Trace-type authorship | Previously set invocation trace type directly in service, now removed | Previously set annotation trace type directly in service, now removed | Legacy implementation detail | Already fixed. Keep removed |
| CRUD over traces | `_create`, `_fetch`, `_edit`, `_delete`, `_query` are near-identical except for domain DTOs and reference names | Same | Accidental duplication | Extract one shared `SimpleTracesService` core for CRUD/query over trace-backed entities |
| Router routes | Same route shape under `/invocations/*` | Same route shape under `/annotations/*` | Domain namespace differs, but the mechanics do not | Extract one generic router factory/base. Keep separate route prefixes |
| Router permissions | `VIEW_INVOCATIONS` / `EDIT_INVOCATIONS` | `VIEW_ANNOTATIONS` / `EDIT_ANNOTATIONS` | Legacy split permission namespace | Replace both with shared `VIEW_TRACES` / `EDIT_TRACES` permissions and configure the generic router once |
| API request/response envelopes | `invocation`, `invocations`, `invocation_link` | `annotation`, `annotations`, `annotation_link` | API compatibility and naming | Keep separate envelope names initially. They can still share an internal generic router/service implementation |
| Domain DTO names | `Invocation*` types | `Annotation*` types | Public API/domain readability | Keep public names, unify internal mechanics |
| Links semantics | Optional links on invocation DTO family | Same underlying trace-link mechanism, but semantically central to annotation traces | Shared tracing model | Keep links on the shared simple-trace model. Domain-specific docs can explain interpretation |

---

## 4. What Should Be Shared

The following should become one shared simple-trace implementation:

1. Trace CRUD orchestration
- create root span
- fetch trace and parse it
- edit root span fields
- delete trace
- query traces and parse them back

2. Shared reconstruction helpers
- derive `channel`
- derive `kind`
- derive `origin` from URI family + materialized metadata
- map parsed trace references into domain references

3. Shared query building
- flags/tags/meta/references/links/windowing -> `TracingQuery`

4. Shared router mechanics
- create/fetch/edit/delete/query route registration
- request scoping
- response wrapping
- exception decorators

5. Shared router/service entrypoint
- one concrete `SimpleTracesRouter`
- one concrete `SimpleTracesService`
- shared trace view/edit permission policy

---

## 5. What Should Stay Domain-Specific

These are still real differences and should remain explicit:

1. Backing workflow domain
- invocation simple traces create/resolve **applications**
- annotation simple traces create/resolve **evaluators**

2. Reference namespace
- application refs vs evaluator refs

3. Schema bootstrapping and validation behavior
- both domains need schema synthesis when the backing workflow is auto-created through the simple-trace path
- both domains need payload validation against the normalized backing workflow schema once that workflow exists
- the only remaining domain-specific difference should be which workflow family is being synthesized or validated

4. Public API envelope names
- for compatibility, `InvocationResponse` and `AnnotationResponse` should remain distinct even if internals unify

---

## 6. Recommended Refactor Shape

The clean refactor path is:

### Phase 1. Introduce a shared simple-trace service

Add a new core service, for example:

- `SimpleTracesService`

Responsibilities:

- create/fetch/edit/delete/query trace-backed simple entities
- call `TracingService`
- parse and reconstruct common simple-trace fields
- expose hooks/config for:
  - domain name
  - reference namespace
  - origin derivation strategy
  - query flag mapping

This should be the real service used by the API surface, not just a private helper behind two copied services.

### Phase 2. Introduce a shared simple-trace router

Add one concrete router, for example:

- `SimpleTracesRouter`

Responsibilities:

- register create/fetch/edit/delete/query routes once
- enforce `VIEW_TRACES` / `EDIT_TRACES`
- call `SimpleTracesService`
- wrap into the generic trace-backed response model

### Phase 3. Keep thin compatibility wrappers

Retain:

- `InvocationsService`
- `AnnotationsService`

- `InvocationsRouter`
- `AnnotationsRouter`

But make them thin wrappers responsible only for:

- application-backed provisioning, schema synthesis, and validation
- evaluator-backed provisioning, schema synthesis, and validation
- public DTO adaptation
- compatibility route names and payload names
- delegating to `SimpleTracesService` / `SimpleTracesRouter`

They should not contain their own duplicated trace CRUD/query implementation anymore.

### Phase 4. Move invocations/annotations to wrapper status

The wrapper routers should become extremely thin:

- translate request/response envelope names
- optionally inject domain-specific query defaults
- delegate everything else to `SimpleTracesRouter`

The wrapper services should become equally thin:

- perform application-backed or evaluator-backed resolution/provisioning
- then delegate trace CRUD/query work to `SimpleTracesService`

Both wrapper namespaces should use the same permissions:

- `VIEW_TRACES`
- `EDIT_TRACES`

### Phase 5. Normalize flags and origins

Move toward:

- URI-derived identity
- materialized query metadata only where needed
- one shared origin derivation rule set

This is where `is_feedback` and `is_custom` finally stop being special annotation-only authored inputs.

### Phase 6. Move schema validation off legacy `service`

Today annotation validation still depends on evaluator `data.service.format`, and invocation-backed simple traces do not yet apply the equivalent normalized validation path.

Target:

- validate both invocation-backed and annotation-backed simple traces against normalized revision schemas
- keep `service` only as compatibility cargo until final removal

---

## 7. Proposed Concrete Changes

This is the actionable checklist.

### 7a. URI and creation semantics

- [ ] Add `agenta:custom:invocation:v0`
- [ ] Add `agenta:custom:annotation:v0`
- [ ] Make simple-trace invocation create/resolve paths write the invocation URI family
- [ ] Make simple-trace annotation create/resolve paths write the annotation URI family

### 7b. Shared simple-trace core

- [ ] Introduce `SimpleTracesService` as the primary trace-backed CRUD/query service
- [ ] Move shared `_create/_fetch/_edit/_delete/_query` logic into `SimpleTracesService`
- [ ] Add shared helpers for `origin`, `kind`, and `channel` reconstruction

### 7c. Shared simple-trace router

- [ ] Introduce `SimpleTracesRouter` as the primary router for trace-backed CRUD/query
- [ ] Make `SimpleTracesRouter` use `VIEW_TRACES` / `EDIT_TRACES`
- [ ] Make `SimpleTracesRouter` call `SimpleTracesService`

### 7d. Compatibility wrappers

- [ ] Reduce `InvocationsService` to an application-backed wrapper over `SimpleTracesService`
- [ ] Reduce `AnnotationsService` to an evaluator-backed wrapper over `SimpleTracesService`
- [ ] Reduce `InvocationsRouter` to a compatibility wrapper over `SimpleTracesRouter`
- [ ] Reduce `AnnotationsRouter` to a compatibility wrapper over `SimpleTracesRouter`
- [ ] Keep only the domain-specific query/default/reference behavior in those wrappers

### 7e. Domain adapters

- [ ] Keep invocation adapter responsible for application-backed resolution/provisioning, schema synthesis, and validation
- [ ] Keep annotation adapter responsible for evaluator-backed resolution/provisioning, schema synthesis, and validation
- [ ] Use one shared normalized schema policy across both adapters

### 7f. Flags and validation

- [ ] Stop treating `is_feedback` / `is_custom` as authored inputs in simple-trace creation
- [ ] Derive/materialize identity metadata from URI family instead
- [ ] Replace annotation validation reads of `data.service.format` with normalized schema reads
- [ ] Add the same normalized schema validation path for invocation-backed simple traces

### 7g. Consumer migration

- [ ] Update API wiring so simple-trace flows land on `SimpleTracesRouter` / `SimpleTracesService`
- [ ] Update SDK client surfaces to target the simple-trace API shape
- [ ] Update web/frontend consumers to read from the simple-trace responses and compatibility wrappers
- [ ] Keep invocations/annotations routes only as thin compatibility layers until consumers fully migrate

---

## 8. Recommended Order

The lowest-risk order is:

1. URI family introduction
2. shared reconstruction helpers
3. shared core trace CRUD/query service
4. router base extraction
5. annotation validation migration from `service` to normalized schemas
6. final cleanup of annotation/invocation duplicated code

This keeps the public API stable while reducing duplication underneath.

---

## 9. Bottom Line

The current invocation and annotation stacks are **not** identical, but the remaining differences are now narrow and explicit.

After trace-type inference moved to ingestion, the durable domain split is:

- **invocation simple traces are application-backed**
- **annotation simple traces are evaluator-backed**

Everything else should trend toward one shared simple-trace implementation with two thin domain adapters.
