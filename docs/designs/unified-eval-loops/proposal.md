# Proposal

## Goal

Introduce unified evaluation loop(s) that avoid separate setup and execution functions for every evaluation shape while preserving the capabilities already implemented in the current backend:

- input steps
- application and evaluator origins
- evaluation run flags
- input sources
- evaluation graph steps
- repeat and cache behavior through `repeats`, `is_cached`, and `is_split`
- live, batch, queue, and SDK/local execution contexts

This proposal does not require every source to become the same thing. It requires every source to enter the same planning and tensor execution contract.

The current code has already implemented several parts that older docs described as missing:

- `EvaluationRunFlags.is_cached`
- `EvaluationRunFlags.is_split`
- `EvaluationRunFlags.is_queue`
- `EvaluationRunData.repeats`
- repeat helper functions in `evaluations/utils.py`
- hash/cache helper functions in `evaluations/utils.py`
- source-aware queue creation from query/testset-backed sources
- live and batch query human/custom pending behavior
- repeat-aware result creation in the inspected backend worker loops

The proposal is therefore a unification/refactor proposal, not a first implementation of those behaviors.

## Design Principle

Separate source resolution, graph planning, execution, and tensor persistence.

```text
setup request
  -> source resolver
  -> run graph
  -> scenario materializer
  -> execution planner
  -> step executor
  -> tensor writer
  -> metrics refresh
```

Each current loop family becomes a configuration of this pipeline instead of a separate handwritten loop.

## Canonical Concepts

### Run Graph

A run graph is a list of immutable step definitions:

```python
class EvaluationStep:
    key: str
    type: Literal["input", "invocation", "annotation"]
    origin: Literal["auto", "human", "custom"]
    references: dict
    inputs: list[StepInput] | None
```

Step references point to concrete revisions or direct-source descriptors. Editing a step means removing it and adding a new step.

### Tensor Cell

Every produced or pending result targets:

```text
run_id + scenario_id + step_key + repeat_idx
```

All execution, retry, prune, cache binding, and manual annotation work should address this coordinate.

### Tensor Slice

Use one slice model for read, write, delete, and processing operations:

```python
class TensorSlice:
    scenarios: Literal["all", "none"] | list[UUID]
    steps: Literal["all", "none"] | list[str]
    repeats: Literal["all", "none"] | list[int]
```

The same slice shape should power:

- `probe`
- `populate`
- `prune`
- `process`
- retry failed cells
- fill missing cells
- re-run a single evaluator
- materialize new repeat slots

## Source Resolver Layer

Input sources should be modeled as descriptors that resolve into concrete source items.

| Descriptor | Resolver output | Scenario source |
|---|---|---|
| query revision | trace refs | queried traces |
| testset revision | testcase refs | testcases |
| direct trace source | trace refs | queued traces |
| direct testcase source | testcase refs | queued testcases |

The resolver is responsible for source-specific rules:

- live query windows
- batch query snapshots
- testset revision loading
- direct item validation
- source-aware queue expansion
- preserving original source references in input steps

The executor should not care whether a trace came from live query, batch query, or a queue. It should receive concrete scenario bindings.

## Annotation Queue Convenience Layer

Annotation Queue v2 should be treated as a consumer-facing layer over the same unified evaluation infrastructure.

Principles:

- `EvaluationRun`, `EvaluationScenario`, `EvaluationResult`, and `EvaluationQueue` remain the backing entities.
- The annotation queue API hides run/scenario/result setup for trace and testset annotation use cases.
- Queue assignment remains based on `EvaluationQueue.data.user_ids`, optional `scenario_ids`, optional `step_keys`, and result `repeat_idx`.
- Queue creation from traces/testsets should translate into canonical source specs and graph steps, then use the same source resolver and planner as evaluation runs.
- Annotation submission can continue to create annotation traces and link them to evaluation results.

Unified eval loops should provide the infrastructure contract for this layer. They should not replace the annotation queue convenience API.

## Planner Layer

The planner converts a graph and concrete scenarios into execution slots.

```python
class PlannedCell:
    scenario_id: UUID
    step_key: str
    repeat_idx: int
    action: Literal["bind_input", "invoke", "pending", "skip"]
    upstream: dict
```

Planner responsibilities:

- validate topology
- derive step order
- materialize input cells
- decide repeat fan-out point
- compute required result slots
- bind upstream trace/testcase/application output context
- mark human/custom annotation cells as pending
- skip cells that are already successful when requested

The planner is where topology-specific behavior belongs.

## Execution Layer

`process(slice)` executes planned `auto` cells only.

```text
process(run, slice):
  resolve concrete scenarios for input steps
  plan cells for the requested slice
  probe existing cells if skip-success is enabled
  for each executable auto cell in dependency order:
    resolve cache/reuse if enabled
    invoke only missing work
    populate result cells
  create pending cells for human/custom work
  refresh metrics for affected scope
```

The same executor can run in different contexts with different adapters:

| Context | Adapter |
|---|---|
| backend worker | API source/DAO/workflow-service adapters |
| SDK/local | local decorator or remote service adapters |
| tests | in-memory adapter |
| frontend human annotation | direct `populate` adapter for submitted cells |

The planner, topology classifier, and result-cell models should be SDK-owned so
SDK-local evaluation and backend workers use the same runtime contract. API code
should not fork the runtime; it should translate backend DTOs into SDK runtime
models and keep only backend-specific adapters beside the worker/service code.

The backend implementation should have one scenario execution loop. Source
wrappers may still differ because live queries, query snapshots, direct queue
items, and testset rows resolve differently, but after resolution they should
all call one source-slice processor. That processor owns input cell creation,
application invocation, evaluator invocation, pending manual/custom cells,
cache resolution, metrics refresh, and run/scenario status updates. Batch
inference is therefore just the application-only graph shape, not a separate
loop. Task-level trace/testcase batch helpers are unnecessary once the slice
worker calls the source-slice processor directly; service/API wrapper methods
can remain for compatibility.

The SDK should own the generic source-slice contract. SDK preview/local
execution can run through SDK-owned `process_evaluation_source_slice` now using
local decorator runners, SDK result logging, and SDK trace loading. The backend
processor should use that same contract with backend adapters for scenario
creation, result persistence, cache reuse, status updates, trace loading, and
workflow service execution.

## Runnable Step Executor

The unified loop should introduce a new runnable-step execution boundary rather than directly preserving the current helper calls inside each loop.

Current application execution is still routed through legacy helper paths such as batch LLM app invocation. Those paths have accumulated patches and are not the right long-term abstraction. Evaluator execution is also assembled separately even though it has the same core shape: prepare a runnable request, bind upstream context, invoke or reuse a trace, validate the trace, and produce a result cell.

Proposed contract:

```python
class WorkflowRunner:
    async def execute(
        self,
        request: WorkflowExecutionRequest,
    ) -> WorkflowExecutionResult:
        ...
```

`WorkflowExecutionResult` should be independent of whether the runnable was an application or evaluator:

```python
class WorkflowExecutionResult:
    status: EvaluationStatus
    trace_id: str | None
    span_id: str | None
    hash_id: str | None
    error: dict | None
    outputs: dict | None
```

Responsibilities:

- build the service request from step references and upstream bindings
- apply cache lookup/reuse when enabled
- invoke missing work
- fetch and validate traces where required
- normalize failures into result payloads
- return enough context for downstream steps

The first implementation can wrap existing application and workflow services.
The SDK should expose the runner protocol and shared models. The API should
provide backend workflow-service and legacy batch-invocation adapters. The SDK
should provide local decorator and remote service adapters. This makes those
wrappers replaceable so the legacy batch helpers can be deprecated without
changing the planner, tensor operations, or queue APIs.

## Origin Semantics

`origin` controls who can populate a step:

| Origin | Planner behavior | Executor behavior |
|---|---|---|
| `auto` | create executable cells | invoke and populate |
| `human` | create pending cells | do not invoke |
| `custom` | create pending cells or external-awaiting cells | do not invoke |

This gives query-backed, testset-backed, and queue-backed runs the same pending/manual semantics. Current behavior where query-backed runs lack human/custom pending branches should become a topology limitation only until the planner supports those cells.

## Flag Model

Use the current backend flag set as canonical. Bridge older design names only where old clients or docs still mention them.

| Canonical flag | Legacy design name | Purpose |
|---|---|---|
| `is_live` | `is_live` | periodic windowed source resolution |
| `is_active` | `is_active` | pause/resume live processing |
| `is_cached` | `reuse_traces` in older docs | enable hash-based trace reuse |
| `is_split` | `repeat_target` in older docs | select fan-out location where meaningful |
| `repeats` | `repeats` | number of repeat slots |
| `is_closed` | `is_closed` | block structural and tensor mutations |

Recommended compatibility mapping:

```text
repeat_target = "application" <=> is_split = true
repeat_target = "evaluator"   <=> is_split = false
reuse_traces = true           <=> is_cached = true
```

Do not introduce `reuse_traces` or `repeat_target` as new model fields unless there is a compatibility requirement. The current code already uses `is_cached` and `is_split`.

## Topology Validation

The unified planner should support every valid topology explicitly and reject invalid combinations before execution.

| Topology | Valid? | Notes |
|---|---:|---|
| query -> evaluator | yes | live or batch; evaluator fan-out only |
| query -> human/custom evaluator | yes target | creates pending cells |
| query -> application -> evaluator | potentially useful | Requires query trace to application input adapter. Do not pass query traces as application `links`; that can make application traces look like annotations rather than invocations. |
| testset -> application -> evaluator | yes | app or evaluator fan-out |
| testset -> application | yes | Batch inference / batch invocation. Application fan-out only; no evaluator execution or evaluator metrics. |
| testset -> evaluator | potentially useful | Requires evaluator testcase-only contract. |
| direct trace -> evaluator | yes | queue trace shape |
| direct testcase -> evaluator | yes | queue testcase shape |
| mixed query + testset in one queue | not planned | Keep queues single-source-family for now. |
| multiple application steps | not planned | Use separate evaluations for A/B comparison for the foreseeable future. |
| live testset | not planned | Static sources do not make sense for live periodic evaluation. |

The key shift is that unsupported shapes should fail through planner validation, not because there is no matching handwritten function. Potentially useful shapes should be explicitly modeled when implemented; not-planned shapes should stay rejected with clear errors.

## Repeat Semantics

Repeats are always represented as `repeat_idx` result slots. Fan-out determines which runnable step produces multiple traces.

Rules:

- query/queue trace/testcase evaluator-only runs fan out at evaluator steps.
- application-only runs, also called batch inference or batch invocation, fan out at application steps.
- testset -> application -> evaluator runs use `is_split`:
  - `true`: application produces one trace per repeat, evaluators consume matching repeat traces
  - `false`: application produces one trace, evaluators produce one trace per repeat
- if a topology has no application/evaluator boundary, `is_split` is ignored or rejected according to validation policy.

## Cache Semantics

Cache reuse is explicit through `is_cached`.

At each runnable step:

1. Compute the expected hash from step references and upstream links.
2. Fetch all candidate traces by hash.
3. Select deterministic traces for requested repeat slots.
4. Invoke missing slots only.
5. Populate the same tensor cells whether the trace was reused or newly generated.

Cache lookup is step-local and already exists in the current backend loops inspected:

- application steps reuse application traces
- evaluator steps reuse evaluator traces

Cross-run reuse is structurally supported by project-scoped trace lookup by hash. The unified planner should reuse the existing helper functions instead of reimplementing this per loop.

The cache resolver should sit inside or immediately beside the runnable-step executor so applications and evaluators use the same reuse semantics.

## Setup API Direction

Consolidate specialized setup functions behind one graph-oriented creation path plus convenience wrappers.

Canonical create request:

```python
class EvaluationCreate:
    inputs: list[InputSourceSpec]
    steps: list[ExecutableStepSpec]
    flags: EvaluationFlags
```

Convenience wrappers may remain:

- create auto testset evaluation
- create live query evaluation
- create annotation queue from traces
- create annotation queue from testcases
- create source-aware queue from query/testset
- create Annotation Queue v2 convenience flows from traces or testsets

Several wrappers already use `_make_evaluation_run_data()`. The next step is to make that builder and its validations explicit enough that wrappers only translate into canonical graph/source specs and do not own separate graph semantics.

## Operation API Direction

Expose or normalize first-class operations:

- `add_step`
- `remove_step`
- `add_scenario`
- `remove_scenario`
- `probe(slice)`
- `populate(slice, results)`
- `prune(slice)`
- `process(slice)`
- `refresh_metrics(scope)`
- `set_flag`

This lets setup, retry, queue assignment, manual annotation, live ticks, and SDK/local runs share the same tensor contract.

Some CRUD operations already exist in service/router form (`create_results`, `query_results`, `delete_results`, `refresh_metrics`, run start/stop, queue creation). The missing piece is a slice-shaped operation boundary and a shared `process(slice)` planner/executor.

## Migration Strategy

Do not rewrite all loops at once. Introduce the unified planner and adapters beside existing loops, then move topologies one at a time while preserving current behavior.

Recommended order:

1. Inventory current behavior and lock it with parity tests.
2. Define shared models: source descriptor, scenario binding, tensor slice, planned cell.
3. Extract current source resolution behavior into resolver interfaces.
4. Extract current repeat/cache planning into shared planner functions.
5. Introduce a runnable-step executor that initially wraps existing invocation services.
6. Route one simple topology through the planner, likely batch query or queue traces.
7. Move pending human/custom planning into the shared planner.
8. Move batch testset after repeat, cache, and runnable-executor parity are proven.
9. Move live query once windowed source resolution and idempotency are stable.
10. Collapse API-internal worker handlers to run/slice processors.
11. Share one backend source-slice processor across live query, batch query, queue slices, batch inference, and testset application evaluation.
12. Route SDK preview/local evaluation through SDK-owned source-slice processing with SDK-specific adapters.
13. Move backend execution onto the SDK source-slice contract through backend adapters that preserve current cache/result/status behavior.
14. Treat batch inference as the application-only shape of the testset application graph.
15. Retire specialized setup/execution branches after parity tests pass, leaving compatibility wrappers around the canonical processor.

## Success Criteria

The design succeeds when adding a new valid combination requires:

- adding or extending a source resolver if the source is new
- adding or extending a step executor if the runnable is new
- adding planner validation if the topology is new

It should not require creating a new end-to-end setup function and a new end-to-end execution loop.
