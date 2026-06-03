# ruff: noqa: E402

from types import SimpleNamespace
from uuid import uuid4
from unittest.mock import AsyncMock, call
import sys
import types

import pytest

sys.modules.setdefault("genson", types.SimpleNamespace(SchemaBuilder=object))

from oss.src.core.shared.dtos import Reference
from oss.src.core.evaluations.types import (
    EvaluationQueue,
    EvaluationQueueData,
    EvaluationRun,
    EvaluationRunData,
    EvaluationRunDataStep,
    EvaluationRunFlags,
    EvaluationScenarioEdit,
    EvaluationStatus,
    SimpleQueueCreate,
    SimpleQueueData,
)
from oss.src.core.evaluations.service import SimpleQueuesService
from oss.src.core.evaluations.tasks import run as run_module


@pytest.mark.asyncio
async def test_simple_queue_create_dispatches_each_query_source_with_step_key():
    project_id = uuid4()
    user_id = uuid4()
    queue_id = uuid4()
    run_id = uuid4()
    query_revision_id_1 = uuid4()
    query_revision_id_2 = uuid4()
    evaluator_revision_id = uuid4()

    run_data = EvaluationRunData(
        steps=[
            EvaluationRunDataStep(
                key="query-source-1",
                type="input",
                origin="custom",
                references={"query_revision": Reference(id=query_revision_id_1)},
            ),
            EvaluationRunDataStep(
                key="query-source-2",
                type="input",
                origin="custom",
                references={"query_revision": Reference(id=query_revision_id_2)},
            ),
            EvaluationRunDataStep(
                key="evaluator-human",
                type="annotation",
                origin="human",
                references={"evaluator_revision": Reference(id=evaluator_revision_id)},
            ),
        ],
        repeats=1,
    )

    run = EvaluationRun(
        id=run_id,
        flags=EvaluationRunFlags(is_queue=True, has_queries=True, has_evaluators=True),
        status=EvaluationStatus.RUNNING,
        data=run_data,
    )
    queue = EvaluationQueue(
        id=queue_id,
        run_id=run_id,
        status=EvaluationStatus.RUNNING,
        data=EvaluationQueueData(step_keys=["evaluator-human"]),
    )

    evaluations_service = SimpleNamespace(
        create_run=AsyncMock(return_value=run),
        create_queue=AsyncMock(return_value=queue),
        delete_run=AsyncMock(),
    )
    simple_evaluations_service = SimpleNamespace(
        _make_evaluation_run_data=AsyncMock(return_value=run_data),
        queries_service=SimpleNamespace(
            fetch_query_revision=AsyncMock(
                side_effect=[
                    SimpleNamespace(
                        data=SimpleNamespace(trace_ids=["trace-1", "trace-2"])
                    ),
                    SimpleNamespace(data=SimpleNamespace(trace_ids=["trace-3"])),
                ]
            )
        ),
        testsets_service=SimpleNamespace(fetch_testset_revision=AsyncMock()),
        dispatch_trace_slice=AsyncMock(return_value=True),
        dispatch_testcase_slice=AsyncMock(return_value=True),
    )

    service = SimpleQueuesService(
        evaluations_service=evaluations_service,  # type: ignore[arg-type]
        simple_evaluations_service=simple_evaluations_service,  # type: ignore[arg-type]
        evaluators_service=SimpleNamespace(),  # type: ignore[arg-type]
    )

    created_queue = await service.create(
        project_id=project_id,
        user_id=user_id,
        queue=SimpleQueueCreate(
            name="query-backed-queue",
            data=SimpleQueueData(
                queries=[query_revision_id_1, query_revision_id_2],
                evaluators=[evaluator_revision_id],
            ),
        ),
    )

    assert created_queue is not None
    assert created_queue.data is not None
    assert created_queue.data.kind == "queries"
    assert created_queue.data.queries == [query_revision_id_1, query_revision_id_2]
    assert simple_evaluations_service.dispatch_trace_slice.await_args_list == [
        call(
            project_id=project_id,
            user_id=user_id,
            run_id=run_id,
            trace_ids=["trace-1", "trace-2"],
            input_step_key="query-source-1",
        ),
        call(
            project_id=project_id,
            user_id=user_id,
            run_id=run_id,
            trace_ids=["trace-3"],
            input_step_key="query-source-2",
        ),
    ]


@pytest.mark.asyncio
async def test_run_query_source_marks_human_steps_pending(monkeypatch):
    project_id = uuid4()
    user_id = uuid4()
    run_id = uuid4()
    query_revision_id = uuid4()
    evaluator_revision_id = uuid4()
    scenario_id = uuid4()

    run = EvaluationRun(
        id=run_id,
        flags=EvaluationRunFlags(is_live=True, has_queries=True, has_human=True),
        status=EvaluationStatus.RUNNING,
        data=EvaluationRunData(
            steps=[
                EvaluationRunDataStep(
                    key="query-live",
                    type="input",
                    origin="custom",
                    references={"query_revision": Reference(id=query_revision_id)},
                ),
                EvaluationRunDataStep(
                    key="evaluator-human",
                    type="annotation",
                    origin="human",
                    references={
                        "evaluator_revision": Reference(id=evaluator_revision_id)
                    },
                ),
            ],
            repeats=1,
        ),
    )

    trace = SimpleNamespace(
        trace_id="trace-live",
        spans={
            "root": SimpleNamespace(
                span_id="span-live",
                model_dump=lambda **kwargs: {
                    "attributes": {
                        "ag": {"data": {"inputs": {"x": 1}, "outputs": {"y": 2}}}
                    }
                },
            )
        },
        model_dump=lambda **kwargs: {"trace_id": "trace-live", "spans": {}},
    )

    fetch_run = AsyncMock(return_value=run)
    create_scenarios = AsyncMock(
        return_value=[SimpleNamespace(id=scenario_id, tags=None, meta=None)]
    )
    set_results = AsyncMock(return_value=[SimpleNamespace(id=uuid4())])
    edit_scenario = AsyncMock(
        side_effect=lambda **kwargs: SimpleNamespace(
            id=kwargs["scenario"].id,
            tags=kwargs["scenario"].tags,
            meta=kwargs["scenario"].meta,
        )
    )
    edit_run = AsyncMock()
    refresh_metrics = AsyncMock()
    query_results = AsyncMock(return_value=[])

    evaluations_service = SimpleNamespace(
        fetch_run=fetch_run,
        create_scenarios=create_scenarios,
        set_results=set_results,
        edit_scenario=edit_scenario,
        edit_run=edit_run,
        refresh_metrics=refresh_metrics,
        query_results=query_results,
    )
    queries_service = SimpleNamespace(
        fetch_query_revision=AsyncMock(
            return_value=SimpleNamespace(
                id=query_revision_id,
                slug="query-live",
                data=SimpleNamespace(filtering=None, windowing=None),
            )
        )
    )
    workflows_service = SimpleNamespace(invoke_workflow=AsyncMock())

    # The query resolver hands the unified flow an already-hydrated trace; no
    # re-fetch happens downstream (Option A seed path).
    monkeypatch.setattr(
        run_module,
        "resolve_query_source_items",
        AsyncMock(
            return_value={
                "query-live": [
                    run_module.ResolvedSourceItem(
                        kind="trace",
                        step_key="query-live",
                        trace_id="trace-live",
                        trace=trace,
                    )
                ]
            }
        ),
    )

    # Live run (use_windowing=False) routes through the query seam directly.
    await run_module._run_query_source(
        project_id=project_id,
        user_id=user_id,
        run=run,
        newest=None,
        oldest=None,
        use_windowing=False,
        tracing_service=SimpleNamespace(),
        queries_service=queries_service,
        workflows_service=workflows_service,
        applications_service=SimpleNamespace(),
        evaluations_service=evaluations_service,
    )

    # The input cell is written under the query step key. The unified flow
    # populates it once (mint+populate) and the SDK plan logs the input step
    # again on execute — same as the direct-slice ingest path. We assert the
    # query step key is present and the human step is logged PENDING, rather
    # than pinning the exact call count.
    logged_step_keys = {
        result.step_key
        for call_args in set_results.await_args_list
        for result in call_args.kwargs["results"]
    }
    assert "query-live" in logged_step_keys

    # The human annotation step is PENDING (the backend never executes it).
    scenario_statuses = {
        call_args.kwargs["scenario"].status
        for call_args in edit_scenario.await_args_list
    }
    assert all(
        isinstance(call_args.kwargs["scenario"], EvaluationScenarioEdit)
        for call_args in edit_scenario.await_args_list
    )
    assert EvaluationStatus.PENDING in scenario_statuses
    # Human-only live tick produced no auto results -> no metric refresh, and a
    # live run is never finalized.
    refresh_metrics.assert_not_awaited()
    edit_run.assert_not_awaited()


@pytest.mark.asyncio
async def test_run_query_source_skips_empty_query_results(monkeypatch):
    project_id = uuid4()
    user_id = uuid4()
    run_id = uuid4()
    query_revision_id = uuid4()
    evaluator_revision_id = uuid4()
    run = EvaluationRun(
        id=run_id,
        flags=EvaluationRunFlags(has_queries=True, has_evaluators=True),
        status=EvaluationStatus.RUNNING,
        data=EvaluationRunData(
            steps=[
                EvaluationRunDataStep(
                    key="query-main",
                    type="input",
                    origin="custom",
                    references={"query_revision": Reference(id=query_revision_id)},
                ),
                EvaluationRunDataStep(
                    key="evaluator-auto",
                    type="annotation",
                    origin="auto",
                    references={
                        "evaluator_revision": Reference(id=evaluator_revision_id)
                    },
                ),
            ]
        ),
    )
    execute_bindings = AsyncMock()
    monkeypatch.setattr(
        run_module,
        "resolve_query_source_items",
        AsyncMock(return_value={"query-main": []}),
    )
    monkeypatch.setattr(run_module, "_execute_bindings", execute_bindings)

    # Live run (use_windowing=False): an empty tick must not mint or execute.
    await run_module._run_query_source(
        project_id=project_id,
        user_id=user_id,
        run=run,
        newest=None,
        oldest=None,
        use_windowing=False,
        tracing_service=SimpleNamespace(),
        queries_service=SimpleNamespace(),
        workflows_service=SimpleNamespace(),
        applications_service=SimpleNamespace(),
        evaluations_service=SimpleNamespace(fetch_run=AsyncMock(return_value=run)),
    )

    execute_bindings.assert_not_awaited()


@pytest.mark.asyncio
async def test_run_query_source_finalizes_batch_run_on_pre_slice_error(
    monkeypatch,
):
    """A pre-slice error in a batch run must finalize it to FAILURE (UEL-024).

    An exception raised before the slice processor runs (here, during source
    resolution) never reaches the slice's own finalize, so the outer handler must
    flip a batch (use_windowing=True) run to FAILURE + inactive instead of
    leaving it stuck RUNNING.
    """
    project_id, user_id, run_id = uuid4(), uuid4(), uuid4()
    run = EvaluationRun(
        id=run_id,
        flags=EvaluationRunFlags(has_queries=True, has_evaluators=True, is_active=True),
        status=EvaluationStatus.RUNNING,
        data=EvaluationRunData(
            steps=[
                EvaluationRunDataStep(
                    key="query-main",
                    type="input",
                    origin="custom",
                    references={"query_revision": Reference(id=uuid4())},
                ),
            ]
        ),
    )
    edit_run = AsyncMock()
    evaluations_service = SimpleNamespace(
        fetch_run=AsyncMock(return_value=run),
        edit_run=edit_run,
    )
    monkeypatch.setattr(
        run_module,
        "resolve_query_source_items",
        AsyncMock(side_effect=RuntimeError("boom: trace fetch failed")),
    )

    # Must not raise — the error is handled and the run finalized.
    await run_module._run_query_source(
        project_id=project_id,
        user_id=user_id,
        run=run,
        newest=None,
        oldest=None,
        use_windowing=True,
        tracing_service=SimpleNamespace(),
        queries_service=SimpleNamespace(),
        workflows_service=SimpleNamespace(),
        applications_service=SimpleNamespace(),
        evaluations_service=evaluations_service,
    )

    edit_run.assert_awaited_once()
    _, kwargs = edit_run.await_args
    edited = kwargs["run"]
    assert edited.status == EvaluationStatus.FAILURE
    assert edited.flags.is_active is False


@pytest.mark.asyncio
async def test_run_query_source_live_run_not_finalized_on_error(monkeypatch):
    """A LIVE run (use_windowing=False) keeps ticking — it is NOT finalized."""
    project_id, user_id, run_id = uuid4(), uuid4(), uuid4()
    run = EvaluationRun(
        id=run_id,
        flags=EvaluationRunFlags(
            has_queries=True, has_evaluators=True, is_live=True, is_active=True
        ),
        status=EvaluationStatus.RUNNING,
        data=EvaluationRunData(
            steps=[
                EvaluationRunDataStep(
                    key="query-main",
                    type="input",
                    origin="custom",
                    references={"query_revision": Reference(id=uuid4())},
                ),
            ]
        ),
    )
    edit_run = AsyncMock()
    evaluations_service = SimpleNamespace(
        fetch_run=AsyncMock(return_value=run),
        edit_run=edit_run,
    )
    monkeypatch.setattr(
        run_module,
        "resolve_query_source_items",
        AsyncMock(side_effect=RuntimeError("boom")),
    )

    await run_module._run_query_source(
        project_id=project_id,
        user_id=user_id,
        run=run,
        newest=None,
        oldest=None,
        use_windowing=False,
        tracing_service=SimpleNamespace(),
        queries_service=SimpleNamespace(),
        workflows_service=SimpleNamespace(),
        applications_service=SimpleNamespace(),
        evaluations_service=evaluations_service,
    )

    # live runs are never finalized on error — the scheduler keeps polling.
    edit_run.assert_not_awaited()
