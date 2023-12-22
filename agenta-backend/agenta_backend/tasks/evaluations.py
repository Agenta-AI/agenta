import asyncio
from typing import List
from celery import shared_task
from collections import defaultdict

from agenta_backend.services import llm_apps_service
from agenta_backend.services.db_manager import (
    fetch_evaluation_by_id,
    fetch_app_variant_by_id,
    fetch_evaluator_config,
    get_deployment_by_objectid,
    fetch_testset_by_id,
    create_aggregated_results,
    create_new_evaluation_scenario,
    fetch_evaluator_config_by_appId,
    update_evaluation_with_aggregated_results,
)
from agenta_backend.models.db_models import (
    AppDB,
    EvaluationScenarioOutputDB,
    EvaluationScenarioResult,
    AggregatedResultDB,
    Result,
)
from agenta_backend.services import evaluators_service
from agenta_backend.models.api.evaluation_model import NewEvaluation


@shared_task(queue="agenta_backend.tasks.evaluations.evaluate")
def evaluate(
    app_data: dict, new_evaluation_data: dict, evaluation_id: str, testset_id: str
):
    loop = asyncio.get_event_loop()
    app = AppDB(**app_data)
    evaluation = NewEvaluation(**new_evaluation_data)

    testset = loop.run_until_complete(fetch_testset_by_id(testset_id))
    new_evaluation_db = loop.run_until_complete(fetch_evaluation_by_id(evaluation_id))
    evaluators_aggregated_data = defaultdict(list)

    for variant_id in evaluation.variant_ids:
        variant_id = str(variant_id)

        app_variant_db = loop.run_until_complete(fetch_app_variant_by_id(variant_id))
        deployment = loop.run_until_complete(
            get_deployment_by_objectid(app_variant_db.base.deployment)
        )

        # TODO: remove if abraham's fix is working
        uri = deployment.uri.replace("http://localhost", "http://host.docker.internal")

        for data_point in testset.csvdata:
            variant_output = llm_apps_service.get_llm_app_output(uri, data_point)

            evaluators_results: [EvaluationScenarioResult] = []
            for evaluator_config_id in evaluation.evaluators_configs:
                evaluator_config = loop.run_until_complete(
                    fetch_evaluator_config(evaluator_config_id)
                )
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

    aggregated_results = loop.run_until_complete(
        aggregate_evaluator_results(app, evaluators_aggregated_data)
    )
    updated_evaluation = loop.run_until_complete(
        update_evaluation_with_aggregated_results(
            new_evaluation_db.id, aggregated_results
        )
    )


async def aggregate_evaluator_results(
    app: AppDB, evaluators_aggregated_data: dict
) -> List[AggregatedResultDB]:
    aggregated_results = []
    for evaluator_key, values in evaluators_aggregated_data.items():
        average_value = sum(values) / len(values) if values else 0
        evaluator_config = await fetch_evaluator_config_by_appId(app.id, evaluator_key)
        aggregated_result_db = await create_aggregated_results(
            str(evaluator_config.id), str(average_value)
        )
        aggregated_results.append(aggregated_result_db)
    return aggregated_results
