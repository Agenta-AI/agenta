# Plan: Evaluation Runtime Heartbeats And Step Mutation

This plan turns the design in [README.md](./README.md) into a concrete implementation sequence.

## Goals

- Add runtime truth for evaluation execution using Redis locks with heartbeats.
- Coordinate run mutation safely against in-flight execution.
- Introduce step archival without destructive removal.
- Add evaluator-step backfill for non-live loops when newly added evaluators are `auto`.
- Support input-step addition and archival for the loops that need it.

## Phase 1: Runtime Locking Foundation

**Goal:** Introduce Redis runtime primitives without changing evaluation semantics yet.

### 1.1 Add Redis lock helpers

**New code:**

- `api/oss/src/core/evaluations/runtime/locks.py`
- optionally `api/oss/src/core/evaluations/runtime/types.py`

**Responsibilities:**

- reuse the existing `oss.src.utils.caching` lock helpers and their Redis key prefix
- build keys
  - `eval:run:{run_id}:lock`
  - `eval:run:{run_id}:job:{job_id}:lock`
  - `eval:worker:{worker_id}:heartbeat`
- acquire mutation lock
- acquire job lock
- renew lock with compare-and-renew semantics
- release lock with compare-and-delete semantics
- list active job locks for a run
- check whether a mutation lock exists

**Payloads:**

Allowed `job_type` values: `api`, `web`, `sdk`

```json
{
  "job_type": "api",
  "job_id": "2e2d3c2e-3d79-45f8-bec5-fc9af9e6d223",
  "job_token": "0b727a0d6ce34576a8f1b91fd6ab9d1b",
  "created_at": "2026-03-24T09:30:00Z",
  "updated_at": "2026-03-24T09:30:30Z"
}
```

For the run-level mutation lock:

```json
{
  "job_type": "sdk",
  "job_id": "3fdcc012-7e17-42ef-9f3d-985ffb15329d",
  "job_token": "8ca4f4be34d14ce8bb122b6794f6f97e",
  "created_at": "2026-03-24T09:30:00Z",
  "updated_at": "2026-03-24T09:30:30Z"
}
```

**Defaults:**

- heartbeat every `30s`
- TTL `5m`

### 1.2 Add worker heartbeat

**Likely code:**

- `api/entrypoints/worker_evaluations.py`
- a small runtime helper started at worker boot

**Behavior:**

- register `eval:worker:{worker_id}:heartbeat`
- refresh every `30s`
- expire after `5m`

### 1.3 Add Taskiq execution wrapper

**Files to modify:**

- `api/oss/src/tasks/taskiq/evaluations/worker.py`

**Changes:**

- wrap every evaluation task with:
  - resolve `job_id`
  - acquire `eval:run:{run_id}:job:{job_id}:lock`
  - start background heartbeat
  - run existing implementation
  - release lock in `finally`
- check `eval:run:{run_id}:lock` before starting execution
- non-queue loops use a reserved singleton job-lock slot per run so concurrent execution is skipped
- queue loops keep distinct job-lock ids and may execute concurrently

**Applies to:**

- `evaluations.live.evaluate`
- `evaluations.queries.batch`
- `evaluations.legacy.annotate`
- `evaluations.invocations.batch`
- `evaluations.traces.batch`
- `evaluations.testcases.batch`

### 1.4 Add runtime observability helpers

**Likely code:**

- `api/oss/src/core/evaluations/service.py`
- possibly new read helpers in `SimpleEvaluationsService`

**Behavior:**

- `is_run_executing(run_id)` by checking `eval:run:{run_id}:job:*:lock`
- `has_run_mutation_lock(run_id)` by checking `eval:run:{run_id}:lock`
- wildcard lock discovery must use Redis `SCAN` or a dedicated index/set, never `KEYS`

### 1.5 Tests

**Add tests for:**

- lock acquire / renew / release
- failed renew with wrong token
- failed release with wrong token
- heartbeat expiration
- task wrapper releasing lock on exception

## Phase 2: SDK Heartbeat Participation

**Goal:** Make SDK-owned executions participate in the same runtime model.

### 2.1 Add SDK heartbeat endpoints

**Files to modify:**

- `api/oss/src/apis/fastapi/evaluations/router.py`
- `api/oss/src/core/evaluations/service.py`

**Endpoints:**

- `POST /preview/simple/evaluations/{run_id}/heartbeat`
- `DELETE /preview/simple/evaluations/{run_id}/heartbeat`

**Behavior:**

- `POST` acquires or renews `eval:run:{run_id}:job:{job_id}:lock`
- `DELETE` releases it if the caller owns it

### 2.2 Update SDK execution loop

**Files to modify:**

- `sdk/agenta/sdk/evaluations/preview/evaluate.py`
- `sdk/agenta/sdk/evaluations/runs.py`
- add small SDK client helpers for heartbeat endpoints

**Behavior:**

- create SDK `job_id`
- acquire heartbeat at evaluation start
- renew every `30s` in a background task
- release on normal completion or exception

### 2.3 Tests

**Add tests for:**

- SDK heartbeat acquisition
- SDK heartbeat renewal
- SDK heartbeat release
- stale SDK lock expiry

## Phase 3: Mutation Locking And Edit Gating

**Goal:** Prevent run-definition changes from racing active execution.

### 3.1 Guard run mutation with `eval:run:{run_id}:lock`

**Files to modify:**

- `api/oss/src/core/evaluations/service.py`

**Primary targets:**

- `SimpleEvaluationsService.edit()`
- any queue-edit path if/when added
- any future step mutation endpoints

**Behavior:**

1. acquire `eval:run:{run_id}:lock`
2. check whether any `eval:run:{run_id}:job:*:lock` exists
3. if yes, fail or require stop-first depending on endpoint contract
4. perform mutation
5. release mutation lock in `finally`

### 3.2 Guard execution against mutation

**Files to modify:**

- `api/oss/src/tasks/taskiq/evaluations/worker.py`

**Behavior:**

- before starting execution, check `eval:run:{run_id}:lock`
- if present, wait/retry/fail fast depending on job type

**Recommended defaults:**

- batch jobs: fail fast or retry with backoff
- live refresh: skip this refresh cycle
- queue batches: retry later

### 3.3 Tests

**Add tests for:**

- mutation blocked by active job locks
- execution blocked by mutation lock
- mutation lock released on failure

## Phase 4: Step Archival Model

**Goal:** Add non-destructive step lifecycle semantics.

### 4.1 Extend step schema

**Files to modify:**

- `api/oss/src/core/evaluations/types.py`
- any shared DTO definitions used by web / SDK
- `web/oss/src/lib/Types.ts` if needed

**Changes:**

- add optional `archived` field to steps
- absence of `archived` means active
- never write `archived: false`

**Rules:**

- archive is the supported removal model
- edit is implemented as `archive + add`

### 4.2 Update parsers and builders

**Files to modify:**

- `api/oss/src/core/evaluations/service.py`

**Changes:**

- preserve optional `archived` on step read/write
- mutation helpers should set archival state sparsely

### 4.3 Update execution loops

**Files to modify:**

- `api/oss/src/core/evaluations/tasks/live.py`
- `api/oss/src/core/evaluations/tasks/legacy.py`

**Behavior:**

- archived steps are skipped for new execution
- historical results are untouched
- only `auto` evaluators execute
- `human` and `custom` remain pending

### 4.4 Query / UI support

**Files to modify:**

- `web/oss/src/components/EvalRunDetails/...`
- any run configuration views
- evaluator/testset/query listing queries as needed

**Behavior:**

- default views may hide archived steps
- add `include_archived` where users need to inspect old structure/results

### 4.5 Tests

**Add tests for:**

- archived step omitted from new execution
- archived step retained in historical results
- absence of `archived` treated as active

## Phase 5: Evaluator-Step Mutation And Backfill

**Goal:** Support evaluator addition and archival safely.

### 5.1 Detect added and archived evaluator steps

**Files to modify:**

- `api/oss/src/core/evaluations/service.py`

**Behavior:**

- diff old vs new evaluator steps
- classify:
  - added
  - archived
  - unchanged

### 5.2 Add backfill job families

**Files to modify:**

- `api/oss/src/tasks/taskiq/evaluations/worker.py`
- add implementation modules if needed

**New job families:**

- `evaluations.backfill.batch_query`
- `evaluations.backfill.batch_testset`
- `evaluations.backfill.trace_queue`
- `evaluations.backfill.testcase_queue`

**Behavior:**

- runs as a separate job after mutation
- acquires its own run job lock
- heartbeats like any other execution
- processes existing scenarios for the newly added evaluator step

### 5.3 Backfill rules

**Rules:**

- only newly added `auto` evaluators enqueue execution backfill
- newly added `human` and `custom` evaluators do not enqueue backfill execution
- live loops never backfill historical scenarios
- non-live loops backfill existing scenarios

### 5.4 Scenario/result semantics

**Behavior:**

- adding an `auto` evaluator creates missing results through backfill
- adding `human` or `custom` updates step/scenario semantics but leaves execution pending
- archiving an evaluator stops future execution only

### 5.5 Tests

**Add tests for:**

- `auto` evaluator addition enqueues backfill
- `human` evaluator addition does not enqueue backfill
- `custom` evaluator addition does not enqueue backfill
- live evaluator addition is future-only
- queue/testset/query backfill populates missing results correctly

## Phase 6: Input-Step Mutation

**Goal:** Support input-step addition and archival where it makes sense.

### 6.1 Live query input mutation

**Files to modify:**

- `api/oss/src/core/evaluations/service.py`
- relevant web / SDK callers

**Behavior:**

- add query/input step affects future windows only
- archive query/input step stops future scenario creation
- no live backfill

### 6.2 Batch query input mutation

**Behavior:**

- add input step creates new scenarios for newly included traces
- archive input step preserves existing scenarios/results
- uses addition and archival semantics, not run revisioning

**Implementation note:**

- likely needs a separate scenario-materialization job after mutation

### 6.3 Batch testset input mutation

**Behavior:**

- add input step creates scenarios for new testcases
- archive input step preserves historical scenarios/results
- uses addition and archival semantics, not run revisioning

**Implementation note:**

- likely needs a separate scenario-materialization job after mutation

### 6.4 Queue inputs

**Behavior:**

- do not add editable input-step mutation for trace/testcase queues
- queue inputs continue to be appended through existing queue endpoints

### 6.5 Tests

**Add tests for:**

- live input addition only affects future items
- batch query input addition materializes new scenarios
- batch testset input addition materializes new scenarios
- queue flows reject input-step mutation

## Phase 7: Metrics And Display Semantics

**Goal:** Keep metrics behavior aligned with existing storage and aggregation.

### 7.1 Preserve current metrics model

**Relevant code today:**

- metrics refresh in `api/oss/src/core/evaluations/service.py`
- run-level metric aggregation in `web/oss/src/components/EvalRunDetails/atoms/metrics.ts`

**Rules:**

- metrics remain keyed by `step_key`
- archiving does not rewrite historical metrics
- metric aggregation remains per step
- archived-step metrics may continue to appear in aggregated views

### 7.2 Add archived-step visibility controls only where needed

**Behavior:**

- do not introduce a separate historical-metrics storage model
- only add display/query controls for archived structural elements where users need them

## Phase 8: API, Web, And SDK Surface Cleanup

**Goal:** Make the feature usable end-to-end.

### 8.1 API endpoints

**Add or adjust endpoints for:**

- SDK heartbeat acquire / renew / release
- step mutation requests that support add / archive
- mutation responses that surface lock conflicts clearly

### 8.2 Web surfaces

**Likely work:**

- run configuration views for step archival/addition
- lock-conflict error handling
- `include_archived` toggles where appropriate

### 8.3 SDK surfaces

**Likely work:**

- heartbeat helpers
- optional mutation helpers if SDK will expose them

## Phase 9: Rollout And Verification

**Goal:** Ship safely and verify the semantics across all loops.

### 9.1 Feature flags

Consider flags for:

- runtime locks enabled
- SDK heartbeat enabled
- step archival enabled
- evaluator backfill enabled
- input-step mutation enabled

### 9.2 Migration / compatibility

Rules:

- old runs without `archived` fields remain active
- no data rewrite required for existing step graphs
- lock keys are ephemeral and require no migration

### 9.3 End-to-end verification matrix

Verify for each loop:

- live query
- batch query
- batch testset
- batch invocation
- trace queue
- testcase queue
- SDK local loop

For each loop, verify:

- lock acquire / renew / release
- mutation blocked while jobs are active
- mutation succeeds when no jobs are active
- added `auto` evaluator backfills when applicable
- added `human` / `custom` evaluator does not backfill
- archived steps stop future execution

## Recommended Execution Order

1. Phase 1: runtime locking foundation
2. Phase 2: SDK heartbeat participation
3. Phase 3: mutation locking and edit gating
4. Phase 4: step archival model
5. Phase 5: evaluator-step mutation and backfill
6. Phase 6: input-step mutation
7. Phase 7: metrics and display semantics
8. Phase 8: API, web, and SDK surface cleanup
9. Phase 9: rollout and verification

## Success Criteria

- Runtime execution can be determined from Redis locks rather than only `is_active` / `status`.
- SDK executions participate in the same runtime model as API-owned executions.
- Step removal is modeled as archival, not destructive deletion.
- Newly added `auto` evaluators backfill for non-live loops only.
- Live loops never backfill historical scenarios.
- Queue runs support concurrent jobs while still blocking mutation safely.
- Existing runs remain valid without requiring `archived: false`.
