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

from oss.src.core.evaluations.types import (
    EvaluationStatus,
    EvaluationRunEdit,
    EvaluationRunFlags,
)


from oss.src.core.evaluations.runtime.sources import resolve_query_source_items
from oss.src.core.evaluations.tasks.processor import process_evaluation_source_slice


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
    #
    # timestamp/interval are TEMPORAL coordinates and only meaningful for LIVE
    # runs (use_windowing=False), which bucket metrics over time. Batch query
    # runs (use_windowing=True) are not live: they have no temporal axis, so
    # timestamp/interval must stay None — otherwise a non-None timestamp gets
    # stamped onto per-scenario (variational) refreshes, producing a metric with
    # BOTH scenario_id and timestamp set, which matches no unique index.
    timestamp: Optional[datetime] = None
    interval: Optional[int] = None
    if not use_windowing:
        # count in minutes
        timestamp = oldest or datetime.now(timezone.utc)
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

        # Batch query runs (use_windowing=True) must finalize their run status,
        # like batch testset/invocation runs. Live query runs (use_windowing
        # =False) intentionally never finalize — the scheduler keeps polling.
        update_run_status = use_windowing

        if total_traces == 0:
            # A live run with nothing to do just waits for the next tick. A batch
            # run with no matching traces is complete: finalize it directly to
            # SUCCESS (the slice processor rejects empty input) so it does not
            # hang in `running`.
            if update_run_status:
                flags = run.flags.model_copy() if run.flags else EvaluationRunFlags()
                flags.is_active = False
                await evaluations_service.edit_run(
                    project_id=project_id,
                    user_id=user_id,
                    run=EvaluationRunEdit(
                        id=run_id,
                        name=run.name,
                        description=run.description,
                        tags=run.tags,
                        meta=run.meta,
                        status=EvaluationStatus.SUCCESS,
                        flags=flags,
                        data=run.data,
                    ),
                )
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
                update_run_status=update_run_status,
                refresh_metrics_without_auto_results=False,
                tracing_service=tracing_service,
                workflows_service=workflows_service,
                evaluations_service=evaluations_service,
            )
    except Exception as e:  # pylint: disable=broad-exception-caught
        log.error(e, exc_info=True)

        # An exception BEFORE the slice runs (trace fetch, source assembly, a
        # missing run/steps) never reaches the slice processor's own finalize, so
        # without this a batch run would hang in RUNNING/is_active forever. Batch
        # query runs (use_windowing=True) must finalize to FAILURE here; live
        # runs (use_windowing=False) intentionally keep ticking and are left
        # untouched. Re-fetch the run since `run` may be unbound/stale in this
        # scope, and tolerate a run that no longer exists or was closed.
        if use_windowing:
            try:
                current = await evaluations_service.fetch_run(
                    project_id=project_id,
                    run_id=run_id,
                )
                if current:
                    flags = (
                        current.flags.model_copy()
                        if current.flags
                        else EvaluationRunFlags()
                    )
                    flags.is_active = False
                    await evaluations_service.edit_run(
                        project_id=project_id,
                        user_id=user_id,
                        run=EvaluationRunEdit(
                            id=run_id,
                            name=current.name,
                            description=current.description,
                            tags=current.tags,
                            meta=current.meta,
                            status=EvaluationStatus.FAILURE,
                            flags=flags,
                            data=current.data,
                        ),
                    )
            except Exception as finalize_error:  # pylint: disable=broad-exception-caught
                # Closing/finalization is best-effort: if the run was closed
                # mid-flight or vanished, do not mask the original error.
                log.error(
                    "[EVAL] [query] failed to finalize run after error",
                    run_id=str(run_id),
                    error=str(finalize_error),
                )

    log.info(
        "[DONE]      ",
        run_id=run_id,
    )

    return
