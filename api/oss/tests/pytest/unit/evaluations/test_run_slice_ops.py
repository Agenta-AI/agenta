"""Unit tests for the run slice operations surface (PR: unify eval loops).

Covers the coordinate-addressed ops over EXISTING scenarios — distinct from the
source-keyed dispatch_*_slice path (which ingests NEW source items):

  - TaskiqEvaluationTaskRunner.process_rerun (dispatch, omits empty kwargs)
  - SimpleEvaluationsService.dispatch_run_slice / probe_slice / populate_slice
  - EvaluationsService self-builds SliceOperations from its sub-services
  - rerun entry fn runs process() then refresh()
"""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from oss.src.core.evaluations.service import (
    EvaluationsService,
    SimpleEvaluationsService,
)
from oss.src.core.evaluations.runtime.runner import TaskiqEvaluationTaskRunner
from oss.src.core.evaluations.runtime.operations import SliceOperations
from oss.src.core.evaluations.runtime.models import RunSlice
from oss.src.core.evaluations.tasks import run as run_module
from oss.src.core.evaluations.tasks.run import (
    run_from_source,
    rerun,
)
from oss.src.core.evaluations.runtime.models import TopologyDecision
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
async def test_runner_process_rerun_dispatches_and_omits_empty_kwargs():
    project_id = uuid4()
    user_id = uuid4()
    run_id = uuid4()
    scenario_id = uuid4()
    worker = SimpleNamespace(
        process_rerun=SimpleNamespace(kiq=AsyncMock(return_value="run-task")),
    )
    runner = TaskiqEvaluationTaskRunner(worker=worker)

    result = await runner.process_rerun(
        project_id=project_id,
        user_id=user_id,
        run_id=run_id,
        scenario_ids=[scenario_id],
        step_keys=["evaluator-auto"],
        # repeat_idxs / process_mode left None -> must be omitted from the call
    )

    assert result == "run-task"
    worker.process_rerun.kiq.assert_awaited_once_with(
        project_id=project_id,
        user_id=user_id,
        run_id=run_id,
        scenario_ids=[scenario_id],
        step_keys=["evaluator-auto"],
    )


@pytest.mark.asyncio
async def test_runner_process_rerun_forwards_all_kwargs_when_present():
    worker = SimpleNamespace(
        process_rerun=SimpleNamespace(kiq=AsyncMock()),
    )
    runner = TaskiqEvaluationTaskRunner(worker=worker)
    project_id, user_id, run_id, scenario_id = uuid4(), uuid4(), uuid4(), uuid4()

    await runner.process_rerun(
        project_id=project_id,
        user_id=user_id,
        run_id=run_id,
        scenario_ids=[scenario_id],
        step_keys=["evaluator-auto"],
        repeat_idxs=[0, 1],
        process_mode="force",
    )

    worker.process_rerun.kiq.assert_awaited_once_with(
        project_id=project_id,
        user_id=user_id,
        run_id=run_id,
        scenario_ids=[scenario_id],
        step_keys=["evaluator-auto"],
        repeat_idxs=[0, 1],
        process_mode="force",
    )


# --- SimpleEvaluationsService.dispatch_run_slice ---------------------------


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
async def test_dispatch_run_slice_dispatches_to_runner():
    project_id, user_id, run_id, scenario_id = uuid4(), uuid4(), uuid4(), uuid4()
    run = SimpleNamespace(id=run_id, flags=SimpleNamespace())
    worker = SimpleNamespace(
        process_rerun=SimpleNamespace(kiq=AsyncMock()),
    )
    evaluations_service = SimpleNamespace(fetch_run=AsyncMock(return_value=run))
    service = _simple_service(worker=worker, evaluations_service=evaluations_service)

    ok = await service.dispatch_run_slice(
        project_id=project_id,
        user_id=user_id,
        run_id=run_id,
        scenario_ids=[scenario_id],
        step_keys=["evaluator-auto"],
        process_mode="force",
    )

    assert ok is True
    worker.process_rerun.kiq.assert_awaited_once_with(
        project_id=project_id,
        user_id=user_id,
        run_id=run_id,
        scenario_ids=[scenario_id],
        step_keys=["evaluator-auto"],
        process_mode="force",
    )


@pytest.mark.asyncio
async def test_dispatch_run_slice_returns_false_without_runner():
    run_id = uuid4()
    service = _simple_service(worker=None, evaluations_service=SimpleNamespace())

    ok = await service.dispatch_run_slice(
        project_id=uuid4(),
        user_id=uuid4(),
        run_id=run_id,
    )

    assert ok is False


@pytest.mark.asyncio
async def test_dispatch_run_slice_returns_false_when_run_missing():
    worker = SimpleNamespace(
        process_rerun=SimpleNamespace(kiq=AsyncMock()),
    )
    evaluations_service = SimpleNamespace(fetch_run=AsyncMock(return_value=None))
    service = _simple_service(worker=worker, evaluations_service=evaluations_service)

    ok = await service.dispatch_run_slice(
        project_id=uuid4(),
        user_id=uuid4(),
        run_id=uuid4(),
    )

    assert ok is False
    worker.process_rerun.kiq.assert_not_awaited()


# --- SimpleEvaluationsService.probe_slice / populate_slice --------------------


@pytest.mark.asyncio
async def test_probe_slice_delegates_to_run_operations_with_built_slice():
    project_id, run_id, scenario_id = uuid4(), uuid4(), uuid4()
    result = MagicMock(spec=EvaluationResult)
    run_operations = SimpleNamespace(probe=AsyncMock(return_value=[result]))
    evaluations_service = SimpleNamespace(run_slice_operations=run_operations)
    service = _simple_service(evaluations_service=evaluations_service)

    results = await service.probe_slice(
        project_id=project_id,
        run_id=run_id,
        scenario_ids=[scenario_id],
        step_keys=["evaluator-auto"],
        repeat_idxs=[0],
    )

    assert results == [result]
    run_operations.probe.assert_awaited_once()
    _, kwargs = run_operations.probe.await_args
    assert kwargs["project_id"] == project_id
    built: RunSlice = kwargs["run_slice"]
    assert built.run_id == run_id
    assert built.scenario_ids == [scenario_id]
    assert built.step_keys == ["evaluator-auto"]
    assert built.repeat_idxs == [0]


@pytest.mark.asyncio
async def test_probe_slice_returns_empty_when_run_operations_unwired():
    evaluations_service = SimpleNamespace(run_slice_operations=None)
    service = _simple_service(evaluations_service=evaluations_service)

    results = await service.probe_slice(project_id=uuid4(), run_id=uuid4())

    assert results == []


@pytest.mark.asyncio
async def test_populate_slice_delegates_results_to_run_operations():
    project_id, user_id = uuid4(), uuid4()
    result = MagicMock(spec=EvaluationResult)
    run_operations = SimpleNamespace(populate=AsyncMock(return_value=[result]))
    evaluations_service = SimpleNamespace(run_slice_operations=run_operations)
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
    run_operations.populate.assert_awaited_once_with(
        project_id=project_id,
        user_id=user_id,
        results=[create],
    )


@pytest.mark.asyncio
async def test_populate_slice_returns_empty_when_run_operations_unwired():
    evaluations_service = SimpleNamespace(run_slice_operations=None)
    service = _simple_service(evaluations_service=evaluations_service)

    results = await service.populate_slice(
        project_id=uuid4(),
        user_id=uuid4(),
        results=[],
    )

    assert results == []


# --- EvaluationsService self-builds SliceOperations ---------------------


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


def test_service_builds_run_operations_when_sub_services_present():
    service = _evaluations_service(with_sub_services=True)

    ops = service.run_slice_operations
    assert isinstance(ops, SliceOperations)
    assert ops.slice_processor is not None
    # the ops reference the owning service (probe/populate go through it)
    assert ops.evaluations_service is service


def test_service_leaves_run_operations_none_without_sub_services():
    service = _evaluations_service(with_sub_services=False)

    assert service.run_slice_operations is None


# --- rerun entry fn --------------------------------


@pytest.mark.asyncio
async def test_rerun_runs_process_then_refresh(monkeypatch):
    """rerun orchestrates process(slice) then refresh(slice) over the same scope.

    The refresh DETAIL (variational + global/temporal aggregate) lives in
    SliceOperations.refresh and is covered by
    test_run_operations_refresh_* — here we only assert rerun delegates both
    steps, in order, against the same coordinate slice.
    """
    project_id, user_id, run_id, scenario_id = uuid4(), uuid4(), uuid4(), uuid4()

    calls = []
    captured = {}

    class _FakeRunOperations:
        def __init__(self, *, evaluations_service, slice_processor):
            captured["slice_processor"] = slice_processor

        async def process(self, *, project_id, user_id, run_slice):
            calls.append("process")
            captured["process_slice"] = run_slice

        async def refresh(self, *, project_id, user_id, run_slice):
            calls.append("refresh")
            captured["refresh_slice"] = run_slice

    monkeypatch.setattr(
        "oss.src.core.evaluations.tasks.run.SliceOperations",
        _FakeRunOperations,
    )

    ok = await rerun(
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
        evaluations_service=SimpleNamespace(),
    )

    assert ok is True
    # process THEN refresh, both over the same coordinate slice.
    assert calls == ["process", "refresh"]
    assert captured["process_slice"].run_id == run_id
    assert captured["process_slice"].scenario_ids == [scenario_id]
    assert captured["process_slice"].step_keys == ["evaluator-auto"]
    assert captured["process_slice"].process_mode == "force"
    assert captured["refresh_slice"].scenario_ids == [scenario_id]


@pytest.mark.asyncio
async def test_run_operations_refresh_global_for_non_live():
    """Non-live run -> refresh does variational + the GLOBAL aggregate row."""
    project_id, user_id, run_id, scenario_id = uuid4(), uuid4(), uuid4(), uuid4()

    refresh_mock = AsyncMock(return_value=[])
    evaluations_service = SimpleNamespace(
        fetch_run=AsyncMock(
            return_value=SimpleNamespace(flags=SimpleNamespace(is_live=False))
        ),
        query_scenarios=AsyncMock(return_value=[]),
        refresh_metrics=refresh_mock,
    )
    operations = SliceOperations(evaluations_service=evaluations_service)

    await operations.refresh(
        project_id=project_id,
        user_id=user_id,
        run_slice=RunSlice(run_id=run_id, scenario_ids=[scenario_id]),
    )

    kinds = [c.kwargs["metrics"] for c in refresh_mock.await_args_list]
    # variational: scenario_ids set, no timestamp.
    assert any(m.scenario_ids == [scenario_id] and not m.timestamps for m in kinds)
    # global: run_id only, no scenario, no timestamp.
    assert any(
        m.run_id == run_id
        and m.scenario_ids is None
        and m.scenario_id is None
        and not m.timestamps
        for m in kinds
    )


@pytest.mark.asyncio
async def test_run_operations_refresh_temporal_for_live():
    """Live run -> refresh does variational + a TEMPORAL aggregate per interval."""
    project_id, user_id, run_id = uuid4(), uuid4(), uuid4()
    s1, s2 = uuid4(), uuid4()
    ts = datetime(2026, 6, 2, 14, 0, 0)

    refresh_mock = AsyncMock(return_value=[])
    evaluations_service = SimpleNamespace(
        fetch_run=AsyncMock(
            return_value=SimpleNamespace(flags=SimpleNamespace(is_live=True))
        ),
        query_scenarios=AsyncMock(
            return_value=[
                SimpleNamespace(id=s1, timestamp=ts, interval=1),
                SimpleNamespace(id=s2, timestamp=ts, interval=1),
            ]
        ),
        refresh_metrics=refresh_mock,
    )
    operations = SliceOperations(evaluations_service=evaluations_service)

    await operations.refresh(
        project_id=project_id,
        user_id=user_id,
        run_slice=RunSlice(run_id=run_id, scenario_ids=[s1, s2]),
    )

    kinds = [c.kwargs["metrics"] for c in refresh_mock.await_args_list]
    # one temporal refresh for the single affected interval, carrying its bucket.
    assert any(
        m.run_id == run_id and m.interval == 1 and m.timestamps == [ts] for m in kinds
    )


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
    # skeleton only: run-scoped, no input cells / results, no temporal bucket
    assert all(s.run_id == run_id for s in scenarios)
    assert all(s.timestamp is None and s.interval is None for s in scenarios)


@pytest.mark.asyncio
async def test_add_scenarios_floors_timestamp_and_sets_interval():
    run_id = uuid4()
    evaluations_service = SimpleNamespace(
        create_scenarios=AsyncMock(return_value=[SimpleNamespace(id=uuid4())])
    )
    service = _simple_service(evaluations_service=evaluations_service)

    await service.add_scenarios(
        project_id=uuid4(),
        user_id=uuid4(),
        run_id=run_id,
        count=1,
        timestamp=datetime(2026, 6, 2, 14, 23, 47, 500000),
    )

    _, kwargs = evaluations_service.create_scenarios.await_args
    scenario = kwargs["scenarios"][0]
    # floored to the minute; interval fixed at 1 (DEFAULT_REFRESH_INTERVAL)
    assert scenario.timestamp == datetime(2026, 6, 2, 14, 23, 0, 0)
    assert scenario.interval == 1


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


# --- prune uses the ID-only query (UEL-029) ----------------------------------


@pytest.mark.asyncio
async def test_prune_uses_query_result_ids_not_full_probe():
    """prune deletes by id, so it must use the ID-only query (no full DTO hydrate)."""
    project_id, user_id, run_id = uuid4(), uuid4(), uuid4()
    result_ids = [uuid4(), uuid4()]

    evaluations_service = SimpleNamespace(
        query_result_ids=AsyncMock(return_value=result_ids),
        # query_results is the full-DTO path; prune must NOT call it.
        query_results=AsyncMock(return_value=["should-not-be-used"]),
        delete_results=AsyncMock(return_value=result_ids),
        refresh_metrics=AsyncMock(return_value=[]),
        # prune -> refresh() reads run kind + scenarios for the aggregate pass.
        fetch_run=AsyncMock(
            return_value=SimpleNamespace(flags=SimpleNamespace(is_live=False))
        ),
        query_scenarios=AsyncMock(return_value=[]),
    )
    run_operations = SliceOperations(evaluations_service=evaluations_service)

    deleted = await run_operations.prune(
        project_id=project_id,
        user_id=user_id,
        run_slice=RunSlice(run_id=run_id, scenario_ids=[uuid4()]),
    )

    assert deleted == result_ids
    evaluations_service.query_result_ids.assert_awaited_once()
    evaluations_service.query_results.assert_not_awaited()
    evaluations_service.delete_results.assert_awaited_once_with(
        project_id=project_id,
        result_ids=result_ids,
    )


@pytest.mark.asyncio
async def test_prune_empty_slice_is_noop():
    """An empty slice dimension ([]) addresses nothing — no query, no delete."""
    evaluations_service = SimpleNamespace(
        query_result_ids=AsyncMock(return_value=[]),
        delete_results=AsyncMock(),
        refresh_metrics=AsyncMock(),
    )
    run_operations = SliceOperations(evaluations_service=evaluations_service)

    deleted = await run_operations.prune(
        project_id=uuid4(),
        user_id=uuid4(),
        run_slice=RunSlice(run_id=uuid4(), scenario_ids=[]),
    )

    assert deleted == []
    evaluations_service.query_result_ids.assert_not_awaited()
    evaluations_service.delete_results.assert_not_awaited()


# --- run dispatch routes queue_* topologies (UEL-019) ------------------------


@pytest.mark.parametrize("dispatch", ["queue_traces", "queue_testcases"])
@pytest.mark.asyncio
async def test_run_from_source_routes_queue_topologies(monkeypatch, dispatch):
    """queue_traces/queue_testcases must be handled (returns True), not dropped.

    Before UEL-019 these truthy-dispatch topologies fell through to the
    "unsupported topology" branch and returned False at run-start, silently
    doing nothing. They are now routed to a clean "open queue awaiting batches"
    finalize.
    """
    run_id = uuid4()
    run = EvaluationRun(
        id=run_id,
        status=EvaluationStatus.RUNNING,
        data=EvaluationRunData(steps=[_step("input")], repeats=1),
    )
    monkeypatch.setattr(
        run_module,
        "classify_run_topology",
        lambda _run: TopologyDecision(
            status="supported",
            label="direct -> evaluator",
            reason="worker-dispatched",
            dispatch=dispatch,
        ),
    )
    evaluations_service = SimpleNamespace(fetch_run=AsyncMock(return_value=run))

    ok = await run_from_source(
        project_id=uuid4(),
        user_id=uuid4(),
        run_id=run_id,
        tracing_service=MagicMock(),
        testsets_service=MagicMock(),
        queries_service=MagicMock(),
        workflows_service=MagicMock(),
        applications_service=MagicMock(),
        evaluations_service=evaluations_service,
        simple_evaluators_service=MagicMock(),
    )

    # Handled (not the unsupported-topology False).
    assert ok is True


@pytest.mark.asyncio
async def test_run_from_source_unsupported_topology_returns_false(monkeypatch):
    """A genuinely unsupported topology (no dispatch) still returns False."""
    run_id = uuid4()
    run = EvaluationRun(
        id=run_id,
        status=EvaluationStatus.RUNNING,
        data=EvaluationRunData(steps=[_step("input")], repeats=1),
    )
    monkeypatch.setattr(
        run_module,
        "classify_run_topology",
        lambda _run: TopologyDecision(
            status="unsupported",
            label="unsupported",
            reason="no path",
            dispatch=None,
        ),
    )
    evaluations_service = SimpleNamespace(fetch_run=AsyncMock(return_value=run))

    ok = await run_from_source(
        project_id=uuid4(),
        user_id=uuid4(),
        run_id=run_id,
        tracing_service=MagicMock(),
        testsets_service=MagicMock(),
        queries_service=MagicMock(),
        workflows_service=MagicMock(),
        applications_service=MagicMock(),
        evaluations_service=evaluations_service,
        simple_evaluators_service=MagicMock(),
    )

    assert ok is False
