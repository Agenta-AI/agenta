from bson import ObjectId
from datetime import datetime
from typing import List, Optional

from fastapi import HTTPException, APIRouter, Body, Depends

from agenta_backend.models.api.evaluation_model import (
    Evaluation,
    EvaluationScenario,
    EvaluationScenarioUpdate,
    NewEvaluation,
    DeleteEvaluation,
    EvaluationType,
    EvaluationStatus,
)
from agenta_backend.services.results_service import (
    fetch_results_for_human_a_b_testing_evaluation,
    fetch_results_for_auto_exact_match_evaluation,
    fetch_results_for_auto_similarity_match_evaluation,
    fetch_results_for_auto_ai_critique,
)
from agenta_backend.services.evaluation_service import (
    UpdateEvaluationScenarioError,
    update_evaluation_scenario,
    update_evaluation_status,
    create_new_evaluation,
)
from agenta_backend.services.db_mongo import (
    evaluations,
    evaluation_scenarios,
)
from agenta_backend.config import settings

if settings.feature_flag in ["cloud", "ee", "demo"]:
    from agenta_backend.ee.services.auth_helper import SessionContainer, verify_session
    from agenta_backend.ee.services.selectors import get_user_and_org_id
else:
    from agenta_backend.services.auth_helper import SessionContainer, verify_session
    from agenta_backend.services.selectors import get_user_and_org_id


router = APIRouter()


@router.post("/", response_model=Evaluation)
async def create_evaluation(
    newEvaluationData: NewEvaluation = Body(...),
    stoken_session: SessionContainer = Depends(verify_session()),
):
    """Creates a new comparison table document
    Raises:
        HTTPException: _description_
    Returns:
        _description_
    """
    try:
        # Get user and organization id
        kwargs: dict = await get_user_and_org_id(stoken_session)
        return await create_new_evaluation(newEvaluationData, **kwargs)
    except KeyError:
        raise HTTPException(
            status_code=400,
            detail="columns in the test set should match the names of the inputs in the variant",
        )


@router.put("/{evaluation_id}", response_model=Evaluation)
async def update_evaluation_status_router(
    evaluation_id: str, update_data: EvaluationStatus = Body(...)
):
    """Updates an evaluation status
    Raises:
        HTTPException: _description_
    Returns:
        _description_
    """
    try:
        return await update_evaluation_status(evaluation_id, update_data.status)
    except KeyError:
        raise HTTPException(
            status_code=400,
            detail="columns in the test set should match the names of the inputs in the variant",
        )


@router.get(
    "/{evaluation_id}/evaluation_scenarios",
    response_model=List[EvaluationScenario],
)
async def fetch_evaluation_scenarios(evaluation_id: str):
    """Creates an empty evaluation row

    Arguments:
        evaluation_scenario -- _description_

    Raises:
        HTTPException: _description_

    Returns:
        _description_
    """
    cursor = evaluation_scenarios.find({"evaluation_id": evaluation_id})
    items = await cursor.to_list(length=100)  # limit length to 100 for the example
    for item in items:
        item["id"] = str(item["_id"])
    return items


@router.post("/{evaluation_id}/evaluation_scenario", response_model=EvaluationScenario)
async def create_evaluation_scenario(
    evaluation_scenario: EvaluationScenario,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    """Creates an empty evaluation row

    Arguments:
        evaluation_scenario -- _description_

    Raises:
        HTTPException: _description_

    Returns:
        _description_
    """
    evaluation_scenario_dict = evaluation_scenario.dict()
    evaluation_scenario_dict.pop("id", None)

    evaluation_scenario_dict["created_at"] = evaluation_scenario_dict[
        "updated_at"
    ] = datetime.utcnow()

    # Get user and organization id
    kwargs: dict = await get_user_and_org_id(stoken_session)
    evaluation_scenario_dict.update(kwargs)

    result = await evaluation_scenarios.insert_one(evaluation_scenario_dict)
    if result.acknowledged:
        evaluation_scenario_dict["id"] = str(result.inserted_id)
        return evaluation_scenario_dict
    else:
        raise HTTPException(
            status_code=500, detail="Failed to create evaluation_scenario"
        )


@router.put(
    "/{evaluation_id}/evaluation_scenario/{evaluation_scenario_id}/{evaluation_type}"
)
async def update_evaluation_scenario_router(
    evaluation_scenario_id: str,
    evaluation_type: EvaluationType,
    evaluation_scenario: EvaluationScenarioUpdate,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    """Updates an evaluation row with a vote

    Arguments:
        evaluation_scenario_id -- _description_
        evaluation_scenario -- _description_

    Raises:
        HTTPException: _description_

    Returns:
        _description_
    """
    try:
        # Get user and organization id
        kwargs: dict = await get_user_and_org_id(stoken_session)
        return await update_evaluation_scenario(
            evaluation_scenario_id, evaluation_scenario, evaluation_type, **kwargs
        )
    except UpdateEvaluationScenarioError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/", response_model=List[Evaluation])
async def fetch_list_evaluations(app_name: Optional[str] = None):
    """lists of all comparison tables

    Returns:
        _description_
    """
    cursor = evaluations.find({"app_name": app_name}).sort("created_at", -1)
    items = await cursor.to_list(length=100)  # limit length to 100 for the example
    for item in items:
        item["id"] = str(item["_id"])
    return items


@router.get("/{evaluation_id}", response_model=Evaluation)
async def fetch_evaluation(evaluation_id: str):
    """Fetch one comparison table

    Returns:
        _description_
    """
    evaluation = await evaluations.find_one({"_id": ObjectId(evaluation_id)})
    if evaluation:
        evaluation["id"] = str(evaluation["_id"])
        return evaluation
    else:
        raise HTTPException(
            status_code=404,
            detail=f"dataset with id {evaluation_id} not found",
        )


@router.delete("/", response_model=List[str])
async def delete_evaluations(delete_evaluations: DeleteEvaluation):
    """
    Delete specific comparison tables based on their unique IDs.

    Args:
    delete_evaluations (List[str]): The unique identifiers of the comparison tables to delete.

    Returns:
    A list of the deleted comparison tables' IDs.
    """
    deleted_ids = []

    for evaluations_id in delete_evaluations.evaluations_ids:
        evaluation = await evaluations.find_one({"_id": ObjectId(evaluations_id)})

        if evaluation is not None:
            result = await evaluations.delete_one({"_id": ObjectId(evaluations_id)})
            if result:
                deleted_ids.append(evaluations_id)
        else:
            raise HTTPException(
                status_code=404,
                detail=f"Comparison table {evaluations_id} not found",
            )

    return deleted_ids


@router.get("/{evaluation_id}/results")
async def fetch_results(evaluation_id: str):
    """Fetch all the results for one the comparison table

    Arguments:
        evaluation_id -- _description_

    Returns:
        _description_
    """
    evaluation = await evaluations.find_one({"_id": ObjectId(evaluation_id)})

    if evaluation["evaluation_type"] == EvaluationType.human_a_b_testing:
        results = await fetch_results_for_human_a_b_testing_evaluation(
            evaluation_id, evaluation.get("variants", [])
        )
        # TODO: replace votes_data by results_data
        return {"votes_data": results}

    elif evaluation["evaluation_type"] == EvaluationType.auto_exact_match:
        results = await fetch_results_for_auto_exact_match_evaluation(
            evaluation_id, evaluation.get("variant", [])
        )
        return {"scores_data": results}

    elif evaluation["evaluation_type"] == EvaluationType.auto_similarity_match:
        results = await fetch_results_for_auto_similarity_match_evaluation(
            evaluation_id, evaluation.get("variant", [])
        )
        return {"scores_data": results}

    elif evaluation["evaluation_type"] == EvaluationType.auto_ai_critique:
        results = await fetch_results_for_auto_ai_critique(evaluation_id)
        return {"results_data": results}
