# Plan

## Goal

Make trace reuse via hashing correct and consistent with repeat-aware evaluation execution.

## Working Model

Repeats are a first-class execution dimension.

For each:

- `scenario_id`
- `step_key`
- `repeat_idx`

there should be exactly one evaluation result slot.

That means the execution model is:

1. for each scenario
2. for each executable step
3. for each repeat
4. create or resolve exactly one result

This matches the existing evaluation result identity shape:

- `scenario_id`
- `step_key`
- `repeat_idx`

## Planned Changes

### 1. Make Repeat Expansion Explicit In Execution

Update evaluation execution loops so they operate over:

- scenarios
- executable steps
- repeat indices

instead of implicitly assuming a single result per scenario-step pair.

Expected outcome:

- each executable step produces one result per repeat
- `repeat_idx` becomes operational rather than incidental

### 2. Define Fan-Out Explicitly

When `repeats > 1`, the run must explicitly declare where fan-out happens through a run flag:

- `is_split`

Semantics:

- `is_split=false` by default
- if `repeats > 1` and `is_split=true`, fan-out happens at the application step
- if `repeats > 1` and `is_split=false`, fan-out happens at the evaluator step

This must be explicit in code, not inferred loosely from current runner structure.

### 3. Apply Hash Reuse At The Step Being Executed

For any runnable step:

- compute the expected hash for the current `scenario_id` / `step_key` / `repeat_idx` context
- try to fetch existing traces by hash
- if enough traces exist for the repeat demand at that step, reuse them
- if not enough traces exist, reuse what exists and generate the missing traces

Required primitives:

- `make_hash(...)`
- `fetch_traces_by_hash(...)`

Required planning helpers:

- `select_traces_for_reuse(...)`
- `plan_missing_traces(...)`
- repeat-aware fan-out planning
- repeat-aware result-slot planning
- per-slot reuse resolution

### 4. Preserve Cross-Step Reuse Where Valid

When repeats fan out at evaluator steps:

- application-step traces may be reused across evaluator repeats

Rule:

- if at least one matching application trace exists, reuse the latest one for all evaluator repeats
- only invoke the application step when no matching trace exists

### 5. Keep Reuse Explicit Via Run Flags

Trace reuse and fan-out behavior must remain explicit through evaluation run flags:

- `is_cached`
- `is_split`

Default:

- `false`

## Immediate Implementation Tasks

1. Audit all evaluation task runners and identify where results are created without repeat expansion.
2. Refactor result creation loops to iterate by `repeat_idx`.
3. Add and propagate `is_split` on evaluation runs.
4. Define the canonical repeat/fan-out behavior for:
   - application steps
   - evaluator steps
5. Apply hash lookup/reuse logic at the correct step boundary.
   - add `make_hash(...)`
   - add `fetch_traces_by_hash(...)`
   - add trace-selection / missing-trace planning
6. Add tests covering:
   - one result per `scenario_id` / `step_key` / `repeat_idx`
   - application-step fan-out with partial cache hits
   - evaluator-step fan-out with partial cache hits
   - cross-step reuse of application traces across evaluator repeats

## Constraints

- `is_cached=false` means no hash reuse
- `is_split=false` means evaluator-step fan-out when `repeats > 1`
- missing cached traces never eliminate required execution for missing repeat slots
- hash reuse must not collapse distinct repeat result identities
