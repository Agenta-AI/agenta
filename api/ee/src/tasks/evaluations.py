import asyncio
import traceback
from typing import Any, Dict, List

from celery import shared_task, states

from json import dumps

from oss.src.services import helpers
from oss.src.utils.helpers import parse_url
from oss.src.utils.logging import get_module_logger
from oss.src.services.auth_helper import sign_secret_token
from oss.src.services import (
    evaluators_service,
    llm_apps_service,
    aggregation_service,
)
from oss.src.models.api.evaluation_model import EvaluationStatusEnum
from oss.src.models.shared_models import (
    AggregatedResult,
    CorrectAnswer,
    EvaluationScenarioInput,
    EvaluationScenarioOutput,
    EvaluationScenarioResult,
    InvokationResult,
    Error,
    Result,
)
from oss.src.services.db_manager import (
    fetch_app_by_id,
    fetch_app_variant_revision_by_id,
    fetch_evaluator_config,
    fetch_testset_by_id,
    get_deployment_by_id,
    get_project_by_id,
)
from ee.src.services.db_manager_ee import (
    update_evaluation,
    EvaluationScenarioResult,
    create_new_evaluation_scenario,
    update_evaluation_with_aggregated_results,
    check_if_evaluation_contains_failed_evaluation_scenarios,
)
from oss.src.services.evaluator_manager import get_evaluators
from oss.src.core.secrets.utils import get_llm_providers_secrets
from ee.src.utils.entitlements import check_entitlements, Counter


log = get_module_logger(__name__)

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


@shared_task(queue="src.tasks.evaluations.evaluate", bind=True)
def evaluate(
    self,
    app_id: str,
    user_id: str,
    project_id: str,
    revision_id: str,
    evaluators_config_ids: List[str],
    testset_id: str,
    evaluation_id: str,
    rate_limit_config: Dict[str, int],
):
    """
    Evaluates an app variant using the provided evaluators and testset, and saves the results in the database.

    Args:
        self: The task instance.
        app_id (str): The ID of the app.
        project_id (str): The ID of the project.
        revision_id (str): The ID of the variant revision.
        evaluators_config_ids (List[str]): The IDs of the evaluators configurations to be used.
        testset_id (str): The ID of the testset.
        evaluation_id (str): The ID of the evaluation.
        rate_limit_config (Dict[str, int]): Configuration for rate limiting.

    Returns:
        None
    """

    log.info(
        "Starting evaluation:",
        evaluation_id=evaluation_id,
        project_id=project_id,
        testset_id=testset_id,
        application_id=app_id,
        revision_id=revision_id,
    )

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
        variant_revision_db = loop.run_until_complete(
            fetch_app_variant_revision_by_id(revision_id)
        )
        assert (
            variant_revision_db is not None
        ), f"Variant revision with id {revision_id} not found!"
        revision_parameters = variant_revision_db.config_parameters
        testset_db = loop.run_until_complete(fetch_testset_by_id(testset_id))
        evaluator_config_dbs = []
        for evaluator_config_id in evaluators_config_ids:
            evaluator_config = loop.run_until_complete(
                fetch_evaluator_config(evaluator_config_id)
            )
            evaluator_config_dbs.append(evaluator_config)

        deployment_db = loop.run_until_complete(
            get_deployment_by_id(str(variant_revision_db.base.deployment_id))
        )
        uri = parse_url(url=deployment_db.uri) # type: ignore

        # 2. Initialize vars
        evaluators_aggregated_data = {
            str(evaluator_config_db.id): {
                "evaluator_key": evaluator_config_db.evaluator_key,
                "results": [],
            }
            for evaluator_config_db in evaluator_config_dbs
        }

        log.info(
            "Starting batches:",
            evaluation_id=evaluation_id,
            project_id=project_id,
            testset_id=testset_id,
            count=len(testset_db.csvdata),
            size=len(dumps(testset_db.csvdata).encode("utf-8")),
        )

        # 3. Invoke the app
        app_outputs: List[InvokationResult] = loop.run_until_complete(
            llm_apps_service.batch_invoke(
                uri,
                testset_db.csvdata,  # type: ignore
                revision_parameters,  # type: ignore
                rate_limit_config,
                user_id,
                project_id,
                application_id=str(
                    app.id
                ),  #! NOTE: removing this will break observability
            )
        )

        # 4. Get provider keys from vault
        providers_keys_from_vault: Dict[str, Any] = loop.run_until_complete(
            get_llm_providers_secrets(project_id)
        )

        project = loop.run_until_complete(
            get_project_by_id(
                project_id=project_id,
            )
        )

        # 5. Signin secret token and prepare headers for authentication
        headers = {}
        secret_token = loop.run_until_complete(
            sign_secret_token(
                user_id=str(user_id),
                project_id=str(project_id),
                workspace_id=str(project.workspace_id),
                organization_id=str(project.organization_id),
            )
        )
        if secret_token:
            headers = {"Authorization": f"Secret {secret_token}"}
        headers["ngrok-skip-browser-warning"] = "1"

        openapi_parameters = None
        max_recursive_depth = 5
        runtime_prefix = uri
        route_path = ""

        while max_recursive_depth > 0 and not openapi_parameters:
            try:
                openapi_parameters = loop.run_until_complete(
                    llm_apps_service.get_parameters_from_openapi(
                        runtime_prefix + "/openapi.json",
                        route_path,
                        headers,
                    ),
                )
            except Exception as e:
                openapi_parameters = None

            if not openapi_parameters:
                max_recursive_depth -= 1
                if not runtime_prefix.endswith("/"):
                    route_path = "/" + runtime_prefix.split("/")[-1] + route_path
                    runtime_prefix = "/".join(runtime_prefix.split("/")[:-1])
                else:
                    route_path = ""
                    runtime_prefix = runtime_prefix[:-1]

        openapi_parameters = loop.run_until_complete(
            llm_apps_service.get_parameters_from_openapi(
                runtime_prefix + "/openapi.json",
                route_path,
                headers,
            ),
        )

        for data_point, app_output in zip(testset_db.csvdata, app_outputs):  # type: ignore
            # 1. We prepare the inputs
            list_inputs = get_app_inputs(revision_parameters, openapi_parameters)

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
                if input_item["name"] != "ag_config"
            ]

            # 2. We skip the iteration if error invoking the llm-app
            if app_output.result.error:
                log.error(
                    "There is an error when invoking the llm app so we need to skip"
                )
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
                        variant_id=str(variant_revision_db.variant_id),
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
            ground_truth_column_names = []  # type: ignore
            for evaluator_config_db in evaluator_config_dbs:
                ground_truth_keys = ground_truth_keys_dict.get(
                    evaluator_config_db.evaluator_key, []
                )
                ground_truth_column_names.extend(
                    evaluator_config_db.settings_values.get(key, "")
                    for key in ground_truth_keys
                )

                result = loop.run_until_complete(
                    evaluators_service.evaluate(
                        evaluator_key=evaluator_config_db.evaluator_key,
                        output=app_output.result.value,
                        data_point=data_point,
                        settings_values=evaluator_config_db.settings_values,
                        app_params=revision_parameters,  # type: ignore
                        inputs=data_point,
                        lm_providers_keys=providers_keys_from_vault,
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
            loop.run_until_complete(
                create_new_evaluation_scenario(
                    project_id=project_id,
                    evaluation_id=evaluation_id,
                    variant_id=str(variant_revision_db.variant_id),
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
        try:
            loop.run_until_complete(
                check_entitlements(
                    organization_id=project.organization_id,
                    key=Counter.EVALUATIONS,
                    delta=-1,
                )
            )
        except:  # pylint: disable=bare-except
            pass

        log.error(f"An error occurred during evaluation: {e}")
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
        log.error(f"An error occurred during evaluation aggregation: {e}")
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

    try:
        input_keys = helpers.find_key_occurrences(parameters, "input_keys") or []
        items = [{"name": input_key, "type": "input"} for input_key in input_keys]
        inputs.extend(items)
        reserved_keys = ["inputs"]
        inputs = [input for input in inputs if input["name"] not in reserved_keys]
    except Exception as e:  # pylint: disable=broad-exception-caught
        log.warn(f"Error making payload: {e}")

    return inputs
