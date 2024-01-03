import os
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
    create_new_evaluation_scenario,
    fetch_evaluator_config_by_appId,
    update_evaluation_with_aggregated_results,
)
from agenta_backend.models.db_models import (
    AppDB,
    EvaluationScenarioInputDB,
    EvaluationScenarioOutputDB,
    EvaluationScenarioResult,
    AggregatedResult,
    Result,
)
from agenta_backend.services import evaluators_service
from agenta_backend.models.api.evaluation_model import NewEvaluation, AppOutput


@shared_task(queue="agenta_backend.tasks.evaluations.evaluate")
def evaluate(
    app_data: dict,
    new_evaluation_data: dict,
    evaluation_id: str,
    testset_id: str,
):
    loop = asyncio.get_event_loop()
    app = AppDB(**app_data)
    evaluation = NewEvaluation(**new_evaluation_data)

    testset = loop.run_until_complete(fetch_testset_by_id(testset_id))
    new_evaluation_db = loop.run_until_complete(fetch_evaluation_by_id(evaluation_id))
    evaluators_aggregated_data = defaultdict(list)

    variant_id = str(evaluation.variant_ids[0])

    app_variant_db = loop.run_until_complete(fetch_app_variant_by_id(variant_id))
    deployment = loop.run_until_complete(
        get_deployment_by_objectid(app_variant_db.base.deployment)
    )

    #!NOTE: do not remove! this will be used in github workflow!
    backend_environment = os.environ.get("ENVIRONMENT")
    if backend_environment is not None and backend_environment == "github":
        uri = f"http://{deployment.container_name}"
    else:
        uri = deployment.uri.replace("http://localhost", "http://host.docker.internal")

    # 2. We get the output from the llm app
    app_outputs: List[AppOutput] = loop.run_until_complete(
        llm_apps_service.batch_invoke(
            uri, testset.csvdata, evaluation.rate_limit.dict()
        )
    )
    for data_point, app_output in zip(testset.csvdata, app_outputs):
        if len(testset.csvdata) != len(app_outputs):
            # TODO: properly handle error in the case where the length are not the same
            break

        # 2. We prepare the inputs
        raw_inputs = (
            app_variant_db.parameters.get("inputs", [])
            if app_variant_db.parameters
            else []
        )
        inputs = []
        if raw_inputs:
            inputs = [
                EvaluationScenarioInputDB(
                    name=input_item["name"],
                    type="text",
                    value=data_point[input_item["name"]],
                )
                for input_item in raw_inputs
            ]

        # 3. We evaluate
        evaluators_results: [EvaluationScenarioResult] = []
        for evaluator_config_id in evaluation.evaluators_configs:
            evaluator_config = loop.run_until_complete(
                fetch_evaluator_config(evaluator_config_id)
            )

            additional_kwargs = (
                {
                    "app_params": app_variant_db.config.parameters,
                    "inputs": data_point,  # TODO: fetch input from config parameters when #1102 has been fixed
                }
                if evaluator_config.evaluator_key == "custom_code_run"
                else {}
            )
            result = evaluators_service.evaluate(
                evaluator_config.evaluator_key,
                app_output.output,
                data_point["correct_answer"],
                evaluator_config.settings_values,
                **additional_kwargs,
            )

            result_object = EvaluationScenarioResult(
                evaluator_config=evaluator_config.id,
                result=result,
            )
            evaluators_results.append(result_object)
            evaluators_aggregated_data[evaluator_config.evaluator_key].append(result)

    # 4. We create a new evaluation scenario
    evaluation_scenario = loop.run_until_complete(
        create_new_evaluation_scenario(
            user=app.user,
            organization=app.organization,
            evaluation=new_evaluation_db,
            variant_id=variant_id,
            evaluators_configs=new_evaluation_db.evaluators_configs,
            inputs=inputs,
            is_pinned=False,
            note="",
            correct_answer=data_point["correct_answer"],
            outputs=[EvaluationScenarioOutputDB(type="text", value=app_output.output)],
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
) -> List[AggregatedResult]:
    aggregated_results = []
    for evaluator_key, results in evaluators_aggregated_data.items():
        if evaluator_key != "auto_ai_critique":
            average_value = (
                sum([result.value for result in results]) / len(results)
                if results
                else 0
            )
        elif evaluator_key == "auto_ai_critique":
            try:
                average_value = (
                    sum(
                        [
                            int(result.value)
                            for result in results
                            if isinstance(int(result.value), int)
                        ]
                    )
                    / len(results)
                    if results
                    else 0
                )
            except TypeError:
                average_value = None
        evaluator_config = await fetch_evaluator_config_by_appId(app.id, evaluator_key)
        aggregated_result = AggregatedResult(
            evaluator_config=evaluator_config.id,
            result=Result(type="number", value=average_value),
        )
        aggregated_results.append(aggregated_result)
    return aggregated_results
