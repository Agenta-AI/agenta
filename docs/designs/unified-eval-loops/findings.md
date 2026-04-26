# Unified Eval Loops Findings

Review scope: last two commits on the current `application` checkout:

- `a114ab369 initial design`
- `747502df1 initial implementation`

Sources:

- Code scan of `a114ab369^..HEAD`, focused on unified evaluation runtime, worker dispatch, SDK preview runtime, engine initialization, and adjacent tests/docs.
- Staged-area scan of the current `application` checkout.
- User-provided validation output from `cd api && poetry run python run-tests.py`: `1040 passed, 11 skipped in 78.94s`.

## Notes

- No local test execution was performed for these findings. The full suite result above is recorded from user-provided validation.
- Findings were resolved through code review and focused patching; no end-to-end evaluation run was performed locally in this pass.

## Open Findings

No open findings recorded after the requested fix pass.

## Closed Findings

### [CLOSED] UEL-004: Runnable batch length mismatches can silently drop planned cells

- ID: `UEL-004`
- Origin: `scan`
- Lens: `verification`
- Severity: `P1`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`
- Summary: The shared source-slice loop zipped planned cells with runner results and did not verify that the runner returned one execution per requested cell.
- Files:
  - `sdk/agenta/sdk/evaluations/runtime/source_slice.py`
  - `sdk/tests/pytest/unit/test_evaluations_runtime.py`
- Resolution:
  - Fixed by making `process_evaluation_source_slice` treat runner result-count mismatches as explicit scenario errors.
  - Missing trailing planned cells are now logged as failed result cells with a contract-violation message instead of disappearing from persistence.
  - Added focused SDK unit coverage for a two-repeat auto evaluator batch where the runner returns only one execution.

### [CLOSED] UEL-005: Trace-backed queue slices do not load trace context before evaluator execution

- ID: `UEL-005`
- Origin: `scan`
- Lens: `verification`
- Severity: `P1`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`
- Summary: Direct trace batches entered the unified runtime as `ResolvedSourceItem(trace_id=...)` only, so auto evaluators could receive no source trace, inputs, outputs, or span link.
- Files:
  - `api/oss/src/core/evaluations/runtime/sources.py`
  - `api/oss/src/core/evaluations/tasks/source_slice.py`
  - `api/oss/tests/pytest/unit/evaluations/test_runtime_topology_planner.py`
- Resolution:
  - Fixed by hydrating direct trace source items through `tracing_service` before converting them to SDK source items.
  - The resolver now populates `trace`, root `span_id`, `inputs`, and `outputs` from `ag.data` when the source trace is available.
  - Added focused unit coverage for direct source resolution and for `process_evaluation_source_slice(trace_ids=[...])` forwarding hydrated source context to the SDK runtime.

### [CLOSED] UEL-006: Source-trace links are hard-coded as `invocation`

- ID: `UEL-006`
- Origin: `scan`
- Lens: `verification`
- Severity: `P2`
- Confidence: `medium`
- Status: `wontfix`
- Category: `Consistency`
- Summary: The SDK runtime emits upstream links under the key `invocation`.
- Files:
  - `sdk/agenta/sdk/evaluations/runtime/source_slice.py`
  - `api/oss/src/core/evaluations/runtime/adapters.py`
- Resolution:
  - Wontfix per user decision: the invocation link key is the workflow contract, and the key for the invocation step should be `invocation`.

### [CLOSED] UEL-003: Dict-revision regression test asserts fields that the request model drops

- ID: `UEL-003`
- Origin: `mixed`
- Lens: `verification`
- Severity: `P1`
- Confidence: `high`
- Status: `fixed`
- Category: `Testing`
- Summary: The staged unit test for dict-shaped evaluator revisions fails because it asserts `workflow_request.interface` and `workflow_request.configuration`, but the active `WorkflowServiceRequest` alias is `WorkflowInvokeRequest`, whose declared payload surface is `data`.
- Impact: This previously made the full API pytest suite red and blocked using the regression test as validation for the staged adapter fix. The latest user-provided validation is now green.
- Evidence:
  - User-provided validation fails at `oss/tests/pytest/unit/evaluations/test_runtime_topology_planner.py::test_backend_evaluator_runner_preserves_dict_revision_data` with `AttributeError: 'WorkflowInvokeRequest' object has no attribute 'interface'`.
  - `api/oss/tests/pytest/unit/evaluations/test_runtime_topology_planner.py:1187-1191` asserts `workflow_request.interface.*` and `workflow_request.configuration.*`.
  - `sdk/agenta/sdk/models/workflows.py:255-256` defines `WorkflowInvokeRequest` with `data: Optional[WorkflowRequestData] = None`; it does not declare `interface` or `configuration`.
  - `api/oss/src/core/evaluations/runtime/adapters.py:355-362` still passes `interface=` and `configuration=` while constructing `WorkflowServiceRequest`, but those are not accessible as model attributes under the current request model. The preserved evaluator details should be verified through `workflow_request.data.revision["data"]` and `workflow_request.data.parameters`, or the request model should explicitly regain those top-level fields if that is the intended contract.
- Files:
  - `api/oss/tests/pytest/unit/evaluations/test_runtime_topology_planner.py`
  - `api/oss/src/core/evaluations/runtime/adapters.py`
  - `sdk/agenta/sdk/models/workflows.py`
- Cause: The staged regression test was written against an older or assumed request shape instead of the current SDK `WorkflowServiceRequest` alias.
- Explanation: The adapter now reads nested dict data with `_read_field`, which addresses the original dict/DTO mismatch. However, the test checks `interface` and `configuration` directly on the Pydantic request object. Since the model only declares `data`, Pydantic does not expose those names, producing the exact `AttributeError` seen in the full-suite output before the test can assert the actual preserved revision data.
- Suggested Fix:
  - Update the regression test to assert the current contract: `workflow_request.data.revision["data"]["uri"]`, `headers`, `schemas`, `script`, and `workflow_request.data.parameters`.
  - If top-level `interface` and `configuration` are still required for downstream workflow-service invocation, add them to the SDK `WorkflowInvokeRequest` model and add assertions on `workflow_request.model_dump(mode="json", exclude_none=True)`.
- Alternatives:
  - Remove the top-level `interface` and `configuration` constructor arguments from `BackendEvaluatorRunner` if they are intentionally obsolete, to avoid suggesting that they are part of the request contract.
- Sources:
  - `api/oss/tests/pytest/unit/evaluations/test_runtime_topology_planner.py:1187`
  - `api/oss/src/core/evaluations/runtime/adapters.py:355`
  - `sdk/agenta/sdk/models/workflows.py:255`
- Resolution:
  - Fixed by updating the regression test to assert preserved evaluator metadata through `workflow_request.data.revision["data"]` and `workflow_request.data.parameters`, matching the current SDK request model.

### [CLOSED] UEL-001: Backend evaluator runner receives dumped revisions but reads them like DTOs

- ID: `UEL-001`
- Origin: `scan`
- Lens: `verification`
- Severity: `P1`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`
- Summary: Backend auto-annotation execution can invoke evaluators with an empty `interface` and `configuration` because the shared runtime dumps revisions to dictionaries before handing them to `BackendEvaluatorRunner`.
- Evidence:
  - `sdk/agenta/sdk/evaluations/runtime/source_slice.py:274-279` builds `WorkflowExecutionRequest` with `revision=_dump_revision(revision)`, so Pydantic DTOs become plain dictionaries.
  - `api/oss/src/core/evaluations/runtime/adapters.py:302-328` detects `dict` revisions but then reads `data` with `getattr(data, "uri")`, `getattr(data, "script")`, and `getattr(data, "parameters")`. When `data` is a dict, these all return `None`.
  - The resulting `WorkflowServiceRequest` for backend evaluator steps loses the evaluator script, parameters, URI, URL, headers, and schemas.
- Files:
  - `sdk/agenta/sdk/evaluations/runtime/source_slice.py`
  - `api/oss/src/core/evaluations/runtime/adapters.py`
- Cause: The shared runtime normalizes revisions for transport with `model_dump`, but the backend evaluator adapter was written for object-shaped revision data and only partially handles dictionary-shaped revisions.
- Explanation: Auto evaluator steps are routed through `process_evaluation_source_slice`, which passes evaluator revisions into the SDK runtime. The SDK runtime dumps the revision before storing it on the request. On the backend side, `BackendEvaluatorRunner._execute_one` switches to dict handling for the top-level revision but not for nested `data`, so evaluator metadata becomes empty. This can make backend auto annotations fail or execute without the intended evaluator configuration while planner tests still pass.
- Suggested Fix:
  - Preserve the revision object in `WorkflowExecutionRequest` when running in-process, or teach `BackendEvaluatorRunner` to read both dict and DTO shapes for `data`.
  - Add a focused unit test where an evaluator revision dict with `data.script`, `data.parameters`, and interface fields reaches `workflows_service.invoke_workflow` intact.
- Alternatives:
  - Move backend request construction before the SDK runtime boundary and pass a backend-native execution payload to the runner.
- Sources:
  - `sdk/agenta/sdk/evaluations/runtime/source_slice.py:274`
  - `api/oss/src/core/evaluations/runtime/adapters.py:302`
- Resolution:
  - Fixed by making `BackendEvaluatorRunner` read revision, nested `data`, and `flags` from both dict-shaped and DTO-shaped objects.
  - Added a focused unit case for dict-shaped evaluator revisions in `api/oss/tests/pytest/unit/evaluations/test_runtime_topology_planner.py`.

### [CLOSED] UEL-002: Startup instrumentation uses raw prints in the FastAPI module

- ID: `UEL-002`
- Origin: `scan`
- Lens: `verification`
- Severity: `P3`
- Confidence: `high`
- Status: `wontfix`
- Category: `Compatibility`
- Summary: `api/entrypoints/routers.py` now emits startup timing with top-level `print()` calls during module import.
- Evidence:
  - `api/entrypoints/routers.py:158-171` prints SDK import and `ag.init()` timing at import time.
  - `api/entrypoints/routers.py:176-180` prints EE import timing at import time.
- Files:
  - `api/entrypoints/routers.py`
- Cause: Debug startup timing instrumentation was committed directly into the application entrypoint instead of using the structured logger or a debug-gated startup probe.
- Explanation: These prints run whenever the module is imported, including tests, scripts, workers, and production ASGI startup. That bypasses log formatting, severity controls, JSON log aggregation, and normal logger configuration. It is not blocking, but it adds noisy side effects to a central import path.
- Suggested Fix:
  - Replace the `print()` calls with `log.debug` or `log.info` after logger initialization, gated by an explicit startup profiling flag if the timings are still needed.
  - Keep import-time side effects limited to required initialization.
- Alternatives:
  - Move startup timing into the FastAPI lifespan handler and emit one structured summary log.
- Sources:
  - `api/entrypoints/routers.py:158`
  - `api/entrypoints/routers.py:176`
- Resolution:
  - Wontfix per user decision.
