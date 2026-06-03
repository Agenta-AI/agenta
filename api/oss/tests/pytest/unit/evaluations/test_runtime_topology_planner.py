from types import SimpleNamespace
from unittest.mock import AsyncMock, call
from uuid import uuid4

import pytest

from oss.src.core.evaluations.runtime.adapters import (
    APICachedRunner,
    APIEvaluatorRunner,
    APIWorkflowRunner,
    APIWorkflowServiceRunner,
)
from oss.src.core.evaluations.runtime.cache import RunnableCacheResolver
from oss.src.core.evaluations.runtime.models import (
    ProcessSummary,
    ResolvedSourceItem,
    TensorSlice,
    TensorProbeSummary,
)
from oss.src.core.evaluations.runtime.planner import (
    EvaluationPlanner,
    make_scenario_bindings,
    plan_source_input_result_creates,
    planned_cells_to_result_creates,
)
from oss.src.core.evaluations.runtime.sources import (
    SourceResolutionError,
    resolve_direct_source_items,
    resolve_live_query_traces,
    resolve_queue_source_batches,
    resolve_testset_input_specs,
)
from oss.src.core.evaluations.runtime.tensor import TensorSliceOperations
from oss.src.core.evaluations.runtime.runner import TaskiqEvaluationTaskRunner
from oss.src.core.evaluations.runtime.topology import classify_run_topology
from agenta.sdk.evaluations.runtime.models import (
    EvaluationStep as SdkEvaluationStep,
    PlannedCell as SdkPlannedCell,
    ResolvedSourceItem as SdkResolvedSourceItem,
    WorkflowExecutionRequest,
    WorkflowExecutionResult,
)
from agenta.sdk.evaluations.runtime.processor import (
    ProcessedScenario as SdkProcessedScenario,
)
from agenta.sdk.models.evaluations import EvaluationStatus as SdkEvaluationStatus
from oss.src.core.evaluations.types import (
    EvaluationResult,
    EvaluationResultCreate,
    EvaluationRun,
    EvaluationRunData,
    EvaluationRunDataStep,
    EvaluationRunFlags,
    EvaluationStatus,
    SimpleEvaluation,
    SimpleEvaluationData,
    SimpleEvaluationFlags,
)
from oss.src.core.shared.dtos import Reference
from oss.src.core.tracing.dtos import Windowing
from oss.src.core.evaluations.service import SimpleEvaluationsService
from oss.src.core.evaluations.tasks import processor as source_slice_tasks
from oss.src.core.evaluations.tasks import run as run_tasks


def _run(*, steps, flags=None, repeats=1):
    return EvaluationRun(
        id=uuid4(),
        flags=flags or EvaluationRunFlags(),
        data=EvaluationRunData(steps=list(steps), repeats=repeats),
    )


def _step(key, type_, origin="custom", references=None):
    return EvaluationRunDataStep(
        key=key,
        type=type_,
        origin=origin,
        references=references or {},
    )


def test_topology_classifier_preserves_current_batch_dispatch_shapes():
    query_eval = _run(
        steps=[
            _step(
                "query-main",
                "input",
                references={"query_revision": Reference(id=uuid4())},
            ),
            _step(
                "evaluator-auto",
                "annotation",
                origin="auto",
                references={"evaluator_revision": Reference(id=uuid4())},
            ),
        ]
    )
    testset_eval = _run(
        steps=[
            _step(
                "testset-main",
                "input",
                references={"testset_revision": Reference(id=uuid4())},
            ),
            _step(
                "application-main",
                "invocation",
                references={"application_revision": Reference(id=uuid4())},
            ),
            _step(
                "evaluator-auto",
                "annotation",
                origin="auto",
                references={"evaluator_revision": Reference(id=uuid4())},
            ),
        ]
    )
    batch_inference = _run(
        steps=[
            _step(
                "testset-main",
                "input",
                references={"testset_revision": Reference(id=uuid4())},
            ),
            _step(
                "application-main",
                "invocation",
                references={"application_revision": Reference(id=uuid4())},
            ),
        ]
    )

    assert classify_run_topology(query_eval).dispatch == "batch_query"
    assert classify_run_topology(testset_eval).dispatch == "batch_testset"
    assert classify_run_topology(batch_inference).dispatch == "batch_invocation"


def test_topology_classifier_names_deferred_shapes():
    query_to_app = _run(
        steps=[
            _step(
                "query-main",
                "input",
                references={"query_revision": Reference(id=uuid4())},
            ),
            _step(
                "application-main",
                "invocation",
                references={"application_revision": Reference(id=uuid4())},
            ),
        ]
    )
    testset_to_eval = _run(
        steps=[
            _step(
                "testset-main",
                "input",
                references={"testset_revision": Reference(id=uuid4())},
            ),
            _step(
                "evaluator-auto",
                "annotation",
                origin="auto",
                references={"evaluator_revision": Reference(id=uuid4())},
            ),
        ]
    )
    multi_app = _run(
        steps=[
            _step(
                "testset-main",
                "input",
                references={"testset_revision": Reference(id=uuid4())},
            ),
            _step("application-a", "invocation"),
            _step("application-b", "invocation"),
        ]
    )

    assert classify_run_topology(query_to_app).status == "potential"
    assert classify_run_topology(testset_to_eval).status == "potential"
    assert classify_run_topology(multi_app).status == "not_planned"


def test_topology_classifier_names_not_planned_source_shapes():
    mixed_sources = _run(
        steps=[
            _step(
                "query-main",
                "input",
                references={"query_revision": Reference(id=uuid4())},
            ),
            _step(
                "testset-main",
                "input",
                references={"testset_revision": Reference(id=uuid4())},
            ),
            _step("evaluator-auto", "annotation", origin="auto"),
        ]
    )
    live_testset = _run(
        flags=EvaluationRunFlags(is_live=True),
        steps=[
            _step(
                "testset-main",
                "input",
                references={"testset_revision": Reference(id=uuid4())},
            ),
            _step("evaluator-auto", "annotation", origin="auto"),
        ],
    )

    assert classify_run_topology(mixed_sources).status == "not_planned"
    assert classify_run_topology(live_testset).status == "not_planned"


def test_planner_creates_repeat_aware_slots_and_keeps_manual_annotations_pending():
    run = _run(
        repeats=3,
        flags=EvaluationRunFlags(is_split=False),
        steps=[
            _step(
                "testset-main",
                "input",
                references={"testset_revision": Reference(id=uuid4())},
            ),
            _step(
                "application-main",
                "invocation",
                references={"application_revision": Reference(id=uuid4())},
            ),
            _step(
                "evaluator-auto",
                "annotation",
                origin="auto",
                references={"evaluator_revision": Reference(id=uuid4())},
            ),
            _step(
                "evaluator-human",
                "annotation",
                origin="human",
                references={"evaluator_revision": Reference(id=uuid4())},
            ),
        ],
    )
    scenario_id = uuid4()
    bindings = make_scenario_bindings(
        scenario_ids=[scenario_id],
        source_items=[
            ResolvedSourceItem(
                kind="testcase",
                step_key="testset-main",
                testcase_id=uuid4(),
            )
        ],
    )

    plan = EvaluationPlanner().plan(run=run, bindings=bindings)
    cells_by_step = {}
    for cell in plan.cells:
        cells_by_step.setdefault(cell.step_key, []).append(cell)

    assert [cell.repeat_idx for cell in cells_by_step["testset-main"]] == [0, 1, 2]
    assert [cell.repeat_idx for cell in cells_by_step["application-main"]] == [0]
    assert [cell.repeat_idx for cell in cells_by_step["evaluator-auto"]] == [0, 1, 2]
    assert [cell.status for cell in cells_by_step["evaluator-human"]] == [
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


def test_planner_fans_out_application_for_batch_inference_without_evaluators():
    run = _run(
        repeats=2,
        steps=[
            _step(
                "testset-main",
                "input",
                references={"testset_revision": Reference(id=uuid4())},
            ),
            _step(
                "application-main",
                "invocation",
                references={"application_revision": Reference(id=uuid4())},
            ),
        ],
    )
    bindings = make_scenario_bindings(
        scenario_ids=[uuid4()],
        source_items=[
            ResolvedSourceItem(
                kind="testcase",
                step_key="testset-main",
                testcase_id=uuid4(),
            )
        ],
    )

    plan = EvaluationPlanner().plan(run=run, bindings=bindings)

    assert [
        cell.repeat_idx for cell in plan.cells if cell.step_key == "application-main"
    ] == [0, 1]


def test_planner_fans_out_application_when_split_is_enabled():
    run = _run(
        repeats=3,
        flags=EvaluationRunFlags(is_split=True),
        steps=[
            _step(
                "testset-main",
                "input",
                references={"testset_revision": Reference(id=uuid4())},
            ),
            _step(
                "application-main",
                "invocation",
                references={"application_revision": Reference(id=uuid4())},
            ),
            _step("evaluator-auto", "annotation", origin="auto"),
        ],
    )
    plan = EvaluationPlanner().plan(
        run=run,
        bindings=make_scenario_bindings(
            scenario_ids=[uuid4()],
            source_items=[
                ResolvedSourceItem(
                    kind="testcase",
                    step_key="testset-main",
                    testcase_id=uuid4(),
                )
            ],
        ),
    )

    assert [
        cell.repeat_idx for cell in plan.cells if cell.step_key == "application-main"
    ] == [0, 1, 2]


def test_planned_cells_convert_to_result_create_payloads():
    run = _run(
        repeats=1,
        steps=[
            _step(
                "query-main",
                "input",
                references={"query_revision": Reference(id=uuid4())},
            ),
            _step(
                "evaluator-human",
                "annotation",
                origin="human",
                references={"evaluator_revision": Reference(id=uuid4())},
            ),
        ],
    )
    trace_id = "trace-1"
    scenario_id = uuid4()
    plan = EvaluationPlanner().plan(
        run=run,
        bindings=make_scenario_bindings(
            scenario_ids=[scenario_id],
            source_items=[
                ResolvedSourceItem(
                    kind="trace",
                    step_key="query-main",
                    trace_id=trace_id,
                )
            ],
        ),
    )

    result_creates = planned_cells_to_result_creates(plan.cells)

    assert [(result.step_key, result.status) for result in result_creates] == [
        ("query-main", EvaluationStatus.SUCCESS),
        ("evaluator-human", EvaluationStatus.PENDING),
    ]
    assert result_creates[0].trace_id == trace_id
    assert result_creates[1].trace_id is None


def test_plan_source_input_result_creates_filters_to_source_step():
    run = _run(
        repeats=2,
        steps=[
            _step("query-other", "input"),
            _step(
                "query-main",
                "input",
                references={"query_revision": Reference(id=uuid4())},
            ),
            _step("evaluator-auto", "annotation", origin="auto"),
        ],
    )
    scenario_id = uuid4()

    result_creates = plan_source_input_result_creates(
        run=run,
        scenario_id=scenario_id,
        source_item=ResolvedSourceItem(
            kind="trace",
            step_key="query-main",
            trace_id="trace-main",
        ),
    )

    assert [result.step_key for result in result_creates] == [
        "query-main",
        "query-main",
    ]
    assert [result.repeat_idx for result in result_creates] == [0, 1]
    assert [result.trace_id for result in result_creates] == [
        "trace-main",
        "trace-main",
    ]


@pytest.mark.asyncio
async def test_cache_resolver_skips_lookup_when_disabled_and_fetches_when_enabled():
    project_id = uuid4()

    class DummyTracingService:
        async def query_traces(self, *, project_id, query):
            return [SimpleNamespace(trace_id="trace-1"), SimpleNamespace(trace_id=None)]

    disabled = await RunnableCacheResolver().resolve(
        tracing_service=DummyTracingService(),
        project_id=project_id,
        enabled=False,
        references={"evaluator_revision": Reference(id=uuid4())},
        required_count=2,
    )
    enabled = await RunnableCacheResolver().resolve(
        tracing_service=DummyTracingService(),
        project_id=project_id,
        enabled=True,
        references={"evaluator_revision": Reference(id=uuid4())},
        required_count=2,
    )

    assert disabled.reusable_traces == []
    assert disabled.missing_count == 2
    assert [trace.trace_id for trace in enabled.reusable_traces] == ["trace-1"]
    assert enabled.missing_count == 1


@pytest.mark.asyncio
async def test_cache_resolver_zero_required_count_does_not_query_traces():
    tracing_service = SimpleNamespace(query_traces=AsyncMock())

    resolution = await RunnableCacheResolver().resolve(
        tracing_service=tracing_service,
        project_id=uuid4(),
        enabled=True,
        references={"evaluator_revision": Reference(id=uuid4())},
        required_count=0,
    )

    assert resolution.reusable_traces == []
    assert resolution.missing_count == 0
    tracing_service.query_traces.assert_not_awaited()


@pytest.mark.asyncio
async def test_queue_source_resolver_resolves_query_and_testset_batches():
    project_id = uuid4()
    query_revision_id = uuid4()
    testset_revision_id = uuid4()
    testcase_id_1 = uuid4()
    testcase_id_2 = uuid4()
    run = _run(
        steps=[
            _step(
                "query-source",
                "input",
                references={"query_revision": Reference(id=query_revision_id)},
            ),
            _step(
                "testset-source",
                "input",
                references={"testset_revision": Reference(id=testset_revision_id)},
            ),
            _step("evaluator-human", "annotation", origin="human"),
        ],
    )
    queries_service = SimpleNamespace(
        fetch_query_revision=AsyncMock(
            return_value=SimpleNamespace(
                data=SimpleNamespace(trace_ids=["trace-1", "trace-2"])
            )
        )
    )
    testsets_service = SimpleNamespace(
        fetch_testset_revision=AsyncMock(
            return_value=SimpleNamespace(
                data=SimpleNamespace(testcase_ids=[testcase_id_1, testcase_id_2])
            )
        )
    )

    batches = await resolve_queue_source_batches(
        project_id=project_id,
        run=run,
        queries_service=queries_service,
        testsets_service=testsets_service,
    )

    assert [batch.kind for batch in batches] == ["traces", "testcases"]
    assert batches[0].step_key == "query-source"
    assert batches[0].trace_ids == ["trace-1", "trace-2"]
    assert batches[1].step_key == "testset-source"
    assert batches[1].testcase_ids == [testcase_id_1, testcase_id_2]
    queries_service.fetch_query_revision.assert_awaited_once()
    testsets_service.fetch_testset_revision.assert_awaited_once()


@pytest.mark.asyncio
async def test_queue_source_resolver_skips_empty_sources():
    run = _run(
        steps=[
            _step(
                "query-source",
                "input",
                references={"query_revision": Reference(id=uuid4())},
            ),
            _step(
                "testset-source",
                "input",
                references={"testset_revision": Reference(id=uuid4())},
            ),
        ],
    )

    batches = await resolve_queue_source_batches(
        project_id=uuid4(),
        run=run,
        queries_service=SimpleNamespace(
            fetch_query_revision=AsyncMock(
                return_value=SimpleNamespace(data=SimpleNamespace(trace_ids=[]))
            )
        ),
        testsets_service=SimpleNamespace(
            fetch_testset_revision=AsyncMock(
                return_value=SimpleNamespace(data=SimpleNamespace(testcase_ids=[]))
            )
        ),
    )

    assert batches == []


@pytest.mark.asyncio
async def test_queue_source_resolver_empty_query_does_not_fall_through_to_testset():
    # A query step whose query revision resolves to zero traces is a real empty
    # batch — it must not fall through to the testset resolver, which should
    # never be asked about a query-only step.
    run = _run(
        steps=[
            _step(
                "query-source",
                "input",
                references={"query_revision": Reference(id=uuid4())},
            ),
        ],
    )
    fetch_testset_revision = AsyncMock(
        return_value=SimpleNamespace(data=SimpleNamespace(testcase_ids=[uuid4()]))
    )

    batches = await resolve_queue_source_batches(
        project_id=uuid4(),
        run=run,
        queries_service=SimpleNamespace(
            fetch_query_revision=AsyncMock(
                return_value=SimpleNamespace(data=SimpleNamespace(trace_ids=[]))
            )
        ),
        testsets_service=SimpleNamespace(fetch_testset_revision=fetch_testset_revision),
    )

    assert batches == []
    fetch_testset_revision.assert_not_awaited()


@pytest.mark.asyncio
async def test_queue_source_resolver_rejects_step_with_multiple_source_refs():
    # An input step must carry exactly one recognized source reference.
    run = _run(
        steps=[
            _step(
                "ambiguous-source",
                "input",
                references={
                    "query_revision": Reference(id=uuid4()),
                    "testset_revision": Reference(id=uuid4()),
                },
            ),
        ],
    )

    with pytest.raises(SourceResolutionError):
        await resolve_queue_source_batches(
            project_id=uuid4(),
            run=run,
            queries_service=SimpleNamespace(fetch_query_revision=AsyncMock()),
            testsets_service=SimpleNamespace(fetch_testset_revision=AsyncMock()),
        )


@pytest.mark.asyncio
async def test_testset_payload_source_resolver_preserves_testcase_payloads():
    project_id = uuid4()
    testset_id = uuid4()
    testset_variant_id = uuid4()
    testset_revision_id = uuid4()
    testcase_id = uuid4()
    testcase = SimpleNamespace(id=testcase_id, data={"prompt": "hello"})
    testsets_service = SimpleNamespace(
        fetch_testset_revision=AsyncMock(
            return_value=SimpleNamespace(
                id=testset_revision_id,
                variant_id=testset_variant_id,
                data=SimpleNamespace(testcases=[testcase]),
            )
        ),
        fetch_testset_variant=AsyncMock(
            return_value=SimpleNamespace(
                id=testset_variant_id,
                testset_id=testset_id,
            )
        ),
        fetch_testset=AsyncMock(
            return_value=SimpleNamespace(
                id=testset_id,
                slug="testset-main",
            )
        ),
    )

    specs = await resolve_testset_input_specs(
        project_id=project_id,
        input_steps=[
            _step(
                "testset-main",
                "input",
                references={"testset_revision": Reference(id=testset_revision_id)},
            )
        ],
        testsets_service=testsets_service,
    )

    assert len(specs) == 1
    assert specs[0].step_key == "testset-main"
    assert specs[0].testcases == [testcase]
    assert specs[0].testcases_data == [
        {"prompt": "hello", "testcase_id": str(testcase_id)}
    ]


@pytest.mark.asyncio
async def test_direct_source_resolver_preserves_order_and_missing_testcases():
    project_id = uuid4()
    testcase_id_1 = uuid4()
    testcase_id_2 = uuid4()
    testcase = SimpleNamespace(id=testcase_id_1, data={"input": "a"})
    testcases_service = SimpleNamespace(
        fetch_testcases=AsyncMock(return_value=[testcase])
    )

    source_items = await resolve_direct_source_items(
        project_id=project_id,
        testcase_ids=[testcase_id_1, testcase_id_2],
        trace_ids=["trace-1"],
        testcases_service=testcases_service,
    )

    assert [source_item.kind for source_item in source_items] == [
        "testcase",
        "testcase",
        "trace",
    ]
    assert source_items[0].testcase == testcase
    assert source_items[1].testcase is None
    assert source_items[2].trace_id == "trace-1"


@pytest.mark.asyncio
async def test_direct_source_resolver_loads_trace_context():
    project_id = uuid4()
    trace_id = "trace-1"
    span_id = "span-1"
    trace_payload = {
        "trace_id": trace_id,
        "spans": {
            span_id: {
                "trace_id": trace_id,
                "span_id": span_id,
                "attributes": {
                    "ag": {
                        "data": {
                            "inputs": {"prompt": "hello"},
                            "outputs": {"answer": "world"},
                        }
                    }
                },
            }
        },
    }
    trace = SimpleNamespace(
        trace_id=trace_id,
        spans={
            span_id: SimpleNamespace(
                trace_id=trace_id,
                span_id=span_id,
                attributes=trace_payload["spans"][span_id]["attributes"],
            )
        },
        model_dump=lambda **_: trace_payload,
    )
    tracing_service = SimpleNamespace(fetch_trace=AsyncMock(return_value=trace))

    source_items = await resolve_direct_source_items(
        project_id=project_id,
        trace_ids=[trace_id],
        tracing_service=tracing_service,
    )

    assert len(source_items) == 1
    assert source_items[0].kind == "trace"
    assert source_items[0].trace_id == trace_id
    assert source_items[0].span_id == span_id
    assert source_items[0].trace is not None
    assert source_items[0].inputs == {"prompt": "hello"}
    assert source_items[0].outputs == {"answer": "world"}


@pytest.mark.asyncio
async def test_live_query_trace_resolver_applies_default_windowing():
    project_id = uuid4()
    traces = [SimpleNamespace(trace_id="trace-1")]

    class DummyTracingService:
        def __init__(self):
            self.query = None

        async def query_traces(self, *, project_id, query):
            self.query = query
            return traces

    tracing_service = DummyTracingService()

    resolved = await resolve_live_query_traces(
        project_id=project_id,
        query_revisions={
            "query-main": SimpleNamespace(data=SimpleNamespace()),
        },
        tracing_service=tracing_service,
    )

    assert resolved == {"query-main": traces}
    assert tracing_service.query.windowing.order == "ascending"
    assert tracing_service.query.windowing.limit is None


@pytest.mark.asyncio
async def test_live_query_trace_resolver_uses_revision_windowing_when_requested():
    class DummyTracingService:
        def __init__(self):
            self.query = None

        async def query_traces(self, *, project_id, query):
            self.query = query
            return []

    tracing_service = DummyTracingService()
    revision_windowing = Windowing(
        oldest=None,
        newest=None,
        limit=25,
        order="descending",
        rate=0.5,
    )

    await resolve_live_query_traces(
        project_id=uuid4(),
        query_revisions={
            "query-main": SimpleNamespace(
                data=SimpleNamespace(filtering=None, windowing=revision_windowing)
            ),
        },
        tracing_service=tracing_service,
        use_windowing=True,
    )

    assert tracing_service.query.windowing.limit == 25
    assert tracing_service.query.windowing.order == "descending"
    assert tracing_service.query.windowing.rate == 0.5


@pytest.mark.asyncio
async def test_tensor_slice_operations_probe_populate_prune_and_process():
    project_id = uuid4()
    user_id = uuid4()
    run_id = uuid4()
    scenario_id = uuid4()
    result_id = uuid4()
    result = EvaluationResult(
        id=result_id,
        run_id=run_id,
        scenario_id=scenario_id,
        step_key="evaluator-auto",
        repeat_idx=0,
        status=EvaluationStatus.SUCCESS,
    )
    evaluations_service = SimpleNamespace(
        query_results=AsyncMock(return_value=[result]),
        # prune deletes by id, so it uses the ID-only query (UEL-029).
        query_result_ids=AsyncMock(return_value=[result_id]),
        set_results=AsyncMock(return_value=[result]),
        delete_results=AsyncMock(return_value=[result_id]),
        refresh_metrics=AsyncMock(return_value=[]),
        # refresh() reads run kind + scenarios for the aggregate boundary.
        fetch_run=AsyncMock(
            return_value=SimpleNamespace(flags=SimpleNamespace(is_live=False))
        ),
        query_scenarios=AsyncMock(return_value=[]),
    )
    operations = TensorSliceOperations(evaluations_service=evaluations_service)
    tensor_slice = TensorSlice(
        run_id=run_id,
        scenario_ids=[scenario_id],
        step_keys=["evaluator-auto"],
        repeat_idxs=[0],
    )

    probed = await operations.probe(
        project_id=project_id,
        tensor_slice=tensor_slice,
    )
    populated = await operations.populate(
        project_id=project_id,
        user_id=user_id,
        results=[
            EvaluationResultCreate(
                run_id=run_id,
                scenario_id=scenario_id,
                step_key="evaluator-auto",
                repeat_idx=0,
                status=EvaluationStatus.SUCCESS,
            )
        ],
    )
    pruned = await operations.prune(
        project_id=project_id,
        user_id=user_id,
        tensor_slice=tensor_slice,
    )

    assert probed == [result]
    assert populated == [result]
    assert pruned == [result_id]
    # probe() is the only full-DTO query here (prune now uses query_result_ids).
    assert evaluations_service.query_results.await_count == 1
    assert evaluations_service.query_result_ids.await_count == 1
    assert evaluations_service.set_results.await_count == 1
    assert evaluations_service.delete_results.await_count == 1
    # prune is a tensor-write op: after removing result cells it re-triggers a
    # metrics refresh over the affected scope (like populate/process), so
    # aggregates recompute over the now-smaller cell set. refresh() does both the
    # variational and the aggregate (global, here) pass — so prune drives >= 1
    # refresh_metrics call. probe/populate do not refresh on their own here.
    after_prune = evaluations_service.refresh_metrics.await_count
    assert after_prune >= 1

    # an explicit refresh() recomputes the slice's scope again (another batch of
    # variational + aggregate refresh_metrics calls).
    await operations.refresh(
        project_id=project_id,
        user_id=user_id,
        tensor_slice=tensor_slice,
    )
    assert evaluations_service.refresh_metrics.await_count > after_prune

    # process() with no wired slice_processor must fail loudly rather than
    # masquerade as execution by silently refreshing metrics (UEL-015).
    with pytest.raises(NotImplementedError):
        await operations.process(
            project_id=project_id,
            user_id=user_id,
            tensor_slice=tensor_slice,
        )


@pytest.mark.asyncio
async def test_tensor_slice_process_delegates_to_injected_processor():
    project_id = uuid4()
    user_id = uuid4()
    run_id = uuid4()
    expected = ProcessSummary(created=2, pending=1)
    slice_processor = SimpleNamespace(process=AsyncMock(return_value=expected))
    operations = TensorSliceOperations(
        evaluations_service=SimpleNamespace(),
        slice_processor=slice_processor,
    )
    tensor_slice = TensorSlice(
        run_id=run_id,
        scenario_ids=[uuid4()],
        step_keys=["evaluator-auto"],
        repeat_idxs=[0],
    )

    summary = await operations.process(
        project_id=project_id,
        user_id=user_id,
        tensor_slice=tensor_slice,
    )

    assert summary == expected
    slice_processor.process.assert_awaited_once_with(
        project_id=project_id,
        user_id=user_id,
        tensor_slice=tensor_slice,
    )


@pytest.mark.asyncio
async def test_tensor_slice_probe_summary_counts_statuses_and_missing_cells():
    project_id = uuid4()
    run_id = uuid4()
    scenario_id = uuid4()
    evaluations_service = SimpleNamespace(
        query_results=AsyncMock(
            return_value=[
                EvaluationResult(
                    id=uuid4(),
                    run_id=run_id,
                    scenario_id=scenario_id,
                    step_key="step-success",
                    repeat_idx=0,
                    status=EvaluationStatus.SUCCESS,
                ),
                EvaluationResult(
                    id=uuid4(),
                    run_id=run_id,
                    scenario_id=scenario_id,
                    step_key="step-failure",
                    repeat_idx=0,
                    status=EvaluationStatus.FAILURE,
                ),
                EvaluationResult(
                    id=uuid4(),
                    run_id=run_id,
                    scenario_id=scenario_id,
                    step_key="step-pending",
                    repeat_idx=0,
                    status=EvaluationStatus.PENDING,
                ),
            ]
        )
    )

    summary = await TensorSliceOperations(
        evaluations_service=evaluations_service
    ).probe_summary(
        project_id=project_id,
        tensor_slice=TensorSlice(run_id=run_id),
        expected_count=5,
    )

    assert summary == TensorProbeSummary(
        existing_count=3,
        missing_count=2,
        success_count=1,
        failure_count=1,
        pending_count=1,
        any_count=3,
    )


@pytest.mark.asyncio
async def test_tensor_slice_empty_dimension_short_circuits_probe_and_process():
    project_id = uuid4()
    user_id = uuid4()
    operations = TensorSliceOperations(
        evaluations_service=SimpleNamespace(
            query_results=AsyncMock(),
            refresh_metrics=AsyncMock(),
        )
    )
    tensor_slice = TensorSlice(run_id=uuid4(), scenario_ids=[])

    assert (
        await operations.probe(
            project_id=project_id,
            tensor_slice=tensor_slice,
        )
        == []
    )
    assert (
        await operations.process(
            project_id=project_id,
            user_id=user_id,
            tensor_slice=tensor_slice,
        )
        == ProcessSummary()
    )
    operations.evaluations_service.query_results.assert_not_awaited()
    operations.evaluations_service.refresh_metrics.assert_not_awaited()


@pytest.mark.asyncio
async def test_backend_workflow_service_runner_adapts_sdk_runtime_request():
    workflows_service = SimpleNamespace(
        invoke_workflow=AsyncMock(
            return_value=SimpleNamespace(
                status=SimpleNamespace(code=200),
                trace_id="trace-success",
                span_id="span-success",
                outputs={"score": 1},
            )
        )
    )
    runner = APIWorkflowServiceRunner(
        workflows_service=workflows_service,
        request_builder=lambda request: {
            "project_id": "project",
            "step_key": request.step.key,
        },
    )
    request = WorkflowExecutionRequest(
        step=SdkEvaluationStep(key="evaluator-auto", type="annotation", origin="auto"),
        cell=SdkPlannedCell(
            run_id=uuid4(),
            scenario_id=uuid4(),
            step_key="evaluator-auto",
            step_type="annotation",
            origin="auto",
            repeat_idx=0,
            status=SdkEvaluationStatus.QUEUED,
        ),
        source=SdkResolvedSourceItem(kind="trace", step_key="query-main"),
        revision={"slug": "evaluator-auto"},
    )

    result = await runner.execute(request)

    assert result.status == SdkEvaluationStatus.SUCCESS
    assert result.trace_id == "trace-success"
    assert result.span_id == "span-success"
    workflows_service.invoke_workflow.assert_awaited_once_with(
        project_id="project",
        step_key="evaluator-auto",
    )


@pytest.mark.asyncio
async def test_taskiq_evaluation_task_runner_omits_empty_optional_kwargs():
    project_id = uuid4()
    user_id = uuid4()
    run_id = uuid4()
    worker = SimpleNamespace(
        process_run_from_source=SimpleNamespace(kiq=AsyncMock(return_value="run-task")),
        process_run_from_batch=SimpleNamespace(
            kiq=AsyncMock(return_value="slice-task")
        ),
    )
    runner = TaskiqEvaluationTaskRunner(worker=worker)

    assert (
        await runner.process_run_from_source(
            project_id=project_id,
            user_id=user_id,
            run_id=run_id,
        )
        == "run-task"
    )
    assert (
        await runner.process_run_from_batch(
            project_id=project_id,
            user_id=user_id,
            run_id=run_id,
            source_kind="traces",
            trace_ids=["trace-1"],
        )
        == "slice-task"
    )

    worker.process_run_from_source.kiq.assert_awaited_once_with(
        project_id=project_id,
        user_id=user_id,
        run_id=run_id,
    )
    worker.process_run_from_batch.kiq.assert_awaited_once_with(
        project_id=project_id,
        user_id=user_id,
        run_id=run_id,
        source_kind="traces",
        trace_ids=["trace-1"],
    )


@pytest.mark.asyncio
async def test_backend_workflow_runner_invokes_application_through_workflow_service():
    project_id = uuid4()
    user_id = uuid4()
    application_revision_id = uuid4()
    workflows_service = SimpleNamespace(
        invoke_workflow=AsyncMock(
            return_value=SimpleNamespace(
                status=SimpleNamespace(code=200),
                trace_id="app-trace",
                span_id="app-span",
                outputs={"answer": "world"},
            )
        )
    )
    runner = APIWorkflowRunner(
        project_id=project_id,
        user_id=user_id,
        workflows_service=workflows_service,
    )
    revision = {
        "id": str(application_revision_id),
        "data": {
            "uri": "http://application",
            "schemas": {
                "inputs": {
                    "type": "object",
                    "properties": {"input": {"type": "string"}},
                }
            },
            "parameters": {"temperature": 0.1},
        },
        "flags": {"is_chat": True},
    }
    request = WorkflowExecutionRequest(
        step=SdkEvaluationStep(key="application-main", type="invocation"),
        cell=SdkPlannedCell(
            run_id=uuid4(),
            scenario_id=uuid4(),
            step_key="application-main",
            step_type="invocation",
            origin="custom",
            repeat_idx=0,
            status=SdkEvaluationStatus.QUEUED,
        ),
        source=SdkResolvedSourceItem(
            kind="testcase",
            step_key="testset-main",
            inputs={
                "input": "hello",
                "correct_answer": "world",
                "testcase_id": "testcase-id",
                "testcase_dedup_id": "dedup-id",
            },
        ),
        revision=revision,
        references={"application_revision": {"id": str(application_revision_id)}},
    )

    result = await runner.execute(request)

    assert result.status == SdkEvaluationStatus.SUCCESS
    assert result.trace_id == "app-trace"
    workflows_service.invoke_workflow.assert_awaited_once()
    kwargs = workflows_service.invoke_workflow.await_args.kwargs
    assert kwargs["project_id"] == project_id
    assert kwargs["user_id"] == user_id
    assert "annotate" not in kwargs
    workflow_request = kwargs["request"]
    assert workflow_request.flags == {"is_chat": True}
    assert workflow_request.data.revision == revision
    assert workflow_request.data.revision["data"]["uri"] == "http://application"
    assert workflow_request.data.revision["data"]["schemas"] == {
        "inputs": {
            "type": "object",
            "properties": {"input": {"type": "string"}},
        }
    }
    assert workflow_request.data.parameters == {"temperature": 0.1}
    assert workflow_request.data.inputs == {"input": "hello"}
    assert (
        workflow_request.references["application_revision"].id
        == application_revision_id
    )


@pytest.mark.asyncio
async def test_backend_evaluator_runner_sends_normalized_workflow_request():
    project_id = uuid4()
    user_id = uuid4()
    workflow_revision_id = uuid4()
    workflows_service = SimpleNamespace(
        invoke_workflow=AsyncMock(
            return_value=SimpleNamespace(
                status=SimpleNamespace(code=200),
                trace_id="eval-trace",
                span_id="eval-span",
                outputs={"score": 1},
            )
        )
    )
    runner = APIEvaluatorRunner(
        project_id=project_id,
        user_id=user_id,
        workflows_service=workflows_service,
    )
    revision = SimpleNamespace(
        id=workflow_revision_id,
        data=SimpleNamespace(
            uri="http://evaluator",
            url=None,
            headers={"authorization": "secret"},
            schemas={"outputs": {"type": "object"}},
            script="return score",
            parameters={"threshold": 0.5},
        ),
        flags=SimpleNamespace(model_dump=lambda **kwargs: {"is_custom": True}),
        model_dump=lambda **kwargs: {"id": str(workflow_revision_id)},
    )
    request = WorkflowExecutionRequest(
        step=SdkEvaluationStep(key="evaluator-auto", type="annotation", origin="auto"),
        cell=SdkPlannedCell(
            run_id=uuid4(),
            scenario_id=uuid4(),
            step_key="evaluator-auto",
            step_type="annotation",
            origin="auto",
            repeat_idx=0,
            status=SdkEvaluationStatus.QUEUED,
        ),
        source=SdkResolvedSourceItem(
            kind="testcase",
            step_key="testset-main",
            inputs={"input": "hello"},
            outputs={"answer": "world"},
        ),
        revision=revision,
        references={"evaluator_revision": {"id": str(workflow_revision_id)}},
        links={"invocation": {"trace_id": "app-trace", "span_id": "app-span"}},
        upstream_trace={"trace_id": "app-trace"},
        upstream_outputs={"answer": "world"},
    )

    result = await runner.execute(request)

    assert result.status == SdkEvaluationStatus.SUCCESS
    assert result.trace_id == "eval-trace"
    workflows_service.invoke_workflow.assert_awaited_once()
    kwargs = workflows_service.invoke_workflow.await_args.kwargs
    assert kwargs["project_id"] == project_id
    assert kwargs["user_id"] == user_id
    assert "annotate" not in kwargs
    workflow_request = kwargs["request"]
    assert workflow_request.flags == {"is_custom": True}
    assert workflow_request.data.revision == {"id": str(workflow_revision_id)}
    assert workflow_request.data.parameters == {"threshold": 0.5}
    assert workflow_request.data.inputs == {"input": "hello"}
    assert workflow_request.data.outputs == {"answer": "world"}
    assert workflow_request.links["invocation"].trace_id == "app-trace"
    assert workflow_request.links["invocation"].span_id == "app-span"


@pytest.mark.asyncio
async def test_backend_evaluator_runner_preserves_dict_revision_data():
    project_id = uuid4()
    user_id = uuid4()
    workflow_revision_id = uuid4()
    workflows_service = SimpleNamespace(
        invoke_workflow=AsyncMock(
            return_value=SimpleNamespace(
                status=SimpleNamespace(code=200),
                trace_id="eval-trace",
                span_id="eval-span",
                outputs={"score": 1},
            )
        )
    )
    runner = APIEvaluatorRunner(
        project_id=project_id,
        user_id=user_id,
        workflows_service=workflows_service,
    )
    revision = {
        "id": str(workflow_revision_id),
        "data": {
            "uri": "http://evaluator",
            "url": None,
            "headers": {"authorization": "secret"},
            "schemas": {"outputs": {"type": "object"}},
            "script": "return score",
            "parameters": {"threshold": 0.5},
        },
        "flags": {"is_custom": True},
    }
    request = WorkflowExecutionRequest(
        step=SdkEvaluationStep(key="evaluator-auto", type="annotation", origin="auto"),
        cell=SdkPlannedCell(
            run_id=uuid4(),
            scenario_id=uuid4(),
            step_key="evaluator-auto",
            step_type="annotation",
            origin="auto",
            repeat_idx=0,
            status=SdkEvaluationStatus.QUEUED,
        ),
        source=SdkResolvedSourceItem(
            kind="testcase",
            step_key="testset-main",
            inputs={"input": "hello"},
        ),
        revision=revision,
    )

    result = await runner.execute(request)

    assert result.status == SdkEvaluationStatus.SUCCESS
    workflows_service.invoke_workflow.assert_awaited_once()
    workflow_request = workflows_service.invoke_workflow.await_args.kwargs["request"]
    assert workflow_request.flags == {"is_custom": True}
    assert workflow_request.data.revision["data"]["uri"] == "http://evaluator"
    assert workflow_request.data.revision["data"]["headers"] == {
        "authorization": "secret"
    }
    assert workflow_request.data.revision["data"]["schemas"] == {
        "outputs": {"type": "object"}
    }
    assert workflow_request.data.revision["data"]["script"] == "return score"
    assert workflow_request.data.revision["data"]["parameters"] == {"threshold": 0.5}
    assert workflow_request.data.parameters == {"threshold": 0.5}


@pytest.mark.asyncio
async def test_backend_cached_runner_preserves_partial_hit_order():
    project_id = uuid4()
    cached_trace = SimpleNamespace(trace_id="cached-trace")
    tracing_service = SimpleNamespace(
        query_traces=AsyncMock(side_effect=[[cached_trace], []])
    )

    class BatchRunner:
        def __init__(self):
            self.requests = []

        async def execute_batch(self, requests, semaphore=None):
            self.requests.append(requests)
            return [
                WorkflowExecutionResult(
                    status=SdkEvaluationStatus.SUCCESS,
                    trace_id="fresh-trace",
                )
            ]

    batch_runner = BatchRunner()
    runner = APICachedRunner(
        runner=batch_runner,
        tracing_service=tracing_service,
        project_id=project_id,
        enabled=True,
    )
    requests = [
        WorkflowExecutionRequest(
            step=SdkEvaluationStep(key="evaluator-auto", type="annotation"),
            cell=SdkPlannedCell(
                run_id=uuid4(),
                scenario_id=uuid4(),
                step_key="evaluator-auto",
                step_type="annotation",
                origin="auto",
                repeat_idx=idx,
                status=SdkEvaluationStatus.QUEUED,
            ),
            source=SdkResolvedSourceItem(kind="trace", step_key="query-main"),
            revision={"id": "evaluator-revision"},
            references={"evaluator_revision": {"id": f"revision-{idx}"}},
        )
        for idx in range(2)
    ]

    results = await runner.execute_batch(requests)

    assert [result.trace_id for result in results] == ["cached-trace", "fresh-trace"]
    assert len(batch_runner.requests) == 1
    assert [request.cell.repeat_idx for request in batch_runner.requests[0]] == [1]


@pytest.mark.asyncio
async def test_simple_evaluation_start_dispatches_batch_invocation_by_topology():
    project_id = uuid4()
    user_id = uuid4()
    run_id = uuid4()
    run = _run(
        steps=[
            _step(
                "testset-main",
                "input",
                references={"testset_revision": Reference(id=uuid4())},
            ),
            _step(
                "application-main",
                "invocation",
                references={"application_revision": Reference(id=uuid4())},
            ),
        ],
    )
    run.id = run_id
    worker = SimpleNamespace(
        process_run_from_source=SimpleNamespace(kiq=AsyncMock()),
    )
    service = SimpleEvaluationsService(
        testsets_service=None,  # type: ignore[arg-type]
        queries_service=None,  # type: ignore[arg-type]
        applications_service=None,  # type: ignore[arg-type]
        evaluators_service=None,  # type: ignore[arg-type]
        evaluations_service=None,  # type: ignore[arg-type]
        evaluations_worker=worker,
    )
    service.fetch = AsyncMock(
        return_value=SimpleEvaluation(
            id=run_id,
            flags=SimpleEvaluationFlags(is_live=False),
            data=SimpleEvaluationData(
                status=None,
                testset_steps={uuid4(): "custom"},
                application_steps={uuid4(): "custom"},
            ),
        )
    )
    service._activate_evaluation_run = AsyncMock(return_value=run)

    await service.start(
        project_id=project_id,
        user_id=user_id,
        evaluation_id=run_id,
    )

    worker.process_run_from_source.kiq.assert_awaited_once_with(
        project_id=project_id,
        user_id=user_id,
        run_id=run_id,
    )


@pytest.mark.asyncio
async def test_simple_evaluation_start_does_not_dispatch_potential_topology():
    project_id = uuid4()
    user_id = uuid4()
    run_id = uuid4()
    run = _run(
        steps=[
            _step(
                "query-main",
                "input",
                references={"query_revision": Reference(id=uuid4())},
            ),
            _step(
                "application-main",
                "invocation",
                references={"application_revision": Reference(id=uuid4())},
            ),
        ],
    )
    run.id = run_id
    worker = SimpleNamespace(
        process_run_from_source=SimpleNamespace(kiq=AsyncMock()),
    )
    service = SimpleEvaluationsService(
        testsets_service=None,  # type: ignore[arg-type]
        queries_service=None,  # type: ignore[arg-type]
        applications_service=None,  # type: ignore[arg-type]
        evaluators_service=None,  # type: ignore[arg-type]
        evaluations_service=None,  # type: ignore[arg-type]
        evaluations_worker=worker,
    )
    service.fetch = AsyncMock(
        return_value=SimpleEvaluation(
            id=run_id,
            flags=SimpleEvaluationFlags(is_live=False),
            data=SimpleEvaluationData(
                status=None,
                query_steps={uuid4(): "custom"},
                application_steps={uuid4(): "custom"},
            ),
        )
    )
    service._activate_evaluation_run = AsyncMock(return_value=run)

    await service.start(
        project_id=project_id,
        user_id=user_id,
        evaluation_id=run_id,
    )

    worker.process_run_from_source.kiq.assert_not_awaited()


@pytest.mark.asyncio
async def test_simple_evaluation_queue_batches_dispatch_through_slice_processor():
    project_id = uuid4()
    user_id = uuid4()
    run_id = uuid4()
    testcase_id = uuid4()
    run = _run(
        flags=EvaluationRunFlags(
            is_queue=True,
            has_queries=True,
            has_testsets=True,
        ),
        steps=[
            _step(
                "query-main",
                "input",
                references={"query_revision": Reference(id=uuid4())},
            ),
            _step(
                "testset-main",
                "input",
                references={"testset_revision": Reference(id=uuid4())},
            ),
            _step("evaluator-human", "annotation", origin="human"),
        ],
    )
    run.id = run_id
    worker = SimpleNamespace(
        process_run_from_batch=SimpleNamespace(kiq=AsyncMock()),
    )
    evaluations_service = SimpleNamespace(fetch_run=AsyncMock(return_value=run))
    service = SimpleEvaluationsService(
        testsets_service=None,  # type: ignore[arg-type]
        queries_service=None,  # type: ignore[arg-type]
        applications_service=None,  # type: ignore[arg-type]
        evaluators_service=None,  # type: ignore[arg-type]
        evaluations_service=evaluations_service,  # type: ignore[arg-type]
        evaluations_worker=worker,
    )
    service._ensure_human_annotation_queue = AsyncMock()

    traces_ok = await service.dispatch_trace_slice(
        project_id=project_id,
        user_id=user_id,
        run_id=run_id,
        trace_ids=["trace-1"],
        input_step_key="query-main",
    )
    testcases_ok = await service.dispatch_testcase_slice(
        project_id=project_id,
        user_id=user_id,
        run_id=run_id,
        testcase_ids=[testcase_id],
        input_step_key="testset-main",
    )

    assert traces_ok is True
    assert testcases_ok is True
    assert worker.process_run_from_batch.kiq.await_args_list == [
        call(
            project_id=project_id,
            user_id=user_id,
            run_id=run_id,
            source_kind="traces",
            trace_ids=["trace-1"],
            input_step_key="query-main",
        ),
        call(
            project_id=project_id,
            user_id=user_id,
            run_id=run_id,
            source_kind="testcases",
            testcase_ids=[testcase_id],
            input_step_key="testset-main",
        ),
    ]


@pytest.mark.asyncio
async def test_direct_id_ingest_adds_scenarios_populates_then_processes(monkeypatch):
    # Direct-id ingest is add_scenarios -> populate -> process: it creates one
    # skeleton scenario per id, writes each scenario's input cell carrying the
    # id, then re-executes (force) over the new scenarios. `process` itself never
    # creates scenarios.
    project_id = uuid4()
    user_id = uuid4()
    run_id = uuid4()
    testcase_id = uuid4()
    scenario_a = uuid4()
    scenario_b = uuid4()

    run = _run(
        flags=EvaluationRunFlags(has_traces=True),
        steps=[_step("query-main", "input")],
    )
    run.id = run_id

    created_scenarios = [SimpleNamespace(id=scenario_a), SimpleNamespace(id=scenario_b)]
    evaluations_service = SimpleNamespace(
        fetch_run=AsyncMock(return_value=run),
        create_scenarios=AsyncMock(return_value=created_scenarios),
        set_results=AsyncMock(return_value=[]),
    )

    # The direct ids are hydrated once by the resolver; the unified flow seeds
    # those items into the executor (no downstream re-fetch).
    monkeypatch.setattr(
        run_tasks,
        "resolve_direct_source_items",
        AsyncMock(
            side_effect=lambda **kwargs: (
                [
                    run_tasks.ResolvedSourceItem(
                        kind="trace", step_key="", trace_id=tid
                    )
                    for tid in (kwargs.get("trace_ids") or [])
                ]
                + [
                    run_tasks.ResolvedSourceItem(
                        kind="testcase", step_key="", testcase_id=tcid
                    )
                    for tcid in (kwargs.get("testcase_ids") or [])
                ]
            )
        ),
    )

    process_calls = []
    seed_calls = []

    class _FakeSliceProcessor:
        def __init__(self, **kwargs):
            pass

        async def process(
            self,
            *,
            project_id,
            user_id,
            tensor_slice,
            seed_bindings=None,
            refresh_metrics_without_auto_results=True,
            finalize_run_status=True,
        ):
            process_calls.append(tensor_slice)
            seed_calls.append(seed_bindings)
            return ProcessSummary(created=len(tensor_slice.scenario_ids or []))

    monkeypatch.setattr(run_tasks, "APISliceProcessor", _FakeSliceProcessor)

    ok = await run_tasks.run_from_batch(
        project_id=project_id,
        user_id=user_id,
        run_id=run_id,
        source_kind="traces",
        trace_ids=["trace-1", "trace-2"],
        input_step_key="query-main",
        tracing_service=object(),  # type: ignore[arg-type]
        testcases_service=object(),  # type: ignore[arg-type]
        workflows_service=object(),  # type: ignore[arg-type]
        applications_service=object(),  # type: ignore[arg-type]
        evaluations_service=evaluations_service,  # type: ignore[arg-type]
    )

    assert ok is True
    # add_scenarios: one skeleton scenario per id
    evaluations_service.create_scenarios.assert_awaited_once()
    _, create_kwargs = evaluations_service.create_scenarios.await_args
    assert len(create_kwargs["scenarios"]) == 2
    assert all(s.run_id == run_id for s in create_kwargs["scenarios"])

    # bind: no input cell is pre-written (the SDK slice loop logs it on execute,
    # avoiding a redundant per-scenario write). The hydrated source rides on the
    # binding instead.
    evaluations_service.set_results.assert_not_awaited()

    # process: re-execute (force) over exactly the new scenarios
    assert len(process_calls) == 1
    tensor_slice = process_calls[0]
    assert tensor_slice.run_id == run_id
    assert set(tensor_slice.scenario_ids) == {scenario_a, scenario_b}
    assert tensor_slice.process_mode == "force"

    # seed bindings carry the hydrated source for each minted scenario (Option A:
    # the executor reuses them instead of re-reading the input cell). Each binds
    # its trace id at the input step key, with no testcase id.
    bindings = seed_calls[0]
    assert set(bindings.keys()) == {scenario_a, scenario_b}
    assert {b.source.trace_id for b in bindings.values()} == {"trace-1", "trace-2"}
    assert all(b.source.step_key == "query-main" for b in bindings.values())
    assert all(b.source.testcase_id is None for b in bindings.values())

    # testcase ingest binds testcase_id (not trace_id) on the seeded source
    evaluations_service.create_scenarios.reset_mock()
    evaluations_service.create_scenarios.return_value = [SimpleNamespace(id=scenario_a)]
    process_calls.clear()
    seed_calls.clear()

    ok = await run_tasks.run_from_batch(
        project_id=project_id,
        user_id=user_id,
        run_id=run_id,
        source_kind="testcases",
        testcase_ids=[testcase_id],
        input_step_key="query-main",
        tracing_service=object(),  # type: ignore[arg-type]
        testcases_service=object(),  # type: ignore[arg-type]
        workflows_service=object(),  # type: ignore[arg-type]
        applications_service=object(),  # type: ignore[arg-type]
        evaluations_service=evaluations_service,  # type: ignore[arg-type]
    )
    assert ok is True
    binding = seed_calls[0][scenario_a]
    assert binding.source.testcase_id == testcase_id
    assert binding.source.trace_id is None


@pytest.mark.asyncio
async def test_run_processor_routes_batch_inference_through_testset_application_loop(
    monkeypatch,
):
    project_id = uuid4()
    user_id = uuid4()
    run_id = uuid4()
    run = _run(
        steps=[
            _step(
                "testset-main",
                "input",
                references={"testset_revision": Reference(id=uuid4())},
            ),
            _step(
                "application-main",
                "invocation",
                references={"application_revision": Reference(id=uuid4())},
            ),
        ],
    )
    run.id = run_id
    run_testset_source = AsyncMock()
    monkeypatch.setattr(
        run_tasks,
        "_run_testset_source",
        run_testset_source,
    )

    processed = await run_tasks.run_from_source(
        project_id=project_id,
        user_id=user_id,
        run_id=run_id,
        tracing_service=object(),  # type: ignore[arg-type]
        testsets_service=object(),  # type: ignore[arg-type]
        queries_service=object(),  # type: ignore[arg-type]
        workflows_service=object(),  # type: ignore[arg-type]
        applications_service=object(),  # type: ignore[arg-type]
        evaluations_service=SimpleNamespace(fetch_run=AsyncMock(return_value=run)),
        simple_evaluators_service=object(),  # type: ignore[arg-type]
    )

    assert processed is True
    run_testset_source.assert_awaited_once()


@pytest.mark.asyncio
async def test_run_processor_routes_query_topologies_with_windowing(monkeypatch):
    project_id = uuid4()
    user_id = uuid4()
    run_id = uuid4()
    query_revision_id = uuid4()
    evaluator_revision_id = uuid4()
    newest = object()
    oldest = object()
    run_query_source = AsyncMock()
    monkeypatch.setattr(
        run_tasks,
        "_run_query_source",
        run_query_source,
    )
    live_run = _run(
        flags=EvaluationRunFlags(is_live=True),
        steps=[
            _step(
                "query-main",
                "input",
                references={"query_revision": Reference(id=query_revision_id)},
            ),
            _step(
                "evaluator-auto",
                "annotation",
                origin="auto",
                references={"evaluator_revision": Reference(id=evaluator_revision_id)},
            ),
        ],
    )
    live_run.id = run_id
    batch_run = live_run.model_copy(update={"flags": EvaluationRunFlags(is_live=False)})

    for run, expected_use_windowing in [(live_run, False), (batch_run, True)]:
        run_query_source.reset_mock()

        processed = await run_tasks.run_from_source(
            project_id=project_id,
            user_id=user_id,
            run_id=run_id,
            newest=newest,  # type: ignore[arg-type]
            oldest=oldest,  # type: ignore[arg-type]
            tracing_service=object(),  # type: ignore[arg-type]
            testsets_service=object(),  # type: ignore[arg-type]
            queries_service=object(),  # type: ignore[arg-type]
            workflows_service=object(),  # type: ignore[arg-type]
            applications_service=object(),  # type: ignore[arg-type]
            evaluations_service=SimpleNamespace(fetch_run=AsyncMock(return_value=run)),
            simple_evaluators_service=object(),  # type: ignore[arg-type]
        )

        assert processed is True
        kwargs = run_query_source.await_args.kwargs
        assert kwargs["use_windowing"] is expected_use_windowing
        # Batch query runs drop the scheduler tick's range; live runs keep it.
        if expected_use_windowing:
            assert kwargs["newest"] is None
            assert kwargs["oldest"] is None
        else:
            assert kwargs["newest"] is newest
            assert kwargs["oldest"] is oldest


@pytest.mark.asyncio
async def test_run_processor_returns_false_for_missing_or_unsupported_run():
    project_id = uuid4()
    user_id = uuid4()
    run_id = uuid4()
    unsupported_run = _run(
        steps=[
            _step(
                "query-main",
                "input",
                references={"query_revision": Reference(id=uuid4())},
            ),
            _step(
                "testset-main",
                "input",
                references={"testset_revision": Reference(id=uuid4())},
            ),
        ],
    )
    unsupported_run.id = run_id

    common_kwargs = dict(
        project_id=project_id,
        user_id=user_id,
        run_id=run_id,
        tracing_service=object(),
        testsets_service=object(),
        queries_service=object(),
        workflows_service=object(),
        applications_service=object(),
        simple_evaluators_service=object(),
    )

    assert (
        await run_tasks.run_from_source(
            **common_kwargs,  # type: ignore[arg-type]
            evaluations_service=SimpleNamespace(fetch_run=AsyncMock(return_value=None)),
        )
        is False
    )
    assert (
        await run_tasks.run_from_source(
            **common_kwargs,  # type: ignore[arg-type]
            evaluations_service=SimpleNamespace(
                fetch_run=AsyncMock(return_value=unsupported_run)
            ),
        )
        is False
    )


@pytest.mark.asyncio
async def test_backend_slice_processor_reexecutes_existing_scenario(monkeypatch):
    # A TensorSlice addresses an EXISTING scenario. The backend slice processor
    # must rebuild that scenario's source binding from its stored input cell,
    # re-hydrate trace context, and re-run the SDK loop AGAINST THE EXISTING
    # scenario (not a freshly created one), returning a populated ProcessSummary.
    project_id = uuid4()
    user_id = uuid4()
    run_id = uuid4()
    scenario_id = uuid4()
    evaluator_revision_id = uuid4()
    trace_id = "trace-existing"

    run = _run(
        flags=EvaluationRunFlags(has_traces=True),
        steps=[
            _step(
                "query-main",
                "input",
                references={"query_revision": Reference(id=uuid4())},
            ),
            _step(
                "evaluator-auto",
                "annotation",
                origin="auto",
                references={"evaluator_revision": Reference(id=evaluator_revision_id)},
            ),
        ],
    )
    run.id = run_id

    # The slice probe returns the evaluator cell; the per-scenario probe returns
    # the input cell carrying the bound trace_id.
    input_cell = EvaluationResult(
        id=uuid4(),
        run_id=run_id,
        scenario_id=scenario_id,
        step_key="query-main",
        repeat_idx=0,
        status=EvaluationStatus.SUCCESS,
        trace_id=trace_id,
    )
    evaluator_cell = EvaluationResult(
        id=uuid4(),
        run_id=run_id,
        scenario_id=scenario_id,
        step_key="evaluator-auto",
        repeat_idx=0,
        status=EvaluationStatus.FAILURE,
    )

    async def _query_results(*, project_id, result=None, windowing=None):
        if result is not None and result.scenario_id == scenario_id:
            return [input_cell, evaluator_cell]
        return [evaluator_cell]

    evaluations_service = SimpleNamespace(
        fetch_run=AsyncMock(return_value=run),
        query_results=AsyncMock(side_effect=_query_results),
        # process now owns "done": per-scenario status writes + run finalize +
        # incremental metrics refresh.
        edit_scenario=AsyncMock(),
        edit_run=AsyncMock(),
        refresh_metrics=AsyncMock(return_value=[]),
    )
    workflows_service = SimpleNamespace(
        fetch_workflow_revision=AsyncMock(
            return_value=SimpleNamespace(id=evaluator_revision_id)
        )
    )

    monkeypatch.setattr(
        source_slice_tasks,
        "resolve_direct_source_items",
        AsyncMock(
            return_value=[
                ResolvedSourceItem(
                    kind="trace",
                    step_key="query-main",
                    trace_id=trace_id,
                    inputs={"prompt": "hi"},
                )
            ]
        ),
    )
    sdk_loop = AsyncMock(
        return_value=[
            SdkProcessedScenario(
                scenario=SimpleNamespace(id=scenario_id),
                results={"evaluator-auto": object()},
                auto_results_created=True,
            )
        ]
    )
    monkeypatch.setattr(
        source_slice_tasks,
        "sdk_process_evaluation_source_slice",
        sdk_loop,
    )

    processor = source_slice_tasks.APISliceProcessor(
        evaluations_service=evaluations_service,
        tracing_service=None,
        testcases_service=None,
        workflows_service=workflows_service,
        applications_service=None,
    )
    summary = await processor.process(
        project_id=project_id,
        user_id=user_id,
        tensor_slice=TensorSlice(
            run_id=run_id,
            scenario_ids=[scenario_id],
            step_keys=["evaluator-auto"],
            repeat_idxs=[0],
            process_mode="force",
        ),
    )

    # The auto evaluator re-ran for the existing scenario.
    assert summary.created == 1
    sdk_loop.assert_awaited_once()
    kwargs = sdk_loop.await_args.kwargs
    # Source rebuilt from the input cell's trace_id.
    assert kwargs["source_items"][0].trace_id == trace_id
    # The loop reuses the EXISTING scenario rather than creating a new one.
    created_scenario = await kwargs["create_scenario"](run_id)
    assert created_scenario.id == scenario_id
    # The auto evaluator runner was wired from the run's current revision.
    assert "evaluator-auto" in kwargs["runners"]
    assert "evaluator-auto" in kwargs["revisions"]


@pytest.mark.asyncio
async def test_backend_slice_processor_uses_requested_scenarios_for_missing_cells(
    monkeypatch,
):
    project_id = uuid4()
    user_id = uuid4()
    run_id = uuid4()
    scenario_id = uuid4()
    evaluator_revision_id = uuid4()
    trace_id = "trace-existing"

    run = _run(
        flags=EvaluationRunFlags(has_traces=True),
        steps=[
            _step(
                "query-main",
                "input",
                references={"query_revision": Reference(id=uuid4())},
            ),
            _step(
                "app-main",
                "invocation",
                references={"application_revision": Reference(id=uuid4())},
            ),
            _step(
                "evaluator-auto",
                "annotation",
                origin="auto",
                references={"evaluator_revision": Reference(id=evaluator_revision_id)},
            ),
        ],
        repeats=2,
    )
    run.id = run_id

    input_cell = EvaluationResult(
        id=uuid4(),
        run_id=run_id,
        scenario_id=scenario_id,
        step_key="query-main",
        repeat_idx=1,
        status=EvaluationStatus.SUCCESS,
        trace_id=trace_id,
    )
    invocation_cell = EvaluationResult(
        id=uuid4(),
        run_id=run_id,
        scenario_id=scenario_id,
        step_key="app-main",
        repeat_idx=1,
        status=EvaluationStatus.SUCCESS,
        trace_id=trace_id,
    )

    async def _query_results(*, project_id, result=None, windowing=None):
        if result is not None and result.scenario_id == scenario_id:
            return [input_cell, invocation_cell]
        return []

    evaluations_service = SimpleNamespace(
        fetch_run=AsyncMock(return_value=run),
        query_results=AsyncMock(side_effect=_query_results),
        edit_scenario=AsyncMock(),
        edit_run=AsyncMock(),
        refresh_metrics=AsyncMock(return_value=[]),
    )
    workflows_service = SimpleNamespace(
        fetch_workflow_revision=AsyncMock(
            return_value=SimpleNamespace(id=evaluator_revision_id)
        ),
        fetch_application_revision=AsyncMock(return_value=SimpleNamespace(id=uuid4())),
    )
    applications_service = SimpleNamespace(
        fetch_application_revision=AsyncMock(return_value=SimpleNamespace(id=uuid4()))
    )

    monkeypatch.setattr(
        source_slice_tasks,
        "resolve_direct_source_items",
        AsyncMock(
            side_effect=[
                [
                    ResolvedSourceItem(
                        kind="trace",
                        step_key="query-main",
                        trace_id=trace_id,
                        inputs={"prompt": "hi"},
                    )
                ],
                [
                    ResolvedSourceItem(
                        kind="trace",
                        step_key="",
                        trace_id=trace_id,
                        span_id="span-1",
                        outputs={"answer": "ok"},
                    )
                ],
            ]
        ),
    )
    sdk_loop = AsyncMock(
        return_value=[
            SdkProcessedScenario(
                scenario=SimpleNamespace(id=scenario_id),
                results={"evaluator-auto": object()},
                auto_results_created=True,
            )
        ]
    )
    monkeypatch.setattr(
        source_slice_tasks, "sdk_process_evaluation_source_slice", sdk_loop
    )

    processor = source_slice_tasks.APISliceProcessor(
        evaluations_service=evaluations_service,
        tracing_service=None,
        testcases_service=None,
        workflows_service=workflows_service,
        applications_service=applications_service,
    )
    summary = await processor.process(
        project_id=project_id,
        user_id=user_id,
        tensor_slice=TensorSlice(
            run_id=run_id,
            scenario_ids=[scenario_id],
            step_keys=["evaluator-auto"],
            repeat_idxs=[1],
        ),
    )

    assert summary.created == 1
    sdk_loop.assert_awaited_once()
    kwargs = sdk_loop.await_args.kwargs
    assert kwargs["initial_context_by_repeat"][1]["trace_id"] == trace_id
    assert kwargs["initial_context_by_repeat"][1]["outputs"] == {"answer": "ok"}
    assert kwargs["plan_cell_filter"](
        SdkPlannedCell(
            run_id=run_id,
            scenario_id=scenario_id,
            step_key="evaluator-auto",
            step_type="annotation",
            origin="auto",
            repeat_idx=1,
            status=EvaluationStatus.QUEUED,
            should_execute=True,
        )
    )
    assert not kwargs["plan_cell_filter"](
        SdkPlannedCell(
            run_id=run_id,
            scenario_id=scenario_id,
            step_key="evaluator-auto",
            step_type="annotation",
            origin="auto",
            repeat_idx=0,
            status=EvaluationStatus.QUEUED,
            should_execute=True,
        )
    )


@pytest.mark.asyncio
async def test_backend_slice_processor_distinguishes_fill_missing_and_force(
    monkeypatch,
):
    project_id = uuid4()
    user_id = uuid4()
    run_id = uuid4()
    scenario_id = uuid4()
    evaluator_revision_id = uuid4()
    trace_id = "trace-existing"

    run = _run(
        flags=EvaluationRunFlags(has_traces=True),
        steps=[
            _step(
                "query-main",
                "input",
                references={"query_revision": Reference(id=uuid4())},
            ),
            _step(
                "evaluator-auto",
                "annotation",
                origin="auto",
                references={"evaluator_revision": Reference(id=evaluator_revision_id)},
            ),
        ],
    )
    run.id = run_id

    input_cell = EvaluationResult(
        id=uuid4(),
        run_id=run_id,
        scenario_id=scenario_id,
        step_key="query-main",
        repeat_idx=0,
        status=EvaluationStatus.SUCCESS,
        trace_id=trace_id,
    )
    evaluator_cell = EvaluationResult(
        id=uuid4(),
        run_id=run_id,
        scenario_id=scenario_id,
        step_key="evaluator-auto",
        repeat_idx=0,
        status=EvaluationStatus.SUCCESS,
    )

    async def _query_results(*, project_id, result=None, windowing=None):
        if result is not None and result.scenario_id == scenario_id:
            return [input_cell, evaluator_cell]
        return [evaluator_cell]

    evaluations_service = SimpleNamespace(
        fetch_run=AsyncMock(return_value=run),
        query_results=AsyncMock(side_effect=_query_results),
        edit_scenario=AsyncMock(),
        edit_run=AsyncMock(),
        refresh_metrics=AsyncMock(return_value=[]),
    )
    workflows_service = SimpleNamespace(
        fetch_workflow_revision=AsyncMock(
            return_value=SimpleNamespace(id=evaluator_revision_id)
        )
    )
    monkeypatch.setattr(
        source_slice_tasks,
        "resolve_direct_source_items",
        AsyncMock(
            return_value=[
                ResolvedSourceItem(
                    kind="trace",
                    step_key="query-main",
                    trace_id=trace_id,
                    inputs={"prompt": "hi"},
                )
            ]
        ),
    )
    sdk_loop = AsyncMock(
        return_value=[
            SdkProcessedScenario(
                scenario=SimpleNamespace(id=scenario_id),
                results={"evaluator-auto": object()},
                auto_results_created=True,
            )
        ]
    )
    monkeypatch.setattr(
        source_slice_tasks, "sdk_process_evaluation_source_slice", sdk_loop
    )

    processor = source_slice_tasks.APISliceProcessor(
        evaluations_service=evaluations_service,
        tracing_service=None,
        testcases_service=None,
        workflows_service=workflows_service,
        applications_service=None,
    )

    fill_missing = await processor.process(
        project_id=project_id,
        user_id=user_id,
        tensor_slice=TensorSlice(
            run_id=run_id,
            scenario_ids=[scenario_id],
            step_keys=["evaluator-auto"],
            repeat_idxs=[0],
        ),
    )
    assert fill_missing.created == 0
    assert fill_missing.reused == 1
    sdk_loop.assert_not_awaited()

    force = await processor.process(
        project_id=project_id,
        user_id=user_id,
        tensor_slice=TensorSlice(
            run_id=run_id,
            scenario_ids=[scenario_id],
            step_keys=["evaluator-auto"],
            repeat_idxs=[0],
            process_mode="force",
        ),
    )
    assert force.created == 1
    sdk_loop.assert_awaited_once()
