import random
import logging
from typing import List, Dict, Optional
from fastapi import HTTPException, Body, Request, status, Response

from oss.src.models import converters

from oss.src.services import results_service
from oss.src.services import evaluation_service
from oss.src.services import db_manager, app_manager
from oss.src.utils.common import APIRouter, isCloudEE

from oss.src.models.api.evaluation_model import (
    DeleteEvaluation,
    EvaluationScenarioScoreUpdate,
    HumanEvaluation,
    HumanEvaluationScenario,
    HumanEvaluationScenarioUpdate,
    EvaluationType,
    HumanEvaluationUpdate,
    NewHumanEvaluation,
    SimpleEvaluationOutput,
)

from oss.src.services.evaluation_service import (
    UpdateEvaluationScenarioError,
    update_human_evaluation_scenario,
    update_human_evaluation_service,
)

if isCloudEE():
    from ee.src.models.shared_models import (
        Permission,
    )  # noqa pylint: disable-all
    from ee.src.utils.permissions import (
        check_action_access,
    )  # noqa pylint: disable-all

router = APIRouter()
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


@router.post(
    "/", response_model=SimpleEvaluationOutput, operation_id="create_human_evaluation"
)
async def create_human_evaluation(
    payload: NewHumanEvaluation,
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
                project_id=str(app.project_id),
                permission=Permission.CREATE_EVALUATION,
            )
            if not has_permission:
                error_msg = f"You do not have permission to perform this action. Please contact your Organization Admin."
                raise HTTPException(
                    detail=error_msg,
                    status_code=403,
                )

        new_human_evaluation_db = await evaluation_service.create_new_human_evaluation(
            payload
        )
        return await converters.human_evaluation_db_to_simple_evaluation_output(
            new_human_evaluation_db
        )
    except KeyError:
        raise HTTPException(
            status_code=400,
            detail="columns in the test set should match the names of the inputs in the variant",
        )


@router.get("/", response_model=List[HumanEvaluation])
async def fetch_list_human_evaluations(
    app_id: str,
    request: Request,
):
    """Fetches a list of evaluations, optionally filtered by an app ID.

    Args:
        app_id (Optional[str]): An optional app ID to filter the evaluations.

    Returns:
        List[HumanEvaluation]: A list of evaluations.
    """

    app = await db_manager.fetch_app_by_id(app_id=app_id)
    if isCloudEE():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=str(app.project_id),
            permission=Permission.VIEW_EVALUATION,
        )
        if not has_permission:
            error_msg = f"You do not have permission to perform this action. Please contact your Organization Admin."
            raise HTTPException(
                detail=error_msg,
                status_code=403,
            )

    return await evaluation_service.fetch_list_human_evaluations(
        app_id, str(app.project_id)
    )


@router.get("/{evaluation_id}/", response_model=HumanEvaluation)
async def fetch_human_evaluation(
    evaluation_id: str,
    request: Request,
):
    """Fetches a single evaluation based on its ID.

    Args:
        evaluation_id (str): The ID of the evaluation to fetch.

    Returns:
        HumanEvaluation: The fetched evaluation.
    """

    human_evaluation = await db_manager.fetch_human_evaluation_by_id(evaluation_id)
    if not human_evaluation:
        raise HTTPException(status_code=404, detail="Evaluation not found")

    if isCloudEE():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=str(human_evaluation.project_id),
            permission=Permission.VIEW_EVALUATION,
        )
        if not has_permission:
            error_msg = f"You do not have permission to perform this action. Please contact your Organization Admin."
            raise HTTPException(
                detail=error_msg,
                status_code=403,
            )

    return await evaluation_service.fetch_human_evaluation(human_evaluation)


@router.get(
    "/{evaluation_id}/evaluation_scenarios/",
    response_model=List[HumanEvaluationScenario],
    operation_id="fetch_human_evaluation_scenarios",
)
async def fetch_human_evaluation_scenarios(
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

    human_evaluation = await db_manager.fetch_human_evaluation_by_id(evaluation_id)
    if human_evaluation is None:
        raise HTTPException(
            status_code=404,
            detail=f"Evaluation with id {evaluation_id} not found",
        )

    if isCloudEE():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=str(human_evaluation.project_id),
            permission=Permission.VIEW_EVALUATION,
        )
        if not has_permission:
            error_msg = f"You do not have permission to perform this action. Please contact your Organization Admin."
            raise HTTPException(
                detail=error_msg,
                status_code=403,
            )

    eval_scenarios = (
        await evaluation_service.fetch_human_evaluation_scenarios_for_evaluation(
            human_evaluation
        )
    )

    return eval_scenarios


@router.put("/{evaluation_id}/", operation_id="update_human_evaluation")
async def update_human_evaluation(
    request: Request,
    evaluation_id: str,
    update_data: HumanEvaluationUpdate = Body(...),
):
    """Updates an evaluation's status.

    Raises:
        HTTPException: If the columns in the test set do not match with the inputs in the variant.

    Returns:
        None: A 204 No Content status code, indicating that the update was successful.
    """

    try:
        human_evaluation = await db_manager.fetch_human_evaluation_by_id(evaluation_id)
        if not human_evaluation:
            raise HTTPException(status_code=404, detail="Evaluation not found")

        if isCloudEE():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                project_id=str(human_evaluation.project_id),
                permission=Permission.EDIT_EVALUATION,
            )
            if not has_permission:
                error_msg = f"You do not have permission to perform this action. Please contact your Organization Admin."
                raise HTTPException(
                    detail=error_msg,
                    status_code=403,
                )

        await update_human_evaluation_service(human_evaluation, update_data)
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    except KeyError:
        raise HTTPException(
            status_code=400,
            detail="columns in the test set should match the names of the inputs in the variant",
        )


@router.put(
    "/{evaluation_id}/evaluation_scenario/{evaluation_scenario_id}/{evaluation_type}/"
)
async def update_evaluation_scenario_router(
    evaluation_id: str,
    evaluation_scenario_id: str,
    evaluation_type: EvaluationType,
    payload: HumanEvaluationScenarioUpdate,
    request: Request,
):
    """Updates an evaluation scenario's vote or score based on its type.

    Raises:
        HTTPException: If update fails or unauthorized.

    Returns:
        None: 204 No Content status code upon successful update.
    """

    evaluation_scenario_db = await db_manager.fetch_human_evaluation_scenario_by_id(
        evaluation_scenario_id
    )
    if evaluation_scenario_db is None:
        raise HTTPException(
            status_code=404,
            detail=f"Evaluation scenario with id {evaluation_scenario_id} not found",
        )

    if isCloudEE():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=str(evaluation_scenario_db.project_id),
            permission=Permission.EDIT_EVALUATION,
        )
        if not has_permission:
            error_msg = f"You do not have permission to perform this action. Please contact your Organization Admin."
            raise HTTPException(
                detail=error_msg,
                status_code=403,
            )

    await update_human_evaluation_scenario(
        evaluation_scenario_db,
        payload,
        evaluation_type,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/evaluation_scenario/{evaluation_scenario_id}/score/")
async def get_evaluation_scenario_score_router(
    evaluation_scenario_id: str,
    request: Request,
) -> Dict[str, str]:
    """
    Fetch the score of a specific evaluation scenario.

    Args:
        evaluation_scenario_id: The ID of the evaluation scenario to fetch.
        stoken_session: Session data, verified by `verify_session`.

    Returns:
        Dictionary containing the scenario ID and its score.
    """

    evaluation_scenario = db_manager.fetch_evaluation_scenario_by_id(
        evaluation_scenario_id
    )
    if evaluation_scenario is None:
        raise HTTPException(
            status_code=404,
            detail=f"Evaluation scenario with id {evaluation_scenario_id} not found",
        )

    if isCloudEE():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=str(evaluation_scenario.project_id),
            permission=Permission.VIEW_EVALUATION,
        )
        if not has_permission:
            error_msg = f"You do not have permission to perform this action. Please contact your Organization Admin."
            raise HTTPException(
                detail=error_msg,
                status_code=403,
            )

    return {
        "scenario_id": str(evaluation_scenario.id),
        "score": evaluation_scenario.score,
    }


@router.put("/evaluation_scenario/{evaluation_scenario_id}/score/")
async def update_evaluation_scenario_score_router(
    evaluation_scenario_id: str,
    payload: EvaluationScenarioScoreUpdate,
    request: Request,
):
    """Updates the score of an evaluation scenario.

    Raises:
        HTTPException: Server error if the evaluation update fails.

    Returns:
        None: 204 No Content status code upon successful update.
    """

    evaluation_scenario = await db_manager.fetch_evaluation_scenario_by_id(
        evaluation_scenario_id
    )
    if evaluation_scenario is None:
        raise HTTPException(
            status_code=404,
            detail=f"Evaluation scenario with id {evaluation_scenario_id} not found",
        )

    if isCloudEE():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=str(evaluation_scenario.project_id),
            permission=Permission.VIEW_EVALUATION,
        )
        if not has_permission:
            error_msg = f"You do not have permission to perform this action. Please contact your Organization Admin."
            raise HTTPException(
                detail=error_msg,
                status_code=403,
            )

    await db_manager.update_human_evaluation_scenario(
        evaluation_scenario_id=str(evaluation_scenario.id),  # type: ignore
        values_to_update=payload.model_dump(),
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{evaluation_id}/results/", operation_id="fetch_results")
async def fetch_results(
    evaluation_id: str,
    request: Request,
):
    """Fetch all the results for one the comparison table

    Arguments:
        evaluation_id -- _description_

    Returns:
        _description_
    """

    evaluation = await db_manager.fetch_human_evaluation_by_id(evaluation_id)
    if evaluation is None:
        raise HTTPException(
            status_code=404,
            detail=f"Evaluation with id {evaluation_id} not found",
        )
    if isCloudEE():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=str(evaluation.project_id),
            permission=Permission.VIEW_EVALUATION,
        )
        if not has_permission:
            error_msg = f"You do not have permission to perform this action. Please contact your Organization Admin."
            raise HTTPException(
                detail=error_msg,
                status_code=403,
            )

    if evaluation.evaluation_type == EvaluationType.human_a_b_testing:
        results = await results_service.fetch_results_for_evaluation(evaluation)
        return {"votes_data": results}

    elif evaluation.evaluation_type == EvaluationType.single_model_test:
        results = await results_service.fetch_results_for_single_model_test(
            evaluation_id
        )
        return {"results_data": results}


@router.delete("/", response_model=List[str])
async def delete_evaluations(
    payload: DeleteEvaluation,
    request: Request,
):
    """
    Delete specific comparison tables based on their unique IDs.

    Args:
        payload (List[str]): The unique identifiers of the comparison tables to delete.

    Returns:
    A list of the deleted comparison tables' IDs.
    """

    evaluation = await db_manager.fetch_human_evaluation_by_id(
        payload.evaluations_ids[0]
    )
    if isCloudEE():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=str(evaluation.project_id),
            permission=Permission.DELETE_EVALUATION,
        )
        if not has_permission:
            error_msg = f"You do not have permission to perform this action. Please contact your Organization Admin."
            raise HTTPException(
                detail=error_msg,
                status_code=403,
            )

    await evaluation_service.delete_human_evaluations(payload.evaluations_ids)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
