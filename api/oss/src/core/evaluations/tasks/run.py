from datetime import datetime
from typing import Any, List, Literal, Optional
from uuid import UUID

from oss.src.core.applications.service import ApplicationsService
from oss.src.core.evaluations.runtime.models import SliceProcessMode, TensorSlice
from oss.src.core.evaluations.runtime.tensor import TensorSliceOperations
from oss.src.core.evaluations.runtime.topology import classify_run_topology
from oss.src.core.evaluations.service import EvaluationsService
from oss.src.core.evaluations.types import (
    EvaluationResultCreate,
    EvaluationScenarioCreate,
    EvaluationStatus,
)
from oss.src.core.evaluations.tasks.processor import (
    APISliceProcessor,
    process_testset_source_run,
)
from oss.src.core.evaluations.tasks.query import process_query_source_run
from oss.src.core.evaluators.service import SimpleEvaluatorsService
from oss.src.core.queries.service import QueriesService
from oss.src.core.testcases.service import TestcasesService
from oss.src.core.testsets.service import TestsetsService
from oss.src.core.tracing.service import TracingService
from oss.src.core.workflows.service import WorkflowsService
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

EvaluationSliceSource = Literal["traces", "testcases"]


async def process_evaluation_run(
    *,
    project_id: UUID,
    user_id: UUID,
    run_id: UUID,
    newest: Optional[datetime] = None,
    oldest: Optional[datetime] = None,
    tracing_service: TracingService,
    testsets_service: TestsetsService,
    queries_service: QueriesService,
    workflows_service: WorkflowsService,
    applications_service: ApplicationsService,
    evaluations_service: EvaluationsService,
    simple_evaluators_service: SimpleEvaluatorsService,
) -> bool:
    run = await evaluations_service.fetch_run(
        project_id=project_id,
        run_id=run_id,
    )
    if not run:
        log.warning("[EVAL] [process-run] run not found", run_id=run_id)
        return False

    topology = classify_run_topology(run)

    if topology.dispatch == "live_query":
        await process_query_source_run(
            project_id=project_id,
            user_id=user_id,
            run_id=run_id,
            newest=newest,
            oldest=oldest,
            use_windowing=False,
        )
        return True

    if topology.dispatch == "batch_query":
        await process_query_source_run(
            project_id=project_id,
            user_id=user_id,
            run_id=run_id,
            newest=None,
            oldest=None,
            use_windowing=True,
        )
        return True

    if topology.dispatch == "batch_testset":
        await process_testset_source_run(
            project_id=project_id,
            user_id=user_id,
            run_id=run_id,
            tracing_service=tracing_service,
            testsets_service=testsets_service,
            workflows_service=workflows_service,
            applications_service=applications_service,
            evaluations_service=evaluations_service,
        )
        return True

    if topology.dispatch == "batch_invocation":
        await process_testset_source_run(
            project_id=project_id,
            user_id=user_id,
            run_id=run_id,
            tracing_service=tracing_service,
            testsets_service=testsets_service,
            workflows_service=workflows_service,
            applications_service=applications_service,
            evaluations_service=evaluations_service,
        )
        return True

    log.warning(
        "[EVAL] [process-run] unsupported run topology",
        run_id=run_id,
        topology=topology.label,
        topology_status=topology.status,
        reason=topology.reason,
    )
    return False


async def process_evaluation_slice(
    *,
    project_id: UUID,
    user_id: UUID,
    run_id: UUID,
    source_kind: EvaluationSliceSource,
    trace_ids: Optional[list[str]] = None,
    testcase_ids: Optional[list[UUID]] = None,
    input_step_key: Optional[str] = None,
    tracing_service: TracingService,
    testcases_service: TestcasesService,
    workflows_service: WorkflowsService,
    applications_service: ApplicationsService,
    evaluations_service: EvaluationsService,
) -> bool:
    """Ingest a batch of DIRECT source ids (trace_ids / testcase_ids).

    A direct id is the only source identity — it can't be loaded internally
    (unlike query/testset). So this is `add_scenarios` -> `populate` -> `process`:

      1. add_scenarios: one skeleton scenario per id;
      2. populate: write each scenario's input cell carrying the id;
      3. process: re-execute over the new scenarios (it reconstructs the source
         from the input cell, plans, runs, and finalizes).

    `process` itself never creates scenarios — that is `add_scenarios` here.
    """
    if source_kind == "traces":
        ids: List[Any] = list(trace_ids or [])
    elif source_kind == "testcases":
        ids = list(testcase_ids or [])
    else:
        log.warning(
            "[EVAL] [process-slice] unsupported source kind",
            run_id=run_id,
            source_kind=source_kind,
        )
        return False

    if not ids:
        return True

    run = await evaluations_service.fetch_run(project_id=project_id, run_id=run_id)
    if not run or not run.data or not run.data.steps:
        log.warning("[EVAL] [process-slice] run has no steps", run_id=run_id)
        return False

    input_steps = [step for step in run.data.steps if step.type == "input"]
    step_key = input_step_key or (input_steps[0].key if input_steps else None)
    if step_key is None:
        log.warning("[EVAL] [process-slice] run has no input step", run_id=run_id)
        return False

    # 1. add_scenarios — one skeleton row per id.
    scenarios = await evaluations_service.create_scenarios(
        project_id=project_id,
        user_id=user_id,
        scenarios=[
            EvaluationScenarioCreate(run_id=run_id, status=EvaluationStatus.RUNNING)
            for _ in ids
        ],
    )
    if len(scenarios) != len(ids):
        log.error(
            "[EVAL] [process-slice] scenario count mismatch",
            run_id=run_id,
            wanted=len(ids),
            got=len(scenarios),
        )
        return False

    # 2. populate — write each scenario's input cell carrying its source id.
    input_results: List[EvaluationResultCreate] = []
    for scenario, source_id in zip(scenarios, ids):
        input_results.append(
            EvaluationResultCreate(
                run_id=run_id,
                scenario_id=scenario.id,
                step_key=step_key,
                repeat_idx=0,
                status=EvaluationStatus.SUCCESS,
                trace_id=str(source_id) if source_kind == "traces" else None,
                testcase_id=source_id if source_kind == "testcases" else None,
            )
        )
    await evaluations_service.set_results(
        project_id=project_id,
        user_id=user_id,
        results=input_results,
    )

    # 3. process — re-execute over the new scenarios (force, since they are fresh
    #    and their cells must be filled even though no result exists yet).
    slice_processor = APISliceProcessor(
        evaluations_service=evaluations_service,
        tracing_service=tracing_service,
        testcases_service=testcases_service,
        workflows_service=workflows_service,
        applications_service=applications_service,
    )
    await slice_processor.process(
        project_id=project_id,
        user_id=user_id,
        tensor_slice=TensorSlice(
            run_id=run_id,
            scenario_ids=[scenario.id for scenario in scenarios],
            process_mode="force",
        ),
    )
    return True


async def process_evaluation_tensor_slice(
    *,
    project_id: UUID,
    user_id: UUID,
    run_id: UUID,
    scenario_ids: Optional[List[UUID]] = None,
    step_keys: Optional[List[str]] = None,
    repeat_idxs: Optional[List[int]] = None,
    process_mode: SliceProcessMode = "fill-missing",
    tracing_service: TracingService,
    testcases_service: TestcasesService,
    workflows_service: WorkflowsService,
    applications_service: ApplicationsService,
    evaluations_service: EvaluationsService,
) -> bool:
    """Re-execute EXISTING scenarios addressed by a tensor coordinate slice.

    The coordinate counterpart of `process_evaluation_slice` (which ingests NEW
    source items): this re-runs the runnable cells of scenarios that already
    exist — retry, fill-missing, or run a newly-added step over them. It rebuilds
    each scenario's source from its stored input cell rather than resolving new
    sources.

    `process` is results-only by design; this entry point owns the metrics
    `refresh` boundary, invoking it after execution over the same slice scope.
    """
    tensor_slice = TensorSlice(
        run_id=run_id,
        scenario_ids=scenario_ids,
        step_keys=step_keys,
        repeat_idxs=repeat_idxs,
        process_mode=process_mode,
    )

    slice_processor = APISliceProcessor(
        evaluations_service=evaluations_service,
        tracing_service=tracing_service,
        testcases_service=testcases_service,
        workflows_service=workflows_service,
        applications_service=applications_service,
    )
    tensor_ops = TensorSliceOperations(
        evaluations_service=evaluations_service,
        slice_processor=slice_processor,
    )

    await tensor_ops.process(
        project_id=project_id,
        user_id=user_id,
        tensor_slice=tensor_slice,
    )
    await tensor_ops.refresh(
        project_id=project_id,
        user_id=user_id,
        tensor_slice=tensor_slice,
    )
    return True
