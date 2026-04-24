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

The plan is incremental. Existing loop families should keep working while the shared planner and executor take over topology by topology. This is a refactor over already implemented backend behavior, not a from-zero feature plan.

## Phase 0. Current-State Inventory

1. Lock down the current behavior with code references and tests before changing design docs again.
2. Treat these as implemented baseline behavior:
   - `is_cached`
   - `is_split`
   - `is_queue`
   - `repeats`
   - repeat-indexed result creation in current backend workers
   - hash-based cache helpers and worker integration
   - source-aware queue creation and source batch dispatch
   - human/custom pending behavior in query/queue-related paths
3. Build a parity matrix from current tests:
   - `test_cache_split_utils.py`
   - `test_query_eval_loops.py`
   - `test_run_flags.py`
   - queue assignment and queue DAO tests
   - acceptance tests for evaluation steps/runs/queues/results
4. Review `application/docs/design/annotation-queue-v2` as product context for queue-facing API and UI requirements.

## Phase 1. Normalize Vocabulary

1. Use current backend flag names as canonical:
   - `is_cached` for trace reuse
   - `is_split` for fan-out location
   - `repeats` for repeat count
2. Add documentation-only compatibility mapping for older names unless real clients require request compatibility:
   - `reuse_traces -> is_cached`
   - `repeat_target="application" -> is_split=true`
   - `repeat_target="evaluator" -> is_split=false`
3. Normalize origin values:
   - `auto`
   - `human`
   - `custom`
4. Verify and then fix or bridge any frontend `automated` usage to backend `auto`.
5. Document topology validation rules in one table used by implementation and tests.

## Phase 2. Add Shared Models

Introduce shared internal models without changing external behavior:

1. `InputSourceSpec`
2. `ResolvedSourceItem`
3. `ScenarioBinding`
4. `EvaluationStep`
5. `TensorSlice`
6. `PlannedCell`
7. `ExecutionPlan`
8. `ProcessSummary`

The first implementation can live inside backend evaluation core. SDK parity can follow once the contract is stable.

## Phase 3. Implement Source Resolvers

Create resolver interfaces:

```python
class SourceResolver:
    async def resolve(source, context) -> list[ResolvedSourceItem]
```

Extract current resolver behavior for:

1. query revision -> trace refs for live windows
2. query revision -> trace refs for source-backed queues
3. testset revision -> testcase refs for source-backed queues
4. testset revision -> testcase payloads for batch testset/invocation
5. direct trace IDs -> trace refs
6. direct testcase IDs -> testcase refs

Acceptance criteria:

- existing source behavior is preserved
- resolver tests cover empty, invalid, and multi-source cases
- live query resolver owns windowing behavior
- queue source resolvers preserve direct-item behavior

## Phase 4. Normalize Tensor Slice Operations

Add or adapt backend service operations around existing CRUD:

1. `probe(slice)`
2. `populate(slice, results)`
3. `prune(slice)`
4. `process(slice)` as an internal service operation first

Acceptance criteria:

- slice dimensions support `all`, `none`, and explicit lists
- `probe` can identify missing, success, failure, and any cells
- `populate` writes by `scenario_id + step_key + repeat_idx`
- `prune` deletes by slice and flushes affected metrics

## Phase 5. Extract Repeat-Aware Planner

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

Start by reproducing current evaluator-only behavior because it has fewer upstream dependencies:

- batch query -> evaluator
- direct trace queue -> evaluator
- direct testcase queue -> evaluator

Acceptance criteria:

- one planned cell exists for every required repeat slot
- unsupported topologies fail with structured validation errors
- human/custom steps are planned as pending rather than silently skipped

## Phase 6. Extract Cache Resolution

Reuse the existing cache helpers:

1. `make_hash(...)`
2. `fetch_traces_by_hash(...)`
3. `select_traces_for_reuse(...)`
4. `plan_missing_traces(...)`
5. per-slot trace binding

Move per-loop cache lookup into one runnable-step cache resolver used when `is_cached=true`.

Acceptance criteria:

- cache lookup is skipped when `is_cached=false`
- full cache hit invokes nothing
- partial cache hit invokes only missing slots
- miss invokes all required slots
- reused and newly generated traces populate identical tensor cells
- lookup scope supports cross-run reuse where intended

## Phase 7. Introduce Runnable-Step Executor

Add a runnable execution boundary that can execute any auto step whose type maps to a runnable.

Initial adapters:

1. application step adapter wrapping the current application invocation path
2. evaluator step adapter wrapping the current workflow invocation path

The interface should own:

- request construction from step references and upstream bindings
- cache resolver integration
- invocation
- trace fetch/validation
- normalized `StepExecutionResult`
- error-to-result conversion

Acceptance criteria:

- existing application invocation behavior is preserved under the adapter
- existing evaluator invocation behavior is preserved under the adapter
- planner code does not call legacy helper functions directly
- legacy helper usage is isolated behind adapters and can be deprecated later

## Phase 8. Move Evaluator-Only Topologies

Route these loops through the shared planner/executor:

1. batch query
2. live query
3. queue traces
4. queue testcases

Implementation notes:

- live query keeps its scheduler/windowing behavior, but uses the shared resolver and planner for each tick.
- queue repeats must preserve current assignment behavior while using the same execution slot model.
- human/custom evaluator pending behavior must match current behavior.

Acceptance criteria:

- existing auto evaluator behavior is unchanged
- repeats produce one result per repeat slot
- query-backed human/custom evaluator tests pass
- direct queue regressions pass

## Phase 9. Move Testset Application Topologies

Route application-bearing testset loops through the planner/executor:

1. testset -> application, also called batch inference / batch invocation
2. testset -> application -> evaluator

Preserve current `is_split` behavior when moving testset loops into the planner:

- `is_split=true`: application fan-out
- `is_split=false`: evaluator fan-out
- batch inference / application-only: application fan-out when `repeats > 1`

Acceptance criteria:

- application result slots are repeat-aware
- evaluator result slots consume the correct upstream application trace
- both fan-out modes are tested
- cache reuse works at application and evaluator boundaries
- application invocation goes through the runnable-step executor, not directly through loop-local legacy helpers

## Phase 10. Add Canonical Setup API

Add a graph-oriented creation path:

```python
class EvaluationCreate:
    inputs: list[InputSourceSpec]
    steps: list[ExecutableStepSpec]
    flags: EvaluationFlags
```

Keep existing setup endpoints as wrappers:

- auto testset evaluation
- human testset evaluation
- live query evaluation
- direct trace/testcase queues
- SDK/local helpers

Keep and normalize the source-aware queue creation that currently exists:

- query revisions -> trace items
- testset revisions -> testcase items

Add the Annotation Queue v2 convenience layer on top of the canonical setup path:

- create queues from trace IDs without exposing the backing run
- create queues from testset revisions without exposing the backing run
- preserve evaluator/schema-driven annotation result shape
- keep assignment/repeats mapped to queue data and result `repeat_idx`
- avoid introducing a separate task runtime

Acceptance criteria:

- existing API consumers are not broken
- new setup path preserves source revision references
- source-aware queues execute on concrete items
- invalid mixed-source requests fail before run creation

## Phase 11. Expose Graph And Processing Operations

Expose or stabilize operations:

1. `add_step`
2. `remove_step`
3. `set_flag`
4. `process(slice)`
5. `probe(slice)`
6. `prune(slice)`
7. `populate(slice, results)`
8. `refresh_metrics(scope)`

Acceptance criteria:

- removing a step prunes its tensor cells
- closed runs reject structural and tensor mutations
- `process(slice)` can retry failures and fill missing cells
- metrics refresh is scoped or conservatively flushed after mutations

## Phase 12. SDK And Frontend Parity

SDK:

1. Extract remote API persistence adapter.
2. Use shared slice/process semantics.
3. Add probe-before-write.
4. Align step keys and flags with backend.

Frontend:

1. Normalize origin naming.
2. Display pending cells consistently.
3. Add targeted retry/fill-missing affordances backed by `TensorSlice`.
4. Add or update source-aware queue setup UI only after the normalized backend API is stable.
5. Add the Annotation Queue v2 inbox/detail experience as a convenience UI over evaluation queues and results.

## Phase 13. Retire Specialized Loops And Legacy Helpers

After parity coverage exists:

1. Remove duplicate nested-loop implementations.
2. Keep thin dispatch wrappers for scheduler/task routing.
3. Delete compatibility flag bridges only after all callers use canonical names.
4. Deprecate or delete legacy application/evaluator helper paths that are fully covered by runnable-step executors.
5. Update docs to make the unified planner and runnable-step executor the primary design reference.

## Test Plan

Add tests in layers:

1. Resolver unit tests
2. Planner unit tests
3. Tensor slice operation tests
4. Cache helper tests
5. Topology validation tests
6. Worker integration tests per topology
7. Source-aware queue API tests
8. SDK/backend parity tests where practical
9. Regression tests for existing setup endpoints

Minimum topology matrix:

| Topology | Repeats | Cache | Origins |
|---|---:|---:|---|
| query -> evaluator | yes | yes | auto, human, custom |
| direct trace -> evaluator | yes | yes | auto, human, custom |
| direct testcase -> evaluator | yes | yes | auto, human, custom |
| testset -> application, batch inference | yes | yes | auto |
| testset -> application -> evaluator | yes | yes | auto, human, custom |

## Rollout Notes

Use feature flags or internal routing switches while moving topologies. Each topology should be migrated only after its planner output can be compared with the current loop output for representative runs.

The key risk is changing result cardinality when repeats become fully operational. Treat repeat-aware execution as a visible behavior change and gate it with tests and migration notes.
