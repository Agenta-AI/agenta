import os
from bson import ObjectId
from datetime import datetime
from typing import List, Optional, Dict

from fastapi import HTTPException, APIRouter, Body, Depends
from fastapi.responses import JSONResponse

from agenta_backend.models.api.evaluation_model import (
    Evaluation,
    EvaluationScenario,
    CustomEvaluationOutput,
    EvaluationScenarioUpdate,
    NewEvaluation,
    DeleteEvaluation,
    EvaluationType,
    EvaluationStatus,
    StoreCustomEvaluation,
)
from agenta_backend.services.results_service import (
    fetch_results_for_human_a_b_testing_evaluation,
    fetch_results_for_auto_exact_match_evaluation,
    fetch_results_for_auto_similarity_match_evaluation,
    fetch_results_for_auto_ai_critique,
)
from agenta_backend.services.evaluation_service import (
    UpdateEvaluationScenarioError,
    fetch_custom_evaluations,
    update_evaluation_scenario,
    update_evaluation_status,
    create_new_evaluation,
    create_new_evaluation_scenario,
    store_custom_code_evaluation,
    execute_custom_code_evaluation,
)
from agenta_backend.services.db_manager import engine, query, get_user_object
from agenta_backend.models.db_models import EvaluationDB, EvaluationScenarioDB
from agenta_backend.config import settings

if os.environ["FEATURE_FLAG"] in ["cloud", "ee", "demo"]:
    from agenta_backend.ee.services.auth_helper import (
        SessionContainer,
        verify_session,
    )
    from agenta_backend.ee.services.selectors import get_user_and_org_id
else:
    from agenta_backend.services.auth_helper import (
        SessionContainer,
        verify_session,
    )
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
    evaluation_id: str,
    update_data: EvaluationStatus = Body(...),
    stoken_session: SessionContainer = Depends(verify_session()),
):
    """Updates an evaluation status
    Raises:
        HTTPException: _description_
    Returns:
        _description_
    """
    try:
        # Get user and organization id
        kwargs: dict = await get_user_and_org_id(stoken_session)
        return await update_evaluation_status(
            evaluation_id, update_data, **kwargs
        )
    except KeyError:
        raise HTTPException(
            status_code=400,
            detail="columns in the test set should match the names of the inputs in the variant",
        )


@router.get(
    "/{evaluation_id}/evaluation_scenarios",
    response_model=List[EvaluationScenario],
)
async def fetch_evaluation_scenarios(
    evaluation_id: str,
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

    # Get user and organization id
    kwargs: dict = await get_user_and_org_id(stoken_session)
    user = await get_user_object(kwargs["uid"])

    # Create query expression builder
    query_expression = query.eq(
        EvaluationScenarioDB.evaluation_id, evaluation_id
    ) & query.eq(EvaluationScenarioDB.user, user.id)

    scenarios = await engine.find(EvaluationScenarioDB, query_expression)
    eval_scenarios = [
        EvaluationScenario(
            evaluation_id=scenario.evaluation_id,
            inputs=scenario.inputs,
            outputs=scenario.outputs,
            vote=scenario.vote,
            score=scenario.score,
            correct_answer=scenario.correct_answer,
            id=str(scenario.id),
        )
        for scenario in scenarios
    ]
    return eval_scenarios


@router.post(
    "/{evaluation_id}/evaluation_scenario", response_model=EvaluationScenario
)
async def create_evaluation_scenario(
    evaluation_id: str,
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
    result = await create_new_evaluation_scenario(
        evaluation_id, evaluation_scenario, **kwargs
    )
    if result is not None:
        return result
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
            evaluation_scenario_id,
            evaluation_scenario,
            evaluation_type,
            **kwargs,
        )
    except UpdateEvaluationScenarioError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/", response_model=List[Evaluation])
async def fetch_list_evaluations(
    app_name: Optional[str] = None,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    """lists of all comparison tables

    Returns:
        _description_
    """

    # Get user and organization id
    kwargs: dict = await get_user_and_org_id(stoken_session)
    user = await get_user_object(kwargs["uid"])

    # Construct query expression builder
    query_expression = query.eq(EvaluationDB.app_name, app_name) & query.eq(
        EvaluationDB.user, user.id
    )
    evaluations = await engine.find(EvaluationDB, query_expression)
    return [
        Evaluation(
            id=str(evaluation.id),
            status=evaluation.status,
            evaluation_type=evaluation.evaluation_type,
            evaluation_type_settings=evaluation.evaluation_type_settings,
            llm_app_prompt_template=evaluation.llm_app_prompt_template,
            variants=evaluation.variants,
            app_name=evaluation.app_name,
            testset=evaluation.testset,
            created_at=evaluation.created_at,
            updated_at=evaluation.updated_at,
        )
        for evaluation in evaluations
    ]


@router.get("/{evaluation_id}", response_model=Evaluation)
async def fetch_evaluation(
    evaluation_id: str,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    """Fetch one comparison table

    Returns:
        _description_
    """

    # Get user and organization id
    kwargs: dict = await get_user_and_org_id(stoken_session)
    user = await get_user_object(kwargs["uid"])

    # Construct query expression builder
    query_expression = query.eq(
        EvaluationDB.id, ObjectId(evaluation_id)
    ) & query.eq(EvaluationDB.user, user.id)
    evaluation = await engine.find_one(EvaluationDB, query_expression)
    if evaluation is not None:
        return Evaluation(
            id=str(evaluation.id),
            status=evaluation.status,
            evaluation_type=evaluation.evaluation_type,
            evaluation_type_settings=evaluation.evaluation_type_settings,
            llm_app_prompt_template=evaluation.llm_app_prompt_template,
            variants=evaluation.variants,
            app_name=evaluation.app_name,
            testset=evaluation.testset,
            created_at=evaluation.created_at,
            updated_at=evaluation.updated_at,
        )
    else:
        raise HTTPException(
            status_code=404,
            detail=f"dataset with id {evaluation_id} not found",
        )


@router.delete("/", response_model=List[str])
async def delete_evaluations(
    delete_evaluations: DeleteEvaluation,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    """
    Delete specific comparison tables based on their unique IDs.

    Args:
    delete_evaluations (List[str]): The unique identifiers of the comparison tables to delete.

    Returns:
    A list of the deleted comparison tables' IDs.
    """

    # Get user and organization id
    kwargs: dict = await get_user_and_org_id(stoken_session)
    user = await get_user_object(kwargs["uid"])

    deleted_ids = []
    for evaluations_id in delete_evaluations.evaluations_ids:
        # Construct query expression builder
        query_expression = query.eq(
            EvaluationDB.id, ObjectId(evaluations_id)
        ) & query.eq(EvaluationDB.user, user.id)
        evaluation = await engine.find_one(EvaluationDB, query_expression)

        if evaluation is not None:
            await engine.delete(evaluation)
            deleted_ids.append(evaluations_id)
        else:
            raise HTTPException(
                status_code=404,
                detail=f"Comparison table {evaluations_id} not found",
            )

    return deleted_ids


@router.get("/{evaluation_id}/results")
async def fetch_results(
    evaluation_id: str,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    """Fetch all the results for one the comparison table

    Arguments:
        evaluation_id -- _description_

    Returns:
        _description_
    """

    # Get user and organization id
    kwargs: dict = await get_user_and_org_id(stoken_session)
    user = await get_user_object(kwargs["uid"])

    # Construct query expression builder and retrieve evaluation from database
    query_expression = query.eq(
        EvaluationDB.id, ObjectId(evaluation_id)
    ) & query.eq(EvaluationDB.user, user.id)
    evaluation = await engine.find_one(EvaluationDB, query_expression)

    if evaluation.evaluation_type == EvaluationType.human_a_b_testing:
        results = await fetch_results_for_human_a_b_testing_evaluation(
            evaluation_id, evaluation.variants
        )
        # TODO: replace votes_data by results_data
        return {"votes_data": results}

    elif evaluation.evaluation_type == EvaluationType.auto_exact_match:
        results = await fetch_results_for_auto_exact_match_evaluation(
            evaluation_id, evaluation.variants
        )
        return {"scores_data": results}

    elif evaluation.evaluation_type == EvaluationType.auto_similarity_match:
        results = await fetch_results_for_auto_similarity_match_evaluation(
            evaluation_id, evaluation.variants
        )
        return {"scores_data": results}

    elif evaluation.evaluation_type == EvaluationType.auto_ai_critique:
        results = await fetch_results_for_auto_ai_critique(evaluation_id)
        return {"results_data": results}


@router.post("/custom_evaluation/store/")
async def store_custom_evaluation(
    custom_evaluation_payload: StoreCustomEvaluation,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    """Store evaluation with custom python code.

    Args:
        \n custom_evaluation_payload (StoreCustomEvaluation): payload schema required
        \n stoken_session (SessionContainer, optional): session token to verify user session. Defaults to Depends(verify_session()).
    """

    # Get user and organization id
    kwargs: dict = await get_user_and_org_id(stoken_session)

    # Store custom evaluation in database
    evaluation_id = await store_custom_code_evaluation(
        custom_evaluation_payload, **kwargs
    )

    return JSONResponse(
        {
            "status": "success",
            "message": "Evaluation stored successfully.",
            "evaluation_id": evaluation_id,
        },
        status_code=200,
    )


@router.get(
    "/custom_evaluation/list/{app_name}",
    response_model=List[CustomEvaluationOutput],
)
async def list_custom_evaluations(
    app_name: str,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    # Get user and organization id
    kwargs: dict = await get_user_and_org_id(stoken_session)

    # Fetch custom evaluations from database
    evaluations = await fetch_custom_evaluations(app_name, **kwargs)
    return evaluations


@router.post(
    "/custom_evaluation/execute/{evaluation_id}/",
)
async def execute_custom_evaluation(
    evaluation_id: str,
    parameters:Dict[str, str],
    inputs: Dict[str, str],
    correct_answer:float,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    # Get user and organization id
    kwargs: dict = await get_user_and_org_id(stoken_session)

    # Excute custom code evaluation
    result = await execute_custom_code_evaluation(evaluation_id, **kwargs)
    return result
