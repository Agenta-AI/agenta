import re
import os
import asyncio
import logging
import traceback

from typing import Any, Dict, List
from celery import shared_task, states

from agenta_backend.utils.common import isCloudEE
from agenta_backend.models.db_engine import DBEngine
from agenta_backend.services import evaluators_service, llm_apps_service

from agenta_backend.models.api.evaluation_model import (
    EvaluationStatusEnum,
)
from agenta_backend.models.db_models import (
    AggregatedResult,
    AppDB,
    EvaluationScenarioInputDB,
    EvaluationScenarioOutputDB,
    EvaluationScenarioResult,
    InvokationResult,
    Error,
    Result,
)
from agenta_backend.services import (
    evaluators_service,
    llm_apps_service,
    deployment_manager,
    aggregation_service,
)
from agenta_backend.services.db_manager import (
    create_new_evaluation_scenario,
    fetch_app_by_id,
    fetch_app_variant_by_id,
    fetch_evaluation_by_id,
    fetch_evaluator_config,
    fetch_testset_by_id,
    get_deployment_by_objectid,
    update_evaluation,
    update_evaluation_with_aggregated_results,
    EvaluationScenarioResult,
    check_if_evaluation_contains_failed_evaluation_scenarios,
)

if os.environ["FEATURE_FLAG"] in ["cloud", "ee"]:
    from agenta_backend.commons.models.db_models import AppDB_ as AppDB
else:
    from agenta_backend.models.db_models import AppDB
from agenta_backend.models.db_models import (
    Result,
    AggregatedResult,
    EvaluationScenarioResult,
    EvaluationScenarioInputDB,
    EvaluationScenarioOutputDB,
)

# Set logger
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


@shared_task(queue="agenta_backend.tasks.evaluations.evaluate", bind=True)
def evaluate(
    self,
    app_id: str,
    variant_id: str,
    evaluators_config_ids: List[str],
    testset_id: str,
    evaluation_id: str,
    rate_limit_config: Dict[str, int],
    lm_providers_keys: Dict[str, Any],
    correct_answer_column: str,
):
    """
    Evaluate function that performs the evaluation of an app variant using the provided evaluators and testset.
    Saves the results in the Database

    Args:
        app_id (str): The ID of the app.
        variant_id (str): The ID of the app variant.
        evaluators_config_ids (List[str]): The IDs of the evaluators configurations to be used.
        testset_id (str): The ID of the testset.
        rate_limit_config (Dict[str,int]): See LLMRunRateLimit
        correct_answer_column (str): The name of the column in the testset that contains the correct answer.

    Returns:
        None
    """

    loop = asyncio.get_event_loop()

    try:
        # 1. Fetch data from the database
        loop.run_until_complete(DBEngine().init_db())
        app = loop.run_until_complete(fetch_app_by_id(app_id))
        app_variant_db = loop.run_until_complete(fetch_app_variant_by_id(variant_id))
        assert (
            app_variant_db is not None
        ), f"App variant with id {variant_id} not found!"
        app_variant_parameters = app_variant_db.config.parameters
        testset_db = loop.run_until_complete(fetch_testset_by_id(testset_id))
        new_evaluation_db = loop.run_until_complete(
            fetch_evaluation_by_id(evaluation_id)
        )
        evaluator_config_dbs = []
        for evaluator_config_id in evaluators_config_ids:
            evaluator_config = loop.run_until_complete(
                fetch_evaluator_config(evaluator_config_id)
            )
            evaluator_config_dbs.append(evaluator_config)
        deployment_db = loop.run_until_complete(
            get_deployment_by_objectid(app_variant_db.base.deployment)
        )
        uri = deployment_manager.get_deployment_uri(deployment_db)

        # 2. Initialize vars
        evaluators_aggregated_data = {
            str(evaluator_config_db.id): {
                "evaluator_key": evaluator_config_db.evaluator_key,
                "results": [],
            }
            for evaluator_config_db in evaluator_config_dbs
        }

        # 3. Invoke the app
        app_outputs: List[InvokationResult] = loop.run_until_complete(
            llm_apps_service.batch_invoke(
                uri,
                testset_db.csvdata,
                app_variant_parameters,
                rate_limit_config,
            )
        )

        # 4. Evaluate the app outputs
        openapi_parameters = loop.run_until_complete(
            llm_apps_service.get_parameters_from_openapi(uri + "/openapi.json")
        )

        for data_point, app_output in zip(testset_db.csvdata, app_outputs):
            # 1. We prepare the inputs
            logger.debug(f"Preparing inputs for data point: {data_point}")
            list_inputs = get_app_inputs(app_variant_parameters, openapi_parameters)
            logger.debug(f"List of inputs: {list_inputs}")

            inputs = [
                EvaluationScenarioInputDB(
                    name=input_item["name"],
                    type="text",
                    value=data_point[
                        (
                            input_item["name"]
                            if input_item["type"] != "messages"
                            else "chat"
                        )
                    ],  # TODO: We need to remove the hardcoding of chat as name for chat inputs from the FE
                )
                for input_item in list_inputs
            ]
            logger.debug(f"Inputs: {inputs}")

            # 2. We skip the iteration if error invking the llm-app
            if app_output.result.error:
                print("There is an error when invoking the llm app so we need to skip")
                error_results = [
                    EvaluationScenarioResult(
                        evaluator_config=evaluator_config_db.id,
                        result=Result(
                            type=app_output.result.type,
                            value=None,
                            error=Error(
                                message=app_output.result.error.message,
                                stacktrace=app_output.result.error.stacktrace,
                            ),
                        ),
                    )
                    for evaluator_config_db in evaluator_config_dbs
                ]
                correct_answer = (
                    data_point[correct_answer_column]
                    if correct_answer_column in data_point
                    else ""
                )

                loop.run_until_complete(
                    create_new_evaluation_scenario(
                        user=app.user,
                        organization=app.organization if isCloudEE() else None,
                        workspace=app.workspace if isCloudEE() else None,
                        evaluation=new_evaluation_db,
                        variant_id=variant_id,
                        evaluators_configs=new_evaluation_db.evaluators_configs,
                        inputs=inputs,
                        is_pinned=False,
                        note="",
                        correct_answer=correct_answer,
                        outputs=[
                            EvaluationScenarioOutputDB(
                                result=Result(
                                    type="error",
                                    value=None,
                                    error=Error(
                                        message=app_output.result.error.message,
                                        stacktrace=app_output.result.error.stacktrace,
                                    ),
                                )
                            )
                        ],
                        results=error_results,
                        rerun_count=new_evaluation_db.rerun_count,
                    )
                )
                continue

            # 3. We evaluate
            evaluators_results: [EvaluationScenarioResult] = []
            for evaluator_config_db in evaluator_config_dbs:
                logger.debug(f"Evaluating with evaluator: {evaluator_config_db}")
                if correct_answer_column in data_point:
                    result = evaluators_service.evaluate(
                        evaluator_key=evaluator_config_db.evaluator_key,
                        output=app_output.result.value,
                        correct_answer=data_point[correct_answer_column],
                        settings_values=evaluator_config_db.settings_values,
                        app_params=app_variant_parameters,
                        inputs=data_point,
                        lm_providers_keys=lm_providers_keys,
                    )
                else:
                    result = Result(
                        type="error",
                        value=None,
                        error=Error(
                            message=f"No {correct_answer_column} column in test set"
                        ),
                    )

                # Update evaluators aggregated data
                evaluator_results: List[Result] = evaluators_aggregated_data[
                    str(evaluator_config_db.id)
                ]["results"]
                evaluator_results.append(result)

                result_object = EvaluationScenarioResult(
                    evaluator_config=evaluator_config_db.id,
                    result=result,
                )
                logger.debug(f"Result: {result_object}")
                evaluators_results.append(result_object)

            # 4. We save the result of the eval scenario in the db
            correct_answer = (
                data_point[correct_answer_column]
                if correct_answer_column in data_point
                else ""
            )
            loop.run_until_complete(
                create_new_evaluation_scenario(
                    user=app.user,
                    evaluation=new_evaluation_db,
                    variant_id=variant_id,
                    evaluators_configs=new_evaluation_db.evaluators_configs,
                    inputs=inputs,
                    is_pinned=False,
                    note="",
                    correct_answer=correct_answer,
                    outputs=[
                        EvaluationScenarioOutputDB(
                            result=Result(type="text", value=app_output.result.value)
                        )
                    ],
                    results=evaluators_results,
                    rerun_count=new_evaluation_db.rerun_count,
                    organization=app.organization if isCloudEE() else None,
                    workspace=app.workspace if isCloudEE() else None,
                )
            )

    except Exception as e:
        logger.error(f"An error occurred during evaluation: {e}")
        traceback.print_exc()
        loop.run_until_complete(
            update_evaluation(
                evaluation_id,
                {
                    "status": Result(
                        type="status",
                        value="EVALUATION_FAILED",
                        error=Error(message="Evaluation Failed", stacktrace=str(e)),
                    )
                },
            )
        )
        self.update_state(state=states.FAILURE)
        return

    aggregated_results = loop.run_until_complete(
        aggregate_evaluator_results(app, evaluators_aggregated_data)
    )
    loop.run_until_complete(
        update_evaluation_with_aggregated_results(
            new_evaluation_db.id, aggregated_results
        )
    )

    failed_evaluation_scenarios = loop.run_until_complete(
        check_if_evaluation_contains_failed_evaluation_scenarios(new_evaluation_db.id)
    )

    evaluation_status = Result(
        type="status", value=EvaluationStatusEnum.EVALUATION_FINISHED, error=None
    )

    if failed_evaluation_scenarios:
        evaluation_status = Result(
            type="status",
            value=EvaluationStatusEnum.EVALUATION_FINISHED_WITH_ERRORS,
            error=None,
        )

    loop.run_until_complete(
        update_evaluation(
            evaluation_id=new_evaluation_db.id, updates={"status": evaluation_status}
        )
    )


async def aggregate_evaluator_results(
    app: AppDB, evaluators_aggregated_data: dict
) -> List[AggregatedResult]:
    aggregated_results = []
    for config_id, val in evaluators_aggregated_data.items():
        evaluator_key = val["evaluator_key"] or ""
        results = val["results"] or []

        if not results:
            result = Result(type="error", value=None, error=Error(message="-"))
            continue

        if evaluator_key == "auto_ai_critique":
            result = aggregation_service.aggregate_ai_critique(results)

        elif evaluator_key == "auto_regex_test":
            result = aggregation_service.aggregate_binary(results)

        elif evaluator_key in [
            "auto_exact_match",
            "auto_similarity_match",
            "field_match_test",
            "auto_webhook_test",
            "auto_custom_code_run",
            "auto_starts_with",
            "auto_ends_with",
            "auto_contains",
            "auto_contains_any",
            "auto_contains_all",
            "auto_contains_json",
        ]:
            result = aggregation_service.aggregate_float(results)

        else:
            result = Result(
                type="error", value=None, error=Error(message="Aggregation failed")
            )

        evaluator_config = await fetch_evaluator_config(config_id)
        aggregated_result = AggregatedResult(
            evaluator_config=evaluator_config.id,
            result=result,
        )
        aggregated_results.append(aggregated_result)
    return aggregated_results


def get_app_inputs(app_variant_parameters, openapi_parameters) -> List[Dict[str, str]]:
    """
    Get a list of application inputs based on the app variant parameters and openapi parameters.

    Args:
        app_variant_parameters (dict): A dictionary containing the app variant parameters.
        openapi_parameters (list): A list of openapi parameters.

    Returns:
        list: A list of dictionaries representing the application inputs, where each dictionary contains the input name and type.
    """
    list_inputs = []
    for param in openapi_parameters:
        if param["type"] == "input":
            list_inputs.append({"name": param["name"], "type": "input"})
        elif param["type"] == "dict":  # in case of dynamic inputs (as in our templates)
            # let's get the list of the dynamic inputs
            if (
                param["name"] in app_variant_parameters
            ):  # in case we have modified in the playground the default list of inputs (e.g. country_name)
                input_names = [_["name"] for _ in app_variant_parameters[param["name"]]]
            else:  # otherwise we use the default from the openapi
                input_names = param["default"]
            for input_name in input_names:
                list_inputs.append({"name": input_name, "type": "dict_input"})
        elif param["type"] == "messages":
            list_inputs.append({"name": param["name"], "type": "messages"})
        elif param["type"] == "file_url":
            list_inputs.append({"name": param["name"], "type": "file_url"})
    return list_inputs
