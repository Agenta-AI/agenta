# Tracing Cleanup: Router vs Service vs Worker

Status as of February 26, 2026: core tracing cleanup is implemented and ready to close.

Assumption: "OTP router" in prior discussion refers to `OTLPRouter`.

---

## 1) Scope

This cleanup covers:

- `api/oss/src/apis/fastapi/tracing/router.py`
  - `TracingRouter` (legacy `/tracing/*`)
  - `SpansRouter` (new `/preview/spans/*`)
  - `TracesRouter` (new `/preview/traces/*`)
- `api/oss/src/apis/fastapi/otlp/router.py` (`/otlp/v1/traces`)
- `api/oss/src/core/tracing/service.py`
- `api/oss/src/tasks/asyncio/tracing/worker.py`
- Internal non-HTTP consumers
  - `core/invocations/service.py`
  - `core/annotations/service.py`
  - `core/evaluations/tasks/*`
  - `core/evaluations/utils.py`
  - `entrypoints/worker_evaluations.py`

Goal: tracing behavior is reusable through core services/workers without depending on FastAPI router classes.

---

## 2) Implemented Boundary

### Router responsibilities

- HTTP request binding/parsing
- EE permission checks
- HTTP status/response shaping
- Mapping domain errors (e.g. focus conflicts, filtering errors) to HTTP responses

### Core tracing service responsibilities

- Span ingest orchestration (`ingest_spans`, `ingest_span_dtos`)
- Trace create/edit validation and orchestration
- Query execution and format/focus normalization
- Query params/body merge and analytics merge/default spec resolution
- Query-revision expansion + pagination merge for preview spans/traces query routes
- Pagination cursor policy (`build_next_windowing`)

### Worker responsibilities

- Async stream publish/consume and persistence
- Authoritative quota checks in worker flow

---

## 3) Coupling Removal Status

Completed:

- Core no longer imports tracing routers/models.
- Internal tracing consumers now call `TracingService` directly.
- `SpansRouter` and `TracesRouter` no longer call private `TracingRouter` methods.
- OTLP span normalization path now uses core payload parsing functions.
- Tracing payload utilities were flattened into one `utils/` package with:
  - `attributes.py` (includes AG namespace helpers)
  - `parsing.py` (includes scalar/timestamp parsing)
  - `trees.py` (trace views + tree metrics)
- Removed legacy split utility modules:
  - `ag_namespace.py`
  - `values.py`
  - `trace_views.py`
  - `tree_metrics.py`
- Shared simple-trace helper utilities were extracted into:
  - `core/tracing/utils/simple_traces.py`
  - adopted by both `core/invocations/service.py` and `core/annotations/service.py` for
    - link normalization (`Link` <-> `OTelLink`)
    - root-span parsing / trace mapping primitives
    - common filtering/query assembly for simple trace entities
- `core/annotations/service.py` no longer depends on API-layer evaluator models.
- `core/evaluations/tasks/batch.py` no longer instantiates FastAPI routers from core.

Cross-check:

- `InvocationsRouter` and `AnnotationsRouter` already depend on service classes (`InvocationsService`, `AnnotationsService`) and not on tracing router internals.

---

## 4) Compatibility Notes

- Legacy `/tracing/*` routes are kept for compatibility.
- Preview `/preview/spans/*` and `/preview/traces/*` remain canonical for new typed routes.
- Route contracts and behavior were preserved while moving orchestration into core service methods.

---

## 5) Acceptance Criteria Checklist

- [x] No imports of `apis.fastapi.tracing.router` from `core/*`
- [x] No imports of `apis.fastapi.tracing.models` from `core/*`
- [x] `SpansRouter` and `TracesRouter` do not call private `TracingRouter` methods
- [x] Router orchestration for merge/query-ref resolution moved into core tracing service
- [x] OTLP ingest path remains protocol-compliant and quota-aware
- [x] No imports of `apis.fastapi.annotations.router` from `core/*`
- [x] No imports of `apis.fastapi.invocations.router` from `core/*`
- [x] Annotations/invocations remain service-driven at router boundary

---

## 6) Remaining Gaps

None in scope for this cleanup.

---

## 7) Optional Follow-up

Any further improvements are out of scope for this cleanup pass.
