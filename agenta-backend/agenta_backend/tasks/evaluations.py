from collections import defaultdict
from bson import ObjectId
from celery import shared_task
import asyncio
from datetime import datetime
from typing import List, Tuple, Dict
import uuid

from agenta_backend.services import llm_apps_service
from agenta_backend.services.db_manager import (
    fetch_evaluation_by_id,
    fetch_app_variant_by_id,
    get_deployment_by_objectid,
    fetch_testset_by_id,
    create_new_evaluation_scenario,
    update_evaluation_with_aggregated_results,
)
from agenta_backend.models.api.evaluation_model import EvaluatorConfig, NewEvaluation

from agenta_backend.models.db_models import (
    AppDB,
    EvaluationScenarioOutputDB,
    EvaluationScenarioResult,
    EvaluatorConfigDB,
    AggregatedResultDB,
    Result,
)

from agenta_backend.services import evaluators_service


@shared_task(queue="agenta_backend.tasks.evaluations.evaluate")
def evaluate(
    app_data: dict, new_evaluation_data: dict, evaluation_id: str, testset_id: str
):
    loop = asyncio.get_event_loop()
    new_evaluation = NewEvaluation(**new_evaluation_data)
    app = AppDB(**app_data)

    # NOTE: This will generate a name in case it's run from cli
    (
        evaluation_evaluators_configs,
        evaluator_key_name_mapping,
    ) = process_evaluators_configs(new_evaluation.evaluators_configs)

    testset = loop.run_until_complete(fetch_testset_by_id(testset_id))
    new_evaluation_db = loop.run_until_complete(fetch_evaluation_by_id(evaluation_id))
    evaluators_aggregated_data = defaultdict(list)

    for variant_id in new_evaluation.variant_ids:
        variant_id = str(variant_id)
        app_variant_db = loop.run_until_complete(fetch_app_variant_by_id(variant_id))
        deployment = loop.run_until_complete(
            get_deployment_by_objectid(app_variant_db.base.deployment)
        )

        # TODO: remove if abraham's fix is working
        uri = deployment.uri.replace("http://localhost", "http://obsidian")

        for data_point in testset.csvdata:
            variant_output = llm_apps_service.get_llm_app_output(uri, data_point)

            evaluators_results: [EvaluationScenarioResult] = []
            for evaluator_config in evaluation_evaluators_configs:
                result = evaluators_service.evaluate(
                    evaluator_config.evaluator_key,
                    data_point["correct_answer"],
                    variant_output,
                )

                result_object = EvaluationScenarioResult(
                    evaluator_key=evaluator_config.evaluator_key,
                    result=Result(type="number", value=result),
                )
                evaluators_results.append(result_object)
                evaluators_aggregated_data[evaluator_config.evaluator_key].append(
                    result
                )

            evaluation_scenario = loop.run_until_complete(
                create_new_evaluation_scenario(
                    user=app.user,
                    organization=app.organization,
                    evaluation=new_evaluation_db,
                    evaluators_configs=new_evaluation_db.evaluators_configs,
                    inputs=[],
                    is_pinned=False,
                    note="",
                    correct_answer=data_point["correct_answer"],
                    outputs=[
                        EvaluationScenarioOutputDB(type="text", value=variant_output)
                    ],
                    results=evaluators_results,
                )
            )

    aggregated_results = aggregate_evaluator_results(
        evaluators_aggregated_data, evaluator_key_name_mapping
    )

    updated_evaluation = loop.run_until_complete(
        update_evaluation_with_aggregated_results(
            new_evaluation_db.id, aggregated_results
        )
    )


def process_evaluators_configs(
    evaluators_configs: List[EvaluatorConfig],
) -> Tuple[List[EvaluatorConfigDB], Dict[str, str]]:
    """Process evaluators_configs to include names if missing and return a mapping of evaluator keys to names."""
    processed_configs = []
    evaluator_key_name_mapping = {}
    for config in evaluators_configs:
        config_dict = config.dict()
        if "name" not in config_dict:
            config_dict["name"] = f"Evaluator_{uuid.uuid4()}"  # Generate a random name
        processed_config = EvaluatorConfigDB(**config_dict)
        processed_configs.append(processed_config)
        evaluator_key_name_mapping[config_dict["evaluator_key"]] = config_dict["name"]
    return processed_configs, evaluator_key_name_mapping


def aggregate_evaluator_results(evaluators_aggregated_data, evaluator_key_name_mapping):
    aggregated_results = []
    for evaluator_key, values in evaluators_aggregated_data.items():
        average_value = sum(values) / len(values) if values else 0
        evaluator_name = evaluator_key_name_mapping.get(
            evaluator_key, "Unknown Evaluator"
        )
        aggregated_result_value = AggregatedResultDB(
            evaluator_config=EvaluatorConfigDB(
                name=evaluator_name, evaluator_key=evaluator_key
            ),
            result=Result(type="number", value=str(average_value)),
        )
        aggregated_results.append(aggregated_result_value)
    return aggregated_results
