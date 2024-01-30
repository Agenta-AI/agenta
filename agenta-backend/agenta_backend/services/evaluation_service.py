import os
import logging

from datetime import datetime
from fastapi import HTTPException
from typing import Dict, List, Any
from beanie import PydanticObjectId as ObjectId

from agenta_backend.models import converters
from agenta_backend.services import db_manager
from agenta_backend.utils.common import isCloudEE

from agenta_backend.models.api.evaluation_model import (
    Evaluation,
    EvaluationScenario,
    EvaluationScenarioInput,
    EvaluationType,
    HumanEvaluation,
    HumanEvaluationScenario,
    HumanEvaluationUpdate,
    NewEvaluation,
    EvaluationScenarioUpdate,
    EvaluationStatusEnum,
    NewHumanEvaluation,
)

if isCloudEE():
    from agenta_backend.commons.models.db_models import (
        AppDB_ as AppDB,
        UserDB_ as UserDB,
        EvaluationDB_ as EvaluationDB,
        HumanEvaluationDB_ as HumanEvaluationDB,
        EvaluationScenarioDB_ as EvaluationScenarioDB,
        HumanEvaluationScenarioDB_ as HumanEvaluationScenarioDB,
    )
else:
    from agenta_backend.models.db_models import (
        AppDB,
        UserDB,
        EvaluationDB,
        HumanEvaluationDB,
        EvaluationScenarioDB,
        HumanEvaluationScenarioDB,
    )

from agenta_backend.models.db_models import (
    HumanEvaluationScenarioInput,
    HumanEvaluationScenarioOutput,
)

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


class UpdateEvaluationScenarioError(Exception):
    """Custom exception for update evaluation scenario errors."""

    pass


async def _fetch_human_evaluation(evaluation_id: str) -> HumanEvaluationDB:
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

    return evaluation


async def _fetch_human_evaluation_scenario(
    evaluation_scenario_id: str,
) -> HumanEvaluationDB:
    # Fetch the evaluation by ID
    evaluation_scenario = await db_manager.fetch_human_evaluation_scenario_by_id(
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
            await new_evaluation.delete()
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
            evaluation=new_evaluation,
            inputs=list_of_scenario_input,
            outputs=[],
        )
        
        if isCloudEE():
            eval_scenario_instance.organization = app.organization
            eval_scenario_instance.workspace = app.workspace
        
        await eval_scenario_instance.create()


async def create_evaluation_scenario(
    evaluation_id: str, payload: EvaluationScenario
) -> None:
    """
    Create a new evaluation scenario.

    Args:
        evaluation_id (str): The ID of the evaluation.
        payload (EvaluationScenario): Evaluation scenario data.

    Raises:
        HTTPException: If evaluation not found or access denied.
    """
    evaluation = await db_manager.fetch_evaluation_by_id(evaluation_id)

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
        workspace=evaluation.workspace,
        evaluation=evaluation,
        inputs=scenario_inputs,
        outputs=[],
        is_pinned=False,
        note="",
        **_extend_with_evaluation(evaluation.evaluation_type),
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )

    await new_eval_scenario.create()


async def update_human_evaluation_service(
    evaluation_id: str, update_payload: HumanEvaluationUpdate
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
    evaluation = await _fetch_human_evaluation(evaluation_id=evaluation_id)

    # Prepare updates
    updates = {}
    if update_payload.status is not None:
        updates["status"] = update_payload.status

    # Update the evaluation
    await evaluation.update({"$set": updates})


async def fetch_evaluation_scenarios_for_evaluation(
    evaluation_id: str,
) -> List[EvaluationScenario]:
    """
    Fetch evaluation scenarios for a given evaluation ID.

    Args:
        evaluation_id (str): The ID of the evaluation.

    Raises:
        HTTPException: If the evaluation is not found or access is denied.

    Returns:
        List[EvaluationScenario]: A list of evaluation scenarios.
    """
    evaluation = await db_manager.fetch_evaluation_by_id(evaluation_id)
    scenarios = await EvaluationScenarioDB.find(
        EvaluationScenarioDB.evaluation.id == ObjectId(evaluation.id)
    ).to_list()
    eval_scenarios = [
        converters.evaluation_scenario_db_to_pydantic(scenario, str(evaluation.id))
        for scenario in scenarios
    ]
    return eval_scenarios


async def fetch_human_evaluation_scenarios_for_evaluation(
    evaluation_id: str,
) -> List[HumanEvaluationScenario]:
    """
    Fetch evaluation scenarios for a given evaluation ID.

    Args:
        evaluation_id (str): The ID of the evaluation.

    Raises:
        HTTPException: If the evaluation is not found or access is denied.

    Returns:
        List[EvaluationScenario]: A list of evaluation scenarios.
    """
    evaluation = await _fetch_human_evaluation(
        evaluation_id=evaluation_id,
    )
    scenarios = await HumanEvaluationScenarioDB.find(
        HumanEvaluationScenarioDB.evaluation.id == ObjectId(evaluation.id),
    ).to_list()
    eval_scenarios = [
        converters.human_evaluation_scenario_db_to_pydantic(
            scenario, str(evaluation.id)
        )
        for scenario in scenarios
    ]
    return eval_scenarios


async def update_human_evaluation_scenario(
    evaluation_scenario_id: str,
    evaluation_scenario_data: EvaluationScenarioUpdate,
    evaluation_type: EvaluationType,
) -> None:
    """
    Updates an evaluation scenario.

    Args:
        evaluation_scenario_id (str): The ID of the evaluation scenario.
        evaluation_scenario_data (EvaluationScenarioUpdate): New data for the scenario.
        evaluation_type (EvaluationType): Type of the evaluation.

    Raises:
        HTTPException: If evaluation scenario not found or access denied.
    """
    eval_scenario = await _fetch_human_evaluation_scenario(evaluation_scenario_id)

    updated_data = evaluation_scenario_data.dict()
    updated_data["updated_at"] = datetime.utcnow()
    new_eval_set = {}

    if updated_data["score"] is not None and evaluation_type in [
        EvaluationType.single_model_test,
    ]:
        new_eval_set["score"] = updated_data["score"]
    elif (
        updated_data["vote"] is not None
        and evaluation_type == EvaluationType.human_a_b_testing
    ):
        new_eval_set["vote"] = updated_data["vote"]

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

    await eval_scenario.update({"$set": new_eval_set})


async def update_evaluation_scenario_score_service(
    evaluation_scenario_id: str, score: float
) -> None:
    """
    Updates the score of an evaluation scenario.

    Args:
        evaluation_scenario_id (str): The ID of the evaluation scenario.
        score (float): The new score to set.

    Raises:
        HTTPException: If evaluation scenario not found or access denied.
    """
    eval_scenario = await _fetch_human_evaluation_scenario(evaluation_scenario_id)
    eval_scenario.score = score

    # Save the updated evaluation scenario
    await eval_scenario.save()


async def get_evaluation_scenario_score_service(
    evaluation_scenario_id: str,
) -> Dict[str, str]:
    """
    Retrieve the score of a given evaluation scenario.

    Args:
        evaluation_scenario_id: The ID of the evaluation scenario.

    Returns:
        Dictionary with 'scenario_id' and 'score' keys.
    """
    evaluation_scenario = await _fetch_human_evaluation_scenario(evaluation_scenario_id)
    return {
        "scenario_id": str(evaluation_scenario.id),
        "score": evaluation_scenario.score,
    }


def _extend_with_evaluation(evaluation_type: EvaluationType):
    evaluation = {}
    if evaluation_type == EvaluationType.single_model_test:
        evaluation["score"] = ""

    if evaluation_type == EvaluationType.human_a_b_testing:
        evaluation["vote"] = ""
    return evaluation


def _extend_with_correct_answer(evaluation_type: EvaluationType, row: dict):
    correct_answer = {}
    if row["correct_answer"]:
        correct_answer["correct_answer"] = row["correct_answer"]
    return correct_answer


async def fetch_list_evaluations(
    app_id: str,
) -> List[Evaluation]:
    """
    Fetches a list of evaluations based on the provided filtering criteria.

    Args:
        app_id (Optional[str]): An optional app ID to filter the evaluations.

    Returns:
        List[Evaluation]: A list of evaluations.
    """

    evaluations_db = await EvaluationDB.find(
        EvaluationDB.app.id == ObjectId(app_id), fetch_links=True
    ).to_list()
    return [
        await converters.evaluation_db_to_pydantic(evaluation)
        for evaluation in evaluations_db
    ]


async def fetch_evaluation(evaluation_id: str) -> Evaluation:
    """
    Fetches a single evaluation based on its ID.

    Args:
        evaluation_id (str): The ID of the evaluation.

    Returns:
        Evaluation: The fetched evaluation.
    """
    evaluation = await db_manager.fetch_evaluation_by_id(evaluation_id)
    return await converters.evaluation_db_to_pydantic(evaluation)


async def fetch_list_human_evaluations(
    app_id: str,
) -> List[HumanEvaluation]:
    """
    Fetches a list of evaluations based on the provided filtering criteria.

    Args:
        app_id (Optional[str]): An optional app ID to filter the evaluations.

    Returns:
        List[Evaluation]: A list of evaluations.
    """
    evaluations_db = await HumanEvaluationDB.find(
        HumanEvaluationDB.app.id == ObjectId(app_id), fetch_links=True
    ).to_list()
    return [
        await converters.human_evaluation_db_to_pydantic(evaluation)
        for evaluation in evaluations_db
    ]


async def fetch_human_evaluation(evaluation_id: str) -> HumanEvaluation:
    """
    Fetches a single evaluation based on its ID.

    Args:
        evaluation_id (str): The ID of the evaluation.

    Returns:
        Evaluation: The fetched evaluation.
    """
    evaluation = await _fetch_human_evaluation(evaluation_id=evaluation_id)
    return await converters.human_evaluation_db_to_pydantic(evaluation)


async def delete_human_evaluations(evaluation_ids: List[str]) -> None:
    """
    Delete evaluations by their IDs.

    Args:
        evaluation_ids (List[str]): A list of evaluation IDs.

    Raises:
        HTTPException: If evaluation not found or access denied.
    """
    for evaluation_id in evaluation_ids:
        evaluation = await _fetch_human_evaluation(evaluation_id=evaluation_id)
        await evaluation.delete()


async def delete_evaluations(evaluation_ids: List[str]) -> None:
    """
    Delete evaluations by their IDs.

    Args:
        evaluation_ids (List[str]): A list of evaluation IDs.

    Raises:
        HTTPException: If evaluation not found or access denied.
    """
    for evaluation_id in evaluation_ids:
        evaluation = await db_manager.fetch_evaluation_by_id(evaluation_id)
        await evaluation.delete()


async def create_new_human_evaluation(
    payload: NewHumanEvaluation, user_uid: str
) -> HumanEvaluationDB:
    """
    Create a new evaluation based on the provided payload and additional arguments.

    Args:
        payload (NewEvaluation): The evaluation payload.
        user_uid (str): The user_uid of the user

    Returns:
        HumanEvaluationDB
    """
    user = await db_manager.get_user(user_uid)

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
        user=user,
        status=payload.status,
        evaluation_type=payload.evaluation_type,
        variants=variants,
        testset=testset,
        created_at=current_time,
        updated_at=current_time,
    )
    
    if isCloudEE():
        eval_instance.organization = app.organization
        eval_instance.workspace = app.workspace
    
    newEvaluation = await eval_instance.create()
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
    app_id: str,
    variant_id: str,
    evaluator_config_ids: List[str],
    testset_id: str,
) -> Evaluation:
    """
    Create a new evaluation in the db

    Args:
        app_id (str): The ID of the app.
        variant_id (str): The ID of the variant.
        evaluator_config_ids (List[str]): The IDs of the evaluator configurations.
        testset_id (str): The ID of the testset.

    Returns:
        Evaluation: The newly created evaluation.
    """

    app = await db_manager.fetch_app_by_id(app_id=app_id)

    testset = await db_manager.fetch_testset_by_id(testset_id)

    evaluation_db = await db_manager.create_new_evaluation(
        app=app,
        user=app.user,
        testset=testset,
        status=EvaluationStatusEnum.EVALUATION_STARTED,
        variant=variant_id,
        evaluators_configs=evaluator_config_ids,
        organization=app.organization if isCloudEE() else None,
        workspace=app.workspace if isCloudEE() else None,
    )
    return await converters.evaluation_db_to_pydantic(evaluation_db)


async def retrieve_evaluation_results(evaluation_id: str) -> List[dict]:
    """Retrieve the aggregated results for a given evaluation.

    Args:
        evaluation_id (str): the evaluation id

    Returns:
        List[dict]: evaluation aggregated results
    """

    # Check for access rights
    evaluation = await db_manager.fetch_evaluation_by_id(evaluation_id)
    return await converters.aggregated_result_to_pydantic(evaluation.aggregated_results)


async def compare_evaluations_scenarios(
    evaluations_ids: List[str],
):
    evaluation = await db_manager.fetch_evaluation_by_id(evaluations_ids[0])
    testset = evaluation.testset
    unique_testset_datapoints = remove_duplicates(testset.csvdata)
    formatted_inputs = extract_inputs_values_from_testset(unique_testset_datapoints)
    # # formatted_inputs: [{'input_name': 'country', 'input_value': 'Nauru'}]

    all_scenarios = []

    for evaluation_id in evaluations_ids:
        eval_scenarios = await fetch_evaluation_scenarios_for_evaluation(evaluation_id)
        all_scenarios.append(eval_scenarios)

    grouped_scenarios_by_inputs = find_scenarios_by_input(
        formatted_inputs, all_scenarios
    )

    return grouped_scenarios_by_inputs


def extract_inputs_values_from_testset(testset):
    extracted_values = []

    input_keys = testset[0].keys()

    for entry in testset:
        for key in input_keys:
            if key != "correct_answer":
                extracted_values.append({"input_name": key, "input_value": entry[key]})

    return extracted_values


def find_scenarios_by_input(formatted_inputs, all_scenarios):
    results = []
    flattened_scenarios = [
        scenario for sublist in all_scenarios for scenario in sublist
    ]

    for formatted_input in formatted_inputs:
        input_name = formatted_input["input_name"]
        input_value = formatted_input["input_value"]

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

    return {
        "inputs": formatted_inputs,
        "data": results,
    }


def remove_duplicates(csvdata):
    unique_data = set()
    unique_entries = []

    for entry in csvdata:
        entry_tuple = tuple(entry.items())
        if entry_tuple not in unique_data:
            unique_data.add(entry_tuple)
            unique_entries.append(entry)

    return unique_entries
