# Cache And Split Audit

## Purpose

Audit all current evaluation loop kinds and determine:

- how hash-based cache reuse should be implemented
- how `repeats` should be implemented
- how `is_split` should control fan-out when `repeats > 1`

This document is the immediate first implementation step before broader refactors.

## Working Model

The target result identity is:

- `scenario_id`
- `step_key`
- `repeat_idx`

The target execution model is:

1. for each scenario
2. for each executable step
3. for each repeat
4. either reuse a cached trace or invoke execution

## Dispatch Topology

Current non-live evaluation dispatch in [`api/oss/src/core/evaluations/service.py`](/api/oss/src/core/evaluations/service.py) recognizes these worker topologies:

- query steps + evaluator steps -> `evaluate_batch_query`
- testset steps + application steps + evaluator steps -> `evaluate_batch_testset`
- testset steps + application steps + no evaluator steps -> `evaluate_batch_invocation`

Queue-only batch dispatch paths are separate:

- `evaluate_batch_traces`
- `evaluate_batch_testcases`

Live query evaluation is dispatched separately through `evaluate_live_query`.

Important consequence:

- fan-out location is not explicit in the run model today
- execution shape is determined implicitly by which runner is selected

## Matrix

| Loop kind | Entry point | Source unit | Executable steps | Current fan-out point(s) | Current result shape | Cache insertion point(s) | `is_split=true` target | `is_split=false` target | Main gaps |
|---|---|---|---|---|---|---|---|---|---|
| Legacy testset -> application -> evaluator | `evaluate_batch_testset` | testcase | application, evaluator | testcase/scenario level before application invoke | one result per scenario for input, application, evaluator; no repeat expansion | application invoke, evaluator invoke | create up to `repeats` application results per scenario; cache/reuse or invoke missing | reuse one application trace per scenario, fan out at evaluator results | no `repeat_idx` expansion; no explicit cache stage; no split flag use |
| Legacy testset -> application only | `evaluate_batch_invocation` | testcase | application | testcase/scenario level before application invoke | one input result + one invocation result per scenario | application invoke | create up to `repeats` application results per scenario | likely same as split=true, because there is no evaluator step | no `repeat_idx`; no cache stage; behavior for `repeats > 1` undefined |
| Queue batch from traces/testcases | `_evaluate_batch_items` via `evaluate_batch_traces` / `evaluate_batch_testcases` | testcase or trace | evaluator | source-item/scenario level before evaluator invoke | one input/invocation source result per scenario; one evaluator result per scenario | evaluator invoke | if queue ever allows application step, expand there; currently mostly evaluator only | create up to `repeats` evaluator results per scenario | no repeat expansion in evaluator loop; queues use repeats for assignment, not execution |
| Live query -> evaluator | `evaluate_live_query` | traced query result | evaluator | query-trace/scenario level | query result uses `repeat_idx=0`; evaluator results have no repeat expansion | evaluator invoke | likely not applicable unless live path grows application step support | create up to `repeats` evaluator results per scenario | hardcoded single repeat; application step not operational here |

## Loop Details

### 1. Legacy Testset -> Application -> Evaluator

Primary file:

- [`api/oss/src/core/evaluations/tasks/legacy.py`](/api/oss/src/core/evaluations/tasks/legacy.py)

Behavior:

- scenarios are created once per testcase
- one input result is created per scenario
- the application is batch-invoked once per testcase/scenario
- one invocation result is created per scenario
- each evaluator is then invoked once per scenario
- one evaluator result is created per scenario-step pair

Cache insertion point(s):

- application step: before batch application invoke
- evaluator step: before evaluator workflow invoke

`is_split=true` target:

- application step is the repeat fan-out point
- for each scenario and application step, fetch traces by hash
- if matches >= repeats, bind them to repeat slots
- if matches < repeats, reuse what exists and invoke the missing application repeats
- downstream evaluator steps consume the per-repeat application traces

`is_split=false` target:

- application step should not fan out
- for each scenario and application step, fetch traces by hash
- if at least one application trace exists, reuse the latest one
- otherwise invoke one application trace
- evaluator steps fan out across repeats and each evaluator repeat may do its own cache lookup

Gaps:

- no repeat loop
- no `repeat_idx` result creation
- no hash lookup stage
- no explicit split semantics

### 2. Legacy Testset -> Application Only

Primary file:

- [`api/oss/src/core/evaluations/tasks/legacy.py`](/api/oss/src/core/evaluations/tasks/legacy.py)

Behavior:

- scenarios are created once per testcase
- one input result is created per scenario
- one application invocation result is created per scenario
- no evaluator steps run

Cache insertion point(s):

- application step only

Implication:

- `is_split` has little semantic value here because there is no evaluator boundary to defer fan-out to
- if `repeats > 1`, this loop effectively behaves like application-step fan-out

Gaps:

- same repeat/result gap as above
- no explicit policy for no-evaluator runs with `repeats > 1`

### 3. Queue Batch From Traces Or Testcases

Primary files:

- [`api/oss/src/core/evaluations/tasks/legacy.py`](/api/oss/src/core/evaluations/tasks/legacy.py)
- [`api/oss/src/core/evaluations/service.py`](/api/oss/src/core/evaluations/service.py)

Behavior:

- queue dispatch is restricted to runs with `is_queue=true`
- source items are testcase IDs or trace IDs
- scenarios are created once per source item
- source/input/invocation results are created once per scenario as applicable
- evaluator steps run once per scenario

Important distinction:

- queue `repeats` is already used for assignment lanes and queue presentation
- queue `repeats` is not yet used as a generic execution fan-out dimension

That means:

- queue semantics already recognize repeat lanes
- evaluator execution still behaves as if there is only one repeat

Cache insertion point(s):

- evaluator step, before evaluator workflow invoke

`is_split=false` is likely the natural default here:

- reuse one upstream source/application trace where available
- fan out at evaluator results per repeat lane

Gaps:

- no evaluator repeat loop
- no per-repeat result creation
- queues use repeats for assignment, not execution

### 4. Live Query -> Evaluator

Primary file:

- [`api/oss/src/core/evaluations/tasks/live.py`](/api/oss/src/core/evaluations/tasks/live.py)

Behavior:

- traces are queried first
- one scenario is created per query trace
- one query-step result is created per scenario with `repeat_idx=0`
- evaluator steps run once per scenario

Important detail:

- this path already encodes single-repeat behavior explicitly via `repeat_idx=0`

Implication:

- repeats are not operational here yet
- this path is the clearest sign that repeat expansion is still missing from the execution layer

Cache insertion point(s):

- evaluator step, before evaluator workflow invoke

Likely target:

- if repeats are supported for live evaluation, fan-out should most naturally happen at evaluator steps unless live application-step execution is added as a first-class concept

Gaps:

- hardcoded single repeat
- no cache lookup stage
- invocation steps are parsed but not materially used in the loop shape

## Cross-Run Reuse

Cross-run reuse should be implicitly supported once cache lookup is hash-based and not scoped to the current run.

That means:

- `is_cached=true` explicitly enables reuse
- the fetched traces are not limited to the current evaluation run
- reuse may bind traces produced by previous runs as long as the hash matches

Implementation requirement:

- `fetch_traces_by_hash(...)` must operate at the intended reuse scope, most likely project scope

## `is_split` Validity By Loop Type

`is_split` is not equally meaningful across all loop kinds.

### Loops Where `is_split` Can Only Be `false`

These loops only have meaningful runnable fan-out at evaluator steps:

- live query evaluation
- queue batch evaluation from traces
- queue batch evaluation from testcases

For these loop kinds:

- `is_split=false` is the only meaningful value
- application-step fan-out is not part of the operational loop shape

### Loops Where `is_split` Is Meaningful

These loops contain both application and evaluator execution boundaries:

- legacy testset -> application -> evaluator evaluation

For this loop kind:

- `is_split=true` means fan-out at the application step
- `is_split=false` means fan-out at the evaluator step

### Loops Where `is_split` Is Irrelevant

These loops do not have an evaluator boundary after the application step:

- legacy testset -> application-only evaluation

For this loop kind:

- `is_split` does not meaningfully change execution shape
- if `repeats > 1`, behavior effectively reduces to application-step repetition

## Utilities Needed

Core primitives:

- `make_hash(...)`
- `fetch_traces_by_hash(...)`

Plural fetch is required because repeat-aware reuse depends on cardinality.

Supporting helpers:

- `select_traces_for_reuse(...)`
- `plan_missing_traces(...)`
- a repeat-aware fan-out planner
- a repeat-aware result-slot planner
- per-slot reuse resolution

## Current Findings

### Repeats

`repeats` exists in the run model and is propagated through service-layer DTOs, but it is not yet a general execution-time loop dimension across current runners.

Evidence:

- live evaluation writes query-step results with `repeat_idx=0`
- legacy runners create scenarios from testcase/trace counts, not from `repeats`
- queue flows use repeats primarily for assignment lanes and presentation

### Fan-Out

Fan-out is currently implicit in runner topology, not explicit in run flags.

Desired future state:

- `is_split=true` -> application-step fan-out when `repeats > 1`
- `is_split=false` -> evaluator-step fan-out when `repeats > 1`

### Results

The database uniqueness constraint already implies the intended result identity:

- `scenario_id`
- `step_key`
- `repeat_idx`

So the execution layer needs to catch up with the persistence model.

## Immediate Next Steps

1. Add a repeat-aware result planner that materializes result slots for every `scenario_id` / `step_key` / `repeat_idx`.
2. Refactor the legacy testset runner around explicit per-repeat loops.
3. Refactor `_evaluate_batch_items` so queue evaluation becomes per-repeat, not just per-assignment-lane metadata.
4. Refactor live evaluation so `repeat_idx` is no longer hardcoded to `0`.
5. Add cache lookup at runnable step boundaries:
   - application step
   - evaluator step
6. Define deterministic trace selection order for reuse candidates.
7. Add tests for:
   - full cache hit
   - partial cache hit
   - zero cache hit
   - `is_split=true`
   - `is_split=false`
   - cross-run reuse
