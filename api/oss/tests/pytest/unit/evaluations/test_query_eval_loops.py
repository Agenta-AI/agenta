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
from oss.src.core.evaluations.tasks import query as query_module


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
    assert created_queue.data.kind == "traces"
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
async def test_process_query_source_run_marks_human_steps_pending(monkeypatch):
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
    create_results = AsyncMock(return_value=[SimpleNamespace(id=uuid4())])
    edit_scenario = AsyncMock(
        side_effect=lambda **kwargs: SimpleNamespace(
            id=kwargs["scenario"].id,
            tags=kwargs["scenario"].tags,
            meta=kwargs["scenario"].meta,
        )
    )
    refresh_metrics = AsyncMock()

    monkeypatch.setattr(
        query_module,
        "evaluations_service",
        SimpleNamespace(
            fetch_run=fetch_run,
            create_scenarios=create_scenarios,
            create_results=create_results,
            edit_scenario=edit_scenario,
            refresh_metrics=refresh_metrics,
        ),
    )
    monkeypatch.setattr(
        query_module,
        "queries_service",
        SimpleNamespace(
            fetch_query_revision=AsyncMock(
                return_value=SimpleNamespace(
                    id=query_revision_id,
                    slug="query-live",
                    data=SimpleNamespace(filtering=None, windowing=None),
                )
            )
        ),
    )
    monkeypatch.setattr(
        query_module,
        "evaluators_service",
        SimpleNamespace(
            fetch_evaluator_revision=AsyncMock(
                return_value=SimpleNamespace(
                    id=evaluator_revision_id,
                    slug="evaluator-human",
                    data=SimpleNamespace(),
                )
            )
        ),
    )
    monkeypatch.setattr(
        query_module,
        "tracing_service",
        SimpleNamespace(query_traces=AsyncMock(return_value=[trace])),
    )
    monkeypatch.setattr(
        query_module,
        "workflows_service",
        SimpleNamespace(invoke_workflow=AsyncMock()),
    )
    await query_module.process_query_source_run(
        project_id=project_id,
        user_id=user_id,
        run_id=run_id,
    )

    assert create_results.await_count == 1
    result_step_keys = [
        result.step_key for result in create_results.await_args.kwargs["results"]
    ]
    assert result_step_keys == ["query-live"]

    scenario_edit = edit_scenario.await_args.kwargs["scenario"]
    assert isinstance(scenario_edit, EvaluationScenarioEdit)
    assert scenario_edit.status == EvaluationStatus.PENDING
    refresh_metrics.assert_not_awaited()


@pytest.mark.asyncio
async def test_process_query_source_run_skips_empty_query_results(monkeypatch):
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
    process_source_slice = AsyncMock()
    monkeypatch.setattr(
        query_module,
        "evaluations_service",
        SimpleNamespace(fetch_run=AsyncMock(return_value=run)),
    )
    monkeypatch.setattr(
        query_module,
        "resolve_query_source_items",
        AsyncMock(return_value={"query-main": []}),
    )
    monkeypatch.setattr(
        query_module,
        "process_evaluation_source_slice",
        process_source_slice,
    )

    await query_module.process_query_source_run(
        project_id=project_id,
        user_id=user_id,
        run_id=run_id,
    )

    process_source_slice.assert_not_awaited()
