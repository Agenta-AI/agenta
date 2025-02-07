import asyncio
import logging
import traceback
from typing import Any, Dict, List

from celery import shared_task, states

from agenta_backend.services import helpers
from agenta_backend.utils.common import isCloudEE

if isCloudEE():
    from agenta_backend.cloud.services.auth_helper import sign_secret_token

from agenta_backend.services import (
    evaluators_service,
    llm_apps_service,
    deployment_manager,
    aggregation_service,
)
from agenta_backend.models.api.evaluation_model import EvaluationStatusEnum
from agenta_backend.models.shared_models import (
    AggregatedResult,
    CorrectAnswer,
    EvaluationScenarioInput,
    EvaluationScenarioOutput,
    EvaluationScenarioResult,
    InvokationResult,
    Error,
    Result,
)
from agenta_backend.services.db_manager import (
    create_new_evaluation_scenario,
    fetch_app_by_id,
    fetch_app_variant_by_id,
    fetch_evaluator_config,
    fetch_testset_by_id,
    get_deployment_by_id,
    update_evaluation,
    update_evaluation_with_aggregated_results,
    EvaluationScenarioResult,
    check_if_evaluation_contains_failed_evaluation_scenarios,
)
from agenta_backend.services.evaluator_manager import get_evaluators


# Set logger
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

# Fetch all evaluators and pre-compute ground truth keys
all_evaluators = get_evaluators()
ground_truth_keys_dict = {
    evaluator.key: [
        key
        for key, value in evaluator.settings_template.items()
        if value.get("ground_truth_key") is True
    ]
    for evaluator in all_evaluators
}


@shared_task(queue="agenta_backend.tasks.evaluations.evaluate", bind=True)
def evaluate(
    self,
    app_id: str,
    user_id: str,
    project_id: str,
    variant_id: str,
    evaluators_config_ids: List[str],
    testset_id: str,
    evaluation_id: str,
    rate_limit_config: Dict[str, int],
    lm_providers_keys: Dict[str, Any],
):
    """
    Evaluates an app variant using the provided evaluators and testset, and saves the results in the database.

    Args:
        self: The task instance.
        app_id (str): The ID of the app.
        project_id (str): The ID of the project.
        variant_id (str): The ID of the app variant.
        evaluators_config_ids (List[str]): The IDs of the evaluators configurations to be used.
        testset_id (str): The ID of the testset.
        evaluation_id (str): The ID of the evaluation.
        rate_limit_config (Dict[str, int]): Configuration for rate limiting.
        lm_providers_keys (Dict[str, Any]): Keys for language model providers.

    Returns:
        None
    """

    loop = asyncio.get_event_loop()

    try:
        # 0. Update evaluation status to STARTED
        loop.run_until_complete(
            update_evaluation(
                evaluation_id,
                project_id,
                {
                    "status": Result(
                        type="status", value=EvaluationStatusEnum.EVALUATION_STARTED
                    ).model_dump()
                },
            )
        )

        # 1. Fetch data from the database
        app = loop.run_until_complete(fetch_app_by_id(app_id))
        app_variant_db = loop.run_until_complete(fetch_app_variant_by_id(variant_id))
        assert (
            app_variant_db is not None
        ), f"App variant with id {variant_id} not found!"
        app_variant_parameters = app_variant_db.config_parameters
        testset_db = loop.run_until_complete(fetch_testset_by_id(testset_id))
        evaluator_config_dbs = []
        for evaluator_config_id in evaluators_config_ids:
            evaluator_config = loop.run_until_complete(
                fetch_evaluator_config(evaluator_config_id)
            )
            evaluator_config_dbs.append(evaluator_config)

        deployment_db = loop.run_until_complete(
            get_deployment_by_id(str(app_variant_db.base.deployment_id))
        )
        uri = deployment_manager.get_deployment_uri(uri=deployment_db.uri)  # type: ignore

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
                testset_db.csvdata,  # type: ignore
                app_variant_parameters,  # type: ignore
                rate_limit_config,
                user_id,
                project_id,
                application_id=str(
                    app.id
                ),  #! NOTE: removing this will break observability
            )
        )

        # 4. Evaluate the app outputs
        secret_token = None
        headers = None
        if isCloudEE():
            secret_token = loop.run_until_complete(
                sign_secret_token(user_id, project_id, None)
            )
            if secret_token:
                headers = {"Authorization": f"Secret {secret_token}"}

        openapi_parameters = loop.run_until_complete(
            llm_apps_service.get_parameters_from_openapi(
                uri + "/openapi.json",
                headers,
            ),
        )

        for data_point, app_output in zip(testset_db.csvdata, app_outputs):  # type: ignore
            # 1. We prepare the inputs
            logger.debug(f"Preparing inputs for data point: {data_point}")
            list_inputs = get_app_inputs(app_variant_parameters, openapi_parameters)
            logger.debug(f"List of inputs: {list_inputs}")

            inputs = [
                EvaluationScenarioInput(
                    name=input_item["name"],
                    type="text",
                    value=data_point.get(
                        (
                            input_item["name"]
                            if input_item["type"] != "messages"
                            else "chat"
                        ),
                        "",
                    ),  # TODO: We need to remove the hardcoding of chat as name for chat inputs from the FE
                )
                for input_item in list_inputs
            ]
            logger.debug(f"Inputs: {inputs}")

            # 2. We skip the iteration if error invoking the llm-app
            if app_output.result.error:
                print("There is an error when invoking the llm app so we need to skip")
                error_results = [
                    EvaluationScenarioResult(
                        evaluator_config=str(evaluator_config_db.id),
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

                loop.run_until_complete(
                    create_new_evaluation_scenario(
                        project_id=project_id,
                        evaluation_id=evaluation_id,
                        variant_id=variant_id,
                        inputs=inputs,
                        outputs=[
                            EvaluationScenarioOutput(
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
                        correct_answers=None,
                        is_pinned=False,
                        note="",
                        results=error_results,
                    )
                )
                continue

            # 3. We evaluate
            evaluators_results: List[EvaluationScenarioResult] = []

            # Loop over each evaluator configuration to gather the correct answers and evaluate
            ground_truth_column_names = []
            for evaluator_config_db in evaluator_config_dbs:
                ground_truth_keys = ground_truth_keys_dict.get(
                    evaluator_config_db.evaluator_key, []
                )
                ground_truth_column_names.extend(
                    evaluator_config_db.settings_values.get(key, "")
                    for key in ground_truth_keys
                )
                logger.debug(f"Evaluating with evaluator: {evaluator_config_db}")

                result = loop.run_until_complete(
                    evaluators_service.evaluate(
                        evaluator_key=evaluator_config_db.evaluator_key,
                        output=app_output.result.value,
                        data_point=data_point,
                        settings_values=evaluator_config_db.settings_values,
                        app_params=app_variant_parameters,  # type: ignore
                        inputs=data_point,
                        lm_providers_keys=lm_providers_keys,
                    )
                )

                # Update evaluators aggregated data
                evaluator_results: List[Result] = evaluators_aggregated_data[
                    str(evaluator_config_db.id)
                ]["results"]
                evaluator_results.append(result)

                result_object = EvaluationScenarioResult(
                    evaluator_config=str(evaluator_config_db.id),
                    result=result,
                )
                logger.debug(f"Result: {result_object}")
                evaluators_results.append(result_object)

            all_correct_answers = [
                (
                    CorrectAnswer(
                        key=ground_truth_column_name,
                        value=data_point[ground_truth_column_name],
                    )
                    if ground_truth_column_name in data_point
                    else CorrectAnswer(key=ground_truth_column_name, value="")
                )
                for ground_truth_column_name in ground_truth_column_names
            ]

            # 4. We save the result of the eval scenario in the db
            print("============ App Output ============: ", app_output.result.value)

            loop.run_until_complete(
                create_new_evaluation_scenario(
                    project_id=project_id,
                    evaluation_id=evaluation_id,
                    variant_id=variant_id,
                    inputs=inputs,
                    outputs=[
                        EvaluationScenarioOutput(
                            result=Result(
                                type="text", value=app_output.result.value["data"]
                            ),
                            latency=app_output.latency,
                            cost=app_output.cost,
                        )
                    ],
                    correct_answers=all_correct_answers,
                    is_pinned=False,
                    note="",
                    results=evaluators_results,
                )
            )

        # Add average cost and latency
        average_latency = aggregation_service.aggregate_float_from_llm_app_response(
            app_outputs, "latency"
        )
        average_cost = aggregation_service.aggregate_float_from_llm_app_response(
            app_outputs, "cost"
        )
        total_cost = aggregation_service.sum_float_from_llm_app_response(
            app_outputs, "cost"
        )
        loop.run_until_complete(
            update_evaluation(
                evaluation_id,
                project_id,
                {
                    "average_latency": average_latency.model_dump(),
                    "average_cost": average_cost.model_dump(),
                    "total_cost": total_cost.model_dump(),
                },
            )
        )

    except Exception as e:
        logger.error(f"An error occurred during evaluation: {e}")
        traceback.print_exc()
        loop.run_until_complete(
            update_evaluation(
                evaluation_id,
                project_id,
                {
                    "status": Result(
                        type="status",
                        value="EVALUATION_FAILED",
                        error=Error(
                            message="Evaluation Failed",
                            stacktrace=str(traceback.format_exc()),
                        ),
                    ).model_dump()
                },
            )
        )
        self.update_state(state=states.FAILURE)
        return

    try:
        aggregated_results = loop.run_until_complete(
            aggregate_evaluator_results(evaluators_aggregated_data)
        )

        loop.run_until_complete(
            update_evaluation_with_aggregated_results(evaluation_id, aggregated_results)
        )

        failed_evaluation_scenarios = loop.run_until_complete(
            check_if_evaluation_contains_failed_evaluation_scenarios(evaluation_id)
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
                evaluation_id=evaluation_id,
                project_id=project_id,
                updates={"status": evaluation_status.model_dump()},
            )
        )

    except Exception as e:
        logger.error(f"An error occurred during evaluation aggregation: {e}")
        traceback.print_exc()
        loop.run_until_complete(
            update_evaluation(
                evaluation_id,
                project_id,
                {
                    "status": Result(
                        type="status",
                        value="EVALUATION_AGGREGATION_FAILED",
                        error=Error(
                            message="Evaluation Aggregation Failed",
                            stacktrace=str(traceback.format_exc()),
                        ),
                    ).model_dump()
                },
            )
        )
        self.update_state(state=states.FAILURE)
        return


async def aggregate_evaluator_results(
    evaluators_aggregated_data: dict,
) -> List[AggregatedResult]:
    """
    Aggregate the results of the evaluation evaluator.

    Args:
        evaluators_aggregated_data (dict):  The evaluators aggregated data

    Returns:
        the aggregated result of the evaluation evaluator
    """

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
            "auto_json_diff",
            "auto_semantic_similarity",
            "auto_levenshtein_distance",
            "rag_faithfulness",
            "rag_context_relevancy",
        ]:
            result = aggregation_service.aggregate_float(results)

        else:
            result = Result(
                type="error", value=None, error=Error(message="Aggregation failed")
            )

        aggregated_result = AggregatedResult(
            evaluator_config=config_id,
            result=result,
        )
        aggregated_results.append(aggregated_result)
    return aggregated_results


def get_app_inputs(parameters, openapi_parameters) -> List[Dict[str, str]]:
    """
    Get a list of application inputs based on the app variant parameters and openapi parameters.

    Args:
        parameters (dict): A dictionary containing the app variant parameters.
        openapi_parameters (list): A list of openapi parameters.

    Returns:
        list: A list of dictionaries representing the application inputs, where each dictionary contains the input name and type.
    """
    # ---
    inputs = []
    # ---

    for param in openapi_parameters:
        if param["type"] == "input":
            # ---
            item = {"name": param["name"], "type": "input"}
            inputs.append(item)
            # ---

        # in case of dynamic inputs (as in our templates)
        elif param["type"] == "dict":
            # let's get the list of the dynamic inputs
            if (
                param["name"] in parameters
            ):  # in case we have modified in the playground the default list of inputs (e.g. country_name)
                input_names = [_["name"] for _ in parameters[param["name"]]]
            else:  # otherwise we use the default from the openapi
                input_names = param["default"]

            for input_name in input_names:
                # ---
                item = {"name": input_name, "type": "dict_input"}
                inputs.append(item)
                # ---

        elif param["type"] == "messages":
            # TODO: Right now the FE is saving chats always under the column name chats. The whole logic for handling chats and dynamic inputs is convoluted and needs rework in time.
            # ---
            item = {"name": "chat", "type": "messages"}
            inputs.append(item)
            # ---
        elif param["type"] == "file_url":
            # ---
            item = {"name": param["name"], "type": "file_url"}
            inputs.append(item)
            # ---
        else:
            # if param["name"] in parameters:  # hotfix
            #     # ---
            #     item = {"name": param["name"], "type": param["type"]}
            #     inputs.append(item)
            #     # ---
            pass

    if "ag_config" in parameters:
        input_keys = helpers.find_key_occurrences(parameters, "input_keys") or []
        items = [{"name": input_key, "type": "input"} for input_key in input_keys]
        inputs.extend(items)

        reserved_keys = ["inputs", "ag_config"]
        inputs = [input for input in inputs if input["name"] not in reserved_keys]

    return inputs
