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
from agenta_backend.services.security.sandbox import execute_code_safely
from agenta_backend.services.db_manager import engine, query, get_user_object
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

from langchain.chains import LLMChain
from langchain.llms import OpenAI
from langchain.prompts import PromptTemplate


class UpdateEvaluationScenarioError(Exception):
    """Custom exception for update evaluation scenario errors."""

    pass


async def create_new_evaluation(payload: NewEvaluation, **kwargs: dict) -> Dict:
    # Get user object
    user = await get_user_object(kwargs["uid"])

    # Convert payload data to dictionary
    evaluation_dict = payload.dict()
    evaluation_dict["created_at"] = datetime.utcnow()
    evaluation_dict["updated_at"] = datetime.utcnow()

    # Initialize evaluation type settings embedded model
    similarity_threshold = payload.evaluation_type_settings.similarity_threshold
    regex_pattern = payload.evaluation_type_settings.regex_pattern
    regex_should_match = payload.evaluation_type_settings.regex_should_match
    webhook_url = payload.evaluation_type_settings.webhook_url
    evaluation_type_settings = EvaluationTypeSettings(
        similarity_threshold=0.0
        if similarity_threshold is None
        else similarity_threshold,
        regex_pattern="" if regex_pattern is None else regex_pattern,
        regex_should_match=True if regex_should_match is None else regex_should_match,
        webhook_url="" if webhook_url is None else webhook_url,
    )

    # Initialize evaluation instance and save to database
    eval_instance = EvaluationDB(
        status=payload.status,
        evaluation_type=payload.evaluation_type,
        custom_code_evaluation_id=payload.custom_code_evaluation_id,
        evaluation_type_settings=evaluation_type_settings,
        llm_app_prompt_template=payload.llm_app_prompt_template,
        variants=payload.variants,
        app_name=payload.app_name,
        testset=payload.testset,
        user=user,
        created_at=evaluation_dict["created_at"],
        updated_at=evaluation_dict["updated_at"],
    )
    newEvaluation = await engine.save(eval_instance)

    if newEvaluation is None:
        raise HTTPException(
            status_code=500, detail="Failed to create evaluation_scenario"
        )

    # Get testset using the provided _id
    testsetId = eval_instance.testset["_id"]
    testset = await engine.find_one(TestSetDB, TestSetDB.id == ObjectId(testsetId))

    csvdata = testset.csvdata
    for datum in csvdata:
        try:
            inputs = [
                {"input_name": name, "input_value": datum[name]}
                for name in payload.inputs
            ]
        except KeyError:
            await engine.delete(newEvaluation)
            msg = f"""
            Columns in the test set should match the names of the inputs in the variant.
            Inputs names in variant are: {payload.inputs} while
            columns in test set are: {[col for col in datum.keys() if col != 'correct_answer']}
            """
            raise HTTPException(
                status_code=400,
                detail=msg,
            )

        list_of_scenario_input = []
        for scenario_input in inputs:
            eval_scenario_input_instance = EvaluationScenarioInput(
                input_name=scenario_input["input_name"],
                input_value=scenario_input["input_value"],
            )
            list_of_scenario_input.append(eval_scenario_input_instance)

        evaluation_scenario_payload = {
            **{
                "created_at": datetime.utcnow(),
                "updated_at": datetime.utcnow(),
            },
            **extend_with_evaluation(payload.evaluation_type),
            **extend_with_correct_answer(payload.evaluation_type, datum),
        }

        eval_scenario_instance = EvaluationScenarioDB(
            **evaluation_scenario_payload,
            user=user,
            evaluation_id=str(newEvaluation.id),
            inputs=list_of_scenario_input,
            outputs=[],
        )
        await engine.save(eval_scenario_instance)

    evaluation_dict["id"] = str(newEvaluation.id)
    return evaluation_dict


async def create_new_evaluation_scenario(
    evaluation_id: str, payload: EvaluationScenario, **kwargs: dict
) -> Dict:
    # Get user object
    user = await get_user_object(kwargs["uid"])

    list_of_scenario_input = []
    for scenario_input in payload.inputs:
        eval_scenario_input_instance = EvaluationScenarioInput(
            input_name=scenario_input["input_name"],
            input_value=scenario_input["input_value"],
        )
        list_of_scenario_input.append(eval_scenario_input_instance)

    evaluation_scenario_payload = {
        **{
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        },
        **extend_with_evaluation(payload.evaluation_type),
    }
    eval_scenario_instance = EvaluationScenarioDB(
        **evaluation_scenario_payload,
        evaluation_id=evaluation_id,
        user=user,
        inputs=list_of_scenario_input,
        outputs=[],
    )
    await engine.save(eval_scenario_instance)
    return EvaluationScenario(
        evaluation_id=evaluation_id,
        inputs=eval_scenario_instance.inputs,
        outputs=eval_scenario_instance.outputs,
        vote=eval_scenario_instance.vote,
        score=eval_scenario_instance.score,
        correct_answer=eval_scenario_instance.correct_answer,
        id=str(eval_scenario_instance.id),
    )


async def update_evaluation(
    evaluation_id: str, update_payload: EvaluationUpdate, **kwargs: dict
) -> Evaluation:
    user = await get_user_object(kwargs["uid"])

    # Construct query expression for evaluation
    query_expression = query.eq(EvaluationDB.id, ObjectId(evaluation_id)) & query.eq(
        EvaluationDB.user, user.id
    )
    result = await engine.find_one(EvaluationDB, query_expression)

    if result is not None:
        # Update status and save to database
        updates = {}
        if update_payload.status is not None:
            updates["status"] = update_payload.status
        if update_payload.evaluation_type_settings is not None:
            updates["evaluation_type_settings"] = EvaluationTypeSettings(
                similarity_threshold=result.evaluation_type_settings.similarity_threshold
                if update_payload.evaluation_type_settings.similarity_threshold is None
                else update_payload.evaluation_type_settings.similarity_threshold,
                regex_pattern=result.evaluation_type_settings.regex_pattern
                if update_payload.evaluation_type_settings.regex_pattern is None
                else update_payload.evaluation_type_settings.regex_pattern,
                regex_should_match=result.evaluation_type_settings.regex_should_match
                if update_payload.evaluation_type_settings.regex_should_match is None
                else update_payload.evaluation_type_settings.regex_should_match,
                webhook_url=result.evaluation_type_settings.webhook_url
                if update_payload.evaluation_type_settings.webhook_url is None
                else update_payload.evaluation_type_settings.webhook_url,
            )

        result.update(updates)
        await engine.save(result)

        return Evaluation(
            id=str(result.id),
            status=result.status,
            evaluation_type=result.evaluation_type,
            evaluation_type_settings=result.evaluation_type_settings,
            llm_app_prompt_template=result.llm_app_prompt_template,
            variants=result.variants,
            app_name=result.app_name,
            testset=result.testset,
            created_at=result.created_at,
            updated_at=result.updated_at,
        )
    else:
        raise UpdateEvaluationScenarioError("Failed to update evaluation status")


async def update_evaluation_scenario(
    evaluation_scenario_id: str,
    evaluation_scenario_data: EvaluationScenarioUpdate,
    evaluation_type: EvaluationType,
    **kwargs,
) -> Dict:
    evaluation_scenario_dict = evaluation_scenario_data.dict()
    evaluation_scenario_dict["updated_at"] = datetime.utcnow()

    # Construct new evaluation set and get user object
    new_evaluation_set = {"outputs": evaluation_scenario_dict["outputs"]}
    user = await get_user_object(kwargs["uid"])

    # Construct query expression builder for evaluation scenario
    query_expression_eval_scen = query.eq(
        EvaluationScenarioDB.id, ObjectId(evaluation_scenario_id)
    ) & query.eq(EvaluationScenarioDB.user, user.id)

    if (
        evaluation_type == EvaluationType.auto_exact_match
        or evaluation_type == EvaluationType.auto_similarity_match
        or evaluation_type == EvaluationType.auto_regex_test
        or evaluation_type == EvaluationType.auto_webhook_test
    ):
        new_evaluation_set["score"] = evaluation_scenario_dict["score"]
    elif evaluation_type == EvaluationType.human_a_b_testing:
        new_evaluation_set["vote"] = evaluation_scenario_dict["vote"]
    elif evaluation_type == EvaluationType.custom_code_run:
        new_evaluation_set["correct_answer"] = evaluation_scenario_dict[
            "correct_answer"
        ]
    elif evaluation_type == EvaluationType.auto_ai_critique:
        new_evaluation_set["evaluation"] = evaluation_scenario_dict["ai_critique_score"]

    # Get an evaluation scenario with the provided id
    result = await engine.find_one(EvaluationScenarioDB, query_expression_eval_scen)

    # Loop through the evaluation set outputs, create an evaluation scenario
    # output instance and append the instance in the list
    list_of_eval_outputs = []
    for output in new_evaluation_set["outputs"]:
        eval_output = EvaluationScenarioOutput(
            variant_name=output["variant_name"],
            variant_output=output["variant_output"],
        )
        list_of_eval_outputs.append(eval_output.dict())

    # Update evaluation scenario
    new_evaluation_set["outputs"] = list_of_eval_outputs
    result.update(new_evaluation_set)

    # Save update to database
    await engine.save(result)

    if result is not None:
        evaluation_scenario = await engine.find_one(
            EvaluationScenarioDB,
            EvaluationScenarioDB.id == ObjectId(evaluation_scenario_id),
        )

        if evaluation_scenario is not None:
            evaluation_scenario_response = EvaluationScenario(
                evaluation_id=evaluation_scenario.evaluation_id,
                inputs=evaluation_scenario.inputs,
                outputs=evaluation_scenario.outputs,
                vote=evaluation_scenario.vote,
                score=evaluation_scenario.score,
                correct_answer=evaluation_scenario.correct_answer,
                id=str(evaluation_scenario.id),
            )

            # Update evaluation response if type of evaluation is auto ai critique
            if evaluation_type == EvaluationType.auto_ai_critique:
                evaluation_scenario_response.evaluation = new_evaluation_set["evaluation"]
            return evaluation_scenario_response

    raise UpdateEvaluationScenarioError("Failed to create evaluation_scenario")


async def update_evaluation_scenario_score(
    evaluation_scenario_id: str, score: float, **kwargs: dict
) -> None:
    """Update the score of the provided evaluation scenario.

    Args:
        evaluation_scenario_id (str): the evaluation scenario to update
        score (float): the value to update
    """

    # Get user object
    user = await get_user_object(kwargs["uid"])

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
    evaluation_scenario_id: str, **kwargs: dict
) -> Dict[str, str]:
    """Get the evaluation scenario score

    Args:
        scenario_id (str): the evaluation scenario score

    Returns:
        Dict[str, str]: scenario id and score
    """

    # Get user object
    user = await get_user_object(kwargs["uid"])

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
    llm_app_inputs: dict,
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
        llm_app_inputs (dict): parameters
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
    payload: CreateCustomEvaluation, **kwargs: dict
) -> str:
    """Save the custom evaluation code in the database.

    Args:
        payload (CreateCustomEvaluation): the required payload

    Returns:
        str: the custom evaluation id
    """

    # Get user object
    user = await get_user_object(kwargs["uid"])

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
    **kwargs: dict,
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
    user = await get_user_object(kwargs["uid"])

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
    app_name: str, **kwargs: dict
) -> List[CustomEvaluationOutput]:
    """Fetch a list of custom evaluations from the database.

    Args:
        app_name (str): the name of the app

    Returns:
        List[CustomEvaluationOutput]: ls=ist of custom evaluations
    """

    # Get user object
    user = await get_user_object(kwargs["uid"])

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
    id: str, **kwargs: dict
) -> CustomEvaluationDetail:
    """Fetch the detail of custom evaluation from the database.

    Args:
        id (str): the id of the custom evaluation

    Returns:
        CustomEvaluationDetail: Detail of the custom evaluation
    """

    # Get user object
    user = await get_user_object(kwargs["uid"])

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
    app_name: str, **kwargs: dict
) -> List[CustomEvaluationNames]:
    """Fetch the names of custom evaluation from the database.

    Args:
        id (str): the name of the app the evaluation belongs to

    Returns:
        List[CustomEvaluationNames]: the list of name of custom evaluations
    """

    # Get user object
    user = await get_user_object(kwargs["uid"])

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
