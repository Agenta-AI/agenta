# Evaluation Runtime Heartbeats And Step Mutation

This document captures the current evaluation execution loops and a concrete proposal for:

- runtime heartbeats / liveness detection
- Redis execution locks / leases
- step mutation semantics for `add` and `archive`
- loop-specific consistency rules

See also:

- [plan.md](./plan.md) for the concrete implementation plan across all phases

## Goals

- Make "is this evaluation currently executing?" answerable from runtime state rather than only persisted run flags.
- Keep `run.flags.is_active` as the control-plane flag for "should this run be active".
- Prevent stale worker ownership after application crashes.
- Support step evolution safely without destroying historical evaluation data.
- Make loop behavior consistent where possible.

## Current Loops

### SDK local loop

The SDK creates a persisted evaluation run and then executes the loop locally in the client process.

- create/persist run: `sdk/agenta/sdk/evaluations/runs.py`
- local execution loop: `sdk/agenta/sdk/evaluations/preview/evaluate.py`

Important property:

- the API does not own execution for this loop once the run is created

### Live query evaluation

Live evaluations are discovered periodically and dispatched as Taskiq jobs.

- live refresh dispatcher: `api/oss/src/core/evaluations/service.py`
- fetch active live runs: `api/oss/src/dbs/postgres/evaluations/dao.py`
- task registration: `api/oss/src/tasks/taskiq/evaluations/worker.py`
- executor: `api/oss/src/core/evaluations/tasks/live.py`

Important property:

- a run can remain logically active for a long time
- execution happens in periodic bursts, not as one continuous attached worker

### Batch query evaluation

This is a one-shot Taskiq run over traces selected by a query.

- dispatch: `api/oss/src/core/evaluations/service.py`
- task registration: `api/oss/src/tasks/taskiq/evaluations/worker.py`
- executor: `api/oss/src/core/evaluations/tasks/live.py`

Important property:

- one worker task executes a finite batch for a single run

### Batch testset evaluation

This is the legacy offline testset loop.

- dispatch: `api/oss/src/core/evaluations/service.py`
- task registration: `api/oss/src/tasks/taskiq/evaluations/worker.py`
- executor: `api/oss/src/core/evaluations/tasks/legacy.py`

Important property:

- one worker task usually owns the full run execution

### Batch invocation

This is the testset + application path without evaluator steps.

- dispatch: `api/oss/src/core/evaluations/service.py`
- task registration: `api/oss/src/tasks/taskiq/evaluations/worker.py`
- executor: `api/oss/src/core/evaluations/tasks/legacy.py`

Important property:

- same runtime concerns as batch testset, but no annotation/evaluator work

### Trace queue

Trace queues create a queue-backed run and then append work in batches.

- queue creation: `api/oss/src/core/evaluations/service.py`
- batch append: `api/oss/src/core/evaluations/service.py`
- task registration: `api/oss/src/tasks/taskiq/evaluations/worker.py`
- executor: `api/oss/src/core/evaluations/tasks/legacy.py`

Important property:

- many batch tasks can belong to the same run over time

### Testcase queue

This mirrors trace queue behavior but the source items are testcase ids.

- queue creation: `api/oss/src/core/evaluations/service.py`
- batch append: `api/oss/src/core/evaluations/service.py`
- task registration: `api/oss/src/tasks/taskiq/evaluations/worker.py`
- executor: `api/oss/src/core/evaluations/tasks/legacy.py`

Important property:

- many batch tasks can belong to the same run over time

## Current Liveness Model

Today, liveness is approximated from persisted run state:

- `run.flags.is_active`
- `run.status`

This is useful as control-plane state, but it is not a reliable execution heartbeat.

Current behavior:

- runs are activated by setting `flags.is_active = True`
- runs are stopped by setting `flags.is_active = False`
- live refresh selects runs with `is_live = true`, `is_active = true`, `status = running`
- there is no per-run worker heartbeat or ownership lease

Consequences:

- worker crashes can leave runs looking active
- batch tasks can appear "running" even when no worker is alive
- there is no authoritative way to block edits only while real execution is in flight

## Proposed Runtime Model

Separate control-plane state from execution-plane state.

### Control plane

Keep existing persisted run state:

- `run.flags.is_active`: the run is enabled / eligible for execution
- `run.status`: lifecycle state shown in UI and APIs

### Execution plane

Add Redis-based leases with heartbeats.

Use leases, not a one-shot lock. The execution owner must refresh a TTL while work is still running.

Implementation note:

- runtime locks reuse the existing `oss.src.utils.caching` lock helpers
- actual Redis keys therefore start with the existing cache lock prefix
- the examples below show the logical suffix after `cache:p:{project}:u:{user}:lock:`

Recommended Redis records:

- worker heartbeat key
- one run mutation lock key
- one execution lock key per run job

## Redis Keys

### Worker heartbeat

Key:

```text
eval:worker:{worker_id}:heartbeat
```

Value:

```json
{
  "worker_id": "...",
  "created_at": "...",
  "updated_at": "..."
}
```

Purpose:

- answer "is worker X alive?"
- support diagnostics
- not sufficient by itself to prove a specific run is executing

### Run mutation lock

Key:

```text
eval:run:{run_id}:lock
```

Allowed `job_type` values: `api`, `web`, `sdk`

Example value:

```json
{
  "job_type": "api",
  "job_id": "2e2d3c2e-3d79-45f8-bec5-fc9af9e6d223",
  "job_token": "0b727a0d6ce34576a8f1b91fd6ab9d1b",
  "created_at": "2026-03-24T09:30:00Z",
  "updated_at": "2026-03-24T09:30:30Z"
}
```

Purpose:

- ensures only one mutation operation edits a run definition at a time
- blocks execution jobs from starting while a run mutation is in progress
- gives run edits a clear coordination point

### Run job execution lock

Key:

```text
eval:run:{run_id}:job:{job_id}:lock
```

Allowed `job_type` values: `api`, `web`, `sdk`

Example value:

```json
{
  "job_type": "sdk",
  "job_id": "3fdcc012-7e17-42ef-9f3d-985ffb15329d",
  "job_token": "8ca4f4be34d14ce8bb122b6794f6f97e",
  "created_at": "2026-03-24T09:30:00Z",
  "updated_at": "2026-03-24T09:30:30Z"
}
```

Purpose:

- authoritative ownership for one concrete execution running under a run
- supports safe cleanup with compare-and-delete semantics

Meaning:

- a run may have one or more active jobs
- non-queue loops use a reserved singleton lock slot, so they have at most one active job
- queue loops may have multiple active jobs at once

## Locking Semantics

### Lease, not mutex

Do not treat this as a permanent state flag. It is a run job lease with TTL and heartbeat.

Rules:

- the owner gets a `job_token`
- only the owner may renew the lease
- only the owner may delete the lease
- renew/delete should use compare-and-set semantics
- use Lua or an equivalent atomic compare-and-renew / compare-and-delete operation
- one lock belongs to exactly one run job
- wildcard lock discovery must use Redis `SCAN` or a dedicated index/set, never `KEYS`

### Mutation lock semantics

Use a separate run-level mutation lock:

```text
eval:run:{run_id}:lock
```

Rules:

- mutation acquires the run mutation lock before changing run steps or mappings
- mutation checks that there are no active job locks under the run before proceeding
- mutation releases the run mutation lock in `finally`
- execution jobs must check for the run mutation lock before starting
- if the mutation lock exists, execution must wait, retry later, or fail fast depending on the loop contract

This separation matters:

- `eval:run:{run_id}:lock` protects the mutable run definition
- `eval:run:{run_id}:job:{job_id}:lock` protects one concrete execution

### TTL and heartbeat cadence

Use a time-based heartbeat, not a scenario-based heartbeat.

Recommended defaults:

- worker heartbeat TTL: 5 minutes
- worker heartbeat refresh: 30 seconds
- run job lock TTL: 5 minutes
- run job lock refresh: 30 seconds

Why not heartbeat per scenario:

- a single scenario can be slow
- different loops do not have a consistent "scenario boundary"
- long model calls and retries would make progress-based heartbeats too coarse

## How Heartbeat Should Work Per Loop

### SDK local loop

The API cannot own this heartbeat unless the SDK participates.

Recommendation:

- do not infer SDK execution from backend worker state
- expose an SDK heartbeat endpoint that acquires and renews a run job lock
- until then, `is_active` and `status` remain best-effort only for SDK runs

Practical rule:

- SDK runs become authoritative for runtime edit gating once they participate in run job locks

Suggested endpoints:

- `POST /preview/simple/evaluations/{run_id}/heartbeat`
- `DELETE /preview/simple/evaluations/{run_id}/heartbeat`

Note: `{run_id}` here is the evaluation run id (`run.id`). In `SimpleEvaluationsService` this is also referred to as `evaluation_id`.

Behavior:

- `POST` acquires or renews `eval:run:{run_id}:job:{job_id}:lock` with `job_type = "sdk"`
- `DELETE` releases the lock if the caller owns it

### Live query evaluation

This loop should use a run job lock only while a refresh execution is actually running.

Reason:

- a live run is logically active for a long time
- work happens in periodic refresh jobs
- there may be minutes between jobs

Proposal:

- keep `run.flags.is_active = true` for enabled live runs
- before dispatch or at task start, check whether `eval:run:{run_id}:lock` exists
- each dispatched refresh job acquires `eval:run:{run_id}:job:{job_id}:lock`
- if overlapping live refresh jobs are not allowed, check whether another active lock already exists for the run before dispatch or at task start

Result:

- `is_active` means the live run is enabled
- the Redis lock means a live refresh job is executing right now

### Batch query evaluation

Use one run job lock for the duration of the batch execution.

Proposal:

- check whether `eval:run:{run_id}:lock` exists before starting
- acquire `eval:run:{run_id}:job:{job_id}:lock` on task start
- heartbeat periodically until task exit
- clear on success/failure in `finally`

### Batch testset evaluation

This should behave the same as batch query.

Proposal:

- check whether `eval:run:{run_id}:lock` exists before starting
- acquire `eval:run:{run_id}:job:{job_id}:lock` on task start
- task heartbeat every 30 to 60 seconds

This is one of the best candidates for edit gating:

- if any active lock exists under the run, edits should be blocked or converted into stop-and-restart behavior

### Batch invocation

Use the same mechanism as batch testset.

Proposal:

- check whether `eval:run:{run_id}:lock` exists before starting
- acquire `eval:run:{run_id}:job:{job_id}:lock` on task start
- heartbeat until completion, then release

### Trace queue

Use one run job lock per appended batch.

Proposal:

- check whether `eval:run:{run_id}:lock` exists before starting
- each appended batch task acquires `eval:run:{run_id}:job:{job_id}:lock`
- multiple queue batch jobs may run concurrently for the same run

Implication:

- queue execution remains concurrent
- run mutation must check whether any active locks exist under the run

### Testcase queue

Same as trace queue.

Proposal:

- check whether `eval:run:{run_id}:lock` exists before starting
- each appended batch task acquires `eval:run:{run_id}:job:{job_id}:lock`
- multiple queue batch jobs may run concurrently for the same run

## Taskiq Integration

The cleanest integration point is middleware or a task wrapper around the registered evaluation tasks.

Responsibilities:

- resolve `job_id`
- check the run mutation lock
- acquire the run job lock on task start
- start a background heartbeat coroutine
- stop the heartbeat and release the lock in `finally`

This handles:

- normal completion
- exceptions in task code
- most application-level crashes where cleanup still runs

This does not fully handle:

- host crash
- container kill with no graceful shutdown
- `SIGKILL`

That is why TTL expiry is still required.

For API-owned Taskiq executions:

- `job_type = "api"`
- `job_id` should be the concrete Taskiq execution id
- non-queue loops may still use a reserved singleton lock slot in the key while storing the concrete Taskiq execution id in the payload

For SDK-owned executions:

- `job_type = "sdk"`
- `job_id` should be the SDK execution or session id

For web-owned executions if needed later:

- `job_type = "web"`
- `job_id` should be the browser/session execution id

## Step Mutation Model

Hard delete is the wrong default for steps.

Recommended model:

- allow `add`
- allow `archive`
- model `edit` as `archive + add`
- do not physically remove historical step definitions or results by default

Suggested step lifecycle:

- `active`
- `archived`
- optionally `superseded_by`

Backward-compatibility rule:

- absence of `archived` means the step is active / not archived
- do not persist `archived: false`
- only write archival state when a step is actually archived

Benefits:

- preserves historical results
- avoids orphaning in-flight writes
- keeps audits and old metrics reproducible
- lets UI hide archived steps by default without destroying history

## Evaluator Step Rules

Evaluator origins:

- `auto`
- `human`
- `custom`

Execution rule:

- scenarios are always created regardless of evaluator origin
- only `auto` evaluators are executed by backend workers
- `human` and `custom` steps remain pending until fulfilled by another mechanism

### Add evaluator step

#### Live query loops

Default rule:

- apply only to future scenarios

#### Non-live loops

Default rule:

- backfill all existing scenarios in the run

Applies to:

- batch query
- batch testset
- trace queue
- testcase queue

Operational requirement:

- schedule a separate backfill job for the newly added step
- do not rebuild or invalidate unrelated results

Backfill behavior:

- backfill runs as a separate execution, not inline with the mutation request
- mutation updates the run definition and then enqueues backfill work
- backfill acquires its own `eval:run:{run_id}:job:{job_id}:lock`
- backfill heartbeats like any other run job
- backfill should be loop-specific rather than one generic opaque job type
- evaluator-step backfill is only enqueued for newly added `auto` evaluators
- newly added `human` and `custom` evaluators do not trigger execution backfill

Likely job families:

- `evaluations.backfill.batch_query`
- `evaluations.backfill.batch_testset`
- `evaluations.backfill.trace_queue`
- `evaluations.backfill.testcase_queue`

### Archive evaluator step

Rule:

- do not schedule future executions for that step
- preserve historical results
- hide archived steps from default "current" views

If a step is archived while tasks are in flight:

- the executor should check step state before writing new results
- if archived, skip writing new result records for that step

## Input Step Rules

Input steps should support `auto` and `custom`.

The semantics are different from evaluator steps because they redefine the corpus.

### Live query loops

Input edits are feasible.

Rules:

- add query/input step: affects future windows only
- archive query/input step: stop generating new scenarios from it
- preserve historical scenarios already produced by that step

### Batch query

Possible, but this is close to redefining the run.

Rules:

- add input step: create new scenarios for newly included traces
- archive input step: stop including it in current aggregate views, preserve historical scenarios

This uses addition and archival semantics, not run revisioning.

### Batch testset

Most sensitive loop.

Rules:

- add input step: create scenarios for all new testcases from that source
- archive input step: preserve old scenarios and exclude archived source from current views

Recommendation:

- use addition and archival semantics, not run revisioning
- for active runs, block mutation while execution locks exist or stop execution first and then mutate

### Trace queue and testcase queue

These do not naturally have editable input-step graphs. The queue source is the appended items.

Recommendation:

- do not expose input-step editing for queue loops

## Metrics Rules

Metrics are stored per evaluation metrics entry, but the payload is keyed by `step_key`.

Implication:

- the backend refresh path builds `EvaluationMetrics.data` as a map of `step_key -> metrics`
- metric computation remains step-scoped even when stored in one run-level or scenario-level metrics row
- archiving a step does not change previously computed metrics for that step
- archived-step metrics remain available through the same step-keyed metric data

What changes after archival:

- default views can hide archived steps
- execution stops producing new results for that step
- the underlying metric records do not need a separate historical mode

What does not change after archival:

- metric aggregation remains per step
- existing archived-step metrics can continue to participate in aggregated views
- metric computation does not need special archived-step filtering

## Edit Gating And Data Integrity

Edits should not mutate a run blindly just because `flags.is_active` is false or true.

Recommended gating:

- mutation must first acquire `eval:run:{run_id}:lock`
- if any `eval:run:{run_id}:job:*:lock` exists for the run, treat the run as executing now (enumerate with Redis `SCAN` / `scan_iter` — never `KEYS` — to avoid blocking Redis under load)
- for batch testset and batch query, block mutation or convert it to stop-and-restart
- for live runs, allow plan mutation for future dispatches even while the run remains logically active
- for queue runs, allow mutation if the semantics are "applies to future batches" or if the system can safely backfill all existing scenarios

## Recommended First Implementation

### Phase 1

- add a run mutation lock
- add Redis run job locks with heartbeat
- add worker heartbeats
- expose "run currently executing" by checking whether any active locks exist under the run
- do not overload `is_active`

### Phase 2

- introduce step lifecycle with `active` and `archived`
- change evaluator edits to `archive + add`
- preserve historical results

### Phase 3

- implement evaluator-step backfill for non-live loops
- keep live-loop additions future-only by default

### Phase 4

- define how aggregate views include or exclude archived steps
- add explicit product semantics for input-step mutation

## Decisions Captured Here

- Queue batches are allowed to execute concurrently for the same run.
- Live-loop edits are future-only. Live loops do not backfill historical scenarios.
- Batch query and batch testset input-step changes use addition and archival semantics, not run revisioning.
- Archived-step results should remain queryable, ideally behind an `include_archived` style flag.

## Summary

The shortest safe path is:

- use Redis run job locks with heartbeats for runtime truth
- use a separate run mutation lock for step/input edits
- keep `is_active` as control-plane state
- use `archive`, not destructive `remove`
- model `edit` as `archive + add`
- backfill evaluator additions for non-live loops
- keep live-loop additions future-only unless explicitly backfilled
