from types import SimpleNamespace
from uuid import uuid4

import pytest

import agenta.sdk.evaluations.preview.evaluate as preview_evaluate
import agenta.sdk.evaluations.runtime.adapters as runtime_adapters
from agenta.sdk.evaluations.runtime.execution import execute_workflow_batch
from agenta.sdk.evaluations.runtime.models import (
    EvaluationStep,
    PlannedCell,
    ResolvedSourceItem,
    ResultLogRequest,
    ScenarioBinding,
)
from agenta.sdk.evaluations.runtime.planner import EvaluationPlanner
from agenta.sdk.evaluations.runtime.source_slice import (
    process_evaluation_source_slice,
)
from agenta.sdk.evaluations.runtime.topology import classify_steps_topology
from agenta.sdk.evaluations.runtime.models import WorkflowExecutionResult
from agenta.sdk.models.evaluations import EvaluationStatus


def test_sdk_runtime_planner_matches_split_repeat_rules():
    run_id = uuid4()
    scenario_id = uuid4()
    plan = EvaluationPlanner().plan(
        run_id=run_id,
        scenario_id=scenario_id,
        source=ResolvedSourceItem(
            kind="testcase",
            step_key="testset-main",
            testcase_id=uuid4(),
        ),
        steps=[
            EvaluationStep(key="testset-main", type="input"),
            EvaluationStep(key="application-main", type="invocation"),
            EvaluationStep(key="evaluator-auto", type="annotation", origin="auto"),
            EvaluationStep(key="evaluator-human", type="annotation", origin="human"),
        ],
        repeats=3,
        is_split=False,
    )

    assert [
        cell.repeat_idx for cell in plan.cells if cell.step_key == "application-main"
    ] == [0]
    assert [
        cell.status for cell in plan.cells if cell.step_key == "evaluator-human"
    ] == [
        EvaluationStatus.PENDING,
        EvaluationStatus.PENDING,
        EvaluationStatus.PENDING,
    ]
    assert {(cell.step_key, cell.repeat_idx) for cell in plan.executable_cells} == {
        ("application-main", 0),
        ("evaluator-auto", 0),
        ("evaluator-auto", 1),
        ("evaluator-auto", 2),
    }


def test_sdk_runtime_planner_handles_multiple_scenario_bindings():
    run_id = uuid4()
    first_scenario_id = uuid4()
    second_scenario_id = uuid4()

    plan = EvaluationPlanner().plan_bindings(
        run_id=run_id,
        bindings=[
            ScenarioBinding(
                scenario_id=first_scenario_id,
                source=ResolvedSourceItem(
                    kind="testcase",
                    step_key="testset-main",
                    testcase_id=uuid4(),
                ),
            ),
            ScenarioBinding(
                scenario_id=second_scenario_id,
                source=ResolvedSourceItem(
                    kind="testcase",
                    step_key="testset-main",
                    testcase_id=uuid4(),
                ),
            ),
        ],
        steps=[
            EvaluationStep(key="testset-main", type="input"),
            EvaluationStep(key="application-main", type="invocation"),
        ],
        repeats=2,
    )

    assert [cell.scenario_id for cell in plan.cells] == [
        first_scenario_id,
        first_scenario_id,
        first_scenario_id,
        first_scenario_id,
        second_scenario_id,
        second_scenario_id,
        second_scenario_id,
        second_scenario_id,
    ]
    assert [
        (cell.step_key, cell.repeat_idx)
        for cell in plan.cells
        if cell.scenario_id == first_scenario_id
    ] == [
        ("testset-main", 0),
        ("testset-main", 1),
        ("application-main", 0),
        ("application-main", 1),
    ]


def test_sdk_runtime_topology_classifier_matches_batch_inference_shape():
    decision = classify_steps_topology(
        steps=[
            EvaluationStep(
                key="testset-main",
                type="input",
                references={"testset_revision": {"id": str(uuid4())}},
            ),
            EvaluationStep(
                key="application-main",
                type="invocation",
                references={"application_revision": {"id": str(uuid4())}},
            ),
        ],
    )

    assert decision.status == "supported"
    assert decision.dispatch == "batch_invocation"


def test_sdk_runtime_topology_classifier_keeps_deferred_query_to_application_shape():
    decision = classify_steps_topology(
        steps=[
            EvaluationStep(
                key="query-main",
                type="input",
                references={"query_revision": {"id": str(uuid4())}},
            ),
            EvaluationStep(
                key="application-main",
                type="invocation",
                references={"application_revision": {"id": str(uuid4())}},
            ),
        ],
    )

    assert decision.status == "potential"


@pytest.mark.asyncio
async def test_sdk_workflow_batch_falls_back_to_single_execute():
    calls = []

    class SingleRunner:
        async def execute(self, request):
            calls.append(request.cell.repeat_idx)
            return WorkflowExecutionResult(
                status=EvaluationStatus.SUCCESS,
                trace_id=f"trace-{request.cell.repeat_idx}",
            )

    requests = [
        SimpleNamespace(
            cell=SimpleNamespace(repeat_idx=0),
        ),
        SimpleNamespace(
            cell=SimpleNamespace(repeat_idx=1),
        ),
    ]

    results = await execute_workflow_batch(
        runner=SingleRunner(),
        requests=requests,
    )

    assert calls == [0, 1]
    assert [result.trace_id for result in results] == ["trace-0", "trace-1"]


@pytest.mark.asyncio
async def test_sdk_source_slice_batches_runnable_cells():
    run_id = uuid4()
    scenario_id = uuid4()
    logged = []

    class BatchRunner:
        def __init__(self):
            self.requests = []

        async def execute_batch(self, requests):
            self.requests.append(requests)
            return [
                WorkflowExecutionResult(
                    status=EvaluationStatus.SUCCESS,
                    trace_id=f"trace-{request.cell.repeat_idx}",
                    span_id=f"span-{request.cell.repeat_idx}",
                )
                for request in requests
            ]

    class Logger:
        async def log(self, request):
            logged.append((request.cell.step_key, request.cell.repeat_idx))
            return SimpleNamespace(id=uuid4())

    async def create_scenario(run_id):
        return SimpleNamespace(id=scenario_id)

    async def refresh_metrics(run_id, scenario_id):
        return SimpleNamespace(id=uuid4())

    runner = BatchRunner()

    await process_evaluation_source_slice(
        run_id=run_id,
        source_items=[
            ResolvedSourceItem(
                kind="testcase",
                step_key="testset-main",
                testcase_id=uuid4(),
                inputs={"prompt": "hello"},
            )
        ],
        steps=[
            EvaluationStep(key="testset-main", type="input"),
            EvaluationStep(key="evaluator-auto", type="annotation", origin="auto"),
        ],
        repeats=3,
        create_scenario=create_scenario,
        result_logger=Logger(),
        refresh_metrics=refresh_metrics,
        runners={"evaluator-auto": runner},
        revisions={"evaluator-auto": {"id": "revision"}},
    )

    assert len(runner.requests) == 1
    assert [request.cell.repeat_idx for request in runner.requests[0]] == [0, 1, 2]
    assert logged == [
        ("testset-main", 0),
        ("testset-main", 1),
        ("testset-main", 2),
        ("evaluator-auto", 0),
        ("evaluator-auto", 1),
        ("evaluator-auto", 2),
    ]


@pytest.mark.asyncio
async def test_sdk_source_slice_marks_short_runner_batch_as_error():
    run_id = uuid4()
    scenario_id = uuid4()
    logged = []

    class ShortRunner:
        async def execute_batch(self, requests):
            return [
                WorkflowExecutionResult(
                    status=EvaluationStatus.SUCCESS,
                    trace_id="trace-0",
                    span_id="span-0",
                )
            ]

    class Logger:
        async def log(self, request):
            logged.append(request)
            return SimpleNamespace(id=uuid4())

    async def create_scenario(run_id):
        return SimpleNamespace(id=scenario_id)

    async def refresh_metrics(run_id, scenario_id):
        return SimpleNamespace(id=uuid4())

    processed = await process_evaluation_source_slice(
        run_id=run_id,
        source_items=[
            ResolvedSourceItem(
                kind="testcase",
                step_key="testset-main",
                testcase_id=uuid4(),
                inputs={"prompt": "hello"},
            )
        ],
        steps=[
            EvaluationStep(key="testset-main", type="input"),
            EvaluationStep(key="evaluator-auto", type="annotation", origin="auto"),
        ],
        repeats=2,
        create_scenario=create_scenario,
        result_logger=Logger(),
        refresh_metrics=refresh_metrics,
        runners={"evaluator-auto": ShortRunner()},
        revisions={"evaluator-auto": {"id": "revision"}},
    )

    assert processed[0].has_errors is True
    failed_log = logged[-1]
    assert failed_log.cell.step_key == "evaluator-auto"
    assert failed_log.cell.repeat_idx == 1
    assert failed_log.cell.status == EvaluationStatus.FAILURE
    assert failed_log.error == {
        "message": (
            "Runner for evaluator-auto returned 1 execution(s) for 2 planned cell(s)."
        )
    }


@pytest.mark.asyncio
async def test_sdk_source_slice_marks_missing_runner_as_error():
    run_id = uuid4()
    scenario_id = uuid4()
    logged = []

    class Logger:
        async def log(self, request):
            logged.append(request)
            return SimpleNamespace(id=uuid4())

    async def create_scenario(run_id):
        return SimpleNamespace(id=scenario_id)

    async def refresh_metrics(run_id, scenario_id):
        return SimpleNamespace(id=uuid4())

    processed = await process_evaluation_source_slice(
        run_id=run_id,
        source_items=[
            ResolvedSourceItem(
                kind="trace",
                step_key="query-main",
                trace_id="query-trace",
            )
        ],
        steps=[
            EvaluationStep(key="query-main", type="input"),
            EvaluationStep(key="evaluator-auto", type="annotation", origin="auto"),
        ],
        repeats=1,
        create_scenario=create_scenario,
        result_logger=Logger(),
        refresh_metrics=refresh_metrics,
        runners={},
        revisions={},
    )

    assert processed[0].has_errors is True
    assert [(item.cell.step_key, item.error) for item in logged] == [
        ("query-main", None),
        (
            "evaluator-auto",
            {"message": "Missing runner or revision for evaluator-auto"},
        ),
    ]


@pytest.mark.asyncio
async def test_sdk_source_slice_can_defer_manual_results_without_metric_refresh():
    run_id = uuid4()
    scenario_id = uuid4()
    logged = []

    class Logger:
        async def log(self, request):
            logged.append(request.cell.step_key)
            return SimpleNamespace(id=uuid4())

    refresh_metrics = pytest.fail

    async def create_scenario(run_id):
        return SimpleNamespace(id=scenario_id)

    processed = await process_evaluation_source_slice(
        run_id=run_id,
        source_items=[
            ResolvedSourceItem(
                kind="trace",
                step_key="query-main",
                trace_id="query-trace",
            )
        ],
        steps=[
            EvaluationStep(key="query-main", type="input"),
            EvaluationStep(key="evaluator-human", type="annotation", origin="human"),
        ],
        repeats=1,
        create_scenario=create_scenario,
        result_logger=Logger(),
        refresh_metrics=refresh_metrics,
        runners={},
        revisions={},
        log_pending=False,
        refresh_metrics_without_auto_results=False,
    )

    assert processed[0].has_pending is True
    assert processed[0].auto_results_created is False
    assert logged == ["query-main"]


@pytest.mark.asyncio
async def test_sdk_source_slice_links_evaluators_to_application_traces():
    run_id = uuid4()
    scenario_id = uuid4()
    evaluator_requests = []

    class ApplicationRunner:
        async def execute_batch(self, requests):
            return [
                WorkflowExecutionResult(
                    status=EvaluationStatus.SUCCESS,
                    trace_id="app-trace",
                    span_id="app-span",
                    outputs={"answer": "hello"},
                    trace={
                        "trace_id": "app-trace",
                        "spans": {
                            "root": {
                                "span_id": "app-span",
                                "attributes": {
                                    "ag": {
                                        "data": {
                                            "outputs": {"answer": "hello"},
                                        }
                                    }
                                },
                            }
                        },
                    },
                )
                for _ in requests
            ]

    class EvaluatorRunner:
        async def execute_batch(self, requests):
            evaluator_requests.extend(requests)
            return [
                WorkflowExecutionResult(
                    status=EvaluationStatus.SUCCESS,
                    trace_id=f"eval-trace-{request.cell.repeat_idx}",
                )
                for request in requests
            ]

    class Logger:
        async def log(self, request):
            return SimpleNamespace(id=uuid4())

    async def create_scenario(run_id):
        return SimpleNamespace(id=scenario_id)

    async def refresh_metrics(run_id, scenario_id):
        return SimpleNamespace(id=uuid4())

    await process_evaluation_source_slice(
        run_id=run_id,
        source_items=[
            ResolvedSourceItem(
                kind="testcase",
                step_key="testset-main",
                testcase_id=uuid4(),
                inputs={"prompt": "hello"},
            )
        ],
        steps=[
            EvaluationStep(key="testset-main", type="input"),
            EvaluationStep(key="application-main", type="invocation"),
            EvaluationStep(key="evaluator-auto", type="annotation", origin="auto"),
        ],
        repeats=2,
        create_scenario=create_scenario,
        result_logger=Logger(),
        refresh_metrics=refresh_metrics,
        runners={
            "application-main": ApplicationRunner(),
            "evaluator-auto": EvaluatorRunner(),
        },
        revisions={
            "application-main": {"id": "application-revision"},
            "evaluator-auto": {"id": "evaluator-revision"},
        },
        is_split=False,
    )

    assert [request.cell.repeat_idx for request in evaluator_requests] == [0, 1]
    assert [request.links for request in evaluator_requests] == [
        {"invocation": {"trace_id": "app-trace", "span_id": "app-span"}},
        {"invocation": {"trace_id": "app-trace", "span_id": "app-span"}},
    ]
    assert [request.upstream_outputs for request in evaluator_requests] == [
        {"answer": "hello"},
        {"answer": "hello"},
    ]


@pytest.mark.asyncio
async def test_sdk_result_logger_adapter_preserves_repeat_idx(monkeypatch):
    calls = []

    async def fake_log_result(**kwargs):
        calls.append(kwargs)
        return {"id": "result"}

    monkeypatch.setattr(runtime_adapters, "alog_result", fake_log_result)
    cell = PlannedCell(
        run_id=uuid4(),
        scenario_id=uuid4(),
        step_key="evaluator-auto",
        step_type="annotation",
        origin="auto",
        repeat_idx=2,
        status=EvaluationStatus.SUCCESS,
        testcase_id=uuid4(),
    )

    result = await runtime_adapters.SdkResultLogger().log(
        ResultLogRequest(
            cell=cell,
            trace_id="trace-repeat",
        )
    )

    assert result == {"id": "result"}
    assert calls == [
        {
            "run_id": cell.run_id,
            "scenario_id": cell.scenario_id,
            "step_key": "evaluator-auto",
            "repeat_idx": 2,
            "trace_id": "trace-repeat",
            "testcase_id": cell.testcase_id,
            "error": None,
        }
    ]


@pytest.mark.asyncio
async def test_sdk_preview_evaluate_logs_repeat_aware_results(monkeypatch):
    run_id = uuid4()
    scenario_id = uuid4()
    testset_id = uuid4()
    testset_variant_id = uuid4()
    testset_revision_id = uuid4()
    application_revision_id = uuid4()
    evaluator_revision_id = uuid4()
    testcase_id = uuid4()

    testcase = SimpleNamespace(
        id=testcase_id,
        data={"prompt": "hello"},
        model_dump=lambda **kwargs: {
            "id": str(testcase_id),
            "data": {"prompt": "hello"},
        },
    )
    testset_revision = SimpleNamespace(
        id=testset_revision_id,
        testset_id=testset_id,
        testset_variant_id=testset_variant_id,
        slug="main",
        version="1",
        data=SimpleNamespace(testcases=[testcase]),
    )
    application_revision = SimpleNamespace(
        id=application_revision_id,
        application_id=uuid4(),
        application_variant_id=uuid4(),
        slug="app",
        version="1",
        data=SimpleNamespace(parameters={"temperature": 0}),
        model_dump=lambda **kwargs: {"id": str(application_revision_id)},
    )
    evaluator_revision = SimpleNamespace(
        id=evaluator_revision_id,
        evaluator_id=uuid4(),
        evaluator_variant_id=uuid4(),
        slug="eval",
        version="1",
        data=SimpleNamespace(parameters={"threshold": 1}),
        model_dump=lambda **kwargs: {"id": str(evaluator_revision_id)},
    )

    async def fake_retrieve_testset(**kwargs):
        return testset_revision

    async def fake_retrieve_application(**kwargs):
        return application_revision

    async def fake_retrieve_evaluator(**kwargs):
        return evaluator_revision

    async def fake_create_run(**kwargs):
        return SimpleNamespace(id=run_id)

    async def fake_add_scenario(**kwargs):
        return SimpleNamespace(id=scenario_id)

    logged_results = []

    async def fake_log_result(**kwargs):
        logged_results.append(kwargs)
        return SimpleNamespace(id=uuid4())

    async def fake_invoke_application(**kwargs):
        return SimpleNamespace(
            data=SimpleNamespace(),
            trace_id="app-trace",
            span_id="app-span",
        )

    evaluator_trace_ids = iter(["eval-trace-0", "eval-trace-1"])

    async def fake_invoke_evaluator(**kwargs):
        return SimpleNamespace(
            data=SimpleNamespace(),
            trace_id=next(evaluator_trace_ids),
            span_id="eval-span",
        )

    async def fake_fetch_trace_data(trace_id, **kwargs):
        return {
            "spans": {
                "root": {
                    "attributes": {
                        "ag": {
                            "data": {
                                "inputs": {"prompt": "hello"},
                                "outputs": {"answer": trace_id},
                            }
                        }
                    }
                }
            }
        }

    async def fake_compute_metrics(**kwargs):
        return SimpleNamespace(id=uuid4())

    async def fake_close_run(**kwargs):
        return SimpleNamespace(id=run_id)

    async def fake_get_url(**kwargs):
        return ""

    monkeypatch.setattr(preview_evaluate, "aretrieve_testset", fake_retrieve_testset)
    monkeypatch.setattr(
        preview_evaluate, "aretrieve_application", fake_retrieve_application
    )
    monkeypatch.setattr(
        preview_evaluate, "aretrieve_evaluator", fake_retrieve_evaluator
    )
    monkeypatch.setattr(preview_evaluate, "acreate_run", fake_create_run)
    monkeypatch.setattr(preview_evaluate, "aadd_scenario", fake_add_scenario)
    monkeypatch.setattr(runtime_adapters, "alog_result", fake_log_result)
    monkeypatch.setattr(runtime_adapters, "invoke_application", fake_invoke_application)
    monkeypatch.setattr(runtime_adapters, "invoke_evaluator", fake_invoke_evaluator)
    monkeypatch.setattr(runtime_adapters, "fetch_trace_data", fake_fetch_trace_data)
    monkeypatch.setattr(preview_evaluate, "acompute_metrics", fake_compute_metrics)
    monkeypatch.setattr(preview_evaluate, "aclose_run", fake_close_run)
    monkeypatch.setattr(preview_evaluate, "aget_url", fake_get_url)

    result = await preview_evaluate.aevaluate(
        testsets={testset_revision_id: "custom"},
        applications={application_revision_id: "custom"},
        evaluators={evaluator_revision_id: "auto"},
        repeats=2,
    )

    assert result["run"].id == run_id
    assert [
        (logged_result["step_key"], logged_result["repeat_idx"])
        for logged_result in logged_results
    ] == [
        ("testset-main", 0),
        ("testset-main", 1),
        ("application-app", 0),
        ("evaluator-eval", 0),
        ("evaluator-eval", 1),
    ]
    assert [
        logged_result["trace_id"]
        for logged_result in logged_results
        if logged_result["step_key"] == "evaluator-eval"
    ] == ["eval-trace-0", "eval-trace-1"]


# ---------------------------------------------------------------------------
# Concurrency and retry
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sdk_source_slice_runs_scenarios_concurrently_up_to_batch_size():
    """batch_size=2 with 4 scenarios: at most 2 invoke_workflow calls in flight at once."""
    import asyncio

    run_id = uuid4()
    in_flight = 0
    peak = 0

    class ConcurrentRunner:
        async def execute_batch(self, requests, semaphore=None):
            results = []
            for request in requests:
                async def _one(req):
                    nonlocal in_flight, peak
                    in_flight += 1
                    peak = max(peak, in_flight)
                    await asyncio.sleep(0)
                    in_flight -= 1
                    return WorkflowExecutionResult(
                        status=EvaluationStatus.SUCCESS,
                        trace_id=f"trace-{req.cell.repeat_idx}",
                    )

                if semaphore is not None:
                    async with semaphore:
                        results.append(await _one(request))
                else:
                    results.append(await _one(request))
            return results

    class Logger:
        async def log(self, request):
            return SimpleNamespace(id=uuid4())

    scenarios_created = []

    async def create_scenario(run_id):
        sid = uuid4()
        scenarios_created.append(sid)
        return SimpleNamespace(id=sid)

    async def refresh_metrics(run_id, scenario_id):
        return None

    source_items = [
        ResolvedSourceItem(
            kind="testcase",
            step_key="testset-main",
            testcase_id=uuid4(),
            inputs={"x": str(i)},
        )
        for i in range(4)
    ]

    await process_evaluation_source_slice(
        run_id=run_id,
        source_items=source_items,
        steps=[
            EvaluationStep(key="testset-main", type="input"),
            EvaluationStep(key="evaluator-auto", type="annotation", origin="auto"),
        ],
        repeats=1,
        create_scenario=create_scenario,
        result_logger=Logger(),
        refresh_metrics=refresh_metrics,
        runners={"evaluator-auto": ConcurrentRunner()},
        revisions={"evaluator-auto": {"id": "rev"}},
        batch_size=2,
    )

    assert len(scenarios_created) == 4
    assert peak <= 2


@pytest.mark.asyncio
async def test_sdk_source_slice_semaphore_shared_across_repeats():
    """batch_size=2 with 1 scenario and 4 repeats: peak concurrency stays ≤ 2."""
    import asyncio

    run_id = uuid4()
    scenario_id = uuid4()
    in_flight = 0
    peak = 0

    class ConcurrentRunner:
        async def execute_batch(self, requests, semaphore=None):
            async def _one(req):
                nonlocal in_flight, peak
                in_flight += 1
                peak = max(peak, in_flight)
                await asyncio.sleep(0)
                in_flight -= 1
                return WorkflowExecutionResult(
                    status=EvaluationStatus.SUCCESS,
                    trace_id=f"trace-{req.cell.repeat_idx}",
                )

            if semaphore is not None:
                results = []
                for req in requests:
                    async with semaphore:
                        results.append(await _one(req))
                return results
            return [await _one(req) for req in requests]

    class Logger:
        async def log(self, request):
            return SimpleNamespace(id=uuid4())

    async def create_scenario(run_id):
        return SimpleNamespace(id=scenario_id)

    async def refresh_metrics(run_id, scenario_id):
        return None

    await process_evaluation_source_slice(
        run_id=run_id,
        source_items=[
            ResolvedSourceItem(
                kind="testcase",
                step_key="testset-main",
                testcase_id=uuid4(),
                inputs={"x": "0"},
            )
        ],
        steps=[
            EvaluationStep(key="testset-main", type="input"),
            EvaluationStep(key="evaluator-auto", type="annotation", origin="auto"),
        ],
        repeats=4,
        create_scenario=create_scenario,
        result_logger=Logger(),
        refresh_metrics=refresh_metrics,
        runners={"evaluator-auto": ConcurrentRunner()},
        revisions={"evaluator-auto": {"id": "rev"}},
        batch_size=2,
    )

    assert peak <= 2


@pytest.mark.asyncio
async def test_sdk_source_slice_no_batch_size_runs_all_concurrently():
    """When batch_size=None the semaphore is absent and all scenarios run freely."""
    run_id = uuid4()
    scenarios_created = []

    class Runner:
        async def execute_batch(self, requests, semaphore=None):
            return [
                WorkflowExecutionResult(
                    status=EvaluationStatus.SUCCESS,
                    trace_id="t",
                )
                for _ in requests
            ]

    class Logger:
        async def log(self, request):
            return SimpleNamespace(id=uuid4())

    async def create_scenario(run_id):
        sid = uuid4()
        scenarios_created.append(sid)
        return SimpleNamespace(id=sid)

    async def refresh_metrics(run_id, scenario_id):
        return None

    source_items = [
        ResolvedSourceItem(
            kind="testcase",
            step_key="testset-main",
            testcase_id=uuid4(),
        )
        for _ in range(5)
    ]

    processed = await process_evaluation_source_slice(
        run_id=run_id,
        source_items=source_items,
        steps=[
            EvaluationStep(key="testset-main", type="input"),
            EvaluationStep(key="evaluator-auto", type="annotation", origin="auto"),
        ],
        repeats=1,
        create_scenario=create_scenario,
        result_logger=Logger(),
        refresh_metrics=refresh_metrics,
        runners={"evaluator-auto": Runner()},
        revisions={"evaluator-auto": {"id": "rev"}},
        batch_size=None,
    )

    assert len(processed) == 5


@pytest.mark.asyncio
async def test_sdk_source_slice_retries_failed_cells_and_succeeds():
    """max_retries=1: first attempt fails, retry succeeds; result is success."""
    run_id = uuid4()
    scenario_id = uuid4()
    call_count = 0

    class FlakyRunner:
        async def execute_batch(self, requests, semaphore=None):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return [
                    WorkflowExecutionResult(
                        status=EvaluationStatus.FAILURE,
                        error={"message": "transient"},
                    )
                    for _ in requests
                ]
            return [
                WorkflowExecutionResult(
                    status=EvaluationStatus.SUCCESS,
                    trace_id="recovered",
                )
                for _ in requests
            ]

    logged = []

    class Logger:
        async def log(self, request):
            logged.append((request.cell.step_key, request.trace_id, request.error))
            return SimpleNamespace(id=uuid4())

    async def create_scenario(run_id):
        return SimpleNamespace(id=scenario_id)

    async def refresh_metrics(run_id, scenario_id):
        return None

    processed = await process_evaluation_source_slice(
        run_id=run_id,
        source_items=[
            ResolvedSourceItem(
                kind="testcase",
                step_key="testset-main",
                testcase_id=uuid4(),
                inputs={"x": "1"},
            )
        ],
        steps=[
            EvaluationStep(key="testset-main", type="input"),
            EvaluationStep(key="evaluator-auto", type="annotation", origin="auto"),
        ],
        repeats=1,
        create_scenario=create_scenario,
        result_logger=Logger(),
        refresh_metrics=refresh_metrics,
        runners={"evaluator-auto": FlakyRunner()},
        revisions={"evaluator-auto": {"id": "rev"}},
        max_retries=1,
    )

    assert call_count == 2
    assert processed[0].has_errors is False
    eval_log = next(entry for entry in logged if entry[0] == "evaluator-auto")
    assert eval_log[1] == "recovered"
    assert eval_log[2] is None


@pytest.mark.asyncio
async def test_sdk_source_slice_exhausts_retries_and_marks_error():
    """max_retries=1 with persistent failure: result is still an error."""
    run_id = uuid4()
    scenario_id = uuid4()
    call_count = 0

    class AlwaysFailRunner:
        async def execute_batch(self, requests, semaphore=None):
            nonlocal call_count
            call_count += 1
            return [
                WorkflowExecutionResult(
                    status=EvaluationStatus.FAILURE,
                    error={"message": "always fails"},
                )
                for _ in requests
            ]

    class Logger:
        async def log(self, request):
            return SimpleNamespace(id=uuid4())

    async def create_scenario(run_id):
        return SimpleNamespace(id=scenario_id)

    async def refresh_metrics(run_id, scenario_id):
        return None

    processed = await process_evaluation_source_slice(
        run_id=run_id,
        source_items=[
            ResolvedSourceItem(
                kind="testcase",
                step_key="testset-main",
                testcase_id=uuid4(),
                inputs={"x": "1"},
            )
        ],
        steps=[
            EvaluationStep(key="testset-main", type="input"),
            EvaluationStep(key="evaluator-auto", type="annotation", origin="auto"),
        ],
        repeats=1,
        create_scenario=create_scenario,
        result_logger=Logger(),
        refresh_metrics=refresh_metrics,
        runners={"evaluator-auto": AlwaysFailRunner()},
        revisions={"evaluator-auto": {"id": "rev"}},
        max_retries=1,
    )

    assert call_count == 2
    assert processed[0].has_errors is True


@pytest.mark.asyncio
async def test_sdk_source_slice_retries_only_failed_cells_in_batch():
    """With repeats=2, only the failing repeat is retried, not the successful one."""
    run_id = uuid4()
    scenario_id = uuid4()
    attempt_by_repeat: dict = {}

    class SelectiveFlakyRunner:
        async def execute_batch(self, requests, semaphore=None):
            results = []
            for req in requests:
                idx = req.cell.repeat_idx
                attempt_by_repeat[idx] = attempt_by_repeat.get(idx, 0) + 1
                if idx == 1 and attempt_by_repeat[idx] == 1:
                    results.append(
                        WorkflowExecutionResult(
                            status=EvaluationStatus.FAILURE,
                            error={"message": "fail repeat 1 first time"},
                        )
                    )
                else:
                    results.append(
                        WorkflowExecutionResult(
                            status=EvaluationStatus.SUCCESS,
                            trace_id=f"trace-{idx}",
                        )
                    )
            return results

    class Logger:
        async def log(self, request):
            return SimpleNamespace(id=uuid4())

    async def create_scenario(run_id):
        return SimpleNamespace(id=scenario_id)

    async def refresh_metrics(run_id, scenario_id):
        return None

    processed = await process_evaluation_source_slice(
        run_id=run_id,
        source_items=[
            ResolvedSourceItem(
                kind="testcase",
                step_key="testset-main",
                testcase_id=uuid4(),
                inputs={"x": "1"},
            )
        ],
        steps=[
            EvaluationStep(key="testset-main", type="input"),
            EvaluationStep(key="evaluator-auto", type="annotation", origin="auto"),
        ],
        repeats=2,
        create_scenario=create_scenario,
        result_logger=Logger(),
        refresh_metrics=refresh_metrics,
        runners={"evaluator-auto": SelectiveFlakyRunner()},
        revisions={"evaluator-auto": {"id": "rev"}},
        max_retries=1,
    )

    assert processed[0].has_errors is False
    assert attempt_by_repeat[0] == 1
    assert attempt_by_repeat[1] == 2
