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
    EvaluationScenarioQuery,
    EvaluationStatus,
)
from oss.src.core.evaluations.runtime.adapters import APIMetricsRefresher
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

    if topology.dispatch in ("queue_traces", "queue_testcases"):
        # Direct trace/testcase -> evaluator runs are fed by explicit source ids
        # via `process_evaluation_slice` (the queue/ingest path), not by a
        # source the run can resolve itself. There is nothing to execute at
        # run-start: the run is an open queue awaiting batches. Finalize it as a
        # clean, started-but-empty queue instead of falling through to the
        # "unsupported topology" path (which logged an error and left the run
        # hanging as if misconfigured).
        await _finalize_empty_queue_run(
            project_id=project_id,
            user_id=user_id,
            run=run,
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


async def _finalize_empty_queue_run(
    *,
    project_id: UUID,
    user_id: UUID,
    run: Any,
    evaluations_service: EvaluationsService,
) -> None:
    """Mark a queue run as active-and-running with nothing dispatched yet.

    A queue run (direct traces/testcases -> evaluator) accumulates results as
    batches arrive via `process_evaluation_slice`; each batch finalizes its own
    slice. At run-start there is no batch, so we simply leave the run RUNNING and
    active — it is a live queue, not a terminal batch — without the misleading
    "unsupported topology" warning. Status transitions to terminal happen on the
    batch slices, consistent with how the slice processor finalizes.
    """
    log.info(
        "[EVAL] [process-run] queue run started; awaiting batches",
        run_id=str(run.id),
    )


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
    #
    # NOTE: not idempotent. There is no dedup on source id and no unique
    # constraint tying a scenario to its trace_id/testcase_id, so dispatching the
    # SAME batch twice (e.g. a manual worker re-queue) mints a second set of
    # scenarios for the same ids. The task is configured allow_concurrency=True,
    # so a re-dispatch with a fresh job id also bypasses the singleton run lock.
    # Acceptable today because batches are dispatched once per ingest; if
    # re-dispatch ever becomes a real flow, dedup by source id here (skip ids
    # already populated in this run) or add a partial-unique input-cell index.
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

    # Metrics boundary for the slice. `process` refreshes the per-scenario
    # (variational) rows for the scenarios it executed; this step refreshes the
    # AGGREGATE that the slice affected, which differs by run kind:
    #   - live run     -> temporal metrics, for every interval bucket the slice's
    #                     scenarios fall into (a live run aggregates over time).
    #   - non-live run -> the global (whole-run) metric row.
    await _refresh_slice_aggregate(
        project_id=project_id,
        user_id=user_id,
        run_id=run_id,
        scenario_ids=scenario_ids,
        evaluations_service=evaluations_service,
    )
    return True


async def _refresh_slice_aggregate(
    *,
    project_id: UUID,
    user_id: UUID,
    run_id: UUID,
    scenario_ids: Optional[List[UUID]],
    evaluations_service: EvaluationsService,
) -> None:
    """Refresh the slice's aggregate metric: temporal (live) or global (non-live).

    Live runs aggregate over time, so a slice must recompute the temporal buckets
    its scenarios belong to (each scenario carries its (timestamp, interval)).
    Non-live runs have a single global aggregate, so the whole-run row is
    recomputed. Variational (per-scenario) rows are already refreshed inside
    `process`.
    """
    run = await evaluations_service.fetch_run(
        project_id=project_id,
        run_id=run_id,
    )
    if not run:
        return

    refresh = APIMetricsRefresher(
        project_id=project_id,
        user_id=user_id,
        evaluations_service=evaluations_service,
    )

    is_live = bool(run.flags and run.flags.is_live)

    if not is_live:
        # Non-live: one global aggregate (no scenario, no timestamp).
        await refresh(run_id)
        return

    # Live: recompute the temporal buckets the slice touched. Resolve the slice's
    # scenarios and group their timestamps by interval, so each affected
    # (interval, timestamp) bucket is recomputed.
    scenarios = await evaluations_service.query_scenarios(
        project_id=project_id,
        scenario=EvaluationScenarioQuery(
            run_id=run_id,
            ids=scenario_ids,
        ),
    )
    timestamps_by_interval: dict[int, set] = {}
    for scenario in scenarios:
        if scenario.timestamp is None or scenario.interval is None:
            continue
        timestamps_by_interval.setdefault(scenario.interval, set()).add(
            scenario.timestamp
        )

    if not timestamps_by_interval:
        # No temporal buckets on the slice's scenarios (e.g. they were never
        # assigned a timestamp/interval). Fall back to the global aggregate so
        # the run is not left with stale metrics.
        await refresh(run_id)
        return

    for interval, timestamps in timestamps_by_interval.items():
        await refresh(
            run_id,
            timestamps=sorted(timestamps),
            interval=interval,
        )
