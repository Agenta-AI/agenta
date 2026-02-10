from typing import Any, List
import random

from redis.asyncio import Redis
from fastapi.responses import JSONResponse
from fastapi import HTTPException, Request, status, Response, Query

from oss.src.utils.logging import get_module_logger
from oss.src.utils.env import env
from oss.src.utils.caching import get_cache, set_cache

from oss.src.services import converters
from oss.src.services import evaluation_service

from oss.src.core.evaluations.tasks.legacy import setup_evaluation

# Import worker tasks from worker_evaluations.py where they're instantiated
from entrypoints.worker_evaluations import evaluations_worker

from oss.src.utils.common import APIRouter, is_ee
from oss.src.models.api.evaluation_model import (
    Evaluation,
    EvaluationScenario,
    NewEvaluation,
    DeleteEvaluation,
)
from oss.src.services import app_manager, db_manager

if is_ee():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access
    from ee.src.utils.entitlements import (
        check_entitlements,
        Tracker,
        Counter,
        NOT_ENTITLED_RESPONSE,
    )

from oss.src.apis.fastapi.evaluations.models import EvaluationRunsResponse


from oss.src.dbs.postgres.queries.dbes import (
    QueryArtifactDBE,
    QueryVariantDBE,
    QueryRevisionDBE,
)
from oss.src.dbs.postgres.testcases.dbes import TestcaseBlobDBE
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
from oss.src.core.testsets.service import TestsetsService, SimpleTestsetsService
from oss.src.core.applications.services import ApplicationsService
from oss.src.core.workflows.service import WorkflowsService
from oss.src.core.evaluators.service import EvaluatorsService, SimpleEvaluatorsService
from oss.src.core.evaluations.service import EvaluationsService
from oss.src.apis.fastapi.tracing.router import TracingRouter
from oss.src.apis.fastapi.testsets.router import SimpleTestsetsRouter
from oss.src.tasks.asyncio.tracing.worker import TracingWorker


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

tracing_service = TracingService(
    tracing_dao=tracing_dao,
)

# Redis client and TracingWorker for publishing spans to Redis Streams
if env.redis.uri_durable:
    redis_client = Redis.from_url(env.redis.uri_durable, decode_responses=False)
    tracing_worker = TracingWorker(
        service=tracing_service,
        redis_client=redis_client,
        stream_name="streams:tracing",
        consumer_group="worker-tracing",
    )
else:
    raise RuntimeError("REDIS_URI_DURABLE is required for tracing worker")

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

applications_service = ApplicationsService(
    workflows_service=workflows_service,
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
    evaluations_worker=evaluations_worker,
)

tracing_router = TracingRouter(
    tracing_service=tracing_service,
    tracing_worker=tracing_worker,
)

simple_testsets_router = SimpleTestsetsRouter(
    simple_testsets_service=simple_testsets_service,
)

router = APIRouter()


log = get_module_logger(__name__)


@router.get(
    "/by_resource/",
    response_model=List[str],
)
async def fetch_evaluation_ids(
    resource_type: str,
    request: Request,
    resource_ids: List[str] = Query(None),
):
    """Fetches evaluation ids for a given resource type and id.

    Arguments:
        app_id (str): The ID of the app for which to fetch evaluations.
        resource_type (str): The type of resource for which to fetch evaluations.
        resource_ids List[ObjectId]: The IDs of resource for which to fetch evaluations.

    Raises:
        HTTPException: If the resource_type is invalid or access is denied.

    Returns:
        List[str]: A list of evaluation ids.
    """

    if is_ee():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_EVALUATION,
        )
        if not has_permission:
            error_msg = "You do not have permission to perform this action. Please contact your organization admin."
            # log.debug(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )
    evaluations = await db_manager.fetch_evaluations_by_resource(
        resource_type,
        request.state.project_id,
        resource_ids,
    )
    return list(map(lambda x: str(x.id), evaluations))


@router.get(
    "/{evaluation_id}/status/",
    operation_id="fetch_evaluation_status",
)
async def fetch_evaluation_status(
    evaluation_id: str,
    request: Request,
):
    """Fetches the status of the evaluation.

    Args:
        evaluation_id (str): the evaluation id
        request (Request): the request object

    Returns:
        (str): the evaluation status
    """

    cache_key = {
        "evaluation_id": evaluation_id,
    }

    evaluation_status = await get_cache(
        project_id=request.state.project_id,
        namespace="fetch_evaluation_status",
        key=cache_key,
        retry=False,
    )

    if evaluation_status is not None:
        return {"status": evaluation_status}

    if is_ee():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_EVALUATION,
        )
        if not has_permission:
            error_msg = "You do not have permission to perform this action. Please contact your organization admin."
            # log.debug(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    evaluation_status = await db_manager.fetch_evaluation_status_by_id(
        project_id=request.state.project_id,
        evaluation_id=evaluation_id,
    )

    await set_cache(
        project_id=request.state.project_id,
        namespace="fetch_evaluation_status",
        key=cache_key,
        value=evaluation_status,
        ttl=15,  # 15 seconds
    )

    return {"status": evaluation_status}


@router.get(
    "/{evaluation_id}/results/",
    operation_id="fetch_legacy_evaluation_results",
)
async def fetch_evaluation_results(
    evaluation_id: str,
    request: Request,
):
    """Fetches the results of the evaluation

    Args:
        evaluation_id (str): the evaluation id
        request (Request): the request object

    Returns:
        _type_: _description_
    """

    evaluation = await db_manager.fetch_evaluation_by_id(
        project_id=request.state.project_id,
        evaluation_id=evaluation_id,
    )
    if is_ee():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=str(evaluation.project_id),
            permission=Permission.VIEW_EVALUATION,
        )
        if not has_permission:
            error_msg = "You do not have permission to perform this action. Please contact your organization admin."
            # log.debug(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    results = converters.aggregated_result_of_evaluation_to_pydantic(
        evaluation.aggregated_results  # type: ignore
    )
    return {"results": results, "evaluation_id": evaluation_id}


@router.get(
    "/{evaluation_id}/evaluation_scenarios/",
    response_model=List[EvaluationScenario],
    operation_id="fetch_legacy_evaluation_scenarios",
)
async def fetch_evaluation_scenarios(
    evaluation_id: str,
    request: Request,
):
    """Fetches evaluation scenarios for a given evaluation ID.

    Arguments:
        evaluation_id (str): The ID of the evaluation for which to fetch scenarios.

    Raises:
        HTTPException: If the evaluation is not found or access is denied.

    Returns:
        List[EvaluationScenario]: A list of evaluation scenarios.
    """

    evaluation = await db_manager.fetch_evaluation_by_id(
        project_id=request.state.project_id,
        evaluation_id=evaluation_id,
    )
    if not evaluation:
        raise HTTPException(
            status_code=404, detail=f"Evaluation with id {evaluation_id} not found"
        )

    if is_ee():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=str(evaluation.project_id),
            permission=Permission.VIEW_EVALUATION,
        )
        if not has_permission:
            error_msg = "You do not have permission to perform this action. Please contact your organization admin."
            # log.debug(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    eval_scenarios = await evaluation_service.fetch_evaluation_scenarios_for_evaluation(
        evaluation_id=str(evaluation.id), project_id=str(evaluation.project_id)
    )
    return eval_scenarios


@router.get(
    "/",
    response_model=List[Evaluation],
    operation_id="fetch_legacy_evaluations",
)
async def fetch_list_evaluations(
    app_id: str,
    request: Request,
):
    """Fetches a list of evaluations, optionally filtered by an app ID.

    Args:
        app_id (Optional[str]): An optional app ID to filter the evaluations.

    Returns:
        List[Evaluation]: A list of evaluations.
    """

    app = await db_manager.fetch_app_by_id(app_id)
    if is_ee():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=str(app.project_id),
            permission=Permission.VIEW_EVALUATION,
        )
        if not has_permission:
            error_msg = "You do not have permission to perform this action. Please contact your organization admin."
            # log.debug(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    return await evaluation_service.fetch_list_evaluations(app, str(app.project_id))


@router.get(
    "/{evaluation_id}/",
    response_model=Evaluation,
    operation_id="fetch_legacy_evaluation",
)
async def fetch_evaluation(
    evaluation_id: str,
    request: Request,
):
    """Fetches a single evaluation based on its ID.

    Args:
        evaluation_id (str): The ID of the evaluation to fetch.

    Returns:
        Evaluation: The fetched evaluation.
    """

    evaluation = await db_manager.fetch_evaluation_by_id(
        project_id=request.state.project_id,
        evaluation_id=evaluation_id,
    )
    if not evaluation:
        raise HTTPException(
            status_code=404, detail=f"Evaluation with id {evaluation_id} not found"
        )

    if is_ee():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=str(evaluation.project_id),
            permission=Permission.VIEW_EVALUATION,
        )
        if not has_permission:
            error_msg = "You do not have permission to perform this action. Please contact your organization admin."
            # log.debug(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    return await converters.evaluation_db_to_pydantic(evaluation)


@router.delete(
    "/",
    response_model=List[str],
    operation_id="delete_legacy_evaluations",
)
async def delete_evaluations(
    payload: DeleteEvaluation,
    request: Request,
):
    """
    Delete specific comparison tables based on their unique IDs.

    Args:
    delete_evaluations (List[str]): The unique identifiers of the comparison tables to delete.

    Returns:
    A list of the deleted comparison tables' IDs.
    """

    evaluation = await db_manager.fetch_evaluation_by_id(
        project_id=request.state.project_id,
        evaluation_id=payload.evaluations_ids[0],
    )
    if is_ee():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=str(evaluation.project_id),
            permission=Permission.DELETE_EVALUATION,
        )
        if not has_permission:
            error_msg = "You do not have permission to perform this action. Please contact your organization admin."
            # log.debug(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    # Update last_modified_by app information
    await app_manager.update_last_modified_by(
        user_uid=request.state.user_id,
        object_id=random.choice(payload.evaluations_ids),
        object_type="evaluation",
        project_id=str(evaluation.project_id),
    )

    await evaluation_service.delete_evaluations(payload.evaluations_ids)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/evaluation_scenarios/comparison-results/",
    response_model=Any,
    operation_id="fetch_legacy_evaluation_scenarios_comparison_results",
)
async def fetch_evaluation_scenarios_comparison_results(
    evaluations_ids: str,
    request: Request,
):
    """Fetches evaluation scenarios for a given evaluation ID.

    Arguments:
        evaluation_id (str): The ID of the evaluation for which to fetch scenarios.

    Raises:
        HTTPException: If the evaluation is not found or access is denied.

    Returns:
        List[EvaluationScenario]: A list of evaluation scenarios.
    """

    evaluations_ids_list = evaluations_ids.split(",")
    evaluation = await db_manager.fetch_evaluation_by_id(
        project_id=request.state.project_id,
        evaluation_id=evaluations_ids_list[0],
    )
    if is_ee():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=str(evaluation.project_id),
            permission=Permission.VIEW_EVALUATION,
        )
        if not has_permission:
            error_msg = "You do not have permission to perform this action. Please contact your organization admin."
            # log.debug(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    eval_scenarios = await evaluation_service.compare_evaluations_scenarios(
        evaluations_ids_list, str(evaluation.project_id)
    )

    return eval_scenarios


@router.post(
    "/preview/start",
    response_model=EvaluationRunsResponse,
    operation_id="start_evaluation",
)
async def start_evaluation(
    request: Request,
    payload: NewEvaluation,
) -> EvaluationRunsResponse:
    try:
        if is_ee():
            # Permissions Check ------------------------------------------------
            check = await check_action_access(
                project_id=request.state.project_id,
                user_uid=request.state.user_id,
                permission=Permission.CREATE_EVALUATION,
            )
            if not check:
                raise HTTPException(
                    status_code=403,
                    detail="You do not have permission to perform this action. Please contact your organization admin.",
                )
            # ------------------------------------------------------------------

            # Entitlements Check -----------------------------------------------
            check, _, _ = await check_entitlements(
                organization_id=request.state.organization_id,
                key=Counter.EVALUATIONS,
                delta=1,
            )

            if not check:
                return NOT_ENTITLED_RESPONSE(Tracker.COUNTERS)
            # ------------------------------------------------------------------

        # Input Validation -----------------------------------------------------
        nof_runs = len(payload.revisions_ids)

        if nof_runs == 0:
            raise HTTPException(
                status_code=400,
                detail="No revisions provided for evaluation. Please provide at least one revision.",
            )
        # ----------------------------------------------------------------------

        # Evaluation Run Execution ---------------------------------------------
        runs = []

        for i in range(nof_runs):
            run = await setup_evaluation(
                project_id=request.state.project_id,
                user_id=request.state.user_id,
                #
                name=payload.name,
                #
                testset_revision_id=payload.testset_revision_id,
                #
                revision_id=payload.revisions_ids[i],
                #
                evaluator_ids=payload.evaluator_ids,
                #
                testsets_service=testsets_service,
                queries_service=queries_service,
                workflows_service=workflows_service,
                applications_service=applications_service,
                evaluators_service=evaluators_service,
                evaluations_service=evaluations_service,
            )

            if not run:
                continue

            runs.append(run)

            await evaluations_worker.evaluate_batch_testset.kiq(
                project_id=request.state.project_id,
                user_id=request.state.user_id,
                #
                run_id=run.id,
            )
        # ----------------------------------------------------------------------

        runs_response = EvaluationRunsResponse(
            count=len(runs),
            runs=runs,
        )

        return runs_response

    except KeyError as e:
        log.error(e, exc_info=True)

        raise HTTPException(
            status_code=400,
            detail="Columns in the testset should match the names of the inputs in the variant",
        ) from e
