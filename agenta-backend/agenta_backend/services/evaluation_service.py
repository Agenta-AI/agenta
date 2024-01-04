import logging
from bson import ObjectId
from datetime import datetime
from typing import Dict, List, Any

from fastapi import HTTPException

from agenta_backend.models.api.evaluation_model import (
    CustomEvaluationNames,
    Evaluation,
    EvaluationScenario,
    CustomEvaluationOutput,
    CustomEvaluationDetail,
    EvaluationScenarioInput,
    EvaluationType,
    EvaluationTypeSettings,
    HumanEvaluation,
    HumanEvaluationScenario,
    HumanEvaluationUpdate,
    NewEvaluation,
    EvaluationScenarioUpdate,
    CreateCustomEvaluation,
    EvaluationStatusEnum,
    NewHumanEvaluation,
)
from agenta_backend.models import converters
from agenta_backend.services import db_manager
from agenta_backend.services.db_manager import fetch_app_variant_by_id, query, get_user
from agenta_backend.utils.common import engine, check_access_to_app
from agenta_backend.services.security.sandbox import execute_code_safely
from agenta_backend.models.db_models import (
    AppVariantDB,
    EvaluationDB,
    EvaluationScenarioDB,
    HumanEvaluationDB,
    HumanEvaluationScenarioDB,
    HumanEvaluationScenarioInput,
    HumanEvaluationScenarioOutput,
    UserDB,
    AppDB,
    CustomEvaluationDB,
)

from langchain.chains import LLMChain
from langchain.llms import OpenAI
from langchain.prompts import PromptTemplate

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


class UpdateEvaluationScenarioError(Exception):
    """Custom exception for update evaluation scenario errors."""

    pass


async def _fetch_evaluation_and_check_access(
    evaluation_id: str, **user_org_data: dict
) -> EvaluationDB:
    # Fetch the evaluation by ID
    evaluation = await db_manager.fetch_evaluation_by_id(evaluation_id=evaluation_id)

    # Check if the evaluation exists
    if evaluation is None:
        raise HTTPException(
            status_code=404,
            detail=f"Evaluation with id {evaluation_id} not found",
        )

    # Check for access rights
    access = await check_access_to_app(
        user_org_data=user_org_data, app_id=evaluation.app.id
    )
    if not access:
        raise HTTPException(
            status_code=403,
            detail=f"You do not have access to this app: {str(evaluation.app.id)}",
        )
    return evaluation


async def _fetch_human_evaluation_and_check_access(
    evaluation_id: str, **user_org_data: dict
) -> HumanEvaluationDB:
    # Fetch the evaluation by ID
    evaluation = await db_manager.fetch_human_evaluation_by_id(
        evaluation_id=evaluation_id
    )

    # Check if the evaluation exists
    if evaluation is None:
        raise HTTPException(
            status_code=404,
            detail=f"Evaluation with id {evaluation_id} not found",
        )

    # Check for access rights
    access = await check_access_to_app(
        user_org_data=user_org_data, app_id=evaluation.app.id
    )
    if not access:
        raise HTTPException(
            status_code=403,
            detail=f"You do not have access to this app: {str(evaluation.app.id)}",
        )
    return evaluation


async def _fetch_human_evaluation_scenario_and_check_access(
    evaluation_scenario_id: str, **user_org_data: dict
) -> HumanEvaluationDB:
    # Fetch the evaluation by ID
    evaluation_scenario = await db_manager.fetch_human_evaluation_scenario_by_id(
        evaluation_scenario_id=evaluation_scenario_id
    )

    print("evaluation_scenario")
    print(evaluation_scenario)
    if evaluation_scenario is None:
        raise HTTPException(
            status_code=404,
            detail=f"Evaluation scenario with id {evaluation_scenario_id} not found",
        )
    evaluation = evaluation_scenario.evaluation

    # Check if the evaluation exists
    if evaluation is None:
        raise HTTPException(
            status_code=404,
            detail=f"Evaluation scenario for evaluation scenario with id {evaluation_scenario_id} not found",
        )

    # Check for access rights
    access = await check_access_to_app(
        user_org_data=user_org_data, app_id=evaluation.app.id
    )
    if not access:
        raise HTTPException(
            status_code=403,
            detail=f"You do not have access to this app: {str(evaluation.app.id)}",
        )
    return evaluation_scenario


async def prepare_csvdata_and_create_evaluation_scenario(
    csvdata: List[Dict[str, str]],
    payload_inputs: List[str],
    evaluation_type: EvaluationType,
    new_evaluation: HumanEvaluationDB,
    user: UserDB,
    app: AppDB,
):
    """
    Prepares CSV data and creates evaluation scenarios based on the inputs, evaluation
    type, and other parameters provided.

    Args:
        csvdata: A list of dictionaries representing the CSV data.
        payload_inputs: A list of strings representing the names of the inputs in the variant.
        evaluation_type: The type of evaluation
        new_evaluation: The instance of EvaluationDB
        user: The owner of the evaluation scenario
        app: The app the evaluation is going to belong to
    """

    for datum in csvdata:
        # Check whether the inputs in the test set match the inputs in the variant
        try:
            inputs = [
                {"input_name": name, "input_value": datum[name]}
                for name in payload_inputs
            ]
        except KeyError:
            await engine.delete(new_evaluation)
            msg = f"""
            Columns in the test set should match the names of the inputs in the variant.
            Inputs names in variant are: {[variant_input for variant_input in payload_inputs]} while
            columns in test set are: {[col for col in datum.keys() if col != 'correct_answer']}
            """
            raise HTTPException(
                status_code=400,
                detail=msg,
            )
        # Create evaluation scenarios
        list_of_scenario_input = []
        for scenario_input in inputs:
            eval_scenario_input_instance = HumanEvaluationScenarioInput(
                input_name=scenario_input["input_name"],
                input_value=scenario_input["input_value"],
            )
            list_of_scenario_input.append(eval_scenario_input_instance)

        evaluation_scenario_payload = {
            **{
                "created_at": datetime.utcnow(),
                "updated_at": datetime.utcnow(),
            },
            **_extend_with_evaluation(evaluation_type),
            **_extend_with_correct_answer(evaluation_type, datum),
        }

        eval_scenario_instance = HumanEvaluationScenarioDB(
            **evaluation_scenario_payload,
            user=user,
            organization=app.organization,
            evaluation=new_evaluation,
            inputs=list_of_scenario_input,
            outputs=[],
        )
        await engine.save(eval_scenario_instance)


async def create_evaluation_scenario(
    evaluation_id: str, payload: EvaluationScenario, **user_org_data: dict
) -> None:
    """
    Create a new evaluation scenario.

    Args:
        evaluation_id (str): The ID of the evaluation.
        payload (EvaluationScenario): Evaluation scenario data.
        user_org_data (dict): User and organization data.

    Raises:
        HTTPException: If evaluation not found or access denied.
    """
    evaluation = await _fetch_evaluation_and_check_access(
        evaluation_id=evaluation_id, **user_org_data
    )

    scenario_inputs = [
        EvaluationScenarioInput(
            input_name=input_item.input_name,
            input_value=input_item.input_value,
        )
        for input_item in payload.inputs
    ]

    new_eval_scenario = EvaluationScenarioDB(
        user=evaluation.user,
        organization=evaluation.organization,
        evaluation=evaluation,
        inputs=scenario_inputs,
        outputs=[],
        is_pinned=False,
        note="",
        **_extend_with_evaluation(evaluation.evaluation_type),
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )

    await engine.save(new_eval_scenario)


async def update_human_evaluation_service(
    evaluation_id: str, update_payload: HumanEvaluationUpdate, **user_org_data: dict
) -> None:
    """
    Update an existing evaluation based on the provided payload.

    Args:
        evaluation_id (str): The existing evaluation ID.
        update_payload (EvaluationUpdate): The payload for the update.

    Raises:
        HTTPException: If the evaluation is not found or access is denied.
    """
    # Fetch the evaluation by ID
    evaluation = await _fetch_human_evaluation_and_check_access(
        evaluation_id=evaluation_id,
        **user_org_data,
    )

    # Prepare updates
    updates = {}
    if update_payload.status is not None:
        updates["status"] = update_payload.status

    if update_payload.evaluation_type_settings is not None:
        current_settings = evaluation.evaluation_type_settings
        new_settings = update_payload.evaluation_type_settings

        # Update only the fields that are explicitly set in the payload
        for field in EvaluationTypeSettings.__annotations__.keys():
            setattr(
                current_settings,
                field,
                getattr(new_settings, field, None)
                or getattr(current_settings, field, None),
            )

        updates["evaluation_type_settings"] = current_settings

    # Update the evaluation
    evaluation.update(updates)
    await engine.save(evaluation)


async def fetch_evaluation_scenarios_for_evaluation(
    evaluation_id: str, **user_org_data: dict
) -> List[EvaluationScenario]:
    """
    Fetch evaluation scenarios for a given evaluation ID.

    Args:
        evaluation_id (str): The ID of the evaluation.
        user_org_data (dict): User and organization data.

    Raises:
        HTTPException: If the evaluation is not found or access is denied.

    Returns:
        List[EvaluationScenario]: A list of evaluation scenarios.
    """
    evaluation = await _fetch_evaluation_and_check_access(
        evaluation_id=evaluation_id,
        **user_org_data,
    )
    scenarios = await engine.find(
        EvaluationScenarioDB,
        EvaluationScenarioDB.evaluation == ObjectId(evaluation.id),
    )
    eval_scenarios = [
        converters.evaluation_scenario_db_to_pydantic(scenario)
        for scenario in scenarios
    ]
    return eval_scenarios


async def fetch_human_evaluation_scenarios_for_evaluation(
    evaluation_id: str, **user_org_data: dict
) -> List[HumanEvaluationScenario]:
    """
    Fetch evaluation scenarios for a given evaluation ID.

    Args:
        evaluation_id (str): The ID of the evaluation.
        user_org_data (dict): User and organization data.

    Raises:
        HTTPException: If the evaluation is not found or access is denied.

    Returns:
        List[EvaluationScenario]: A list of evaluation scenarios.
    """
    evaluation = await _fetch_human_evaluation_and_check_access(
        evaluation_id=evaluation_id,
        **user_org_data,
    )
    print("$$$$$$ evaluation")
    print(evaluation)
    scenarios = await engine.find(
        HumanEvaluationScenarioDB,
        HumanEvaluationScenarioDB.evaluation == ObjectId(evaluation.id),
    )
    eval_scenarios = [
        converters.human_evaluation_scenario_db_to_pydantic(scenario)
        for scenario in scenarios
    ]
    return eval_scenarios


async def update_human_evaluation_scenario(
    evaluation_scenario_id: str,
    evaluation_scenario_data: EvaluationScenarioUpdate,
    evaluation_type: EvaluationType,
    **user_org_data,
) -> None:
    """
    Updates an evaluation scenario.

    Args:
        evaluation_scenario_id (str): The ID of the evaluation scenario.
        evaluation_scenario_data (EvaluationScenarioUpdate): New data for the scenario.
        evaluation_type (EvaluationType): Type of the evaluation.
        user_org_data (dict): User and organization data.

    Raises:
        HTTPException: If evaluation scenario not found or access denied.
    """
    eval_scenario = await _fetch_human_evaluation_scenario_and_check_access(
        evaluation_scenario_id=evaluation_scenario_id,
        **user_org_data,
    )

    updated_data = evaluation_scenario_data.dict()
    updated_data["updated_at"] = datetime.utcnow()
    new_eval_set = {}

    if updated_data["score"] is not None and evaluation_type in [
        EvaluationType.auto_exact_match,
        EvaluationType.auto_similarity_match,
        EvaluationType.auto_regex_test,
        EvaluationType.auto_webhook_test,
        EvaluationType.auto_ai_critique,
        EvaluationType.single_model_test,
    ]:
        new_eval_set["score"] = updated_data["score"]
    elif (
        updated_data["vote"] is not None
        and evaluation_type == EvaluationType.human_a_b_testing
    ):
        new_eval_set["vote"] = updated_data["vote"]
    elif evaluation_type == EvaluationType.custom_code_run:
        new_eval_set["correct_answer"] = updated_data["correct_answer"]

    if updated_data["outputs"] is not None:
        new_outputs = [
            HumanEvaluationScenarioOutput(
                variant_id=output["variant_id"],
                variant_output=output["variant_output"],
            ).dict()
            for output in updated_data["outputs"]
        ]
        new_eval_set["outputs"] = new_outputs

    if updated_data["inputs"] is not None:
        new_inputs = [
            HumanEvaluationScenarioInput(
                input_name=input_item["input_name"],
                input_value=input_item["input_value"],
            ).dict()
            for input_item in updated_data["inputs"]
        ]
        new_eval_set["inputs"] = new_inputs

    if updated_data["is_pinned"] is not None:
        new_eval_set["is_pinned"] = updated_data["is_pinned"]

    if updated_data["note"] is not None:
        new_eval_set["note"] = updated_data["note"]

    if updated_data["correct_answer"] is not None:
        new_eval_set["correct_answer"] = updated_data["correct_answer"]

    eval_scenario.update(new_eval_set)
    await engine.save(eval_scenario)


async def update_evaluation_scenario_score_service(
    evaluation_scenario_id: str, score: float, **user_org_data: dict
) -> None:
    """
    Updates the score of an evaluation scenario.

    Args:
        evaluation_scenario_id (str): The ID of the evaluation scenario.
        score (float): The new score to set.
        user_org_data (dict): User and organization data.

    Raises:
        HTTPException: If evaluation scenario not found or access denied.
    """
    eval_scenario = await _fetch_human_evaluation_scenario_and_check_access(
        evaluation_scenario_id, **user_org_data
    )
    eval_scenario.score = score

    # Save the updated evaluation scenario
    await engine.save(eval_scenario)


async def get_evaluation_scenario_score_service(
    evaluation_scenario_id: str, **user_org_data: dict
) -> Dict[str, str]:
    """
    Retrieve the score of a given evaluation scenario.

    Args:
        evaluation_scenario_id: The ID of the evaluation scenario.
        user_org_data: Additional user and organization data.

    Returns:
        Dictionary with 'scenario_id' and 'score' keys.
    """
    evaluation_scenario = await _fetch_human_evaluation_scenario_and_check_access(
        evaluation_scenario_id, **user_org_data
    )
    return {
        "scenario_id": str(evaluation_scenario.id),
        "score": evaluation_scenario.score,
    }


def _extend_with_evaluation(evaluation_type: EvaluationType):
    evaluation = {}
    if (
        evaluation_type == EvaluationType.auto_exact_match
        or evaluation_type == EvaluationType.auto_similarity_match
        or evaluation_type == EvaluationType.auto_regex_test
        or evaluation_type == EvaluationType.auto_webhook_test
        or evaluation_type == EvaluationType.single_model_test
        or EvaluationType.auto_ai_critique
    ):
        evaluation["score"] = ""

    if evaluation_type == EvaluationType.human_a_b_testing:
        evaluation["vote"] = ""
    return evaluation


def _extend_with_correct_answer(evaluation_type: EvaluationType, row: dict):
    correct_answer = {}
    if (
        evaluation_type == EvaluationType.auto_exact_match
        or evaluation_type == EvaluationType.auto_similarity_match
        or evaluation_type == EvaluationType.auto_regex_test
        or evaluation_type == EvaluationType.auto_ai_critique
        or evaluation_type == EvaluationType.auto_webhook_test
    ):
        if row["correct_answer"]:
            correct_answer["correct_answer"] = row["correct_answer"]
    return correct_answer


async def fetch_list_evaluations(
    app_id: str,
    **user_org_data: dict,
) -> List[Evaluation]:
    """
    Fetches a list of evaluations based on the provided filtering criteria.

    Args:
        app_id (Optional[str]): An optional app ID to filter the evaluations.
        user_org_data (dict): User and organization data.

    Returns:
        List[Evaluation]: A list of evaluations.
    """
    access = await check_access_to_app(user_org_data=user_org_data, app_id=app_id)
    if not access:
        raise HTTPException(
            status_code=403,
            detail=f"You do not have access to this app: {app_id}",
        )

    evaluations_db = await engine.find(
        EvaluationDB, EvaluationDB.app == ObjectId(app_id)
    )
    return [
        await converters.evaluation_db_to_pydantic(evaluation)
        for evaluation in evaluations_db
    ]


async def fetch_evaluation(evaluation_id: str, **user_org_data: dict) -> Evaluation:
    """
    Fetches a single evaluation based on its ID.

    Args:
        evaluation_id (str): The ID of the evaluation.
        user_org_data (dict): User and organization data.

    Returns:
        Evaluation: The fetched evaluation.
    """
    evaluation = await _fetch_evaluation_and_check_access(
        evaluation_id=evaluation_id, **user_org_data
    )
    return await converters.evaluation_db_to_pydantic(evaluation)


async def fetch_list_human_evaluations(
    app_id: str,
    **user_org_data: dict,
) -> List[HumanEvaluation]:
    """
    Fetches a list of evaluations based on the provided filtering criteria.

    Args:
        app_id (Optional[str]): An optional app ID to filter the evaluations.
        user_org_data (dict): User and organization data.

    Returns:
        List[Evaluation]: A list of evaluations.
    """
    access = await check_access_to_app(user_org_data=user_org_data, app_id=app_id)
    if not access:
        raise HTTPException(
            status_code=403,
            detail=f"You do not have access to this app: {app_id}",
        )

    evaluations_db = await engine.find(
        HumanEvaluationDB, HumanEvaluationDB.app == ObjectId(app_id)
    )
    return [
        await converters.human_evaluation_db_to_pydantic(evaluation)
        for evaluation in evaluations_db
    ]


async def fetch_human_evaluation(
    evaluation_id: str, **user_org_data: dict
) -> HumanEvaluation:
    """
    Fetches a single evaluation based on its ID.

    Args:
        evaluation_id (str): The ID of the evaluation.
        user_org_data (dict): User and organization data.

    Returns:
        Evaluation: The fetched evaluation.
    """
    evaluation = await _fetch_human_evaluation_and_check_access(
        evaluation_id=evaluation_id, **user_org_data
    )
    return await converters.human_evaluation_db_to_pydantic(evaluation)


async def delete_human_evaluations(
    evaluation_ids: List[str], **user_org_data: dict
) -> None:
    """
    Delete evaluations by their IDs.

    Args:
        evaluation_ids (List[str]): A list of evaluation IDs.
        user_org_data (dict): User and organization data.

    Raises:
        HTTPException: If evaluation not found or access denied.
    """
    for evaluation_id in evaluation_ids:
        evaluation = await _fetch_human_evaluation_and_check_access(
            evaluation_id=evaluation_id, **user_org_data
        )
        await engine.delete(evaluation)


async def delete_evaluations(evaluation_ids: List[str], **user_org_data: dict) -> None:
    """
    Delete evaluations by their IDs.

    Args:
        evaluation_ids (List[str]): A list of evaluation IDs.
        user_org_data (dict): User and organization data.

    Raises:
        HTTPException: If evaluation not found or access denied.
    """
    for evaluation_id in evaluation_ids:
        evaluation = await _fetch_evaluation_and_check_access(
            evaluation_id=evaluation_id, **user_org_data
        )
        await engine.delete(evaluation)


async def create_custom_code_evaluation(
    payload: CreateCustomEvaluation, **user_org_data: dict
) -> str:
    """Save the custom evaluation code in the database.

    Args:
        payload (CreateCustomEvaluation): the required payload

    Returns:
        str: the custom evaluation id
    """

    # Initialize custom evaluation instance
    access = await check_access_to_app(
        user_org_data=user_org_data, app_id=payload.app_id
    )
    if not access:
        raise HTTPException(
            status_code=403,
            detail=f"You do not have access to this app: {payload.app_id}",
        )
    app = await db_manager.fetch_app_by_id(app_id=payload.app_id)
    custom_eval = CustomEvaluationDB(
        evaluation_name=payload.evaluation_name,
        user=app.user,
        organization=app.organization,
        app=app,
        python_code=payload.python_code,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )

    await engine.save(custom_eval)
    return str(custom_eval.id)


async def update_custom_code_evaluation(
    id: str, payload: CreateCustomEvaluation, **kwargs: dict
) -> str:
    """Update a custom code evaluation in the database.
    Args:
        id (str): the ID of the custom evaluation to update
        payload (CreateCustomEvaluation): the payload with updated data
    Returns:
        str: the ID of the updated custom evaluation
    """

    # Get user object
    user = await get_user(user_uid=kwargs["uid"])

    # Build query expression
    query_expression = query.eq(CustomEvaluationDB.user, user.id) & query.eq(
        CustomEvaluationDB.id, ObjectId(id)
    )

    # Get custom evaluation
    custom_eval = await engine.find_one(CustomEvaluationDB, query_expression)
    if not custom_eval:
        raise HTTPException(status_code=404, detail="Custom evaluation not found")

    # Update the custom evaluation fields
    custom_eval.evaluation_name = payload.evaluation_name
    custom_eval.python_code = payload.python_code
    custom_eval.updated_at = datetime.utcnow()

    # Save the updated custom evaluation
    await engine.save(custom_eval)

    return str(custom_eval.id)


async def execute_custom_code_evaluation(
    evaluation_id: str,
    app_id: str,
    output: str,
    correct_answer: str,
    variant_id: str,
    inputs: Dict[str, Any],
    **user_org_data: dict,
):
    """Execute the custom evaluation code.

    Args:
        evaluation_id (str): the custom evaluation id
        app_id (str): the ID of the app
        output (str): required by the custom code
        correct_answer (str): required by the custom code
        variant_id (str): required by the custom code
        inputs (Dict[str, Any]): required by the custom code

    Raises:
        HTTPException: Evaluation not found
        HTTPException: You do not have access to this app: {app_id}
        HTTPException: App variant not found
        HTTPException: Failed to execute custom code evaluation

    Returns:
        result: The result of the executed custom code
    """
    logger.debug(
        f"evaluation_id {evaluation_id} | app_id {app_id} | variant_id {variant_id} | inputs {inputs} | output {output} | correct_answer {correct_answer}"
    )
    # Get user object
    user = await get_user(user_uid=user_org_data["uid"])

    # Build query expression
    query_expression = query.eq(
        CustomEvaluationDB.id, ObjectId(evaluation_id)
    ) & query.eq(CustomEvaluationDB.user, user.id)

    # Get custom evaluation
    custom_eval = await engine.find_one(CustomEvaluationDB, query_expression)
    if not custom_eval:
        raise HTTPException(status_code=404, detail="Evaluation not found")

    # Check if user has app access
    access = await check_access_to_app(user_org_data=user_org_data, app_id=app_id)
    if not access:
        raise HTTPException(
            status_code=403,
            detail=f"You do not have access to this app: {app_id}",
        )

    # Retrieve app from database
    app = await db_manager.fetch_app_by_id(app_id=app_id)

    # Build query expression for app variant
    appvar_query_expression = query.eq(AppVariantDB.app, app.id) & query.eq(
        AppVariantDB.id, ObjectId(variant_id)
    )

    # Get app variant object
    app_variant = await engine.find_one(AppVariantDB, appvar_query_expression)
    if not app_variant:
        raise HTTPException(status_code=404, detail="App variant not found")

    # Execute the Python code with the provided inputs
    try:
        result = execute_code_safely(
            app_variant.config.parameters,
            inputs,
            output,
            correct_answer,
            custom_eval.python_code,
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to execute custom code evaluation: {str(e)}",
        )
    return result


async def fetch_custom_evaluations(
    app_id: str, **user_org_data: dict
) -> List[CustomEvaluationOutput]:
    """Fetch a list of custom evaluations from the database.

    Args:
        app_name (str): the name of the app

    Returns:
        List[CustomEvaluationOutput]: ls=ist of custom evaluations
    """
    # Get user object
    access = await check_access_to_app(user_org_data=user_org_data, app_id=app_id)
    if not access:
        raise HTTPException(
            status_code=403,
            detail=f"You do not have access to this app: {app_id}",
        )

    # Retrieve app from database
    app = await db_manager.fetch_app_by_id(app_id=app_id)

    # Get custom evaluations
    custom_evals = await engine.find(
        CustomEvaluationDB, CustomEvaluationDB.app == ObjectId(app.id)
    )
    if not custom_evals:
        return []

    # Convert custom evaluations to evaluations
    evaluations = []
    for custom_eval in custom_evals:
        evaluations.append(
            CustomEvaluationOutput(
                id=str(custom_eval.id),
                app_id=str(custom_eval.app.id),
                evaluation_name=custom_eval.evaluation_name,
                created_at=custom_eval.created_at,
            )
        )
    return evaluations


async def fetch_custom_evaluation_detail(
    id: str, **user_org_data: dict
) -> CustomEvaluationDetail:
    """Fetch the detail of custom evaluation from the database.

    Args:
        id (str): the id of the custom evaluation

    Returns:
        CustomEvaluationDetail: Detail of the custom evaluation
    """

    # Get user object
    user = await get_user(user_uid=user_org_data["uid"])

    # Build query expression
    query_expression = query.eq(CustomEvaluationDB.user, user.id) & query.eq(
        CustomEvaluationDB.id, ObjectId(id)
    )

    # Get custom evaluation
    custom_eval = await engine.find_one(CustomEvaluationDB, query_expression)
    if not custom_eval:
        raise HTTPException(status_code=404, detail="Custom evaluation not found")

    return CustomEvaluationDetail(
        id=str(custom_eval.id),
        app_id=str(custom_eval.app.id),
        python_code=custom_eval.python_code,
        evaluation_name=custom_eval.evaluation_name,
        created_at=custom_eval.created_at,
        updated_at=custom_eval.updated_at,
    )


async def fetch_custom_evaluation_names(
    app_id: str, **user_org_data: dict
) -> List[CustomEvaluationNames]:
    """Fetch the names of custom evaluation from the database.

    Args:
        id (str): the name of the app the evaluation belongs to

    Returns:
        List[CustomEvaluationNames]: the list of name of custom evaluations
    """

    # Get user object
    user = await get_user(user_uid=user_org_data["uid"])

    # Check if user has app access
    access = await check_access_to_app(user_org_data=user_org_data, app_id=app_id)
    if not access:
        raise HTTPException(
            status_code=403,
            detail=f"You do not have access to this app: {app_id}",
        )

    # Retrieve app from database
    app = await db_manager.fetch_app_by_id(app_id=app_id)

    # Build query expression
    query_expression = query.eq(CustomEvaluationDB.user, user.id) & query.eq(
        CustomEvaluationDB.app, app.id
    )

    # Get custom evaluation
    custom_evals = await engine.find(CustomEvaluationDB, query_expression)

    list_of_custom_eval_names = []
    for custom_eval in custom_evals:
        list_of_custom_eval_names.append(
            CustomEvaluationNames(
                id=str(custom_eval.id),
                evaluation_name=custom_eval.evaluation_name,
            )
        )
    return list_of_custom_eval_names


async def create_new_human_evaluation(
    payload: NewHumanEvaluation, **user_org_data: dict
) -> EvaluationDB:
    """
    Create a new evaluation based on the provided payload and additional arguments.

    Args:
        payload (NewEvaluation): The evaluation payload.
        **user_org_data (dict): Additional keyword arguments, e.g., user id.

    Returns:
        EvaluationDB
    """
    user = await get_user(user_uid=user_org_data["uid"])

    # Initialize evaluation type settings
    settings = payload.evaluation_type_settings
    evaluation_type_settings = {}

    current_time = datetime.utcnow()

    # Fetch app
    app = await db_manager.fetch_app_by_id(app_id=payload.app_id)
    if app is None:
        raise HTTPException(
            status_code=404,
            detail=f"App with id {payload.app_id} does not exist",
        )

    variants = [ObjectId(variant_id) for variant_id in payload.variant_ids]

    testset = await db_manager.fetch_testset_by_id(testset_id=payload.testset_id)
    # Initialize and save evaluation instance to database
    eval_instance = HumanEvaluationDB(
        app=app,
        organization=app.organization,  # Assuming user has an organization_id attribute
        user=user,
        status=payload.status,
        evaluation_type=payload.evaluation_type,
        evaluation_type_settings=evaluation_type_settings,
        variants=variants,
        testset=testset,
        created_at=current_time,
        updated_at=current_time,
    )
    newEvaluation = await engine.save(eval_instance)

    if newEvaluation is None:
        raise HTTPException(
            status_code=500, detail="Failed to create evaluation_scenario"
        )

    await prepare_csvdata_and_create_evaluation_scenario(
        testset.csvdata,
        payload.inputs,
        payload.evaluation_type,
        newEvaluation,
        user,
        app,
    )
    return newEvaluation


async def create_new_evaluation(
    app_data: dict, new_evaluation_data: dict, evaluators_configs: List[str]
) -> Evaluation:
    """
    Create a new evaluation.

    Args:
        app_data (dict): Required app data
        new_evaluation_data (dict): Required new evaluation data
        evaluators_configs (List[str]): List of evaluator configurations

    Returns:
        Evaluation
    """

    new_evaluation = NewEvaluation(**new_evaluation_data)
    app = AppDB(**app_data)

    testset = await db_manager.fetch_testset_by_id(new_evaluation.testset_id)

    evaluation_db = await db_manager.create_new_evaluation(
        app=app,
        organization=app.organization,
        user=app.user,
        testset=testset,
        status=EvaluationStatusEnum.EVALUATION_STARTED,
        variants=new_evaluation.variant_ids,
        evaluators_configs=new_evaluation.evaluators_configs,
    )
    return await converters.evaluation_db_to_pydantic(evaluation_db)


async def retrieve_evaluation_results(
    evaluation_id: str, **user_org_data: dict
) -> List[dict]:
    """Retrieve the aggregated results for a given evaluation.

    Args:
        evaluation_id (str): the evaluation id

    Returns:
        List[dict]: evaluation aggregated results
    """

    # Check for access rights
    evaluation = await db_manager.fetch_evaluation_by_id(evaluation_id)
    access = await check_access_to_app(
        user_org_data=user_org_data, app_id=str(evaluation.app.id)
    )
    if not access:
        raise HTTPException(
            status_code=403,
            detail=f"You do not have access to this app: {str(evaluation.app.id)}",
        )
    return await converters.aggregated_result_to_pydantic(evaluation.aggregated_results)


async def compare_evaluations_scenarios(
    evaluations_ids: List[str],
    testset_id: str,
    app_variant_id: str,
    **user_org_data: dict,
):
    all_scenarios = []
    grouped_scenarios = {}
    for evaluation_id in evaluations_ids:
        eval_scenarios = await fetch_evaluation_scenarios_for_evaluation(
            evaluation_id, **user_org_data
        )
        all_scenarios.append(eval_scenarios)

    app_variant_db = await fetch_app_variant_by_id(app_variant_id)
    testset = await db_manager.fetch_testset_by_id(testset_id=testset_id)

    inputs = app_variant_db.parameters.get("inputs", [])
    # inputs: [{'name': 'country'}]
    formatted_inputs = extract_inputs_values_from_tesetset(inputs, testset.csvdata)
    # formatted_inputs: [{'input_name': 'country', 'input_values': ['Nauru', 'Tuvalu'...]}]

    print(formatted_inputs)
    groupped_scenarios_by_inputs = find_scenarios_by_input(
        formatted_inputs, all_scenarios
    )
    print(groupped_scenarios_by_inputs)
    return groupped_scenarios_by_inputs


def extract_inputs_values_from_tesetset(inputs, testset):
    extracted_values = []

    for input_item in inputs:
        key_name = input_item["name"]
        values = [entry[key_name] for entry in testset if key_name in entry]

        # Create a dictionary for each input with its values
        input_dict = {"input_name": key_name, "input_values": values}
        extracted_values.append(input_dict)

    return extracted_values


def find_scenarios_by_input(formatted_inputs, all_scenarios):
    results = []
    flattened_scenarios = [
        scenario for sublist in all_scenarios for scenario in sublist
    ]

    for formatted_input in formatted_inputs:
        input_name = formatted_input["input_name"]
        for input_value in formatted_input["input_values"]:
            matching_scenarios = [
                scenario
                for scenario in flattened_scenarios
                if any(
                    input_item.name == input_name and input_item.value == input_value
                    for input_item in scenario.inputs
                )
            ]

            results.append(
                {
                    "input_name": input_name,
                    "input_value": input_value,
                    "scenarios": matching_scenarios,
                }
            )

    return results
