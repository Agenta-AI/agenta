# Plan

## Goal

Move from multiple specialized setup and execution functions to unified evaluation loop(s) built around:

- source resolvers
- run graph steps
- tensor slices
- repeat-aware planning
- origin-aware execution
- runnable-step execution
- adapter-based persistence

This plan describes required work, not phases or timeline.

## Baseline Inventory

1. Lock down the current behavior with code references and tests before changing semantics.
2. Treat these as implemented baseline behavior:
   - `is_cached`
   - `is_split`
   - current `is_queue`
   - `repeats`
   - repeat-indexed result creation in current backend workers
   - hash-based cache helpers and worker integration
   - source-aware queue creation and source batch dispatch
   - human/custom pending behavior in query/queue-related paths
3. Maintain a parity matrix from current tests:
   - `test_cache_split_utils.py`
   - `test_query_eval_loops.py`
   - `test_run_flags.py`
   - queue assignment and queue DAO tests
   - acceptance tests for evaluation steps/runs/queues/results

## Vocabulary And Flags

1. Use current backend names as canonical:
   - `is_cached`
   - `is_split`
   - `repeats`
2. Normalize origin values:
   - `auto`
   - `human`
   - `custom`
3. Add explicit source-family flags:
   - `has_queries`
   - `has_testsets`
   - `has_traces`
   - `has_testcases`
4. Separate source-family classification from simple-queue eligibility.
5. Redefine target `run.flags.is_queue` as:

```text
active default queue exists + active human evaluator work exists
```

6. Document topology validation rules in one table used by implementation and tests.

## Shared Runtime Models

Introduce or consolidate shared internal models:

1. `InputSourceSpec`
2. `ResolvedSourceItem`
3. `ScenarioBinding`
4. `EvaluationStep`
5. `TensorSlice`
6. `PlannedCell`
7. `ExecutionPlan`
8. `ProcessSummary`

The common runtime contract should live in the SDK so SDK-local evaluations and API workers share the same planner/topology/result-cell model. Backend code should keep API-specific source, DAO, workflow-service, and worker-dispatch adapters in backend modules.

## Source Resolution

Create resolver interfaces that cover:

1. query revision -> trace refs for live windows
2. query revision -> trace refs for source-backed queues
3. testset revision -> testcase refs for source-backed queues
4. testset revision -> testcase payloads for batch testset/invocation
5. direct trace IDs -> trace refs
6. direct testcase IDs -> testcase refs

Resolver requirements:

- preserve existing source behavior
- own live query windowing
- preserve original source references in input steps
- reject unsupported mixed-source combinations explicitly
- expose source-family flags consistently

## Tensor Slice Operations

Add or adapt backend service operations around existing CRUD:

1. `probe(slice)`
2. `populate(slice, results)`
3. `prune(slice)`
4. `process(slice)`

Requirements:

- slice dimensions support all/none/explicit selections
- `probe` identifies missing, success, failure, and any cells
- `populate` writes by `scenario_id + step_key + repeat_idx`
- `prune` deletes by slice and refreshes affected metrics

## Planner

Implement planner logic that produces result slots before execution.

Planner responsibilities:

1. validate topology
2. order steps
3. materialize scenario bindings
4. create input cells
5. expand repeat slots
6. decide fan-out boundary
7. bind upstream context
8. mark `human` and `custom` cells pending
9. select `auto` cells for execution

Planner requirements:

- one planned cell exists for every required repeat slot
- unsupported topologies fail with structured validation errors
- human/custom steps are planned as pending rather than silently skipped

## Cache Resolution

Reuse the existing cache helpers:

1. `make_hash(...)`
2. `fetch_traces_by_hash(...)`
3. `select_traces_for_reuse(...)`
4. `plan_missing_traces(...)`
5. per-slot trace binding

Requirements:

- cache lookup is skipped when `is_cached=false`
- full cache hit invokes nothing
- partial cache hit invokes only missing slots
- misses invoke all required slots
- reused and newly generated traces populate identical tensor cells

## Runnable-Step Execution

Add a runnable execution boundary for any auto step whose type maps to a runnable.

Initial adapters:

1. SDK workflow-runner protocols for application/evaluator execution
2. SDK/local adapters wrapping decorator/service endpoint execution
3. API adapters wrapping the current backend workflow invocation path
4. API application adapter wrapping the current legacy batch invocation path

The interface should own:

- request construction from step references and upstream bindings
- cache resolver integration
- invocation
- trace fetch/validation
- normalized `StepExecutionResult`

## Queue Integration

1. Treat default queues as persisted human-work views over the tensor, not orchestration.
2. Add `queue.flags.is_default` to identify the canonical queue.
3. Keep default queues open over scenarios, steps, and assignments.
4. Let source-family flags describe where scenarios come from.
5. Let `run.flags.is_queue` describe simple-queue eligibility.
6. Ensure queue eligibility depends on active human steps and active default queue lifecycle.

## Mutation Semantics

1. Decide whether ordinary evaluator removal is archival/deactivation rather than destructive deletion.
2. If history must remain visible, represent active versus archived step state in the graph model.
3. Make planner defaults operate on active steps.
4. Reserve hard remove/prune for explicit destructive cleanup.
5. Keep queue eligibility tied to active human steps.

## Verification

Add or preserve coverage for:

1. topology classification
2. resolver behavior
3. repeat slot creation
4. cache reuse
5. human/custom pending behavior
6. query/testset/direct trace/direct testcase source families
7. source-family validation
8. tensor slice probe/populate/prune/process behavior
9. queue/default-queue integration semantics
10. active-versus-archived step behavior once chosen
