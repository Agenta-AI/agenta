from typing import List


from oss.src.utils.logging import get_module_logger
from oss.src.services import converters
from oss.src.services import db_manager

from oss.src.models.api.evaluation_model import (
    Evaluation,
    EvaluationStatusEnum,
)
from oss.src.models.db_models import AppDB

from oss.src.models.shared_models import (
    Result,
)

log = get_module_logger(__name__)


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


async def delete_evaluations(evaluation_ids: List[str]) -> None:
    """
    Delete evaluations by their IDs.

    Args:
        evaluation_ids (List[str]): A list of evaluation IDs.

    Raises:
        HTTPException: If evaluation not found or access denied.
    """

    await db_manager.delete_evaluations(evaluation_ids=evaluation_ids)


async def create_new_evaluation(
    app_id: str,
    project_id: str,
    revision_id: str,
    testset_id: str,
) -> Evaluation:
    """
    Create a new evaluation in the db

    Args:
        app_id (str): The ID of the app.
        project_id (str): The ID of the project.
        revision_id (str): The ID of the variant revision.
        testset_id (str): The ID of the testset.

    Returns:
        Evaluation: The newly created evaluation.
    """

    app = await db_manager.fetch_app_by_id(app_id=app_id)
    testset = await db_manager.fetch_testset_by_id(
        project_id=project_id,
        #
        testset_id=testset_id,
    )
    variant_revision = await db_manager.fetch_app_variant_revision_by_id(
        variant_revision_id=revision_id
    )

    assert variant_revision and variant_revision.revision is not None, (
        f"Variant revision with {revision_id} cannot be None"
    )

    assert testset is not None, f"Testset with id {testset_id} does not exist"

    evaluation_db = await db_manager.create_new_evaluation(
        app=app,
        project_id=project_id,
        testset=testset,
        status=Result(
            value=EvaluationStatusEnum.EVALUATION_INITIALIZED, type="status", error=None
        ),
        variant=str(variant_revision.variant_id),
        variant_revision=str(variant_revision.id),
    )
    return await converters.evaluation_db_to_pydantic(evaluation_db)


async def compare_evaluations_scenarios(evaluations_ids: List[str], project_id: str):
    evaluation = await db_manager.fetch_evaluation_by_id(
        project_id=project_id,
        evaluation_id=evaluations_ids[0],
    )
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
