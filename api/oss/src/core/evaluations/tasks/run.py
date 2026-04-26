from datetime import datetime
from typing import Literal, Optional
from uuid import UUID

from oss.src.core.applications.service import ApplicationsService
from oss.src.core.evaluations.runtime.topology import classify_run_topology
from oss.src.core.evaluations.service import EvaluationsService
from oss.src.core.evaluations.tasks.source_slice import (
    process_evaluation_source_slice,
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
    evaluations_service: EvaluationsService,
) -> bool:
    if source_kind == "traces":
        await process_evaluation_source_slice(
            project_id=project_id,
            user_id=user_id,
            run_id=run_id,
            trace_ids=trace_ids or [],
            input_step_key=input_step_key,
            tracing_service=tracing_service,
            workflows_service=workflows_service,
            evaluations_service=evaluations_service,
        )
        return True

    if source_kind == "testcases":
        await process_evaluation_source_slice(
            project_id=project_id,
            user_id=user_id,
            run_id=run_id,
            testcase_ids=testcase_ids or [],
            input_step_key=input_step_key,
            tracing_service=tracing_service,
            testcases_service=testcases_service,
            workflows_service=workflows_service,
            evaluations_service=evaluations_service,
        )
        return True

    log.warning(
        "[EVAL] [process-slice] unsupported source kind",
        run_id=run_id,
        source_kind=source_kind,
    )
    return False
