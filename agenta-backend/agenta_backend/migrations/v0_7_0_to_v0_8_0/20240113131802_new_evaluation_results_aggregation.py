import asyncio
from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field
from beanie import free_fall_migration, Document, Link, PydanticObjectId


class OrganizationDB(Document):
    name: str = Field(default="agenta")
    description: str = Field(default="")
    type: Optional[str]
    owner: str  # user id
    members: Optional[List[PydanticObjectId]]
    created_at: Optional[datetime] = Field(default=datetime.now())
    updated_at: Optional[datetime] = Field(default=datetime.now())

    class Settings:
        name = "organizations"


class UserDB(Document):
    uid: str = Field(default="0", unique=True, index=True)
    username: str = Field(default="agenta")
    email: str = Field(default="demo@agenta.ai", unique=True)
    organizations: Optional[List[PydanticObjectId]] = []
    created_at: Optional[datetime] = Field(default=datetime.now())
    updated_at: Optional[datetime] = Field(default=datetime.now())

    class Settings:
        name = "users"


class AppDB(Document):
    app_name: str
    organization: Link[OrganizationDB]
    user: Link[UserDB]
    created_at: Optional[datetime] = Field(default=datetime.now())
    updated_at: Optional[datetime] = Field(default=datetime.now())

    class Settings:
        name = "app_db"


class TestSetDB(Document):
    name: str
    app: Link[AppDB]
    csvdata: List[Dict[str, str]]
    user: Link[UserDB]
    organization: Link[OrganizationDB]
    created_at: Optional[datetime] = Field(default=datetime.now())
    updated_at: Optional[datetime] = Field(default=datetime.now())

    class Settings:
        name = "testsets"


class Result(BaseModel):
    type: str
    value: Any


class EvaluationScenarioResult(BaseModel):
    evaluator_config: PydanticObjectId
    result: Result


class AggregatedResult(BaseModel):
    evaluator_config: PydanticObjectId
    result: Result


class EvaluationScenarioInputDB(BaseModel):
    name: str
    type: str
    value: str


class EvaluationScenarioOutputDB(BaseModel):
    type: str
    value: Any


class EvaluationDB(Document):
    app: Link[AppDB]
    organization: Link[OrganizationDB]
    user: Link[UserDB]
    status: str = Field(default="EVALUATION_INITIALIZED")
    testset: Link[TestSetDB]
    variant: PydanticObjectId
    evaluators_configs: List[PydanticObjectId]
    aggregated_results: List[AggregatedResult]
    created_at: datetime = Field(default=datetime.now())
    updated_at: datetime = Field(default=datetime.now())

    class Settings:
        name = "new_evaluations"


class EvaluationScenarioDB(Document):
    user: Link[UserDB]
    organization: Link[OrganizationDB]
    evaluation: Link[EvaluationDB]
    variant_id: PydanticObjectId
    inputs: List[EvaluationScenarioInputDB]
    outputs: List[EvaluationScenarioOutputDB]
    correct_answer: Optional[str]
    is_pinned: Optional[bool]
    note: Optional[str]
    evaluators_configs: List[PydanticObjectId]
    results: List[EvaluationScenarioResult]
    created_at: datetime = Field(default=datetime.now())
    updated_at: datetime = Field(default=datetime.now())

    class Settings:
        name = "new_evaluation_scenarios"


def prepare_evaluation_keyvalue_store(
    evaluation_id: str, evaluation_keyvalue_store: Dict
) -> Dict[str, Dict[str, Any]]:
    """
    Construct a key-value store to saves results based on a evaluator config in an evaluation

    Args:
        evaluation_id (str): ID of evaluation
        evaluation_keyvalue_store (Dict): evaluation keyvalue store

    Returns:
        Dict[str, Dict[str, Any]]: {"evaluation_id": {"evaluation_config_id": {"results": [Result("type": str, "value": Any)]}}}
    """

    if evaluation_id not in evaluation_keyvalue_store:
        evaluation_keyvalue_store[evaluation_id] = {}

    return evaluation_keyvalue_store


def prepare_evaluator_keyvalue_store(
    evaluation_id: str, evaluator_id: str, evaluation_keyvalue_store: Dict
) -> Dict[str, Dict[str, Any]]:
    """
    Construct a key-value store to saves results based on a evaluator config in an evaluation

    Args:
        evaluation_id (str): ID of evaluation
        evaluator_id (str): ID of evaluator config
        evaluation_keyvalue_store (Dict): evaluation keyvalue store

    Returns:
        Dict[str, Dict[str, Any]]: {"evaluation_id": {"evaluation_config_id": {"results": [Result("type": str, "value": Any)]}}}
    """

    if evaluator_id not in evaluation_keyvalue_store[evaluation_id]:
        evaluation_keyvalue_store[evaluation_id][evaluator_id] = {"results": []}

    return evaluation_keyvalue_store


def get_numeric_value(value: Any):
    """
    Converts the given value to a numeric representation, with specific
    conversions for strings such as 'correct', 'wrong', 'true', and 'false'.
    """

    if isinstance(value, str):
        if value.lower() == "correct":
            return 1
        elif value.lower() == "wrong":
            return 0
        elif value.lower() == "true":
            return float(True)
        elif value.lower() == "false":
            return float(False)
        else:
            try:
                return float(value)
            except ValueError:
                return 0
    return 0


def aggregate_evaluator_results(
    evaluators_aggregated_data: dict,
) -> List[AggregatedResult]:
    aggregated_results = []
    for config_id, evaluator_store in evaluators_aggregated_data.items():
        results: List[EvaluationScenarioResult] = evaluator_store.get("results", [])
        if len(results) >= 1:
            values = [get_numeric_value(result.result.value) for result in results]
            average_value = sum(values) / len(values)
        else:
            average_value = 0

        aggregated_result = AggregatedResult(
            evaluator_config=PydanticObjectId(config_id),
            result=Result(type="number", value=round(average_value, 4)),
        )
        aggregated_results.append(aggregated_result)
    return aggregated_results


def modify_evaluation_scenario_store(
    evaluator_id: str,
    result: Result,
    evaluation_keyvalue_store: Dict[str, Dict[str, List[Any]]],
):
    """
    Updates an evaluation scenario store by adding a result to the list of results for a
    specific evaluation and evaluator.

    Args:
        evaluator_id (str): ID of evaluator config
        result: The evaluation result that needs to be added to the evaluation_results list
        evaluation_keyvalue_store: The store that holds the evaluation data
    """

    evaluation_evaluator_config_store = evaluation_keyvalue_store[evaluator_id]
    evaluation_results = list(evaluation_evaluator_config_store["results"])
    if result not in evaluation_results:
        evaluation_results.append(result)
        evaluation_evaluator_config_store["results"] = list(evaluation_results)


class Forward:
    @free_fall_migration(
        document_models=[
            AppDB,
            OrganizationDB,
            UserDB,
            TestSetDB,
            EvaluationDB,
            EvaluationScenarioDB,
        ]
    )
    async def aggregate_new_evaluation_with_evaluation_scenario_results(self, session):
        # STEP 1:
        # Create a key-value store that saves all the evaluator configs & results for a particular evaluation id
        # Example: {"evaluation_id": {"evaluation_config_id": {"results": [}}}
        evaluation_keyvalue_store = {}
        new_auto_evaluations = await EvaluationDB.find().to_list()
        print("### len new_auto_evaluations", len(new_auto_evaluations))

        for auto_evaluation in new_auto_evaluations:
            evaluation_keyvalue_store = prepare_evaluation_keyvalue_store(
                str(auto_evaluation.id),
                evaluation_keyvalue_store,
            )
            for evaluator_config in auto_evaluation.evaluators_configs:
                evaluation_keyvalue_store = prepare_evaluator_keyvalue_store(
                    str(auto_evaluation.id),
                    str(evaluator_config),
                    evaluation_keyvalue_store,
                )

        print("### len evaluation_keyvalue_store", len(evaluation_keyvalue_store))
        await asyncio.sleep(2)

        # STEP 2:
        # Update the evaluation key-value store
        new_auto_evaluation_scenarios = await EvaluationScenarioDB.find(
            fetch_links=True
        ).to_list()
        for auto_evaluation in new_auto_evaluation_scenarios:
            evaluation_id = str(auto_evaluation.evaluation.id)

            # Check if the evaluation_id exists in the key-value store
            if evaluation_id in evaluation_keyvalue_store:
                evaluation_store = evaluation_keyvalue_store[evaluation_id]
                configs_with_results = zip(
                    auto_evaluation.evaluators_configs, auto_evaluation.results
                )
                for evaluator, result in configs_with_results:
                    modify_evaluation_scenario_store(
                        str(evaluator), result, evaluation_store
                    )
            else:
                print(
                    f"Warning: Evaluation ID {evaluation_id} not found in the key-value store."
                )

        # STEP 3:
        # Modify the evaluations with the aggregated results from the keyvalue store
        for auto_evaluation in new_auto_evaluations:
            aggregated_results = aggregate_evaluator_results(
                evaluation_keyvalue_store[str(auto_evaluation.id)]
            )
            auto_evaluation.status = "EVALUATION_FINISHED"
            auto_evaluation.aggregated_results = aggregated_results
            auto_evaluation.updated_at = datetime.now().isoformat()
            await auto_evaluation.save()


class Backward:
    pass
