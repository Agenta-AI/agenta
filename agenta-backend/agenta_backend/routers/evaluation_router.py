import secrets
import logging
from typing import Any, List

from fastapi.responses import JSONResponse
from fastapi import HTTPException, Request, status, Response, Query

from agenta_backend.models import converters
from agenta_backend.tasks.evaluations import evaluate
from agenta_backend.utils.common import APIRouter, isCloudEE
from agenta_backend.services import evaluation_service, db_manager
from agenta_backend.models.api.evaluation_model import (
    Evaluation,
    EvaluationScenario,
    NewEvaluation,
    DeleteEvaluation,
    EvaluationWebhook,
    RerunEvaluation,
)
from agenta_backend.services.evaluator_manager import (
    check_ai_critique_inputs,
)

if isCloudEE():
    from agenta_backend.commons.models.db_models import Permission
    from agenta_backend.commons.utils.permissions import check_action_access

from beanie import PydanticObjectId as ObjectId


router = APIRouter()
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


@router.get(
    "/by_resource/",
    response_model=List[ObjectId],
)
async def fetch_evaluation_ids(
    app_id: str,
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
    try:
        if isCloudEE():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                object_id=app_id,
                object_type="app",
                permission=Permission.VIEW_EVALUATION,
            )
            logger.debug(
                f"User has permission to get single evaluation: {has_permission}"
            )
            if not has_permission:
                error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
                logger.error(error_msg)
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=403,
                )
        evaluations = await evaluation_service.fetch_evaluations_by_resource(
            resource_type, resource_ids
        )
        return list(map(lambda x: x.id, evaluations))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/", response_model=List[Evaluation], operation_id="create_evaluation")
async def create_evaluation(
    payload: NewEvaluation,
    request: Request,
):
    """Creates a new comparison table document
    Raises:
        HTTPException: _description_
    Returns:
        _description_
    """
    try:
        app = await db_manager.fetch_app_by_id(app_id=payload.app_id)
        if app is None:
            raise HTTPException(status_code=404, detail="App not found")

        if isCloudEE():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                object=app,
                permission=Permission.CREATE_EVALUATION,
            )
            logger.debug(f"User has permission to create evaluation: {has_permission}")
            if not has_permission:
                error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
                logger.error(error_msg)
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=403,
                )

        success, response = await check_ai_critique_inputs(
            payload.evaluators_configs, payload.lm_providers_keys
        )
        if not success:
            return response

        evaluations = []
        correct_answer_column = (
            "correct_answer"
            if payload.correct_answer_column is None
            else payload.correct_answer_column
        )

        for variant_id in payload.variant_ids:
            evaluation = await evaluation_service.create_new_evaluation(
                app_id=payload.app_id,
                variant_id=variant_id,
                evaluator_config_ids=payload.evaluators_configs,
                testset_id=payload.testset_id,
            )

            evaluate.delay(
                app_id=payload.app_id,
                variant_id=variant_id,
                evaluators_config_ids=payload.evaluators_configs,
                testset_id=payload.testset_id,
                evaluation_id=evaluation.id,
                rate_limit_config=payload.rate_limit.dict(),
                lm_providers_keys=payload.lm_providers_keys,
                correct_answer_column=correct_answer_column,
            )
            evaluations.append(evaluation)

        return evaluations
    except KeyError:
        raise HTTPException(
            status_code=400,
            detail="columns in the test set should match the names of the inputs in the variant",
        )


@router.post("/re-run/{evaluation_ids}/", operation_id="re_run_evaluation")
async def re_run_evaluation(
    evaluation_ids: str,
    app_id: str,
    payload: RerunEvaluation,
    request: Request,
):
    """Re-runs the evaluations for the given evaluation IDs and increments their rerun count.
    Raises:
        HTTPException: If the app is not found or the user lacks permissions.
    Returns:
        HTTP response indicating the operation's outcome.
    """
    try:
        app = await db_manager.fetch_app_by_id(app_id)
        print(app)
        if app is None:
            raise HTTPException(status_code=404, detail="App not found")

        if isCloudEE():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                object=app,
                permission=Permission.CREATE_EVALUATION,
            )
            logger.debug(f"User has permission to create evaluation: {has_permission}")
            if not has_permission:
                error_msg = "You do not have permission to perform this action. Please contact your organization admin."
                logger.error(error_msg)
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=403,
                )

        evaluation_ids = evaluation_ids.split(',')

        rate_limit_config = {
            'batch_size': 10,
            'max_retries': 3,
            'retry_delay': 3,
            'delay_between_batches': 5
        }

        for evaluation_id in evaluation_ids:
            evaluation = await db_manager.fetch_evaluation_by_id(evaluation_id)

            await evaluation.increase_rerun_count()

            evaluate.delay(
                app_id=app_id,
                variant_id=str(evaluation.variant),
                evaluators_config_ids=[str(config_id) for config_id in evaluation.evaluators_configs],
                testset_id=str(evaluation.testset.id),
                evaluation_id=evaluation_id,
                rate_limit_config=rate_limit_config,
                lm_providers_keys=payload.lm_providers_keys,
                correct_answer_column="correct_answer",
            )

        return Response(status_code=status.HTTP_200_OK)
    except KeyError:
        raise HTTPException(
            status_code=400,
            detail="columns in the test set should match the names of the inputs in the variant",
        )


@router.get("/{evaluation_id}/status/", operation_id="fetch_evaluation_status")
async def fetch_evaluation_status(evaluation_id: str, request: Request):
    """Fetches the status of the evaluation.

    Args:
        evaluation_id (str): the evaluation id
        request (Request): the request object

    Returns:
        (str): the evaluation status
    """

    try:
        evaluation = await db_manager.fetch_evaluation_by_id(evaluation_id)
        if isCloudEE():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                object=evaluation,
                permission=Permission.VIEW_EVALUATION,
            )
            logger.debug(
                f"User has permission to fetch evaluation status: {has_permission}"
            )
            if not has_permission:
                error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
                logger.error(error_msg)
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=403,
                )

        return {"status": evaluation.status}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/{evaluation_id}/results/", operation_id="fetch_evaluation_results")
async def fetch_evaluation_results(evaluation_id: str, request: Request):
    """Fetches the results of the evaluation

    Args:
        evaluation_id (str): the evaluation id
        request (Request): the request object

    Returns:
        _type_: _description_
    """

    try:
        evaluation = await db_manager.fetch_evaluation_by_id(evaluation_id)
        if isCloudEE():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                object=evaluation,
                permission=Permission.VIEW_EVALUATION,
            )
            logger.debug(
                f"User has permission to get evaluation results: {has_permission}"
            )
            if not has_permission:
                error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
                logger.error(error_msg)
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=403,
                )

        results = await converters.aggregated_result_to_pydantic(
            evaluation.aggregated_results
        )
        return {"results": results, "evaluation_id": evaluation_id}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get(
    "/{evaluation_id}/evaluation_scenarios/",
    response_model=List[EvaluationScenario],
    operation_id="fetch_evaluation_scenarios",
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

    try:
        evaluation = await db_manager.fetch_evaluation_by_id(evaluation_id)
        if isCloudEE():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                object=evaluation,
                permission=Permission.VIEW_EVALUATION,
            )
            logger.debug(
                f"User has permission to get evaluation scenarios: {has_permission}"
            )
            if not has_permission:
                error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
                logger.error(error_msg)
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=403,
                )

        eval_scenarios = (
            await evaluation_service.fetch_evaluation_scenarios_for_evaluation(
                evaluation=evaluation
            )
        )
        return eval_scenarios

    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/", response_model=List[Evaluation])
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
    try:
        app = await db_manager.fetch_app_by_id(app_id)
        if isCloudEE():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                object=app,
                permission=Permission.VIEW_EVALUATION,
            )
            logger.debug(
                f"User has permission to get list of evaluations: {has_permission}"
            )
            if not has_permission:
                error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
                logger.error(error_msg)
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=403,
                )

        return await evaluation_service.fetch_list_evaluations(app)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get(
    "/{evaluation_id}/", response_model=Evaluation, operation_id="fetch_evaluation"
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
    try:
        evaluation = await db_manager.fetch_evaluation_by_id(evaluation_id)
        if isCloudEE():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                object_id=evaluation_id,
                object_type="evaluation",
                permission=Permission.VIEW_EVALUATION,
            )
            logger.debug(
                f"User has permission to get single evaluation: {has_permission}"
            )
            if not has_permission:
                error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
                logger.error(error_msg)
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=403,
                )

        return await converters.evaluation_db_to_pydantic(evaluation)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/", response_model=List[str], operation_id="delete_evaluations")
async def delete_evaluations(
    delete_evaluations: DeleteEvaluation,
    request: Request,
):
    """
    Delete specific comparison tables based on their unique IDs.

    Args:
    delete_evaluations (List[str]): The unique identifiers of the comparison tables to delete.

    Returns:
    A list of the deleted comparison tables' IDs.
    """

    try:
        if isCloudEE():
            for evaluation_id in delete_evaluations.evaluations_ids:
                has_permission = await check_action_access(
                    user_uid=request.state.user_id,
                    object_id=evaluation_id,
                    object_type="evaluation",
                    permission=Permission.DELETE_EVALUATION,
                )
                logger.debug(
                    f"User has permission to delete evaluation: {has_permission}"
                )
                if not has_permission:
                    error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
                    logger.error(error_msg)
                    return JSONResponse(
                        {"detail": error_msg},
                        status_code=403,
                    )

        await evaluation_service.delete_evaluations(delete_evaluations.evaluations_ids)
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post(
    "/webhook_example_fake/",
    response_model=EvaluationWebhook,
    operation_id="webhook_example_fake",
)
async def webhook_example_fake():
    """Returns a fake score response for example webhook evaluation

    Returns:
        _description_
    """

    # return a random score b/w 0 and 1
    random_generator = secrets.SystemRandom()
    random_number = random_generator.random()
    return {"score": random_number}


@router.get(
    "/evaluation_scenarios/comparison-results/",
    response_model=Any,
)
async def fetch_evaluation_scenarios(
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
    try:
        evaluations_ids_list = evaluations_ids.split(",")

        if isCloudEE():
            for evaluation_id in evaluations_ids_list:
                has_permission = await check_action_access(
                    user_uid=request.state.user_id,
                    object_id=evaluation_id,
                    object_type="evaluation",
                    permission=Permission.VIEW_EVALUATION,
                )
                logger.debug(
                    f"User has permission to get evaluation scenarios: {has_permission}"
                )
                if not has_permission:
                    error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
                    logger.error(error_msg)
                    return JSONResponse(
                        {"detail": error_msg},
                        status_code=403,
                    )

        eval_scenarios = await evaluation_service.compare_evaluations_scenarios(
            evaluations_ids_list
        )

        return eval_scenarios
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
