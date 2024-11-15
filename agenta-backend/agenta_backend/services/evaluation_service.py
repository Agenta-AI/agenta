import uuid
import logging
from typing import Dict, List
from datetime import datetime, timezone

from fastapi import HTTPException

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

from agenta_backend.models.shared_models import (
    HumanEvaluationScenarioInput,
    HumanEvaluationScenarioOutput,
    Result,
)


logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


class UpdateEvaluationScenarioError(Exception):
    """Custom exception for update evaluation scenario errors."""

    pass


async def prepare_csvdata_and_create_evaluation_scenario(
    csvdata: List[Dict[str, str]],
    payload_inputs: List[str],
    project_id: str,
    evaluation_type: EvaluationType,
    new_evaluation: HumanEvaluationDB,
):
    """
    Prepares CSV data and creates evaluation scenarios based on the inputs, evaluation
    type, and other parameters provided.

    Args:
        csvdata: A list of dictionaries representing the CSV data.
        payload_inputs: A list of strings representing the names of the inputs in the variant.
        project_id (str): The ID of the project
        evaluation_type: The type of evaluation
        new_evaluation: The instance of EvaluationDB
    """

    for datum in csvdata:
        # Check whether the inputs in the test set match the inputs in the variant
        try:
            inputs = [
                {"input_name": name, "input_value": datum[name]}
                for name in payload_inputs
            ]
        except KeyError:
            await db_manager.delete_human_evaluation(
                evaluation_id=str(new_evaluation.id)
            )
            msg = f"""
            Columns in the test set should match the names of the inputs in the variant.
            Inputs names in variant are: {[variant_input for variant_input in payload_inputs]} while
            columns in test set are: {[col for col in datum.keys() if col != 'correct_answer']}
            """
            raise HTTPException(
                status_code=400,
                detail=msg,
            )

        # Prepare scenario inputs
        list_of_scenario_input = []
        for scenario_input in inputs:
            eval_scenario_input_instance = HumanEvaluationScenarioInput(
                input_name=scenario_input["input_name"],
                input_value=scenario_input["input_value"],
            )
            list_of_scenario_input.append(eval_scenario_input_instance)

        evaluation_scenario_extend_payload = {
            **_extend_with_evaluation(evaluation_type),
            **_extend_with_correct_answer(evaluation_type, datum),
        }
        await db_manager.create_human_evaluation_scenario(
            inputs=list_of_scenario_input,
            project_id=project_id,
            evaluation_id=str(new_evaluation.id),
            evaluation_extend=evaluation_scenario_extend_payload,
        )


async def update_human_evaluation_service(
    evaluation: EvaluationDB, update_payload: HumanEvaluationUpdate
) -> None:
    """
    Update an existing evaluation based on the provided payload.

    Args:
        evaluation (EvaluationDB): The evaluation instance.
        update_payload (EvaluationUpdate): The payload for the update.
    """

    # Update the evaluation
    await db_manager.update_human_evaluation(
        evaluation_id=str(evaluation.id), values_to_update=update_payload.model_dump()
    )


async def fetch_evaluation_scenarios_for_evaluation(
    evaluation_id: str, project_id: str
):
    """
    Fetch evaluation scenarios for a given evaluation ID.

    Args:
        evaluation_id (str): The ID of the evaluation.
        project_id (str): The ID of the project.

    Returns:
        List[EvaluationScenario]: A list of evaluation scenarios.
    """

    evaluation_scenarios = await db_manager.fetch_evaluation_scenarios(
        evaluation_id=evaluation_id, project_id=project_id
    )
    return [
        await converters.evaluation_scenario_db_to_pydantic(
            evaluation_scenario_db=evaluation_scenario, evaluation_id=evaluation_id
        )
        for evaluation_scenario in evaluation_scenarios
    ]


async def fetch_human_evaluation_scenarios_for_evaluation(
    human_evaluation: HumanEvaluationDB,
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
    human_evaluation_scenarios = await db_manager.fetch_human_evaluation_scenarios(
        evaluation_id=str(human_evaluation.id)
    )
    eval_scenarios = [
        converters.human_evaluation_scenario_db_to_pydantic(
            evaluation_scenario_db=human_evaluation_scenario,
            evaluation_id=str(human_evaluation.id),
        )
        for human_evaluation_scenario in human_evaluation_scenarios
    ]
    return eval_scenarios


async def update_human_evaluation_scenario(
    evaluation_scenario_db: HumanEvaluationScenarioDB,
    evaluation_scenario_data: EvaluationScenarioUpdate,
    evaluation_type: EvaluationType,
) -> None:
    """
    Updates an evaluation scenario.

    Args:
        evaluation_scenario_db (EvaluationScenarioDB): The evaluation scenario instance.
        evaluation_scenario_data (EvaluationScenarioUpdate): New data for the scenario.
        evaluation_type (EvaluationType): Type of the evaluation.

    Raises:
        HTTPException: If evaluation scenario not found or access denied.
    """

    values_to_update = {}
    payload = evaluation_scenario_data.model_dump(exclude_unset=True)

    if "score" in payload and evaluation_type == EvaluationType.single_model_test:
        values_to_update["score"] = str(payload["score"])

    if "vote" in payload and evaluation_type == EvaluationType.human_a_b_testing:
        values_to_update["vote"] = payload["vote"]

    if "outputs" in payload:
        new_outputs = [
            HumanEvaluationScenarioOutput(
                variant_id=output["variant_id"],
                variant_output=output["variant_output"],
            ).model_dump()
            for output in payload["outputs"]
        ]
        values_to_update["outputs"] = new_outputs

    if "inputs" in payload:
        new_inputs = [
            HumanEvaluationScenarioInput(
                input_name=input_item["input_name"],
                input_value=input_item["input_value"],
            ).model_dump()
            for input_item in payload["inputs"]
        ]
        values_to_update["inputs"] = new_inputs

    if "is_pinned" in payload:
        values_to_update["is_pinned"] = payload["is_pinned"]

    if "note" in payload:
        values_to_update["note"] = payload["note"]

    if "correct_answer" in payload:
        values_to_update["correct_answer"] = payload["correct_answer"]

    await db_manager.update_human_evaluation_scenario(
        evaluation_scenario_id=str(evaluation_scenario_db.id),
        values_to_update=values_to_update,
    )


def _extend_with_evaluation(evaluation_type: EvaluationType):
    evaluation = {}
    if evaluation_type == EvaluationType.single_model_test:
        evaluation["score"] = ""

    if evaluation_type == EvaluationType.human_a_b_testing:
        evaluation["vote"] = ""
    return evaluation


def _extend_with_correct_answer(evaluation_type: EvaluationType, row: dict):
    correct_answer = {"correct_answer": ""}
    if row.get("correct_answer") is not None:
        correct_answer["correct_answer"] = row["correct_answer"]
    return correct_answer


async def fetch_list_evaluations(app: AppDB, project_id: str) -> List[Evaluation]:
    """
    Fetches a list of evaluations based on the provided filtering criteria.

    Args:
        app (AppDB): An app to filter the evaluations.
        project_id (str): The ID of the project

    Returns:
        List[Evaluation]: A list of evaluations.
    """

    evaluations_db = await db_manager.list_evaluations(
        app_id=str(app.id), project_id=project_id
    )
    return [
        await converters.evaluation_db_to_pydantic(evaluation)
        for evaluation in evaluations_db
    ]


async def fetch_list_human_evaluations(
    app_id: str, project_id: str
) -> List[HumanEvaluation]:
    """
    Fetches a list of evaluations based on the provided filtering criteria.

    Args:
        app_id (Optional[str]): An optional app ID to filter the evaluations.
        project_id (str): The ID of the project.

    Returns:
        List[Evaluation]: A list of evaluations.
    """

    evaluations_db = await db_manager.list_human_evaluations(
        app_id=app_id, project_id=project_id
    )
    return [
        await converters.human_evaluation_db_to_pydantic(evaluation)
        for evaluation in evaluations_db
    ]


async def fetch_human_evaluation(human_evaluation_db) -> HumanEvaluation:
    """
    Fetches a single evaluation based on its ID.

    Args:
        human_evaluation_db (HumanEvaluationDB): The evaluation instance.

    Returns:
        Evaluation: The fetched evaluation.
    """

    return await converters.human_evaluation_db_to_pydantic(human_evaluation_db)


async def delete_human_evaluations(evaluation_ids: List[str]) -> None:
    """
    Delete evaluations by their IDs.

    Args:
        evaluation_ids (List[str]): A list of evaluation IDs.
        project_id (str): The ID of the project.

    Raises:
        NoResultFound: If evaluation not found or access denied.
    """

    for evaluation_id in evaluation_ids:
        await db_manager.delete_human_evaluation(evaluation_id=evaluation_id)


async def delete_evaluations(evaluation_ids: List[str]) -> None:
    """
    Delete evaluations by their IDs.

    Args:
        evaluation_ids (List[str]): A list of evaluation IDs.

    Raises:
        HTTPException: If evaluation not found or access denied.
    """

    await db_manager.delete_evaluations(evaluation_ids=evaluation_ids)


async def create_new_human_evaluation(payload: NewHumanEvaluation) -> HumanEvaluationDB:
    """
    Create a new evaluation based on the provided payload and additional arguments.

    Args:
        payload (NewEvaluation): The evaluation payload.

    Returns:
        HumanEvaluationDB
    """

    app = await db_manager.fetch_app_by_id(app_id=payload.app_id)
    if app is None:
        raise HTTPException(
            status_code=404,
            detail=f"App with id {payload.app_id} does not exist",
        )

    human_evaluation = await db_manager.create_human_evaluation(
        app=app,
        status=payload.status,
        evaluation_type=payload.evaluation_type,
        testset_id=payload.testset_id,
        variants_ids=payload.variant_ids,
    )
    if human_evaluation is None:
        raise HTTPException(
            status_code=500, detail="Failed to create evaluation_scenario"
        )

    await prepare_csvdata_and_create_evaluation_scenario(
        human_evaluation.testset.csvdata,
        payload.inputs,
        str(app.project_id),
        payload.evaluation_type,
        human_evaluation,
    )
    return human_evaluation


async def create_new_evaluation(
    app_id: str,
    project_id: str,
    variant_id: str,
    testset_id: str,
) -> Evaluation:
    """
    Create a new evaluation in the db

    Args:
        app_id (str): The ID of the app.
        project_id (str): The ID of the project.
        variant_id (str): The ID of the variant.
        testset_id (str): The ID of the testset.

    Returns:
        Evaluation: The newly created evaluation.
    """

    app = await db_manager.fetch_app_by_id(app_id=app_id)
    testset = await db_manager.fetch_testset_by_id(testset_id=testset_id)
    variant_db = await db_manager.get_app_variant_instance_by_id(
        variant_id=variant_id, project_id=project_id
    )

    assert variant_db is not None, f"App variant with ID {variant_id} cannot be None."
    assert (
        variant_db.revision is not None
    ), f"Revision of App variant with ID {variant_id} cannot be None"
    variant_revision = await db_manager.fetch_app_variant_revision_by_variant(
        app_variant_id=variant_id, project_id=project_id, revision=variant_db.revision  # type: ignore
    )

    evaluation_db = await db_manager.create_new_evaluation(
        app=app,
        project_id=project_id,
        testset=testset,
        status=Result(
            value=EvaluationStatusEnum.EVALUATION_INITIALIZED, type="status", error=None
        ),
        variant=variant_id,
        variant_revision=str(variant_revision.id),
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


async def compare_evaluations_scenarios(evaluations_ids: List[str], project_id: str):
    evaluation = await db_manager.fetch_evaluation_by_id(evaluations_ids[0])
    testset = evaluation.testset
    unique_testset_datapoints = remove_duplicates(testset.csvdata)
    formatted_inputs = extract_inputs_values_from_testset(unique_testset_datapoints)
    # # formatted_inputs: [{'input_name': 'country', 'input_value': 'Nauru'}]

    all_scenarios = []

    for evaluation_id in evaluations_ids:
        eval_scenarios = await fetch_evaluation_scenarios_for_evaluation(
            evaluation_id=evaluation_id, project_id=project_id
        )
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
