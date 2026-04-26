from typing import Optional
from uuid import UUID
from datetime import datetime, timezone

from oss.src.utils.logging import get_module_logger

from oss.src.dbs.postgres.queries.dbes import (
    QueryArtifactDBE,
    QueryVariantDBE,
    QueryRevisionDBE,
)
from oss.src.dbs.postgres.testcases.dbes import (
    TestcaseBlobDBE,
)
from oss.src.dbs.postgres.testsets.dbes import (
    TestsetArtifactDBE,
    TestsetVariantDBE,
    TestsetRevisionDBE,
)
from oss.src.dbs.postgres.workflows.dbes import (
    WorkflowArtifactDBE,
    WorkflowVariantDBE,
    WorkflowRevisionDBE,
)

from oss.src.dbs.postgres.tracing.dao import TracingDAO
from oss.src.dbs.postgres.blobs.dao import BlobsDAO
from oss.src.dbs.postgres.git.dao import GitDAO
from oss.src.dbs.postgres.evaluations.dao import EvaluationsDAO

from oss.src.core.tracing.service import TracingService
from oss.src.core.queries.service import QueriesService
from oss.src.core.testcases.service import TestcasesService
from oss.src.core.testsets.service import TestsetsService
from oss.src.core.testsets.service import SimpleTestsetsService
from oss.src.core.workflows.service import WorkflowsService
from oss.src.core.evaluators.service import EvaluatorsService
from oss.src.core.evaluators.service import SimpleEvaluatorsService
from oss.src.core.evaluations.service import EvaluationsService
from oss.src.core.annotations.service import AnnotationsService


from oss.src.core.evaluations.runtime.sources import resolve_query_source_items
from oss.src.core.evaluations.tasks.source_slice import process_evaluation_source_slice


log = get_module_logger(__name__)


# DBS --------------------------------------------------------------------------

tracing_dao = TracingDAO()

testcases_dao = BlobsDAO(
    BlobDBE=TestcaseBlobDBE,
)

queries_dao = GitDAO(
    ArtifactDBE=QueryArtifactDBE,
    VariantDBE=QueryVariantDBE,
    RevisionDBE=QueryRevisionDBE,
)

testsets_dao = GitDAO(
    ArtifactDBE=TestsetArtifactDBE,
    VariantDBE=TestsetVariantDBE,
    RevisionDBE=TestsetRevisionDBE,
)

workflows_dao = GitDAO(
    ArtifactDBE=WorkflowArtifactDBE,
    VariantDBE=WorkflowVariantDBE,
    RevisionDBE=WorkflowRevisionDBE,
)

evaluations_dao = EvaluationsDAO()

# CORE -------------------------------------------------------------------------

tracing_service = TracingService(
    tracing_dao=tracing_dao,
)

queries_service = QueriesService(
    queries_dao=queries_dao,
)

testcases_service = TestcasesService(
    testcases_dao=testcases_dao,
)

testsets_service = TestsetsService(
    testsets_dao=testsets_dao,
    testcases_service=testcases_service,
)

simple_testsets_service = SimpleTestsetsService(
    testsets_service=testsets_service,
)

workflows_service = WorkflowsService(
    workflows_dao=workflows_dao,
)

evaluators_service = EvaluatorsService(
    workflows_service=workflows_service,
)

simple_evaluators_service = SimpleEvaluatorsService(
    evaluators_service=evaluators_service,
)

evaluations_service = EvaluationsService(
    evaluations_dao=evaluations_dao,
    tracing_service=tracing_service,
    queries_service=queries_service,
    testsets_service=testsets_service,
    evaluators_service=evaluators_service,
    #
)

# APIS -------------------------------------------------------------------------

annotations_service = AnnotationsService(
    tracing_service=tracing_service,
    evaluators_service=evaluators_service,
    simple_evaluators_service=simple_evaluators_service,
)

# ------------------------------------------------------------------------------


async def process_query_source_run(
    project_id: UUID,
    user_id: UUID,
    #
    run_id: UUID,
    #
    newest: Optional[datetime] = None,
    oldest: Optional[datetime] = None,
    #
    use_windowing: bool = False,
):
    # Backward-compatible live-query worker shell. Scheduling/windowing stays
    # here for now; query source resolution and evaluator execution are routed
    # through the unified runtime.
    # count in minutes
    timestamp = oldest or datetime.now(timezone.utc)
    interval: Optional[int] = None
    if newest and oldest:
        interval = int((newest - oldest).total_seconds() / 60)

    try:
        # ----------------------------------------------------------------------
        log.info(
            "[SCOPE]     ",
            run_id=run_id,
            project_id=project_id,
            user_id=user_id,
        )

        log.info(
            "[RANGE]     ",
            run_id=run_id,
            timestamp=timestamp,
            interval=interval,
            newest=newest,
            oldest=oldest,
            use_windowing=use_windowing,
        )
        # ----------------------------------------------------------------------

        # fetch evaluation run -------------------------------------------------
        run = await evaluations_service.fetch_run(
            project_id=project_id,
            run_id=run_id,
        )

        if not run:
            raise ValueError(f"Evaluation run with id {run_id} not found!")

        if not run.data:
            raise ValueError(f"Evaluation run with id {run_id} has no data!")

        if not run.data.steps:
            raise ValueError(f"Evaluation run with id {run_id} has no steps!")

        source_items_by_step = await resolve_query_source_items(
            project_id=project_id,
            run=run,
            queries_service=queries_service,
            tracing_service=tracing_service,
            newest=newest,
            oldest=oldest,
            use_windowing=use_windowing,
        )
        for query_step_key, source_items in source_items_by_step.items():
            log.info(
                "[TRACES]    ",
                run_id=run_id,
                count=len(source_items),
            )
        # ----------------------------------------------------------------------

        total_traces = sum(
            len(source_items) for source_items in source_items_by_step.values()
        )
        if total_traces == 0:
            return

        for query_step_key, source_items in source_items_by_step.items():
            if not source_items:
                continue

            await process_evaluation_source_slice(
                project_id=project_id,
                user_id=user_id,
                run_id=run_id,
                source_items=source_items,
                input_step_key=query_step_key,
                timestamp=timestamp,
                interval=interval,
                require_queue=False,
                update_run_status=False,
                refresh_metrics_without_auto_results=False,
                tracing_service=tracing_service,
                workflows_service=workflows_service,
                evaluations_service=evaluations_service,
            )
    except Exception as e:  # pylint: disable=broad-exception-caught
        log.error(e, exc_info=True)

    log.info(
        "[DONE]      ",
        run_id=run_id,
    )

    return
