import os
import secrets
from typing import List, Dict

from fastapi.responses import JSONResponse
from fastapi.encoders import jsonable_encoder
from fastapi import HTTPException, APIRouter, Body, Request, status, Response

from agenta_backend.models.api.evaluation_model import (
    DeleteEvaluation,
    EvaluationScenarioScoreUpdate,
    HumanEvaluation,
    HumanEvaluationScenarioUpdate,
    EvaluationType,
    NewHumanEvaluation,
    SimpleEvaluationOutput,
)

from agenta_backend.services import evaluation_service
from agenta_backend.utils.common import check_access_to_app
from agenta_backend.services import db_manager
from agenta_backend.models import converters
from agenta_backend.services import results_service
from agenta_backend.tasks.evaluations import evaluate


if os.environ["FEATURE_FLAG"] in ["cloud", "ee"]:
    from agenta_backend.commons.services.selectors import (  # noqa pylint: disable-all
        get_user_and_org_id,
    )
else:
    from agenta_backend.services.selectors import get_user_and_org_id

router = APIRouter()


@router.post(
    "/", response_model=SimpleEvaluationOutput, operation_id="create_evaluation"
)
async def create_evaluation(
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
        user_org_data: dict = await get_user_and_org_id(request.state.user_id)
        access_app = await check_access_to_app(
            user_org_data=user_org_data,
            app_id=payload.app_id,
            check_owner=False,
        )
        if not access_app:
            error_msg = f"You do not have access to this app: {payload.app_id}"
            return JSONResponse(
                {"detail": error_msg},
                status_code=400,
            )
        app = await db_manager.fetch_app_by_id(app_id=payload.app_id)

        if app is None:
            raise HTTPException(status_code=404, detail="App not found")

        new_evaluation_db = await evaluation_service.create_new_human_evaluation(
            payload, **user_org_data
        )
        print(new_evaluation_db)
        return converters.evaluation_db_to_simple_evaluation_output(new_evaluation_db)
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
    user_org_data = await get_user_and_org_id(request.state.user_id)
    return await evaluation_service.fetch_list_human_evaluations(
        app_id=app_id, **user_org_data
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
    user_org_data = await get_user_and_org_id(request.state.user_id)
    return await evaluation_service.fetch_human_evaluation(
        evaluation_id, **user_org_data
    )


@router.put(
    "/{evaluation_id}/evaluation_scenario/{evaluation_scenario_id}/{evaluation_type}/"
)
async def update_evaluation_scenario_router(
    evaluation_id: str,
    evaluation_scenario_id: str,
    evaluation_type: EvaluationType,
    evaluation_scenario: HumanEvaluationScenarioUpdate,
    request: Request,
):
    """Updates an evaluation scenario's vote or score based on its type.

    Raises:
        HTTPException: If update fails or unauthorized.

    Returns:
        None: 204 No Content status code upon successful update.
    """
    user_org_data = await get_user_and_org_id(request.state.user_id)
    try:
        await update_human_evaluation_scenario(
            evaluation_scenario_id,
            evaluation_scenario,
            evaluation_type,
            **user_org_data,
        )
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except UpdateEvaluationScenarioError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


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
    user_org_data = await get_user_and_org_id(request.state.user_id)
    return await get_evaluation_scenario_score(evaluation_scenario_id, **user_org_data)


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
    user_org_data = await get_user_and_org_id(request.state.user_id)
    try:
        await update_evaluation_scenario_score(
            evaluation_scenario_id, payload.score, **user_org_data
        )
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


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

    # Get user and organization id
    print("are we here")
    user_org_data: dict = await get_user_and_org_id(request.state.user_id)
    evaluation = (
        await evaluation_service._fetch_human_evaluation_scenario_and_check_access(
            evaluation_id, **user_org_data
        )
    )
    print("really???")
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

    # Get user and organization id
    user_org_data: dict = await get_user_and_org_id(request.state.user_id)
    await evaluation_service.delete_evaluations(
        delete_evaluations.evaluations_ids, **user_org_data
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
