# Tracing Cleanup: Router vs Service vs Worker

Status: draft for implementation planning

Assumption: "OTP router" in prior discussion refers to `OTLPRouter`.

---

## 1) Scope

This cleanup plan covers:

- `api/oss/src/apis/fastapi/tracing/router.py`
  - `TracingRouter` (legacy `/tracing/*`)
  - `SpansRouter` (new `/preview/spans/*`)
  - `TracesRouter` (new `/preview/traces/*`)
- `api/oss/src/apis/fastapi/otlp/router.py` (`/otlp/v1/traces`)
- `api/oss/src/core/tracing/service.py`
- `api/oss/src/tasks/asyncio/tracing/worker.py`
- Internal non-HTTP consumers that currently call routers directly
  - `core/invocations/service.py`
  - `core/annotations/service.py`
  - `core/evaluations/tasks/*`
  - `core/evaluations/utils.py`
  - `entrypoints/worker_evaluations.py`

Goal: make tracing behavior usable through core tracing services/workers without depending on FastAPI router classes.

---

## 2) Current State (What Is In Routers Today)

| Surface | Router-level behavior currently present |
|---|---|
| `TracingRouter._upsert` | span normalization/parsing, metrics propagation, sync/async dispatch policy, entitlement checks (sync path), link generation |
| `TracingRouter.create_trace` / `edit_trace` | domain validation (missing spans, root span count), payload polymorphism handling (`spans` vs `traces`) |
| `TracingRouter.query_spans` | params/body merge, simple `trace_id` optimization, polymorphic response formatting (`spans` or `traces`) |
| `TracingRouter.fetch_trace` | trace-id parsing + tree formatting |
| `TracingRouter.list_sessions` / `list_users` | cursor/window pagination policy (`_compute_next_windowing`) |
| `SpansRouter` | adapter conversion over legacy flow, query-ref resolution path, span filtering/query shaping, direct call to `tracing_router._upsert` |
| `TracesRouter` | adapter conversion list<->map, query-ref resolution path, direct call to `tracing_router.create_trace` and `_upsert` |
| `OTLPRouter.otlp_ingest` | protobuf decode/validation, batch-size validation, OTel->internal span conversion, soft entitlements check, metrics propagation, stream publish |

Observation: routers currently own both transport concerns and core tracing orchestration logic.

---

## 3) Cross-Layer Coupling To Remove

Current core usage of router classes (non-HTTP):

- `InvocationsService` calls `create_trace`, `edit_trace`, `delete_trace`, `fetch_trace`, `query_traces` through router instances.
- `AnnotationsService` does the same.
- Evaluation task flows instantiate/use `TracingRouter` and `TracesRouter` directly.
- `core/evaluations/utils.fetch_trace` calls router `fetch_trace`.

This creates a reverse dependency:

- Core layer depends on API layer (`core -> apis.fastapi.tracing`), which should be inverted.

---

## 4) Boundary Decisions

| Concern | Target Owner | Notes |
|---|---|---|
| FastAPI request binding, status codes, response models | Router | Keep in API layer |
| Query params/body merge into query DTO | Core service/helper | Router should pass parsed DTO only |
| `spans`/`traces` polymorphic request normalization | Core service/helper | Domain input normalization, not transport |
| Trace root-span validation | Core service | Shared validation used by HTTP + internal callers |
| OTel/agenta span normalization and metrics propagation | Core service/helper | Reusable by legacy/new/OTLP paths |
| Sync vs async ingest policy | Core service (with worker gateway) | Router passes mode, service orchestrates |
| Redis stream publish details | Worker (or worker gateway) | Keep queue mechanics outside routers |
| Query revision expansion (`query_ref`, etc.) | Core service | Shared between spans/traces query paths |
| Response shape adaptation (`Trace[]`, map tree, flat spans) | Core formatter + router adapter | Canonical shape in core; legacy shape only in legacy adapter |
| Session/user pagination cursor policy | Core service/helper | Shared and testable without HTTP |
| EE permission check mapping to HTTP errors | Router boundary | Keep as boundary concern unless domain-level permission errors are introduced |

---

## 5) Target Design

1. Routers become thin adapters:
   - validate auth/permissions
   - parse request into DTOs
   - call core tracing service
   - map domain exceptions to HTTP responses

2. Core tracing service owns orchestration:
   - ingest command pipeline (normalize -> validate -> propagate metrics -> sync/async write)
   - query pipeline (resolve query source -> execute -> format)
   - trace CRUD semantics for internal callers

3. Worker owns asynchronous persistence and authoritative quota checks.

4. Legacy router remains compatibility adapter only:
   - legacy polymorphic response/shape behavior is contained there
   - core remains canonical (`Trace`, `Traces`, `Span`, `Spans`)

---

## 6) Phased Migration Plan

### Phase A: Extract Pure Tracing Logic Out of Routers

- Move/duplicate then migrate logic from `apis/fastapi/tracing/utils.py` into `core/tracing/*`:
  - request normalization helpers
  - span normalization/parsing helpers
  - response/tree formatting helpers
  - analytics/query merge helpers that are domain-level
- Add unit tests around extracted helpers before router rewiring.

### Phase B: Add Service Entry Points (No API Changes Yet)

- Extend `core/tracing/service.py` with orchestration methods (names illustrative):
  - `ingest_spans(...)`
  - `create_trace(...)`
  - `edit_trace(...)`
  - `query_spans(...)`
  - `query_traces(...)`
  - `fetch_trace_tree(...)`
  - `build_next_windowing(...)`
- Keep existing DAO-facing methods for compatibility.

### Phase C: Rewire Routers To Service Methods

- `TracingRouter`, `SpansRouter`, `TracesRouter`, `OTLPRouter` call new service methods.
- Remove direct calls to `tracing_router._upsert` from sibling routers.
- Keep HTTP behavior and contracts unchanged while rewiring.

### Phase D: Remove Core -> Router Dependencies

- `InvocationsService` and `AnnotationsService` depend on tracing service, not router classes.
- Evaluation tasks/utils depend on tracing service/facade, not router instances.
- `entrypoints/worker_evaluations.py` wires tracing service directly.

### Phase E: Hardening + Compatibility Boundary

- Legacy `/tracing/*` kept as adapter layer only.
- New `/preview/spans/*` and `/preview/traces/*` remain canonical externally.
- Add lint/check or architectural rule to block imports from `core/*` into `apis/fastapi/*`.

---

## 7) Acceptance Criteria

- No imports of `apis.fastapi.tracing.router` from `core/*`.
- No imports of `apis.fastapi.tracing.models` from `core/*`.
- `SpansRouter` and `TracesRouter` do not call private `TracingRouter` methods.
- Router code paths contain transport concerns only; orchestration logic lives in core tracing service.
- OTLP ingest path still preserves protocol-compliant responses and current quota behavior.

---

## 8) Suggested First PR Slice

Smallest high-value slice:

1. Introduce core tracing service methods for:
   - `ingest_spans` orchestration
   - create/edit trace validation
2. Rewire `SpansRouter` + `TracesRouter` to call service instead of `tracing_router._upsert`.
3. Keep `TracingRouter` legacy behavior untouched in that first slice.

This immediately removes router-to-router coupling and creates a stable service surface for subsequent internal caller migrations.
