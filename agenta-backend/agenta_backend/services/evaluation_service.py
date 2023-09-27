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
    EvaluationType,
    NewEvaluation,
    EvaluationScenarioUpdate,
    CreateCustomEvaluation,
    EvaluationUpdate,
)
from agenta_backend.models import converters
from agenta_backend.utills.common import engine
from agenta_backend.services.db_manager import query, get_user_object
from agenta_backend.services import new_db_manager
from agenta_backend.models.db_models import (
    AppVariantDB,
    EvaluationDB,
    EvaluationScenarioDB,
    TestSetDB,
    EvaluationTypeSettings,
    EvaluationScenarioInput,
    EvaluationScenarioOutput,
    CustomEvaluationDB,
)

from agenta_backend.utills import common

from langchain.chains import LLMChain
from langchain.llms import OpenAI
from langchain.prompts import PromptTemplate


class UpdateEvaluationScenarioError(Exception):
    """Custom exception for update evaluation scenario errors."""

    pass


async def _fetch_evaluation_and_check_access(
    evaluation_id: str, **user_org_data: dict
) -> EvaluationDB:
    # Fetch the evaluation by ID
    evaluation = await new_db_manager.fetch_evaluation_by_id(
        evaluation_id=evaluation_id
    )

    # Check if the evaluation exists
    if evaluation is None:
        raise HTTPException(
            status_code=404, detail=f"Evaluation with id {evaluation_id} not found"
        )

    # Check for access rights
    access = await common.check_access_to_app(
        kwargs=user_org_data, app_id=evaluation.app.id
    )
    if not access:
        raise HTTPException(
            status_code=403,
            detail=f"You do not have access to this app: {str(evaluation.app.id)}",
        )
    return evaluation


async def _fetch_evaluation_scenario_and_check_access(
    evaluation_scenario_id: str, **user_org_data: dict
) -> EvaluationDB:
    # Fetch the evaluation by ID
    evaluation_scenario = await new_db_manager.fetch_evaluation_scenario_by_id(
        evaluation_scenario_id=evaluation_scenario_id
    )
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
    access = await common.check_access_to_app(
        kwargs=user_org_data, app_id=evaluation.app.id
    )
    if not access:
        raise HTTPException(
            status_code=403,
            detail=f"You do not have access to this app: {str(evaluation.app.id)}",
        )
    return evaluation_scenario


# async def create_new_evaluation(
#     payload: NewEvaluation, **user_org_data: dict
# ) -> EvaluationDB:
#     """
#     Create a new evaluation based on the provided payload and additional arguments.

#     Args:
#         payload (NewEvaluation): The evaluation payload.
#         **user_org_data (dict): Additional keyword arguments, e.g., user id.

#     Returns:
#         EvaluationDB
#     """
#     user = await get_user_object(user_org_data["uid"])

#     # Initialize evaluation type settings
#     settings = payload.evaluation_type_settings
#     evaluation_type_settings = EvaluationTypeSettings(
#         similarity_threshold=settings.similarity_threshold or 0.0,
#         regex_pattern=settings.regex_pattern or "",
#         regex_should_match=settings.regex_should_match or True,
#         webhook_url=settings.webhook_url or "",
#         custom_code_evaluation_id=settings.custom_code_evaluation_id or "",
#         llm_app_prompt_template=settings.llm_app_prompt_template or "",
#     )

#     current_time = datetime.utcnow()

#     # Fetch app
#     app = await new_db_manager.fetch_app_by_id(app_id=payload.app_id)
#     if app is None:
#         raise HTTPException(
#             status_code=404, detail=f"App with id {payload.app_id} does not exist"
#         )

#     variants = [ObjectId(variant_id) for variant_id in payload.variant_ids]

#     testset = await new_db_manager.fetch_testset_by_id(testset_id=payload.testset_id)
#     # Initialize and save evaluation instance to database
#     eval_instance = EvaluationDB(
#         app=app,
#         organization=app.organization_id,  # Assuming user has an organization_id attribute
#         user=user,
#         status=payload.status,
#         evaluation_type=payload.evaluation_type,
#         evaluation_type_settings=evaluation_type_settings,
#         variants=variants,
#         testset=testset,
#         created_at=current_time,
#         updated_at=current_time,
#     )
#     newEvaluation = await engine.save(eval_instance)

#     if newEvaluation is None:
#         raise HTTPException(
#             status_code=500, detail="Failed to create evaluation_scenario"
#         )

#     csvdata = testset.csvdata
#     for datum in csvdata:
#         # Check whether the inputs in the test set match the inputs in the variant
#         try:
#             inputs = [
#                 {"input_name": name, "input_value": datum[name]}
#                 for name in payload.inputs
#             ]
#         except KeyError:
#             await engine.delete(newEvaluation)
#             msg = f"""
#             Columns in the test set should match the names of the inputs in the variant.
#             Inputs names in variant are: {payload.inputs} while
#             columns in test set are: {[col for col in datum.keys() if col != 'correct_answer']}
#             """
#             raise HTTPException(
#                 status_code=400,
#                 detail=msg,
#             )
#         # Create evaluation scenarios
#         list_of_scenario_input = []
#         for scenario_input in inputs:
#             eval_scenario_input_instance = EvaluationScenarioInput(
#                 input_name=scenario_input["input_name"],
#                 input_value=scenario_input["input_value"],
#             )
#             list_of_scenario_input.append(eval_scenario_input_instance)

#         evaluation_scenario_payload = {
#             **{
#                 "created_at": datetime.utcnow(),
#                 "updated_at": datetime.utcnow(),
#             },
#             **extend_with_evaluation(payload.evaluation_type),
#             **extend_with_correct_answer(payload.evaluation_type, datum),
#         }

#         eval_scenario_instance = EvaluationScenarioDB(
#             **evaluation_scenario_payload,
#             user=user,
#             organization=app.organization_id,
#             evaluation=newEvaluation,
#             inputs=list_of_scenario_input,
#             outputs=[],
#         )
#         await engine.save(eval_scenario_instance)

#     return newEvaluation


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
            input_name=input_item.input_name, input_value=input_item.input_value
        )
        for input_item in payload.inputs
    ]

    new_eval_scenario = EvaluationScenarioDB(
        user=evaluation.user,
        organization=evaluation.organization,
        evaluation=evaluation,
        inputs=scenario_inputs,
        outputs=[],
        **extend_with_evaluation(evaluation.evaluation_type),
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
        evaluation_id=evaluation_id,
    )

    await engine.save(new_eval_scenario)


async def update_evaluation(
    evaluation_id: str, update_payload: EvaluationUpdate, **user_org_data: dict
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
    evaluation = await _fetch_evaluation_and_check_access(
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
        EvaluationScenarioDB, EvaluationScenarioDB.evaluation == ObjectId(evaluation.id)
    )
    eval_scenarios = [
        converters.evaluation_scenario_db_to_pydantic(scenario)
        for scenario in scenarios
    ]
    return eval_scenarios


async def update_evaluation_scenario(
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
    eval_scenario = await _fetch_evaluation_scenario_and_check_access(
        evaluation_scenario_id=evaluation_scenario_id,
        **user_org_data,
    )

    updated_data = evaluation_scenario_data.dict()
    updated_data["updated_at"] = datetime.utcnow()

    new_eval_set = {"outputs": updated_data["outputs"]}

    if evaluation_type in [
        EvaluationType.auto_exact_match,
        EvaluationType.auto_similarity_match,
        EvaluationType.auto_regex_test,
        EvaluationType.auto_webhook_test,
    ]:
        new_eval_set["score"] = updated_data["score"]
    elif evaluation_type == EvaluationType.human_a_b_testing:
        new_eval_set["vote"] = updated_data["vote"]
    elif evaluation_type == EvaluationType.custom_code_run:
        new_eval_set["correct_answer"] = updated_data["correct_answer"]

    new_outputs = [
        EvaluationScenarioOutput(
            variant_id=output["variant_id"],
            variant_output=output["variant_output"],
        ).dict()
        for output in new_eval_set["outputs"]
    ]

    new_eval_set["outputs"] = new_outputs
    eval_scenario.update(new_eval_set)
    await engine.save(eval_scenario)


async def update_evaluation_scenario_score(
    evaluation_scenario_id: str, score: float, **user_org_data: dict
) -> None:
    """Update the score of the provided evaluation scenario.

    Args:
        evaluation_scenario_id (str): the evaluation scenario to update
        score (float): the value to update
    """

    # Get user object
    user = await get_user_object(user_org_data["uid"])

    # Build query expression
    query_expression = query.eq(
        EvaluationScenarioDB.id, ObjectId(evaluation_scenario_id)
    ) & query.eq(EvaluationScenarioDB.user, user.id)

    # Find evaluation scenario if it meets with the query expression
    evaluation_scenario = await engine.find_one(EvaluationScenarioDB, query_expression)
    evaluation_scenario.score = score

    # Save the evaluation scenario
    await engine.save(evaluation_scenario)


async def get_evaluation_scenario_score(
    evaluation_scenario_id: str, **user_org_data: dict
) -> Dict[str, str]:
    """Get the evaluation scenario score

    Args:
        scenario_id (str): the evaluation scenario score

    Returns:
        Dict[str, str]: scenario id and score
    """

    # Get user object
    user = await get_user_object(user_org_data["uid"])

    # Build query expression
    query_expression = query.eq(
        EvaluationScenarioDB.id, ObjectId(evaluation_scenario_id)
    ) & query.eq(EvaluationScenarioDB.user, user.id)

    # Find evaluation scenario if it meets with the query expression
    evaluation_scenario = await engine.find_one(EvaluationScenarioDB, query_expression)
    return {
        "scenario_id": str(evaluation_scenario.id),
        "score": evaluation_scenario.score,
    }


def evaluate_with_ai_critique(
    llm_app_prompt_template: str,
    llm_app_inputs: list,
    correct_answer: str,
    app_variant_output: str,
    evaluation_prompt_template: str,
    open_ai_key: str,
    temperature: float = 0.9,
) -> str:
    """Evaluate a response using an AI critique based on provided
     - An evaluation prompt,
     - An LLM App prompt,
     - An LLM App output,
     - a correct answer.

    Args:
        llm_app_prompt_template (str): the prompt template of the llm app variant
        llm_app_inputs (list): parameters
        correct_answer (str): correct answer
        app_variant_output (str): the output of an ll app variant with given parameters
        evaluation_prompt_template (str): evaluation prompt set by an agenta user in the ai evaluation view

    Returns:
        str: returns an evaluation
    """
    llm = OpenAI(openai_api_key=open_ai_key, temperature=temperature)

    input_variables = []

    # List of default variables
    default_vars = [
        "app_variant_output",
        "llm_app_prompt_template",
        "correct_answer",
    ]

    # Check default variables
    for var in default_vars:
        if "{%s}" % var in evaluation_prompt_template:
            input_variables.append(var)

    # Iterate over llm_app_inputs and check if the variable name exists in the evaluation_prompt_template
    for input_item in llm_app_inputs:
        if "{%s}" % input_item["input_name"] in evaluation_prompt_template:
            input_variables.append(input_item["input_name"])

    chain_run_args = {
        "llm_app_prompt_template": llm_app_prompt_template,
        "correct_answer": correct_answer,
        "app_variant_output": app_variant_output,
    }

    for input_item in llm_app_inputs:
        chain_run_args[input_item["input_name"]] = input_item["input_value"]

    prompt = PromptTemplate(
        input_variables=input_variables, template=evaluation_prompt_template
    )
    chain = LLMChain(llm=llm, prompt=prompt)

    output = chain.run(**chain_run_args)
    return output.strip()


def extend_with_evaluation(evaluation_type: EvaluationType):
    evaluation = {}
    if (
        evaluation_type == EvaluationType.auto_exact_match
        or evaluation_type == EvaluationType.auto_similarity_match
        or evaluation_type == EvaluationType.auto_regex_test
        or evaluation_type == EvaluationType.auto_webhook_test
    ):
        evaluation["score"] = ""

    if evaluation_type == EvaluationType.human_a_b_testing:
        evaluation["vote"] = ""

    if evaluation_type == EvaluationType.auto_ai_critique:
        evaluation["evaluation"] = ""
    return evaluation


def extend_with_correct_answer(evaluation_type: EvaluationType, row: dict):
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


async def create_custom_code_evaluation(
    payload: CreateCustomEvaluation, **user_org_data: dict
) -> str:
    """Save the custom evaluation code in the database.

    Args:
        payload (CreateCustomEvaluation): the required payload

    Returns:
        str: the custom evaluation id
    """

    # Get user object
    user = await get_user_object(user_org_data["uid"])

    # Initialize custom evaluation instance
    custom_eval = CustomEvaluationDB(**payload.dict(), user=user)

    await engine.save(custom_eval)
    return str(custom_eval.id)


async def execute_custom_code_evaluation(
    evaluation_id: str,
    app_name: str,
    output: str,
    correct_answer: str,
    variant_name: str,
    inputs: Dict[str, Any],
    **user_org_data: dict,
):
    """Execute the custom evaluation code.

    Args:
        evaluation_id (str): the custom evaluation id
        app_name (str): the name of the app
        output (str): required by the custom code
        correct_answer (str): required by the custom code
        variant_name (str): required by the custom code
        inputs (Dict[str, Any]): required by the custom code

    Raises:
        HTTPException: Evaluation not found
        HTTPException: App variant not found
        HTTPException: Failed to execute custom code evaluation

    Returns:
        result: The result of the executed custom code
    """

    # Get user object
    user = await get_user_object(user_org_data["uid"])

    # Build query expression
    query_expression = query.eq(
        CustomEvaluationDB.id, ObjectId(evaluation_id)
    ) & query.eq(CustomEvaluationDB.user, user.id)

    # Get custom evaluation
    custom_eval = await engine.find_one(CustomEvaluationDB, query_expression)
    if not custom_eval:
        raise HTTPException(status_code=404, detail="Evaluation not found")

    # Build query expression for app variant
    appvar_query_expression = query.eq(AppVariantDB.app_name, app_name) & query.eq(
        AppVariantDB.variant_name, variant_name
    )

    # Get app variant object
    app_variant = await engine.find_one(AppVariantDB, appvar_query_expression)
    if not app_variant:
        raise HTTPException(status_code=404, detail="App variant not found")

    # Execute the Python code with the provided inputs
    try:
        result = execute_code_safely(
            app_variant.parameters,
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
    app_name: str, **user_org_data: dict
) -> List[CustomEvaluationOutput]:
    """Fetch a list of custom evaluations from the database.

    Args:
        app_name (str): the name of the app

    Returns:
        List[CustomEvaluationOutput]: ls=ist of custom evaluations
    """

    # Get user object
    user = await get_user_object(user_org_data["uid"])

    # Build query expression
    query_expression = query.eq(CustomEvaluationDB.user, user.id) & query.eq(
        CustomEvaluationDB.app_name, app_name
    )

    # Get custom evaluations
    custom_evals = await engine.find(CustomEvaluationDB, query_expression)
    if not custom_evals:
        return []

    # Convert custom evaluations to evaluations
    evaluations = []
    for custom_eval in custom_evals:
        evaluations.append(
            CustomEvaluationOutput(
                id=str(custom_eval.id),
                app_name=custom_eval.app_name,
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
    user = await get_user_object(user_org_data["uid"])

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
        app_name=custom_eval.app_name,
        python_code=custom_eval.python_code,
        evaluation_name=custom_eval.evaluation_name,
        created_at=custom_eval.created_at,
        updated_at=custom_eval.updated_at,
    )


async def fetch_custom_evaluation_names(
    app_name: str, **user_org_data: dict
) -> List[CustomEvaluationNames]:
    """Fetch the names of custom evaluation from the database.

    Args:
        id (str): the name of the app the evaluation belongs to

    Returns:
        List[CustomEvaluationNames]: the list of name of custom evaluations
    """

    # Get user object
    user = await get_user_object(user_org_data["uid"])

    # Build query expression
    query_expression = query.eq(CustomEvaluationDB.user, user.id) & query.eq(
        CustomEvaluationDB.app_name, app_name
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
