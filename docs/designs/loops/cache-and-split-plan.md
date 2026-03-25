# Cache And Split Plan

## Goal

Implement repeat-aware evaluation execution with:

- explicit cache opt-in through `is_cached`
- explicit fan-out control through `is_split`
- one result per `scenario_id` / `step_key` / `repeat_idx`
- hash-based trace reuse across runs

## Core Model

### Result Identity

Each execution result is identified by:

- `scenario_id`
- `step_key`
- `repeat_idx`

This is already aligned with the current database uniqueness constraint.

### Run Flags

Two run flags control behavior:

- `is_cached`
  - default `false`
  - when `true`, runnable steps may reuse traces by hash
- `is_split`
  - default `false`
  - when `repeats > 1`:
    - `true` means fan-out at the application step
    - `false` means fan-out at the evaluator step

### Cache Scope

Cache reuse is:

- explicit at the run level through `is_cached`
- implicit across runs once enabled

That means trace lookup must not be limited to the current evaluation run.

## Required Components

### 1. Hash Utility

Add a utility:

- `make_hash(...)`

Responsibilities:

- compute canonical trace identity from references and links
- use the same normalization rules as ingestion-time hashing
- exclude `testset_variant` and `testset_revision`

### 2. Trace Lookup Utility

Add a utility:

- `fetch_traces_by_hash(...)`

Responsibilities:

- fetch all candidate traces for a given hash
- support deterministic ordering
- operate at project scope

Why plural:

- repeat-aware reuse depends on how many traces already exist
- partial cache hits need all matching traces, not just one

### 3. Trace Selection Helper

Add a helper:

- `select_traces_for_reuse(...)`

Responsibilities:

- choose which fetched traces satisfy the current repeat demand
- apply deterministic ordering
- return the selected traces for reuse

### 4. Missing-Trace Planner

Add a helper:

- `plan_missing_traces(...)`

Responsibilities:

- compare required repeat slots with fetched reusable traces
- determine how many new executions are still required
- preserve repeat-slot identity

### 5. Repeat/Fan-Out Planner

Add a helper:

- `plan_step_fanout(...)`

Responsibilities:

- interpret `repeats`
- interpret `is_split`
- determine whether the current runnable step fans out
- determine how many traces are required at that step

## Loop Rules

### Testset -> Application -> Evaluator

This is the main loop where `is_split` matters.

If `is_split=true`:

- application steps fan out across repeats
- application traces are fetched by hash
- if matches >= repeats, reuse them
- if matches < repeats, reuse what exists and invoke the missing repeats
- evaluator steps consume per-repeat application traces

If `is_split=false`:

- application steps do not fan out
- fetch application traces by hash
- if at least one matching application trace exists, reuse the latest one
- otherwise invoke one application trace
- evaluator steps fan out across repeats
- evaluator traces are fetched by hash per repeat demand

### Live Query -> Evaluator

Only evaluator-step fan-out is meaningful here.

Rules:

- `is_split` must effectively be `false`
- repeats fan out at evaluator steps only
- evaluator step is the cache insertion point

### Queue Batch From Traces/Testcases

Only evaluator-step fan-out is meaningful here.

Rules:

- `is_split` must effectively be `false`
- queue repeats already exist as assignment lanes
- execution must be upgraded so evaluator results are created per repeat lane
- evaluator step is the cache insertion point

### Application-Only Batch Evaluation

`is_split` is not meaningful here.

Rules:

- if `repeats > 1`, behavior reduces to application-step repetition
- cache lookup occurs at the application step

## Execution Refactor Tasks

### Task 1. Materialize Repeat Slots

Refactor execution loops so they iterate over:

1. scenarios
2. executable steps
3. repeat indices

Technical requirement:

- stop assuming one result per scenario-step pair
- create one result slot per `scenario_id` / `step_key` / `repeat_idx`

### Task 2. Introduce Cache Resolution Before Invocation

At each runnable step:

1. build the expected hash
2. fetch traces by hash
3. select reusable traces
4. plan missing traces
5. invoke only for missing slots

Technical requirement:

- cache lookup must happen before step invocation
- execution must bind reused traces back to concrete result slots

### Task 3. Refactor Testset Runner

Target file:

- `api/oss/src/core/evaluations/tasks/legacy.py`

Technical changes:

- refactor `evaluate_batch_testset`
- make application step repeat-aware
- make evaluator step repeat-aware
- enforce `is_split` semantics

### Task 4. Refactor Queue Batch Runner

Target file:

- `api/oss/src/core/evaluations/tasks/legacy.py`

Technical changes:

- refactor `_evaluate_batch_items`
- make evaluator execution repeat-aware
- align queue repeat lanes with `repeat_idx`
- add evaluator-step cache resolution

### Task 5. Refactor Live Runner

Target file:

- `api/oss/src/core/evaluations/tasks/live.py`

Technical changes:

- remove hardcoded single-repeat behavior
- replace `repeat_idx=0` assumptions with repeat-aware result creation
- add evaluator-step cache resolution
- enforce `is_split=false`

### Task 6. Validate Run Topology

Add topology validation before dispatch/execution.

Technical rules:

- live evaluation must reject or ignore `is_split=true`
- queue trace/testcase evaluation must reject or ignore `is_split=true`
- application-only loops should treat `is_split` as irrelevant
- testset -> application -> evaluator loops must honor `is_split`

## Data And API Tasks

### Task 7. Keep Run Flags End-To-End

Ensure both flags are preserved through:

- run create
- run edit
- run fetch
- run query
- simple evaluation parsing
- queue parsing where relevant

### Task 8. Add Query Support For Cache/Split Filtering

`EvaluationRunQueryFlags` should support filtering by:

- `is_cached`
- `is_split`

Technical requirement:

- query paths must preserve `false` explicitly, not only `true`

## Testing Tasks

### Task 9. Add Unit Tests For Planning Helpers

Tests should cover:

- hash creation inputs
- plural trace fetch assumptions
- trace selection for reuse
- missing-trace planning
- split vs non-split fan-out planning

### Task 10. Add Loop-Level Tests

Tests should cover:

- one result per `scenario_id` / `step_key` / `repeat_idx`
- `is_split=true` on testset -> application -> evaluator runs
- `is_split=false` on testset -> application -> evaluator runs
- queue evaluation with repeat-aware evaluator results
- live evaluation with repeat-aware evaluator results

### Task 11. Add Cache Behavior Tests

Tests should cover:

- full cache hit
- partial cache hit
- zero cache hit
- cross-run reuse
- deterministic selection order

## Constraints

- `is_cached=false` means no hash reuse
- `is_split=false` means evaluator-step fan-out when `repeats > 1`
- missing cached traces never eliminate required execution for missing repeat slots
- cache reuse must not collapse distinct repeat result identities
- cross-run reuse must be supported once `is_cached=true`

## Suggested Implementation Order

1. Add helper utilities:
   - `make_hash(...)`
   - `fetch_traces_by_hash(...)`
   - `select_traces_for_reuse(...)`
   - `plan_missing_traces(...)`
   - `plan_step_fanout(...)`
2. Refactor result-slot creation around `repeat_idx`.
3. Refactor `evaluate_batch_testset`.
4. Refactor `_evaluate_batch_items`.
5. Refactor `evaluate_live_query`.
6. Add topology validation for `is_split`.
7. Add loop-level and cache-level tests.
