# Research

## Scope

This document consolidates the existing evaluation-loop design notes and the
current implementation state from:

- `application/docs/designs/eval-loops`
- `application/docs/designs/loops`
- `application/docs/designs/query-eval-loops`
- `application/docs/design/annotation-queue-v2`
- `application/api/oss/src/core/evaluations/types.py`
- `application/api/oss/src/core/evaluations/utils.py`
- `application/api/oss/src/core/evaluations/service.py`
- `application/api/oss/src/core/evaluations/tasks/legacy.py`
- `application/api/oss/src/core/evaluations/tasks/live.py`
- `application/api/oss/tests/pytest/unit/evaluations/*`

The goal is to identify the common execution model behind the current loop families and the places where setup and execution still diverge.

## Current Loop Families

The runtime currently has several explicit evaluation loop families:

| Loop family | Source unit | Input steps | Application steps | Evaluator steps | Scenario represents |
|---|---|---:|---:|---:|---|
| Live query | trace returned by query | `1..N` query | `0` | `1..N` | queried trace |
| Batch query | trace returned by query | `1..N` query | `0` | `1..N` | queried trace |
| Batch testset | testcase | `1..N` testset | `1` | `1..N` | testcase |
| Batch inference / batch invocation | testcase | `1..N` testset | `1` | `0` | testcase |
| Queue traces | trace ID | `1` synthetic source | `0` | `1..N` | provided trace |
| Queue testcases | testcase ID | `1` synthetic source | `0` | `1..N` | provided testcase |
| SDK/local | runner-defined | run-defined | run-defined | run-defined | runner-defined |

## Related Design: Annotation Queue v2

`application/docs/design/annotation-queue-v2` matters because annotation queues are one of the main consumers of unified evaluation loop infrastructure.

The durable direction from that design is:

- keep `EvaluationRun`, `EvaluationScenario`, `EvaluationResult`, and `EvaluationQueue` as backing infrastructure
- expose a simpler annotation queue API/UI that hides backing run/scenario/result setup
- do not introduce a separate annotation task runtime unless the existing entities prove insufficient
- map assignment/repeats through `EvaluationQueue.data.user_ids` and `EvaluationResult.repeat_idx`
- support trace and testset annotation as consumer-facing queue creation flows

Some current-state claims in that older design are stale. In current code, source-aware queue creation and human/custom pending behavior are already partially implemented. The useful takeaway is the layering principle: annotation queues are a convenience layer over evaluation entities, not a separate execution model.

The current worker dispatch only supports a subset of possible graphs:

- `query(1..N) -> evaluator(1..N)`
- `testset(1..N) -> application(1) -> evaluator(1..N)`
- `testset(1..N) -> application(1)`
- `queue source(1) -> evaluator(1..N)`

Unsupported by the current simple-evaluation worker dispatch, with product priority:

| Unsupported shape | Priority | Notes |
|---|---|---|
| multiple application steps in one worker-dispatched run | not planned | A/B comparison can remain separate evaluations for the foreseeable future. |
| query inputs followed by application steps | potentially useful | The planner must treat query traces as input data, not as invocation links for the application step. If query trace IDs are placed in application `links`, the resulting application traces may be classified as annotations rather than invocations. |
| testset inputs followed directly by evaluator steps in non-queue mode | potentially useful | Useful for evaluators that can score testcase payloads without first invoking an application. Requires an explicit evaluator input contract. |
| mixed query and testset source families in one queue | not planned | Keep queues single-source-family for now. |
| live testset evaluation | not planned | Static testsets do not make sense as periodic live sources. |

## Shared Runtime Model

All loop families can be described with the same conceptual entities:

- input source descriptors
- materialized scenarios
- executable steps
- result cells
- repeat slots
- execution flags

The intended result identity is already visible in the persistence model:

```text
scenario_id + step_key + repeat_idx
```

That identity is the core tensor coordinate. A unified loop should treat every execution as filling, probing, or pruning cells in this coordinate system.

The current code already models this directly:

- `EvaluationResult` has `scenario_id`, `step_key`, and `repeat_idx`.
- `EvaluationResultQuery` can filter by `scenario_ids`, `step_keys`, and `repeat_idxs`.
- worker loops now create repeat-indexed result rows in the main batch, queue, and live paths.

## Steps

Current run data already carries step definitions with:

- `key`
- `type`
- `origin`
- `references`
- optional input links

The shared step types are:

| Step type | Meaning | Typical references |
|---|---|---|
| `input` | Source materialization | query revision, testset revision, direct trace/testcase source |
| `invocation` | Application/workflow execution | application revision, variant, workflow revision |
| `annotation` | Evaluator/judge/manual annotation | evaluator revision, annotation task |

The shared origins are:

| Origin | Populated by | Execution behavior |
|---|---|---|
| `auto` | Backend/SDK runner | invoked by `process` |
| `human` | UI/user annotation | runner creates or leaves pending work |
| `custom` | External/programmatic actor | runner creates or leaves pending work |

Backend types use `auto`, `human`, and `custom`. Any frontend or generated-client naming drift should be treated as compatibility debt and verified before changing.

## Input Sources

The current code distinguishes source descriptors from concrete execution items.

| Source descriptor | Concrete item | Current usage |
|---|---|---|
| query revision | trace | live query, batch query |
| testset revision | testcase | batch testset, batch inference / batch invocation |
| direct trace IDs | trace | queue traces |
| direct testcase IDs | testcase | queue testcases |

Source-aware queue creation has been partially implemented. `SimpleQueuesService.create()` can accept query/testset-backed queue sources, builds run data through `_make_evaluation_run_data()`, preserves source revision references in input steps, and dispatches concrete trace/testcase batches through `_dispatch_source_batches()`. Direct trace/testcase queue additions remain supported.

Annotation Queue v2 frames this as a consumer-facing convenience layer: users should be able to create annotation queues from traces or testsets without manually constructing the backing evaluation run, scenarios, results, and queue.

## Scenario Semantics

A scenario is a concrete source item inside a run.

Depending on the source family, a scenario may represent:

- a trace returned by a query
- a testcase from a testset revision
- a direct trace queue item
- a direct testcase queue item

Live query scenarios additionally need temporal metadata such as timestamp and interval. Testset-backed online evaluation is intentionally unsupported because the same static testcases would be reprocessed every interval.

## Application And Evaluator Boundaries

Application steps produce application traces and outputs. Evaluator steps consume either:

- an existing source trace from query/queue trace inputs
- an application trace/output from an invocation step
- testcase payload where the evaluator supports testcase-only input

The current loop families differ mostly in which upstream object exists before evaluator execution.

| Shape | Evaluator input |
|---|---|
| query -> evaluator | source trace |
| queue trace -> evaluator | source trace |
| testset -> application | no evaluator; output is application trace/result |
| testset -> application -> evaluator | application trace and outputs |
| queue testcase -> evaluator | testcase item |

This difference is real and should be modeled as planning data, not hidden in separate handwritten loops.

## Repeats And Fan-Out

Older docs used two naming schemes for the same underlying concern:

| Older eval-loop name | Current code name | Meaning |
|---|---|---|
| `repeat_target = "application"` | `is_split = true` | fan out at the application step |
| `repeat_target = "evaluator"` | `is_split = false` | fan out at evaluator steps |
| `reuse_traces` | `is_cached` | enable hash-based trace reuse |

The current backend model uses `is_cached`, `is_split`, and `repeats`. `EvaluationRunFlags` contains `is_cached` and `is_split`; `EvaluationRunData.repeats` defaults to `1`.

The worker loops now expand repeat slots in the core paths inspected:

- batch testset creates input, invocation, and evaluator results per `repeat_idx`
- batch inference / batch invocation creates input and invocation results per `repeat_idx`
- batch trace/testcase queue items create input/source and evaluator results per `repeat_idx`
- live query creates query and evaluator results per `repeat_idx`

The remaining issue is not absence of repeat support. It is that repeat planning is still duplicated inside specialized loops rather than centralized in one planner.

Fan-out validity depends on topology:

| Topology | Valid fan-out |
|---|---|
| query -> evaluator | evaluator only |
| queue source -> evaluator | evaluator only |
| testset -> application -> evaluator | application or evaluator |
| testset -> application | application only; this is batch inference / batch invocation |

## Trace Reuse

Hash-based trace reuse is explicit through `is_cached`.

Reuse flow:

1. Compute a stable hash for the runnable node from canonical references and upstream links.
2. Fetch matching traces by hash at project scope.
3. Select deterministic reusable traces for the requested repeat slots.
4. Invoke only the missing slots.
5. Populate result cells with reused or newly produced trace IDs.

The lookup is already plural in `fetch_traces_by_hash(...)`, and helper tests cover selection and missing-count behavior. Cache lookup is now wired into the inspected application and evaluator worker boundaries. The remaining issue is duplicated per-loop cache resolution logic.

## Setup Fragmentation

Current setup is not one universal flow. It is split across:

- auto evaluation creation for app + variant + testset + evaluators
- human evaluation creation for testset + single variant + evaluators
- live evaluation setup for query-backed trace sampling
- queue creation from trace IDs or testcase IDs
- SDK/local setup
- annotation queue convenience setup from traces/testsets, backed by evaluation entities

These setup paths build similar run-data concepts through `_make_evaluation_run_data()` in several paths, but they still apply different validation and dispatch rules. That is why new combinations still tend to require setup and execution changes in multiple places.

## Execution Fragmentation

The SDK, backend batch workers, backend live workers, and queue workers each encode their own nested loops. Recent backend work has brought the loops closer together, but they still share concepts by convention rather than through one planner/executor abstraction:

- source resolution
- scenario creation
- input result creation
- application invocation
- evaluator invocation
- human/custom pending behavior
- repeat handling
- cache lookup
- metrics refresh

This duplication is now the main remaining problem. Some formerly missing capabilities are implemented, but they are implemented repeatedly across specialized loops.

## Runnable Execution Debt

Unifying the loop should not mean preserving every current invocation helper as-is.

The current application execution path is especially legacy. Batch testset and batch inference paths still rely on older application invocation helpers such as the LLM app service batch invocation path, which has been patched repeatedly over time. Evaluator execution uses workflow invocation paths with similar but not identical request assembly, links, reference handling, cache handling, trace fetch handling, and error handling.

The repeated pattern is broader than "application vs evaluator":

- build runnable request from step references, upstream bindings, inputs, trace, and outputs
- optionally compute hash and reuse existing traces
- invoke a runnable when cache does not satisfy the slot
- fetch/validate the resulting trace
- convert response or failure into an evaluation result cell

That should become a shared runnable-step execution contract. Application and evaluator steps can then be two runnable kinds handled by the same boundary, rather than separate loop-local helper stacks.

## Research Conclusion

The product does not need one flattened source type, but it does need one loop contract.

The common contract should be:

```text
resolve sources -> materialize scenarios -> plan result slots -> execute auto steps -> leave human/custom slots pending -> populate tensor cells -> refresh metrics
```

Current code has many pieces of that contract, including flags, repeat helpers, cache helpers, source-aware queue dispatch, and pending human/custom behavior in key loops. The missing layer is a shared planner that owns these decisions once.

Source-specific behavior should live in resolvers and planners. Step execution should be generic over:

- scenario
- step
- repeat slot
- upstream bindings
- origin
- cache policy
- fan-out policy
- runnable invocation policy
