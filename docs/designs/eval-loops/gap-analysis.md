# Evaluation Gap Analysis

**Created:** 2026-02-17
**Purpose:** Map the current codebase (SDK, backend API, frontend) to the desired operation model, identifying what exists, what is named differently, and what is missing
**Related:**
- [Evaluation Structure](./evaluation-structure.md)
- [Evaluation Operations](./evaluation-operations.md)
- [Desired Architecture](./desired-architecture.md)
- [Refactoring Analysis](./refactoring-analysis.md)

---

## Table of Contents

- [Document Coherence Notes](#document-coherence-notes)
- [Terminology Mapping](#terminology-mapping)
- [Current Implementation by Layer](#current-implementation-by-layer)
  - [SDK](#sdk)
  - [Backend API](#backend-api)
  - [Frontend](#frontend)
- [Operation Model Coverage](#operation-model-coverage)
- [Flag Coverage](#flag-coverage)
- [Structural Gaps](#structural-gaps)

---

## Document Coherence Notes

The five design documents are broadly coherent. Minor inconsistencies to be aware of:

| Document | Note |
|----------|------|
| `iteration-patterns.md` | Uses "applications/evaluators" terminology; predates the `type: input/invocation/annotation` vocabulary from `evaluation-operations.md` |
| `desired-architecture.md` | Uses "ports & adapters / RemoteAPIPersistence" framing; SDK analysis shows no such abstraction exists yet — it is all direct HTTP |
| `refactoring-analysis.md` | Identifies 4-level SDK loop vs 2/3-level API loops — still accurate; the `TensorSlice` / `process` vocabulary in `evaluation-operations.md` is the intended reconciliation |
| `evaluation-structure.md` | Tensor entity model (composite key, by-reference results) is consistent with the DB schema (`unique on (project_id, run_id, scenario_id, step_key, repeat_idx)`) |
| `evaluation-operations.md` | `repeat_target`, `reuse_traces`, `allow_decrease_repeats` flags are **not yet in the codebase** — documented as desired state |

---

## Terminology Mapping

| Desired term | SDK term | Backend term | Frontend term |
|--------------|----------|--------------|---------------|
| `add_step` | Implicit in `acreate_run()` payload | Built inside `setup_evaluation()` | Implicit in creation wizard (evaluator + testset selection) |
| `remove_step` | — | — | — |
| `add_scenario` | `aadd_scenario()` | `create_scenario()` / `POST /scenarios/` | — (backend-driven) |
| `remove_scenario` | — | `delete_scenario()` / `DELETE /scenarios/{id}` | — |
| `populate` | `alog_result()` | `create_result()` / `POST /results/` | `upsertStepResultWithAnnotation()` |
| `prune` | — | `delete_result[s]()` / `DELETE /results/` | — |
| `probe` | — | `query_results()` / `POST /results/query` | `queryStepResults()` |
| `process` | `aevaluate()` (the whole loop) | `SimpleEvaluationsService.start()` → Taskiq worker | "Run" button → triggers backend |
| `refresh_metrics` | `acompute_metrics()` | `refresh_metrics()` / `POST /metrics/refresh` | — (backend-driven) |
| `get_flags` | — | `GET /runs/{run_id}` (returns full run) | — |
| `set_flag` | — | `PATCH /runs/{run_id}` with `flags` in body | Implicit (is_live via online eval creation) |
| `TensorSlice` | Not implemented | Not implemented | Not implemented |
| `step.type = "input"` | Implicit (testset data) | `type: "input"` in `EvaluationRunDataStep` | `type: "input"` in step meta |
| `step.type = "invocation"` | `"application-{slug}"` step_key | `type: "invocation"` | `kind: "invocation"` |
| `step.type = "annotation"` | `"evaluator-{slug}"` step_key | `type: "annotation"` | `kind: "annotation"` |
| `step.origin = "auto"` | Origin enum exists in models | `origin: "auto"` in step | `origin: "automated"` ⚠️ (inconsistent spelling) |
| `step.origin = "human"` | Origin enum exists in models | `origin: "human"` | `origin: "human"` |
| `step.origin = "custom"` | Origin enum exists in models | `origin: "custom"` | Not explicitly exposed |

**Note:** Frontend uses `"automated"` where backend/SDK use `"auto"`. This is a naming inconsistency to fix.

---

## Current Implementation by Layer

### SDK

**File:** `sdk/agenta/sdk/evaluations/preview/evaluate.py`

The SDK implements the `process` role in a single `aevaluate()` function. All operations are direct HTTP calls to the backend — no abstraction layer.

#### What exists

| Operation | SDK function | Endpoint |
|-----------|-------------|---------|
| Create run | `acreate_run()` | `POST /preview/simple/evaluations/` |
| Add scenario | `aadd_scenario()` | `POST /preview/evaluations/scenarios/` |
| Populate (log result) | `alog_result()` | `POST /preview/evaluations/results/` |
| Refresh metrics | `acompute_metrics()` | `POST /preview/evaluations/metrics/refresh` |
| Close run | `aclose_run()` | `POST /preview/evaluations/runs/{id}/close/{status}` |

#### What is missing / gaps

- **No `probe`** — SDK does not query existing results before writing. It always writes (no idempotency check / skip-if-success).
- **No `prune`** — SDK cannot delete results or scenarios.
- **No `TensorSlice`** — SDK always processes the full tensor (all scenarios, all steps, all repeats).
- **No `process(slice)` API** — `aevaluate()` is monolithic; there is no way to re-run a subset.
- **No ports & adapters** — `desired-architecture.md` describes `RemoteAPIPersistence`; the SDK currently has direct HTTP with no abstraction boundary.
- **No `repeat_target` or `reuse_traces`** — repeats not implemented in SDK loop.
- **Step keys use short slugs** (`"application-{uuid[:8]}"`) rather than full revision IDs — may cause collisions.
- **4-level nesting** (testset → testcase → application → evaluator) is tightly coupled; cannot be decomposed into slice-based execution.

#### Desired SDK state

The SDK loop becomes canonical `process(slice)`, with:
- Injected `RemoteAPIPersistence` implementing `populate`, `prune`, `probe`
- `probe` to skip already-successful cells
- `TensorSlice` to target re-runs or partial execution

---

### Backend API

**Files:**
- `api/oss/src/core/evaluations/service.py`
- `api/oss/src/core/evaluations/tasks/legacy.py`
- `api/oss/src/core/evaluations/tasks/live.py`
- `api/oss/src/apis/fastapi/evaluations/router.py`
- `api/oss/src/tasks/taskiq/evaluations/worker.py`

#### What exists

| Operation | Backend function | HTTP endpoint |
|-----------|----------------|--------------|
| Create run | `create_run()` | `POST /runs/` |
| Add scenario | `create_scenario[s]()` | `POST /scenarios/` |
| Remove scenario | `delete_scenario()` | `DELETE /scenarios/{id}` |
| Populate | `create_result[s]()` | `POST /results/` |
| Probe | `query_results()` | `POST /results/query` |
| Prune | `delete_result[s]()` | `DELETE /results/` |
| Refresh metrics | `refresh_metrics()` | `POST /metrics/refresh` |
| Close run | `close_run()` | `POST /runs/{id}/close` |
| Open run | `open_run()` | `POST /runs/{id}/open` |
| Start processing | `start()` → Taskiq worker | (internal dispatch, no HTTP endpoint) |
| Stop processing | `stop()` | (internal, no HTTP endpoint) |

**DB unique constraint:** `(project_id, run_id, scenario_id, step_key, repeat_idx)` — matches the composite key in our tensor model. ✅

#### What is missing / gaps

**Steps (critical gap):**
- **No `add_step` endpoint.** Steps are constructed inside `setup_evaluation()` (legacy.py) — the graph is assembled as a single blob and stored. There is no API to add or remove steps after creation.
- **No `remove_step` endpoint.**
- Steps are in `run.data.steps` (a list in a JSON column), not a normalized table. This makes adding/removing expensive (read-modify-write the whole blob).

**Processing control:**
- **No `POST /runs/{id}/process` endpoint.** Processing is triggered by `start()` internally, which dispatches a Taskiq task. There is no slice parameter.
- **No slice-aware re-run.** `evaluate_batch_testset` and `evaluate_live_query` tasks always re-process the full run.

**Flags:**
- **`repeat_target` not in `EvaluationRunFlags`.** The current flags model has `is_live`, `is_active`, `is_closed`, `has_queries`, `has_testsets`, `has_evaluators`, `has_custom`, `has_human`, `has_auto`. Missing: `repeat_target`, `reuse_traces`, `allow_decrease_repeats`.
- **No dedicated `set_flag` endpoint.** Flags are set via `PATCH /runs/{id}` with the whole flags object. The desired `set_flag(name, value)` (read-modify-write) is not yet a first-class operation.

**TensorSlice:**
- **Not implemented anywhere.** All CRUD operations use individual IDs or full-table queries. No slice-based multi-dimension targeting.

**`process` dispatch:**
- `SimpleEvaluationsService.start()` dispatches either `evaluate_batch_testset` or `evaluate_live_query` based on whether the run has `query_steps` or `testset_steps`. This is the current equivalent of `process`, but:
  - It's hardcoded logic in the service, not a general slice executor
  - No HTTP endpoint to trigger it externally (used via internal dispatch only)
  - No idempotency (no `probe`-before-write to skip successful cells)

---

### Frontend

**Key files:**
- `web/oss/src/services/evaluations/api/index.ts` — core evaluation CRUD
- `web/oss/src/services/evaluations/results/api.ts` — step results + annotation linkage
- `web/oss/src/services/onlineEvaluations/api.ts` — live evaluation + queries
- `web/oss/src/services/annotations/api/index.ts` — annotation CRUD
- `web/oss/src/components/pages/evaluations/NewEvaluation/` — creation wizard
- `web/oss/src/components/EvalRunDetails/` — legacy results display

#### What exists

| Feature | Status | Notes |
|---------|--------|-------|
| Step `type` tracking | ✅ | `type: "invocation" \| "annotation" \| "input"` in step meta |
| Step `origin` tracking | ⚠️ | Uses `"automated"` instead of `"auto"` |
| Human annotation workflow | ✅ | Dedicated Annotate drawer; `upsertStepResultWithAnnotation()` |
| Populate (frontend) | ✅ | `upsertStepResultWithAnnotation()` → `POST /preview/evaluations/results/` |
| Probe (frontend) | ✅ | `queryStepResults()` → `POST /results/query` |
| Live evaluations | ✅ | Online eval drawer with `is_live` flag, query definition, sampling rate |
| Result display | ✅ | Metrics table, spider chart, temporal chart, scenario focus drawer |
| Evaluation creation | ✅ | 5-step wizard: app → variant → testset → evaluators → settings |

#### What is missing / gaps

- **No graph builder.** The graph (which steps, in what order) is assembled implicitly by the creation wizard (testset + evaluators = the graph). There is no DAG visualization or explicit step management UI.
- **`origin = "automated"` vs `"auto"`.** The frontend uses `"automated"` in step metadata filtering (`ActionCell.tsx`) while backend uses `"auto"`. This must be aligned.
- **No TensorSlice UI.** No way to select a subset of scenarios/steps/repeats to re-run or prune.
- **No `prune` operation in UI.** Users cannot delete specific results or scenarios.
- **No flag management UI** (beyond implicit toggles like start/stop for `is_active`, close for `is_closed`).
- **No `repeat_target`, `reuse_traces` in UI.** These flags don't exist in the codebase yet.

---

## Operation Model Coverage

Summary of coverage across all three layers:

| Operation | SDK | Backend | Frontend | TensorSlice-aware |
|-----------|-----|---------|----------|-------------------|
| `add_step` | ⚠️ Implicit at creation | ❌ No endpoint | ⚠️ Implicit in wizard | — |
| `remove_step` | ❌ | ❌ | ❌ | — |
| `add_scenario` | ✅ `aadd_scenario` | ✅ `POST /scenarios/` | — | ❌ |
| `remove_scenario` | ❌ | ✅ `DELETE /scenarios/{id}` | — | ❌ |
| `increase_repeats` | ❌ | ❌ | ❌ | — |
| `decrease_repeats` | ❌ | ❌ | ❌ | — |
| `populate` | ✅ `alog_result` | ✅ `POST /results/` | ✅ `upsertStepResult...` | ❌ |
| `prune` | ❌ | ✅ `DELETE /results/` | ❌ | ❌ |
| `probe` | ❌ | ✅ `POST /results/query` | ✅ `queryStepResults` | ❌ |
| `refresh_metrics` | ✅ `acompute_metrics` | ✅ `POST /metrics/refresh` | — | — |
| `get_flags` | ❌ | ⚠️ Via `GET /runs/{id}` | — | — |
| `set_flag` | ❌ | ⚠️ Via `PATCH /runs/{id}` | ⚠️ Implicit only | — |
| `process` | ✅ `aevaluate()` (monolithic) | ⚠️ Internal only (Taskiq) | ⚠️ "Run" button triggers it | ❌ |

Legend: ✅ Exists · ⚠️ Partial/implicit · ❌ Missing

---

## Flag Coverage

| Flag | In `EvaluationRunFlags` | Set by whom | Gaps |
|------|------------------------|-------------|------|
| `is_live` | ✅ | Frontend (online eval creation) | — |
| `is_active` | ✅ | Backend (`start()` / `stop()`) | No HTTP endpoint to toggle directly |
| `is_closed` | ✅ | Backend (`close_run()` / `open_run()`) | — |
| `has_queries` | ✅ | Backend (derived at creation) | Derived, not user-set |
| `has_testsets` | ✅ | Backend (derived at creation) | Derived, not user-set |
| `has_evaluators` | ✅ | Backend (derived at creation) | Derived, not user-set |
| `has_custom` | ✅ | Backend (derived at creation) | Derived, not user-set |
| `has_human` | ✅ | Backend (derived at creation) | Derived, not user-set |
| `has_auto` | ✅ | Backend (derived at creation) | Derived, not user-set |
| `repeat_target` | ❌ | — | Not implemented anywhere |
| `reuse_traces` | ❌ | — | Not implemented anywhere |
| `allow_decrease_repeats` | ❌ | — | Not implemented anywhere |

---

## Structural Gaps

### Priority 1 — Critical for the operation model

1. **`add_step` / `remove_step` endpoints.** Steps need to be first-class entities with their own lifecycle, not a blob inside `run.data`. This is the foundation for the graph mutation model.

2. **`repeat_target`, `reuse_traces`, `allow_decrease_repeats` flags.** Not in the data model at all. Needed before implementing repeat and trace-reuse behaviors.

3. **`increase_repeats` / `decrease_repeats`.** No concept of repeat count as a mutable run property. Currently hardcoded per-run at creation.

### Priority 2 — Important for operational correctness

4. **`process(slice)` HTTP endpoint.** Processing is currently internal-only (Taskiq dispatch). To support re-runs of failed/missing results, process needs to be externally triggerable with a slice parameter.

5. **`TensorSlice` in `probe` / `prune` / `populate`.** Current operations are per-entity (single ID) or full-table. Slice-based multi-dimensional targeting is not implemented.

6. **Idempotent `process` (probe-before-write).** SDK and backend tasks always write results without checking if a successful result already exists. This means re-running overwrites correct data.

### Priority 3 — Naming and consistency

7. **Frontend `"automated"` → `"auto"`.** One-line fix in `ActionCell.tsx` and any other frontend files that filter on origin.

8. **SDK step key format.** Currently `"application-{uuid[:8]}"` — short slugs risk collision and don't match the design's `step_key = revision_id`-based format.

9. **`set_flag` as a first-class endpoint.** Currently flags are set via `PATCH /runs/{id}` with an arbitrary body. A dedicated `POST /runs/{id}/flags/{flag_name}` (or similar) would match the operation model and make constraints explicit.

10. **`RemoteAPIPersistence` abstraction in SDK.** The `desired-architecture.md` calls for injecting a persistence adapter. Currently all HTTP calls are inlined in `evaluate.py`. Extracting them into an adapter class would decouple orchestration from transport.

---

**Document Status:** Draft — reflects codebase state as of 2026-02-17
**Next Action:** Prioritize gaps and assign to refactoring phases
