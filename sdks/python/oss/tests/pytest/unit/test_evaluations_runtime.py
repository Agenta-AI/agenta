from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

import agenta.sdk.evaluations.preview.evaluate as preview_evaluate
import agenta.sdk.evaluations.runtime.adapters as runtime_adapters
from agenta.sdk.evaluations.runtime.executor import execute_workflow_batch
from agenta.sdk.evaluations.runtime.models import (
    EvaluationStep,
    PlannedCell,
    ResolvedSourceItem,
    ResultLogRequest,
    ScenarioBinding,
)
from agenta.sdk.evaluations.runtime.planner import EvaluationPlanner
from agenta.sdk.evaluations.runtime.processor import (
    process_sources,
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


def test_sdk_runtime_topology_classifier_distinguishes_direct_testcases_from_testsets():
    decision = classify_steps_topology(
        steps=[
            EvaluationStep(key="testcases", type="input"),
            EvaluationStep(key="evaluator-human", type="annotation", origin="human"),
        ],
        has_testcases=True,
        has_evaluators=True,
    )

    assert decision.status == "supported"
    assert decision.dispatch == "queue_testcases"


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

        async def execute_batch(self, requests, semaphore=None):
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

    processed = await process_sources(
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

    # ProcessedScenario.results retains EVERY repeat per step (keyed by
    # repeat_idx), not just the last one — repeats>1 must not collapse to one
    # result per step. Regression guard for UEL-016.
    assert len(processed) == 1
    results = processed[0].results
    assert set(results["testset-main"].keys()) == {0, 1, 2}
    assert set(results["evaluator-auto"].keys()) == {0, 1, 2}


@pytest.mark.asyncio
async def test_sdk_source_slice_isolates_one_scenario_failure():
    """One scenario's create_scenario failure must not abort the siblings.

    Regression guard for UEL-023: the per-scenario seams were unguarded under
    asyncio.gather(return_exceptions=False), so a single failing scenario crashed
    the whole slice. Now each scenario is isolated.
    """
    run_id = uuid4()
    good_scenario_id = uuid4()

    class Runner:
        async def execute_batch(self, requests, semaphore=None):
            return [
                WorkflowExecutionResult(
                    status=EvaluationStatus.SUCCESS,
                    trace_id=f"trace-{req.cell.repeat_idx}",
                )
                for req in requests
            ]

    class Logger:
        async def log(self, request):
            return SimpleNamespace(id=uuid4())

    calls = {"n": 0}

    async def create_scenario(run_id):
        # First scenario blows up; the second succeeds.
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("boom: scenario factory failed")
        return SimpleNamespace(id=good_scenario_id)

    async def refresh_metrics(run_id, scenario_id):
        return SimpleNamespace(id=uuid4())

    source_items = [
        ResolvedSourceItem(
            kind="testcase",
            step_key="testset-main",
            testcase_id=uuid4(),
            inputs={"prompt": "a"},
        ),
        ResolvedSourceItem(
            kind="testcase",
            step_key="testset-main",
            testcase_id=uuid4(),
            inputs={"prompt": "b"},
        ),
    ]

    processed = await process_sources(
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
        revisions={"evaluator-auto": {"id": "revision"}},
    )

    # The failed scenario is dropped (not raised); the healthy one still ran.
    assert len(processed) == 1
    assert processed[0].scenario.id == good_scenario_id


@pytest.mark.asyncio
async def test_sdk_source_slice_marks_short_runner_batch_as_error():
    run_id = uuid4()
    scenario_id = uuid4()
    logged = []

    class ShortRunner:
        async def execute_batch(self, requests, semaphore=None):
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

    processed = await process_sources(
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
async def test_sdk_source_slice_handles_over_count_runner_batch():
    # Runner returns more executions than planned cells: the planned cells are
    # logged from the first executions, the extras have no cell and are dropped
    # (with a structured warning), and the scenario is flagged as having errors.
    run_id = uuid4()
    scenario_id = uuid4()
    logged = []

    class LongRunner:
        async def execute_batch(self, requests, semaphore=None):
            # 3 executions for 2 planned cells (repeats=2).
            return [
                WorkflowExecutionResult(
                    status=EvaluationStatus.SUCCESS,
                    trace_id=f"trace-{i}",
                    span_id=f"span-{i}",
                )
                for i in range(3)
            ]

    class Logger:
        async def log(self, request):
            logged.append(request)
            return SimpleNamespace(id=uuid4())

    async def create_scenario(run_id):
        return SimpleNamespace(id=scenario_id)

    async def refresh_metrics(run_id, scenario_id):
        return SimpleNamespace(id=uuid4())

    processed = await process_sources(
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
        runners={"evaluator-auto": LongRunner()},
        revisions={"evaluator-auto": {"id": "revision"}},
    )

    assert processed[0].has_errors is True
    # Both planned evaluator cells were logged from the first two executions; the
    # third (extra) execution is dropped, not logged as a cell.
    evaluator_logs = [
        entry for entry in logged if entry.cell.step_key == "evaluator-auto"
    ]
    assert len(evaluator_logs) == 2
    assert {entry.cell.repeat_idx for entry in evaluator_logs} == {0, 1}


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

    processed = await process_sources(
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

    processed = await process_sources(
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
        async def execute_batch(self, requests, semaphore=None):
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
        async def execute_batch(self, requests, semaphore=None):
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

    await process_sources(
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
async def test_collecting_result_logger_collects_populate_ready_cell():
    """CollectingResultLogger stashes each cell as a populate-ready dict.

    It does NOT write per cell (that's the bulk populate_slice afterward); it
    preserves repeat_idx and the cell's bound trace/testcase, and the dict it
    returns is what the engine remembers — so it round-trips into populate.
    """
    run_id = uuid4()
    scenario_id = uuid4()
    testcase_id = uuid4()
    cell = PlannedCell(
        run_id=run_id,
        scenario_id=scenario_id,
        step_key="evaluator-auto",
        step_type="annotation",
        origin="auto",
        repeat_idx=2,
        status=EvaluationStatus.SUCCESS,
        testcase_id=testcase_id,
    )

    logger = runtime_adapters.CollectingResultLogger()
    returned = await logger.log(
        ResultLogRequest(
            cell=cell,
            trace_id="trace-repeat",
        )
    )

    # the returned dict is also the collected cell (round-trips into populate).
    assert logger.cells == [returned]
    assert returned == {
        "run_id": str(run_id),
        "scenario_id": str(scenario_id),
        "step_key": "evaluator-auto",
        "repeat_idx": 2,
        "status": "success",
        "trace_id": "trace-repeat",
        "testcase_id": str(testcase_id),
        "error": None,
    }


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

    async def fake_add_scenarios(*, run_id, count, timestamp=None):
        # bulk-mint: one scenario per testcase, in order.
        return [SimpleNamespace(id=scenario_id) for _ in range(count)]

    populated_cells = []

    async def fake_populate_slice(*, results):
        # the single bulk populate the SDK does after local execution.
        populated_cells.extend(results)
        return [SimpleNamespace(id=uuid4()) for _ in results]

    refresh_calls = []

    async def fake_refresh_slice(*, run_id, scenario_ids):
        refresh_calls.append((run_id, scenario_ids))

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

    async def fake_afetch_trace(trace_id, **kwargs):
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
    # the SDK now mirrors the API slice ops: bulk add_scenarios -> (local
    # execute, collect) -> bulk populate_slice -> refresh_slice.
    monkeypatch.setattr(preview_evaluate, "aadd_scenarios", fake_add_scenarios)
    monkeypatch.setattr(preview_evaluate, "apopulate_slice", fake_populate_slice)
    monkeypatch.setattr(preview_evaluate, "arefresh_slice", fake_refresh_slice)
    monkeypatch.setattr(
        preview_evaluate,
        "aquery_metrics",
        AsyncMock(return_value=[]),
    )
    monkeypatch.setattr(runtime_adapters, "invoke_application", fake_invoke_application)
    monkeypatch.setattr(runtime_adapters, "invoke_evaluator", fake_invoke_evaluator)
    monkeypatch.setattr(preview_evaluate, "afetch_trace", fake_afetch_trace)
    monkeypatch.setattr(preview_evaluate, "aclose_run", fake_close_run)
    monkeypatch.setattr(preview_evaluate, "aget_url", fake_get_url)

    result = await preview_evaluate.aevaluate(
        testsets={testset_revision_id: "custom"},
        applications={application_revision_id: "custom"},
        evaluators={evaluator_revision_id: "auto"},
        repeats=2,
    )

    assert result["run"].id == run_id
    # cells written via populate_slice (one scenario here), repeat-aware, in
    # plan order.
    assert [(cell["step_key"], cell["repeat_idx"]) for cell in populated_cells] == [
        ("testset-main", 0),
        ("testset-main", 1),
        ("application-app", 0),
        ("evaluator-eval", 0),
        ("evaluator-eval", 1),
    ]
    assert [
        cell["trace_id"]
        for cell in populated_cells
        if cell["step_key"] == "evaluator-eval"
    ] == ["eval-trace-0", "eval-trace-1"]
    # metrics rolled up via refresh_slice over the one scenario.
    assert refresh_calls == [(run_id, [scenario_id])]


@pytest.mark.asyncio
async def test_sdk_preview_evaluate_populates_and_refreshes_per_scenario(monkeypatch):
    """Two testcases -> two scenarios, each its OWN populate + refresh.

    Locks in the per-scenario persistence boundary: a whole-testset bulk write
    would be one populate over all cells; per-scenario is one populate per
    scenario (its cells only) plus one refresh scoped to that scenario.
    """
    run_id = uuid4()
    scenario_a, scenario_b = uuid4(), uuid4()
    testset_revision_id = uuid4()
    application_revision_id = uuid4()
    evaluator_revision_id = uuid4()
    tc_a, tc_b = uuid4(), uuid4()

    def _testcase(tcid, prompt):
        return SimpleNamespace(
            id=tcid,
            data={"prompt": prompt},
            model_dump=lambda **kwargs: {"id": str(tcid), "data": {"prompt": prompt}},
        )

    testset_revision = SimpleNamespace(
        id=testset_revision_id,
        testset_id=uuid4(),
        testset_variant_id=uuid4(),
        slug="main",
        version="1",
        data=SimpleNamespace(testcases=[_testcase(tc_a, "a"), _testcase(tc_b, "b")]),
    )
    application_revision = SimpleNamespace(
        id=application_revision_id,
        application_id=uuid4(),
        application_variant_id=uuid4(),
        slug="app",
        version="1",
        data=SimpleNamespace(parameters={}),
        model_dump=lambda **kwargs: {"id": str(application_revision_id)},
    )
    evaluator_revision = SimpleNamespace(
        id=evaluator_revision_id,
        evaluator_id=uuid4(),
        evaluator_variant_id=uuid4(),
        slug="eval",
        version="1",
        data=SimpleNamespace(parameters={}),
        model_dump=lambda **kwargs: {"id": str(evaluator_revision_id)},
    )

    # one scenario id per testcase, in order.
    minted_ids = iter([scenario_a, scenario_b])

    async def fake_add_scenarios(*, run_id, count, timestamp=None):
        return [SimpleNamespace(id=next(minted_ids)) for _ in range(count)]

    # capture populate calls as separate batches (NOT flattened), to prove each
    # scenario is its own populate.
    populate_batches = []

    async def fake_populate_slice(*, results):
        populate_batches.append(results)
        return [SimpleNamespace(id=uuid4()) for _ in results]

    refresh_calls = []

    async def fake_refresh_slice(*, run_id, scenario_ids):
        refresh_calls.append(scenario_ids)

    async def fake_invoke_application(**kwargs):
        return SimpleNamespace(
            data=SimpleNamespace(), trace_id="app-trace", span_id="app-span"
        )

    async def fake_invoke_evaluator(**kwargs):
        return SimpleNamespace(
            data=SimpleNamespace(), trace_id="eval-trace", span_id="eval-span"
        )

    async def fake_afetch_trace(trace_id, **kwargs):
        return {"spans": {"root": {"attributes": {"ag": {"data": {}}}}}}

    monkeypatch.setattr(
        preview_evaluate, "aretrieve_testset", lambda **k: _async(testset_revision)
    )
    monkeypatch.setattr(
        preview_evaluate,
        "aretrieve_application",
        lambda **k: _async(application_revision),
    )
    monkeypatch.setattr(
        preview_evaluate, "aretrieve_evaluator", lambda **k: _async(evaluator_revision)
    )
    monkeypatch.setattr(
        preview_evaluate, "acreate_run", lambda **k: _async(SimpleNamespace(id=run_id))
    )
    monkeypatch.setattr(preview_evaluate, "aadd_scenarios", fake_add_scenarios)
    monkeypatch.setattr(preview_evaluate, "apopulate_slice", fake_populate_slice)
    monkeypatch.setattr(preview_evaluate, "arefresh_slice", fake_refresh_slice)
    monkeypatch.setattr(
        preview_evaluate,
        "aquery_metrics",
        AsyncMock(return_value=[]),
    )
    monkeypatch.setattr(runtime_adapters, "invoke_application", fake_invoke_application)
    monkeypatch.setattr(runtime_adapters, "invoke_evaluator", fake_invoke_evaluator)
    monkeypatch.setattr(preview_evaluate, "afetch_trace", fake_afetch_trace)
    monkeypatch.setattr(
        preview_evaluate, "aclose_run", lambda **k: _async(SimpleNamespace(id=run_id))
    )
    monkeypatch.setattr(preview_evaluate, "aget_url", lambda **k: _async(""))

    await preview_evaluate.aevaluate(
        testsets={testset_revision_id: "custom"},
        applications={application_revision_id: "custom"},
        evaluators={evaluator_revision_id: "auto"},
        repeats=1,
    )

    # TWO scenarios -> TWO populate calls, each carrying only its own scenario's
    # cells, and TWO refresh calls, each scoped to one scenario id.
    assert len(populate_batches) == 2
    assert {c["scenario_id"] for c in populate_batches[0]} == {str(scenario_a)}
    assert {c["scenario_id"] for c in populate_batches[1]} == {str(scenario_b)}
    assert refresh_calls == [[scenario_a], [scenario_b]]


async def _async(value):
    return value


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

    await process_sources(
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

    await process_sources(
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

    processed = await process_sources(
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

    processed = await process_sources(
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

    processed = await process_sources(
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

    processed = await process_sources(
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
