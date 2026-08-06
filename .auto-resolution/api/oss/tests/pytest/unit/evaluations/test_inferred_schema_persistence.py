"""
`EvaluationsService._update_run_mappings_from_inferred_metrics` persists the
trace-inferred outputs schema onto run steps (so the UI can type filter columns
for evaluators that declare no schema) without clobbering unrelated run data.

These are unit tests: the method only calls `self.edit_run`, so we build a bare
service, stub `edit_run`, and assert on the `EvaluationRunEdit` it receives.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from oss.src.core.evaluations.service import EvaluationsService
from oss.src.core.evaluations.types import (
    EvaluationRun,
    EvaluationRunData,
    EvaluationRunDataStep,
    EvaluationRunDataConcurrency,
    JsonSchemas,
)
from agenta.sdk.models.workflows import JsonSchemas as _SdkJsonSchemas  # noqa: F401


def _service_with_stubbed_edit():
    service = object.__new__(EvaluationsService)
    service.edit_run = AsyncMock()  # type: ignore[attr-defined]
    return service


def _annotation_step(key: str, schemas=None) -> EvaluationRunDataStep:
    return EvaluationRunDataStep(
        key=key,
        type="annotation",
        origin="custom",
        references={},
        schemas=schemas,
    )


def _run(steps, *, tags=None, meta=None, concurrency=None) -> EvaluationRun:
    return EvaluationRun(
        id=uuid4(),
        name="run",
        description="desc",
        tags=tags,
        meta=meta,
        data=EvaluationRunData(
            steps=steps,
            mappings=[],
            concurrency=concurrency,
        ),
    )


def _edited_run(service) -> SimpleNamespace:
    assert service.edit_run.await_count == 1
    return service.edit_run.await_args.kwargs["run"]


@pytest.mark.asyncio
async def test_inferred_schema_persisted_onto_schemaless_step():
    service = _service_with_stubbed_edit()
    run = _run([_annotation_step("evaluator-x")])
    inferred = {
        "type": "object",
        "properties": {
            "myscore": {"type": "integer"},
            "success": {"type": "boolean"},
        },
    }

    await service._update_run_mappings_from_inferred_metrics(
        project_id=uuid4(),
        user_id=uuid4(),
        run=run,
        inferred_metrics_keys_by_step={
            "evaluator-x": [
                {"path": "myscore", "type": "numeric/discrete"},
                {"path": "success", "type": "binary"},
            ]
        },
        inferred_schemas_by_step={"evaluator-x": inferred},
    )

    edited = _edited_run(service)
    step = edited.data.steps[0]
    assert step.schemas is not None
    assert step.schemas.outputs == inferred


@pytest.mark.asyncio
async def test_existing_step_schema_is_not_overwritten():
    service = _service_with_stubbed_edit()
    declared = JsonSchemas(
        outputs={"type": "object", "properties": {"a": {"type": "string"}}}
    )
    run = _run([_annotation_step("evaluator-x", schemas=declared)])

    await service._update_run_mappings_from_inferred_metrics(
        project_id=uuid4(),
        user_id=uuid4(),
        run=run,
        inferred_metrics_keys_by_step={
            "evaluator-x": [{"path": "b", "type": "numeric/discrete"}]
        },
        inferred_schemas_by_step={
            "evaluator-x": {"type": "object", "properties": {"b": {"type": "integer"}}}
        },
    )

    # Mappings still changed (new inferred column), so edit_run is called, but
    # the step keeps its declared schema rather than the inferred one.
    edited = _edited_run(service)
    step = next(s for s in edited.data.steps if s.key == "evaluator-x")
    assert step.schemas.outputs == declared.outputs


@pytest.mark.asyncio
async def test_full_put_preserves_unrelated_run_data():
    service = _service_with_stubbed_edit()
    concurrency = EvaluationRunDataConcurrency(batch_size=7, max_retries=3)
    run = _run(
        [_annotation_step("evaluator-x")],
        tags={"team": "evals"},
        meta={"note": "keep me"},
        concurrency=concurrency,
    )

    await service._update_run_mappings_from_inferred_metrics(
        project_id=uuid4(),
        user_id=uuid4(),
        run=run,
        inferred_metrics_keys_by_step={
            "evaluator-x": [{"path": "myscore", "type": "numeric/discrete"}]
        },
        inferred_schemas_by_step={
            "evaluator-x": {
                "type": "object",
                "properties": {"myscore": {"type": "integer"}},
            }
        },
    )

    edited = _edited_run(service)
    assert edited.tags == {"team": "evals"}
    assert edited.meta == {"note": "keep me"}
    assert edited.data.concurrency == concurrency
