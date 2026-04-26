# Gap Analysis

## Summary

The current system has many pieces of a unified evaluation model, but they are split across setup surfaces, worker loops, SDK code, queue code, and frontend assumptions.

The largest gaps are:

- no first-class planner that turns run graph + sources + flags into tensor cells
- source resolution exists in several paths but not behind one resolver interface
- repeat-aware execution exists in current backend loops but not behind one execution planner
- pending/manual lifecycle exists in key loops but is still duplicated and topology-specific
- no slice-aware `process` operation
- no single slice-shaped operation boundary across process/probe/populate/prune

## Already Implemented

Current code already includes several capabilities that older design docs listed as missing or speculative:

- `EvaluationRunFlags.is_cached`
- `EvaluationRunFlags.is_split`
- `EvaluationRunFlags.is_queue`
- `EvaluationRunData.repeats`
- `EvaluationResult.repeat_idx`
- `EvaluationResultQuery.repeat_idx` / `repeat_idxs`
- repeat helpers: `build_repeat_indices`, `required_traces_for_step`, `effective_is_split`
- cache helpers: `make_hash`, `fetch_traces_by_hash`, `select_traces_for_reuse`, `plan_missing_traces`
- source-aware queue creation from query/testset-backed sources
- source-backed queue dispatch to concrete trace/testcase batches
- human/custom evaluator pending behavior in live query and batch item paths
- repeat-aware input/evaluator result creation in live query
- repeat-aware input/application/evaluator result creation in batch testset
- repeat-aware input/application result creation in batch inference / batch invocation
- repeat-aware source/evaluator result creation in batch trace/testcase items

## Setup Gaps

Current setup is fragmented:

- auto testset evaluation setup builds one specific graph shape
- human evaluation setup builds a related but separate testset shape
- live query setup has separate query semantics
- queue setup accepts direct trace/testcase IDs but not source revisions
- SDK/local setup has its own assumptions

Still missing or incomplete:

- canonical graph-oriented create request
- shared validation for input source combinations
- one canonical setup request model used by all wrappers
- wrapper-to-canonical translation for every existing setup API
- one place to enforce step origin semantics
- annotation queue convenience APIs that hide backing run/scenario/result setup while using the same canonical setup path

## Source Resolution Gaps

There is no shared abstraction for resolving source descriptors into concrete scenario items, even though source resolution now exists in several code paths.

Resolver behavior that exists but should be extracted:

- query revision -> trace refs for live windows
- query revision -> trace refs for source-backed queues
- testset revision -> testcase refs for source-backed queues
- testset revision -> testcase payloads for batch testset/invocation
- direct trace IDs -> trace refs
- direct testcase IDs -> testcase refs

Current consequences:

- scenario creation is repeated in each loop
- each loop owns part of source resolution itself
- live and batch query semantics are harder to compare
- unsupported mixed-source cases fail implicitly rather than through clear validation

## Planner Gaps

The system lacks an execution planner that can materialize these concepts once:

- scenario cells
- input result cells
- auto executable cells
- human/custom pending cells
- repeat slots
- cache reuse plans
- upstream bindings between steps

Current loops encode planning inline. This makes it difficult to support new combinations or change semantics consistently.

- multiple input steps with consistent result slots
- repeat fan-out at different graph boundaries
- partial retries by tensor slice

## Execution Gaps

Current execution was specialized:

- SDK preview evaluation had its own nested loop
- backend legacy batch testset had another loop
- backend live query had another loop
- queue batch evaluation had another loop

Current backend implementation direction:

- live query, batch query, direct trace queues, direct testcase queues, batch inference, and testset -> application -> evaluator resolve source items and call one backend source-slice processor
- batch inference is the application-only testset application graph shape
- API-internal task handlers have been collapsed to run and slice processors
- trace/testcase batch task helpers are no longer needed because the slice processor can call the source-slice processor directly
- specialized helper names may remain as wrappers while web/API compatibility is preserved

Current SDK implementation direction:

- SDK preview/local evaluation now routes through SDK-owned `process_evaluation_source_slice`
- SDK runner, result logging, trace loading, and metrics work are adapters around the shared SDK runtime contract
- backend execution now delegates to the SDK processor through backend-specific scenario, result, cache, status, trace, and workflow adapters

Still missing:

- unified `process(run, slice)` role exposed as a public API or service operation
- topological execution over planned cells
- idempotent probe-before-write behavior
- consistent error-as-result behavior
- shared metrics refresh policy after processing
- clear separation between execution and persistence adapters
- public API/service operation shape for invoking the SDK-owned source-slice processor by tensor slice

## Runnable Execution Gaps

The current worker loops still call step-specific invocation helpers directly.

Known debt:

- application execution still uses legacy batch invocation helper paths
- evaluator execution assembles workflow invocation requests separately
- cache lookup, trace validation, link/reference construction, and error-to-result conversion are repeated around those calls
- there is no single runnable-step executor that can handle application and evaluator steps through the same contract

Needed:

- `RunnableStepExecutor` interface for any auto runnable step
- application-step adapter that can initially wrap the current application invocation path
- evaluator-step adapter that can initially wrap workflow invocation
- shared request/context builder for references, links, inputs, trace, outputs, and parameters
- shared trace validation and result normalization
- migration path to deprecate legacy LLM app batch helper functions after parity is proven

This should be treated as part of unification, not as a later cleanup. Otherwise the new loop would only centralize iteration while preserving the most brittle execution boundary.

## Tensor Operation Gaps

The intended tensor identity exists in storage and query models, but the operation model is incomplete.

Missing or partial:

- `TensorSlice` model across backend, SDK, and frontend
- slice-aware `probe`
- slice-aware `populate`
- slice-aware `prune`
- slice-aware `process`
- partial retry/fill-missing workflows
- repeat slot materialization as a shared planner primitive

Existing APIs are mostly per-entity or full-run oriented.

## Repeat And Fan-Out Gaps

`repeat_idx` exists in result identity and current backend loops now expand it in the inspected paths.

Current gaps:

- repeat expansion is duplicated across loops
- queue repeats still also carry assignment semantics, so execution repeats and assignment lanes need an explicit shared contract
- `is_split` is enforced through helpers in some paths, but topology validation is still dispatch-specific
- no shared planner decides whether application or evaluator steps fan out

Needed:

- repeat-aware result-slot planner
- topology-specific fan-out validation
- deterministic repeat-slot binding for reused traces
- tests for full, partial, and zero cache hits under repeats

## Cache Gaps

Hash-based trace reuse is implemented in current backend worker paths, but not centralized.

Still missing:

- one shared cache-resolution stage used by every runnable step
- one explicit per-slot cache binding object
- parity tests proving all loops use the same cache rules
- a documented project-scoped cross-run reuse policy

The current code uses `is_cached`; older docs that say `reuse_traces` should be treated as stale terminology unless an external compatibility need exists.

## Origin Gaps

`auto`, `human`, and `custom` origins exist in the current backend model, and human/custom pending behavior is present in several loops.

Still missing or incomplete:

- common pending/manual result lifecycle
- consistent frontend/backend origin naming
- external custom-populate contract for custom steps
- annotation queue progress/status semantics layered over evaluation results without duplicating task state

Verify frontend/generated-client naming before changing UI code; backend type truth is `auto`.

## Annotation Queue Layer Gaps

Annotation Queue v2 identifies product/API gaps adjacent to unified loop execution:

- convenience API for queue creation from traces and testsets
- annotator inbox/list view across queues
- per-item progress computed from evaluation results
- explicit export/write-back flow for testset-sourced annotation queues
- clear distinction between backing infrastructure status and consumer-facing task status
- UI that uses queue assignment instead of allowing annotators to annotate any scenario

These should be built on top of the unified planner/source resolver/tensor result model, not as a separate runtime.

## Graph Mutation Gaps

Steps are stored in run data, but graph operations are not first-class enough.

Missing:

- `add_step` endpoint/service operation
- `remove_step` endpoint/service operation
- graph validation outside setup functions
- tensor pruning cascade when removing a step
- explicit immutable-reference policy in code paths
- UI/API affordances for managing steps after creation

Without these, graph changes require specialized setup edits or recreation.

## Flag Gaps

Flags are consistently modeled in the current backend types, but old docs and possibly callers still use stale names.

Current canonical backend flags include:

- `is_live`
- `is_active`
- `is_cached`
- `is_split`
- `is_queue`
- `repeats`
- `is_closed`

Compatibility names to reconcile:

- `reuse_traces` vs `is_cached`
- `repeat_target` vs `is_split`
- `allow_decrease_repeats` if repeat count becomes mutable

Still missing:

- first-class constrained `set_flag`
- validation when flags conflict with topology
- end-to-end propagation through setup, run fetch, queue creation, SDK/local execution, and frontend state

## Topology Gaps

Supported topologies are implicit in dispatch logic.

Missing:

- explicit topology validation table in code
- structured error messages for unsupported combinations
- explicit rejection for not-planned shapes such as multiple application steps, mixed-source queues, and live testset runs
- future extension point for query -> application flows
- future extension point for testset -> evaluator flows

Potentially useful future shapes:

- `query -> application -> evaluator`, with query traces adapted as input data rather than application links
- `testset -> evaluator`, with an explicit evaluator testcase-only input contract

Not planned for now:

- multiple application steps in one worker-dispatched run
- mixed query/testset source families in one queue
- live testset evaluation

The immediate goal should not be to support every theoretical graph. It should be to reject unsupported graphs through one planner, and make adding support localized.

## API Gaps

Missing or incomplete API surface:

- graph-oriented create request
- `process(slice)`
- `probe(slice)`
- `prune(slice)`
- `populate(slice, results)` for bulk/slice writes
- `set_flag`
- response payloads that expose resolved source items and pending cells consistently

Existing APIs should remain as compatibility wrappers while the canonical surface is introduced.

## SDK Gaps

The SDK should own the shared runtime contract. The preview loop can keep its
public setup API, but orchestration should move behind SDK runtime planning and
SDK-specific execution/persistence adapters. Backend workers should consume the
same SDK runtime models through backend-specific adapters.

Missing:

- remote API persistence adapter
- slice-aware processing
- probe-before-write
- cache parity with backend
- stable step key strategy aligned with backend graph steps
- removal of duplicate backend planner/topology logic once migration coverage is sufficient

The desired state is not "SDK calls backend worker for everything." It is "SDK and backend share the same loop contract with different persistence/execution adapters."

## Frontend Gaps

Missing:

- explicit graph builder/step management model
- TensorSlice UI concepts for retry, prune, and fill missing
- unified origin naming
- flag editing beyond current implicit flows
- display of pending human/custom cells across query, testset, and queue runs
- source-aware queue creation UI if that product path is enabled

Frontend work can follow backend planner/API stabilization.

## Testing Gaps

Needed test coverage:

- source resolver outputs for query, testset, trace IDs, testcase IDs
- topology validation success and failure cases
- repeat slot materialization for every supported topology
- `is_split=true` and `is_split=false` on testset -> application -> evaluator
- evaluator-only repeat fan-out for query and queue runs
- cache full hit, partial hit, and miss
- cross-run trace reuse
- human/custom pending cells in query-backed runs
- source-aware queues preserving query/testset revision references
- existing direct queue behavior remains unchanged
- SDK/backend parity for the same planned graph

## Documentation Gaps

Needed docs after implementation starts:

- canonical source matrix
- topology validation matrix
- flag semantics and compatibility names
- manual/custom origin lifecycle
- cache and repeat behavior
- migration guide from specialized setup APIs to canonical graph creation
