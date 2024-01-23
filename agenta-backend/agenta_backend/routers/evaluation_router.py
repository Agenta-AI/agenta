import os
import secrets
import logging

from typing import Any, List
from fastapi.responses import JSONResponse
from fastapi import HTTPException, Request, status, Response

from agenta_backend.utils.common import APIRouter
from agenta_backend.tasks.evaluations import evaluate
from agenta_backend.services import evaluation_service, db_manager

from agenta_backend.models.api.evaluation_model import (
    Evaluation,
    EvaluationScenario,
    LMProvidersEnum,
    NewEvaluation,
    DeleteEvaluation,
    EvaluationWebhook,
)

from agenta_backend.services.evaluator_manager import (
    check_ai_critique_inputs,
)

FEATURE_FLAG = os.environ["FEATURE_FLAG"]
if FEATURE_FLAG in ["cloud", "ee"]:
    from agenta_backend.commons.models.db_models import Permission
    from agenta_backend.commons.utils.permissions import check_action_access

router = APIRouter()
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


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
        if FEATURE_FLAG in ["cloud", "ee"]:
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                object_id=payload.app_id,
                object_type="app",
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

        app = await db_manager.fetch_app_by_id(app_id=payload.app_id)
        if app is None:
            raise HTTPException(status_code=404, detail="App not found")

        success, response = await check_ai_critique_inputs(
            payload.evaluators_configs, payload.lm_providers_keys
        )
        if not success:
            return response

        evaluations = []

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
            )
            evaluations.append(evaluation)

        return evaluations
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
        if FEATURE_FLAG in ["cloud", "ee"]:
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                object_id=evaluation_id,
                object_type="evaluation",
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

        evaluation = await evaluation_service.fetch_evaluation(evaluation_id)
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
        if FEATURE_FLAG in ["cloud", "ee"]:
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                object_id=evaluation_id,
                object_type="evaluation",
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

        results = await evaluation_service.retrieve_evaluation_results(evaluation_id)
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
        if FEATURE_FLAG in ["cloud", "ee"]:
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

        eval_scenarios = (
            await evaluation_service.fetch_evaluation_scenarios_for_evaluation(
                evaluation_id
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
        if FEATURE_FLAG in ["cloud", "ee"]:
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                object_id=app_id,
                object_type="app",
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

        return await evaluation_service.fetch_list_evaluations(app_id)
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
        if FEATURE_FLAG in ["cloud", "ee"]:
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

        return await evaluation_service.fetch_evaluation(evaluation_id)
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
        if FEATURE_FLAG in ["cloud", "ee"]:
            for evaluation_id in delete_evaluations.evaluations_ids:
                has_permission = await check_action_access(
                    user_uid=request.state.user_id,
                    object_id=evaluation_id,
                    object_type="evaluation",
                    permission=Permission.VIEW_EVALUATION,
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

        if FEATURE_FLAG in ["cloud", "ee"]:
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
