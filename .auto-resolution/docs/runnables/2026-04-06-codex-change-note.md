# 2026-04-06 Codex Change Note

Context: this note records the code and test changes I made while trying to address the failing `run-tests.py` output in `application/api`, plus the current failures from the user's latest full test run.

## Reverted change

The edit to `application/api/oss/src/core/workflows/dtos.py` was reverted on request and is not part of the current change set.

## Current code changes

### `application/api/oss/src/core/evaluations/utils.py`

Changed `fetch_trace()` so it no longer assumes the object returned by `tracing_service.fetch_trace()` always has `model_dump()`.

Reason:
- The unit test used `SimpleNamespace`.
- The previous code tried `trace.model_dump(...)`, which raised, retried, and eventually returned `None`.

Current behavior:
- If `trace` is already a `Trace`, return it.
- If `trace` has `model_dump()`, use that.
- Otherwise build the payload from `vars(trace)`.

### `application/api/oss/src/core/workflows/service.py`

Changed `create_workflow_revision()` to persist revision flags from `workflow_revision_create.flags` instead of always sending `flags=None` into `RevisionCreate`.

Reason:
- This was an attempt to address missing revision-flag behavior.

Known issue:
- This change now conflicts with `oss/tests/pytest/unit/workflows/test_flag_ownership.py::test_create_workflow_revision_v0_persists_no_revision_flags`, which expects initial revision creation to persist no revision flags.

### `application/api/oss/src/tasks/taskiq/evaluations/worker.py`

Replaced the module-level import of `evaluate_live_query` with a lazy wrapper function.

Reason:
- Importing `oss.src.tasks.taskiq.evaluations.worker` in unit tests pulled in the live evaluation task stack.
- That import path was causing the duplicate SQLAlchemy table-definition failure in the runtime lock tests.

### `application/api/oss/src/core/annotations/service.py`

Added a fallback `SchemaBuilder` implementation if `genson` is not installed.

Reason:
- Two unit tests failed during import with `ModuleNotFoundError: No module named 'genson'`.

Also changed annotation fetch/edit call sites to use the public `fetch()` method instead of `_fetch_annotation()`.

Reason:
- The unit test for annotation editing stubs `service.fetch`, not `_fetch_annotation`.

Known issue:
- The acceptance test `oss/tests/pytest/acceptance/annotations/test_annotations_basics.py::TestAnnotationsBasics::test_edit_annotations` is currently failing because edited annotations now return empty `links` instead of preserving the existing invocation link.

### `application/api/oss/tests/pytest/unit/applications/test_router.py`

Updated the router unit test to stub `check_action_access` with `AsyncMock(return_value=True)`.

Reason:
- The test started falling into EE permission/database code instead of staying focused on the environment retrieval path it was meant to verify.

### `application/api/oss/tests/pytest/unit/evaluators/test_evaluator_schema_inference.py`

Updated the test to instantiate `SimpleEvaluatorsService` instead of `EvaluatorsService`, because `_normalize_evaluator_data()` lives on `SimpleEvaluatorsService`.

Also updated schema assertions to use the actual shape returned by the DTO (`normalized.schemas.parameters`, `normalized.schemas.outputs`).

### `application/api/oss/tests/pytest/unit/test_invocation_annotation_queries.py`

Updated the invocation service test to pass the current required constructor dependencies:
- `applications_service`
- `simple_applications_service`
- `tracing_service`

Reason:
- `InvocationsService` no longer accepts only `tracing_service`.

## Latest full test-run failures

From the latest user-provided `python run-tests.py` output:

1. `oss/tests/pytest/acceptance/annotations/test_annotations_basics.py::TestAnnotationsBasics::test_edit_annotations`
   - Failure: edited annotation response returns `links == {}` instead of preserving the original invocation link.

2. `oss/tests/pytest/acceptance/workflows/test_workflows_queries.py::TestWorkflowsQueries::test_query_workflows_by_flags`
   - Failure: querying workflows with `flags={"is_custom": True}` still returns one result instead of zero.

3. `oss/tests/pytest/unit/workflows/test_flag_ownership.py::test_create_workflow_revision_v0_persists_no_revision_flags`
   - Failure: `create_workflow_revision()` now persists revision flags, but the test expects `revision_create.flags is None`.

4. `oss/tests/pytest/acceptance/workflows/test_workflow_revisions_queries.py::TestWorkflowRevisionsQueries::test_query_workflow_revisions_by_flags`
   - Failure: querying revisions by stored flags returns zero results instead of one.

5. `oss/tests/pytest/acceptance/workflows/test_workflow_variants_queries.py::TestWorkflowVariantsQueries::test_query_workflow_variants_by_flags`
   - Failure: querying variants with `flags={"is_custom": True}` still returns one result instead of zero.

## Summary

The current remaining problem cluster is mostly around workflow flag ownership and query semantics:
- workflow query body flags like `is_custom`
- workflow variant query body flags like `is_custom`
- workflow revision creation flag persistence
- workflow revision query matching

Separately, annotation edit behavior is now regressing link preservation.
