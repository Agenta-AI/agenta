"""Unit tests for the tensor slice operations surface (PR: unify eval loops).

Covers the coordinate-addressed ops over EXISTING scenarios — distinct from the
source-keyed dispatch_*_slice path (which ingests NEW source items):

  - TaskiqEvaluationTaskRunner.process_tensor_slice (dispatch, omits empty kwargs)
  - SimpleEvaluationsService.dispatch_tensor_slice / probe_slice / populate_slice
  - EvaluationsService self-builds TensorSliceOperations from its sub-services
  - process_evaluation_tensor_slice entry fn runs process() then refresh()
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from oss.src.core.evaluations.service import (
    EvaluationsService,
    SimpleEvaluationsService,
)
from oss.src.core.evaluations.runtime.runner import TaskiqEvaluationTaskRunner
from oss.src.core.evaluations.runtime.tensor import TensorSliceOperations
from oss.src.core.evaluations.runtime.models import TensorSlice
from oss.src.core.evaluations.tasks.run import process_evaluation_tensor_slice
from oss.src.core.evaluations.types import (
    EvaluationResult,
    EvaluationResultCreate,
    EvaluationRun,
    EvaluationRunData,
    EvaluationRunDataStep,
    EvaluationStatus,
)


# --- runner dispatch ----------------------------------------------------------


@pytest.mark.asyncio
async def test_runner_process_tensor_slice_dispatches_and_omits_empty_kwargs():
    project_id = uuid4()
    user_id = uuid4()
    run_id = uuid4()
    scenario_id = uuid4()
    worker = SimpleNamespace(
        process_tensor_slice=SimpleNamespace(kiq=AsyncMock(return_value="tensor-task")),
    )
    runner = TaskiqEvaluationTaskRunner(worker=worker)

    result = await runner.process_tensor_slice(
        project_id=project_id,
        user_id=user_id,
        run_id=run_id,
        scenario_ids=[scenario_id],
        step_keys=["evaluator-auto"],
        # repeat_idxs / process_mode left None -> must be omitted from the call
    )

    assert result == "tensor-task"
    worker.process_tensor_slice.kiq.assert_awaited_once_with(
        project_id=project_id,
        user_id=user_id,
        run_id=run_id,
        scenario_ids=[scenario_id],
        step_keys=["evaluator-auto"],
    )


@pytest.mark.asyncio
async def test_runner_process_tensor_slice_forwards_all_kwargs_when_present():
    worker = SimpleNamespace(
        process_tensor_slice=SimpleNamespace(kiq=AsyncMock()),
    )
    runner = TaskiqEvaluationTaskRunner(worker=worker)
    project_id, user_id, run_id, scenario_id = uuid4(), uuid4(), uuid4(), uuid4()

    await runner.process_tensor_slice(
        project_id=project_id,
        user_id=user_id,
        run_id=run_id,
        scenario_ids=[scenario_id],
        step_keys=["evaluator-auto"],
        repeat_idxs=[0, 1],
        process_mode="force",
    )

    worker.process_tensor_slice.kiq.assert_awaited_once_with(
        project_id=project_id,
        user_id=user_id,
        run_id=run_id,
        scenario_ids=[scenario_id],
        step_keys=["evaluator-auto"],
        repeat_idxs=[0, 1],
        process_mode="force",
    )


# --- SimpleEvaluationsService.dispatch_tensor_slice ---------------------------


def _simple_service(*, worker=None, evaluations_service=None):
    return SimpleEvaluationsService(
        testsets_service=None,  # type: ignore[arg-type]
        queries_service=None,  # type: ignore[arg-type]
        applications_service=None,  # type: ignore[arg-type]
        evaluators_service=None,  # type: ignore[arg-type]
        evaluations_service=evaluations_service,  # type: ignore[arg-type]
        evaluations_worker=worker,
    )


@pytest.mark.asyncio
async def test_dispatch_tensor_slice_dispatches_to_runner():
    project_id, user_id, run_id, scenario_id = uuid4(), uuid4(), uuid4(), uuid4()
    run = SimpleNamespace(id=run_id, flags=SimpleNamespace())
    worker = SimpleNamespace(
        process_tensor_slice=SimpleNamespace(kiq=AsyncMock()),
    )
    evaluations_service = SimpleNamespace(fetch_run=AsyncMock(return_value=run))
    service = _simple_service(worker=worker, evaluations_service=evaluations_service)

    ok = await service.dispatch_tensor_slice(
        project_id=project_id,
        user_id=user_id,
        run_id=run_id,
        scenario_ids=[scenario_id],
        step_keys=["evaluator-auto"],
        process_mode="force",
    )

    assert ok is True
    worker.process_tensor_slice.kiq.assert_awaited_once_with(
        project_id=project_id,
        user_id=user_id,
        run_id=run_id,
        scenario_ids=[scenario_id],
        step_keys=["evaluator-auto"],
        process_mode="force",
    )


@pytest.mark.asyncio
async def test_dispatch_tensor_slice_returns_false_without_runner():
    run_id = uuid4()
    service = _simple_service(worker=None, evaluations_service=SimpleNamespace())

    ok = await service.dispatch_tensor_slice(
        project_id=uuid4(),
        user_id=uuid4(),
        run_id=run_id,
    )

    assert ok is False


@pytest.mark.asyncio
async def test_dispatch_tensor_slice_returns_false_when_run_missing():
    worker = SimpleNamespace(
        process_tensor_slice=SimpleNamespace(kiq=AsyncMock()),
    )
    evaluations_service = SimpleNamespace(fetch_run=AsyncMock(return_value=None))
    service = _simple_service(worker=worker, evaluations_service=evaluations_service)

    ok = await service.dispatch_tensor_slice(
        project_id=uuid4(),
        user_id=uuid4(),
        run_id=uuid4(),
    )

    assert ok is False
    worker.process_tensor_slice.kiq.assert_not_awaited()


# --- SimpleEvaluationsService.probe_slice / populate_slice --------------------


@pytest.mark.asyncio
async def test_probe_slice_delegates_to_tensor_ops_with_built_slice():
    project_id, run_id, scenario_id = uuid4(), uuid4(), uuid4()
    result = MagicMock(spec=EvaluationResult)
    tensor_ops = SimpleNamespace(probe=AsyncMock(return_value=[result]))
    evaluations_service = SimpleNamespace(tensor_slice_operations=tensor_ops)
    service = _simple_service(evaluations_service=evaluations_service)

    results = await service.probe_slice(
        project_id=project_id,
        run_id=run_id,
        scenario_ids=[scenario_id],
        step_keys=["evaluator-auto"],
        repeat_idxs=[0],
    )

    assert results == [result]
    tensor_ops.probe.assert_awaited_once()
    _, kwargs = tensor_ops.probe.await_args
    assert kwargs["project_id"] == project_id
    built: TensorSlice = kwargs["tensor_slice"]
    assert built.run_id == run_id
    assert built.scenario_ids == [scenario_id]
    assert built.step_keys == ["evaluator-auto"]
    assert built.repeat_idxs == [0]


@pytest.mark.asyncio
async def test_probe_slice_returns_empty_when_tensor_ops_unwired():
    evaluations_service = SimpleNamespace(tensor_slice_operations=None)
    service = _simple_service(evaluations_service=evaluations_service)

    results = await service.probe_slice(project_id=uuid4(), run_id=uuid4())

    assert results == []


@pytest.mark.asyncio
async def test_populate_slice_delegates_results_to_tensor_ops():
    project_id, user_id = uuid4(), uuid4()
    result = MagicMock(spec=EvaluationResult)
    tensor_ops = SimpleNamespace(populate=AsyncMock(return_value=[result]))
    evaluations_service = SimpleNamespace(tensor_slice_operations=tensor_ops)
    service = _simple_service(evaluations_service=evaluations_service)

    create = EvaluationResultCreate(
        run_id=uuid4(),
        scenario_id=uuid4(),
        step_key="evaluator-auto",
        status=EvaluationStatus.SUCCESS,
    )
    results = await service.populate_slice(
        project_id=project_id,
        user_id=user_id,
        results=[create],
    )

    assert results == [result]
    tensor_ops.populate.assert_awaited_once_with(
        project_id=project_id,
        user_id=user_id,
        results=[create],
    )


@pytest.mark.asyncio
async def test_populate_slice_returns_empty_when_tensor_ops_unwired():
    evaluations_service = SimpleNamespace(tensor_slice_operations=None)
    service = _simple_service(evaluations_service=evaluations_service)

    results = await service.populate_slice(
        project_id=uuid4(),
        user_id=uuid4(),
        results=[],
    )

    assert results == []


# --- EvaluationsService self-builds TensorSliceOperations ---------------------


def _evaluations_service(*, with_sub_services: bool) -> EvaluationsService:
    extra = {}
    if with_sub_services:
        extra = dict(
            testcases_service=MagicMock(),
            workflows_service=MagicMock(),
            applications_service=MagicMock(),
        )
    return EvaluationsService(
        evaluations_dao=MagicMock(),
        tracing_service=MagicMock(),
        queries_service=MagicMock(),
        testsets_service=MagicMock(),
        evaluators_service=MagicMock(),
        **extra,
    )


def test_service_builds_tensor_ops_when_sub_services_present():
    service = _evaluations_service(with_sub_services=True)

    ops = service.tensor_slice_operations
    assert isinstance(ops, TensorSliceOperations)
    assert ops.slice_processor is not None
    # the ops reference the owning service (probe/populate go through it)
    assert ops.evaluations_service is service


def test_service_leaves_tensor_ops_none_without_sub_services():
    service = _evaluations_service(with_sub_services=False)

    assert service.tensor_slice_operations is None


# --- process_evaluation_tensor_slice entry fn --------------------------------


@pytest.mark.asyncio
async def test_process_evaluation_tensor_slice_runs_process_then_refresh(monkeypatch):
    project_id, user_id, run_id, scenario_id = uuid4(), uuid4(), uuid4(), uuid4()

    process_mock = AsyncMock()
    refresh_mock = AsyncMock()
    captured = {}

    class _FakeTensorOps:
        def __init__(self, *, evaluations_service, slice_processor):
            captured["slice_processor"] = slice_processor

        async def process(self, *, project_id, user_id, tensor_slice):
            captured["process_slice"] = tensor_slice
            await process_mock()

        async def refresh(self, *, project_id, user_id, tensor_slice):
            captured["refresh_slice"] = tensor_slice
            await refresh_mock()

    monkeypatch.setattr(
        "oss.src.core.evaluations.tasks.run.TensorSliceOperations",
        _FakeTensorOps,
    )

    ok = await process_evaluation_tensor_slice(
        project_id=project_id,
        user_id=user_id,
        run_id=run_id,
        scenario_ids=[scenario_id],
        step_keys=["evaluator-auto"],
        process_mode="force",
        tracing_service=MagicMock(),
        testcases_service=MagicMock(),
        workflows_service=MagicMock(),
        applications_service=MagicMock(),
        evaluations_service=MagicMock(),
    )

    assert ok is True
    process_mock.assert_awaited_once()
    refresh_mock.assert_awaited_once()
    # both ops act on the same coordinate slice
    assert captured["process_slice"].run_id == run_id
    assert captured["process_slice"].scenario_ids == [scenario_id]
    assert captured["process_slice"].step_keys == ["evaluator-auto"]
    assert captured["process_slice"].process_mode == "force"
    assert captured["refresh_slice"] == captured["process_slice"]


# --- graph-shape ops: add/remove_scenarios (height), add/remove_steps (width),
#     set_repeats (depth) ---------------------------------------------------


@pytest.mark.asyncio
async def test_add_scenarios_creates_n_skeleton_rows():
    run_id = uuid4()
    created = [SimpleNamespace(id=uuid4()), SimpleNamespace(id=uuid4())]
    evaluations_service = SimpleNamespace(
        create_scenarios=AsyncMock(return_value=created)
    )
    service = _simple_service(evaluations_service=evaluations_service)

    result = await service.add_scenarios(
        project_id=uuid4(),
        user_id=uuid4(),
        run_id=run_id,
        count=2,
    )

    assert result == created
    evaluations_service.create_scenarios.assert_awaited_once()
    _, kwargs = evaluations_service.create_scenarios.await_args
    scenarios = kwargs["scenarios"]
    assert len(scenarios) == 2
    # skeleton only: run-scoped, no input cells / results
    assert all(s.run_id == run_id for s in scenarios)


@pytest.mark.asyncio
async def test_add_scenarios_zero_count_is_noop():
    evaluations_service = SimpleNamespace(create_scenarios=AsyncMock())
    service = _simple_service(evaluations_service=evaluations_service)

    result = await service.add_scenarios(
        project_id=uuid4(),
        user_id=uuid4(),
        run_id=uuid4(),
        count=0,
    )

    assert result == []
    evaluations_service.create_scenarios.assert_not_awaited()


@pytest.mark.asyncio
async def test_remove_scenarios_deletes_rows():
    scenario_ids = [uuid4(), uuid4()]
    evaluations_service = SimpleNamespace(
        delete_scenarios=AsyncMock(return_value=scenario_ids)
    )
    service = _simple_service(evaluations_service=evaluations_service)

    result = await service.remove_scenarios(
        project_id=uuid4(),
        scenario_ids=scenario_ids,
    )

    assert result == scenario_ids
    evaluations_service.delete_scenarios.assert_awaited_once()
    _, kwargs = evaluations_service.delete_scenarios.await_args
    assert kwargs["scenario_ids"] == scenario_ids


@pytest.mark.asyncio
async def test_remove_scenarios_empty_is_noop():
    evaluations_service = SimpleNamespace(delete_scenarios=AsyncMock())
    service = _simple_service(evaluations_service=evaluations_service)

    result = await service.remove_scenarios(project_id=uuid4(), scenario_ids=[])

    assert result == []
    evaluations_service.delete_scenarios.assert_not_awaited()


def _step(key: str) -> EvaluationRunDataStep:
    return EvaluationRunDataStep(
        key=key,
        type="input",
        origin="custom",
        references={},
    )


@pytest.mark.asyncio
async def test_add_steps_appends_new_columns():
    run_id = uuid4()
    run = EvaluationRun(
        id=run_id,
        status=EvaluationStatus.RUNNING,
        data=EvaluationRunData(steps=[_step("input")], repeats=1),
    )
    edited = SimpleNamespace(id=run_id)
    evaluations_service = SimpleNamespace(
        fetch_run=AsyncMock(return_value=run),
        edit_run=AsyncMock(return_value=edited),
    )
    service = _simple_service(evaluations_service=evaluations_service)

    result = await service.add_steps(
        project_id=uuid4(),
        user_id=uuid4(),
        run_id=run_id,
        steps=[_step("evaluator")],
    )

    assert result == edited
    _, kwargs = evaluations_service.edit_run.await_args
    assert [s.key for s in kwargs["run"].data.steps] == ["input", "evaluator"]


@pytest.mark.asyncio
async def test_add_steps_skips_existing_key():
    run_id = uuid4()
    run = EvaluationRun(
        id=run_id,
        status=EvaluationStatus.RUNNING,
        data=EvaluationRunData(steps=[_step("input")], repeats=1),
    )
    evaluations_service = SimpleNamespace(
        fetch_run=AsyncMock(return_value=run),
        edit_run=AsyncMock(),
    )
    service = _simple_service(evaluations_service=evaluations_service)

    result = await service.add_steps(
        project_id=uuid4(),
        user_id=uuid4(),
        run_id=run_id,
        steps=[_step("input")],
    )

    # all keys already present -> no edit, run returned unchanged
    assert result is run
    evaluations_service.edit_run.assert_not_awaited()


@pytest.mark.asyncio
async def test_remove_steps_drops_named_columns():
    run_id = uuid4()
    run = EvaluationRun(
        id=run_id,
        status=EvaluationStatus.RUNNING,
        data=EvaluationRunData(steps=[_step("input"), _step("evaluator")], repeats=1),
    )
    edited = SimpleNamespace(id=run_id)
    evaluations_service = SimpleNamespace(
        fetch_run=AsyncMock(return_value=run),
        edit_run=AsyncMock(return_value=edited),
    )
    service = _simple_service(evaluations_service=evaluations_service)

    result = await service.remove_steps(
        project_id=uuid4(),
        user_id=uuid4(),
        run_id=run_id,
        step_keys=["evaluator"],
    )

    assert result == edited
    _, kwargs = evaluations_service.edit_run.await_args
    assert [s.key for s in kwargs["run"].data.steps] == ["input"]


@pytest.mark.asyncio
async def test_remove_steps_unknown_key_is_noop():
    run_id = uuid4()
    run = EvaluationRun(
        id=run_id,
        status=EvaluationStatus.RUNNING,
        data=EvaluationRunData(steps=[_step("input")], repeats=1),
    )
    evaluations_service = SimpleNamespace(
        fetch_run=AsyncMock(return_value=run),
        edit_run=AsyncMock(),
    )
    service = _simple_service(evaluations_service=evaluations_service)

    result = await service.remove_steps(
        project_id=uuid4(),
        user_id=uuid4(),
        run_id=run_id,
        step_keys=["missing"],
    )

    assert result is run
    evaluations_service.edit_run.assert_not_awaited()


@pytest.mark.asyncio
async def test_set_repeats_sets_run_data_repeats():
    run_id = uuid4()
    # set_repeats builds a real EvaluationRunEdit, so the run/data must be the
    # real DTOs (model_copy + validation run for real).
    run = EvaluationRun(
        id=run_id,
        status=EvaluationStatus.RUNNING,
        data=EvaluationRunData(repeats=1),
    )
    edited = SimpleNamespace(id=run_id)
    evaluations_service = SimpleNamespace(
        fetch_run=AsyncMock(return_value=run),
        edit_run=AsyncMock(return_value=edited),
    )
    service = _simple_service(evaluations_service=evaluations_service)

    result = await service.set_repeats(
        project_id=uuid4(),
        user_id=uuid4(),
        run_id=run_id,
        repeats=3,
    )

    assert result == edited
    evaluations_service.edit_run.assert_awaited_once()
    _, kwargs = evaluations_service.edit_run.await_args
    assert kwargs["run"].data.repeats == 3


@pytest.mark.asyncio
async def test_set_repeats_returns_none_when_run_missing():
    evaluations_service = SimpleNamespace(fetch_run=AsyncMock(return_value=None))
    service = _simple_service(evaluations_service=evaluations_service)

    result = await service.set_repeats(
        project_id=uuid4(),
        user_id=uuid4(),
        run_id=uuid4(),
        repeats=3,
    )

    assert result is None
