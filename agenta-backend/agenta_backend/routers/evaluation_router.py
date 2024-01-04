import os
import secrets
from typing import List

from fastapi.responses import JSONResponse
from fastapi.encoders import jsonable_encoder
from fastapi import HTTPException, Request, status, Response

from agenta_backend.utils.common import APIRouter
from agenta_backend.models.api.evaluation_model import (
    Evaluation,
    EvaluationScenario,
    NewEvaluation,
    DeleteEvaluation,
    EvaluationWebhook,
)
from agenta_backend.services import db_manager
from agenta_backend.tasks.evaluations import evaluate
from agenta_backend.services import evaluation_service
from agenta_backend.utils.common import check_access_to_app


if os.environ["FEATURE_FLAG"] in ["cloud", "ee"]:
    from agenta_backend.commons.services.selectors import (  # noqa pylint: disable-all
        get_user_and_org_id,
    )
else:
    from agenta_backend.services.selectors import get_user_and_org_id


# Initialize api router
router = APIRouter()


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

        app_data = jsonable_encoder(app)
        evaluations = []

        for variant_id in payload.variant_ids:
            new_evaluation_data = {
                "app_id": payload.app_id,
                "variant_ids": [variant_id],  # Only this variant ID
                "evaluators_configs": payload.evaluators_configs,
                "testset_id": payload.testset_id,
            }

            evaluation = await evaluation_service.create_new_evaluation(
                app_data=app_data,
                new_evaluation_data=new_evaluation_data,
                evaluators_configs=payload.evaluators_configs,
            )

            evaluate.delay(
                app_data, new_evaluation_data, evaluation.id, evaluation.testset_id
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
        # Get user and organization id
        user_org_data: dict = await get_user_and_org_id(request.state.user_id)
        evaluation = await evaluation_service.fetch_evaluation(
            evaluation_id, **user_org_data
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
        # Get user and organization id
        user_org_data: dict = await get_user_and_org_id(request.state.user_id)
        results = await evaluation_service.retrieve_evaluation_results(
            evaluation_id, **user_org_data
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

    user_org_data: dict = await get_user_and_org_id(request.state.user_id)
    eval_scenarios = await evaluation_service.fetch_evaluation_scenarios_for_evaluation(
        evaluation_id, **user_org_data
    )

    return eval_scenarios


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
    user_org_data = await get_user_and_org_id(request.state.user_id)
    return await evaluation_service.fetch_list_evaluations(
        app_id=app_id, **user_org_data
    )


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
    user_org_data = await get_user_and_org_id(request.state.user_id)
    return await evaluation_service.fetch_evaluation(evaluation_id, **user_org_data)


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

    # Get user and organization id
    user_org_data: dict = await get_user_and_org_id(request.state.user_id)
    await evaluation_service.delete_evaluations(
        delete_evaluations.evaluations_ids, **user_org_data
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


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
    response_model=List,
)
async def fetch_evaluation_scenarios(
    evaluations_ids: str,
    testset_id: str,
    app_variant_id: str,
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
    user_org_data: dict = await get_user_and_org_id(request.state.user_id)
    eval_scenarios = await evaluation_service.compare_evaluations_scenarios(
        evaluations_ids_list, testset_id, app_variant_id, **user_org_data
    )

    return eval_scenarios
