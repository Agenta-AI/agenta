from typing import Any, Dict, List, Optional
from uuid import UUID
import asyncio
import traceback
from json import dumps
from collections import Counter as StatisticsCounter
from urllib.parse import urljoin


import math
import itertools
import numpy

from celery import shared_task, states

from fastapi import Request


from oss.src.services import helpers
from oss.src.utils.helpers import parse_url, get_slug_from_name_and_id
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
    fetch_app_variant_by_id,
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

from oss.src.apis.fastapi.tracing.utils import make_hash_id
from oss.src.apis.fastapi.tracing.router import TracingRouter
from oss.src.apis.fastapi.annotations.router import AnnotationsRouter
from oss.src.apis.fastapi.evaluators.router import SimpleEvaluatorsRouter
from oss.src.apis.fastapi.testsets.router import SimpleTestsetsRouter
from oss.src.apis.fastapi.evaluations.router import EvaluationsRouter
from oss.src.core.evaluations.service import EvaluationsService
from oss.src.core.workflows.service import WorkflowsService
from oss.src.core.testsets.service import TestsetsService
from oss.src.core.testcases.service import TestcasesService
from oss.src.core.tracing.service import TracingService
from oss.src.dbs.postgres.evaluations.dao import EvaluationsDAO
from oss.src.dbs.postgres.git.dao import GitDAO
from oss.src.dbs.postgres.blobs.dao import BlobsDAO
from oss.src.dbs.postgres.tracing.dao import TracingDAO


from oss.src.apis.fastapi.annotations.models import (
    AnnotationOrigin,
    AnnotationKind,
    AnnotationChannel,
    AnnotationCreate,
    AnnotationCreateRequest,
)
from oss.src.apis.fastapi.evaluations.models import (
    EvaluationRunEditRequest,
    EvaluationScenariosCreateRequest,
    EvaluationScenarioEditRequest,
    EvaluationStepsCreateRequest,
    EvaluationMetricsCreateRequest,
)
from oss.src.core.evaluations.types import (
    EvaluationStatus,
    EvaluationRunEdit,
    EvaluationScenarioCreate,
    EvaluationScenarioEdit,
    EvaluationStepCreate,
    EvaluationMetricCreate,
)
from oss.src.dbs.postgres.workflows.dbes import (
    WorkflowArtifactDBE,
    WorkflowVariantDBE,
    WorkflowRevisionDBE,
)
from oss.src.dbs.postgres.testsets.dbes import (
    TestsetArtifactDBE,
    TestsetVariantDBE,
    TestsetRevisionDBE,
)
from oss.src.dbs.postgres.testcases.dbes import (
    TestcaseBlobDBE,
)


from oss.src.core.shared.dtos import Reference
from oss.src.core.workflows.dtos import (
    WorkflowServiceData,
    WorkflowServiceRequest,
    WorkflowServiceResponse,
    WorkflowServiceInterface,
    WorkflowRevisionData,
    WorkflowRevision,
    WorkflowVariant,
    Workflow,
)

from oss.src.core.workflows.dtos import VersionedTree

tracing_service = TracingService(
    tracing_dao=TracingDAO(),
)

tracing_router = TracingRouter(
    tracing_service=tracing_service,
)

workflow_service = WorkflowsService(
    workflows_dao=GitDAO(
        ArtifactDBE=WorkflowArtifactDBE,
        VariantDBE=WorkflowVariantDBE,
        RevisionDBE=WorkflowRevisionDBE,
    ),
    tracing_router=tracing_router,
)

testcases_service = TestcasesService(
    blobs_dao=BlobsDAO(
        BlobDBE=TestcaseBlobDBE,
    ),
)

evaluations_service = EvaluationsService(
    evaluations_dao=EvaluationsDAO(),
)

testsets_service = TestsetsService(
    testsets_dao=GitDAO(
        ArtifactDBE=TestsetArtifactDBE,
        VariantDBE=TestsetVariantDBE,
        RevisionDBE=TestsetRevisionDBE,
    ),
    testcases_service=testcases_service,
)

annotations_router = AnnotationsRouter(
    tracing_service=tracing_service,
    workflows_service=workflow_service,
)

evaluators_router = SimpleEvaluatorsRouter(
    workflows_service=workflow_service,
)

testsets_router = SimpleTestsetsRouter(
    testsets_service=testsets_service,
)

evaluations_router = EvaluationsRouter(
    evaluations_service=evaluations_service,
)

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
        uri = parse_url(url=deployment_db.uri)  # type: ignore
        if not uri:
            log.error(
                f"Evaluation {evaluation_id} failed: Deployment {deployment_db.id} has no valid URI"
            )
            raise Exception(f"Deployment {deployment_db.id} has no valid URI")

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
            except Exception:  # pylint: disable=broad-exception-caught
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


@shared_task(queue="src.tasks.evaluations.annotate", bind=True)
def annotate(
    self,
    *,
    project_id: UUID,
    user_id: UUID,
    #
    run_id: UUID,
    #
    testset_id: str,
    revision_id: str,
    autoeval_ids: Optional[List[str]],
    #
    run_config: Dict[str, int],
):
    """
    Annotates an application revision applied to a testset using auto evaluator(s).

    Args:
        self: The task instance.
        project_id (str): The ID of the project.
        user_id (str): The ID of the user.
        run_id (str): The ID of the evaluation run.
        testset_id (str): The ID of the testset.
        revision_id (str): The ID of the application revision.
        autoeval_ids (List[str]): The IDs of the evaluators configurations.
        run_config (Dict[str, int]): Configuration for evaluation run.

    Returns:
        None
    """

    request = Request(scope={"type": "http", "http_version": "1.1", "scheme": "http"})

    request.state.project_id = project_id
    request.state.user_id = user_id

    loop = asyncio.get_event_loop()

    try:
        # ----------------------------------------------------------------------
        log.info("[SCOPE]     ", run_id=run_id, project_id=project_id, user_id=user_id)
        log.info("[INPUTS]    ", run_id=run_id, ids=[testset_id])
        log.info("[INVOCATON] ", run_id=run_id, ids=[revision_id])
        log.info("[ANNOTATION]", run_id=run_id, ids=autoeval_ids)
        # ----------------------------------------------------------------------

        # fetch project --------------------------------------------------------
        project = loop.run_until_complete(
            get_project_by_id(project_id=project_id),
        )
        # ----------------------------------------------------------------------

        # fetch evaluation run -------------------------------------------------
        evaluation_run_response = loop.run_until_complete(
            evaluations_router.fetch_run(
                request=request,
                run_id=run_id,
            )
        )

        assert (
            evaluation_run_response.count != 0
        ), f"Evaluation run with id {run_id} not found!"
        # ----------------------------------------------------------------------

        # just-in-time transfer of testset -------------------------------------
        testset_response = loop.run_until_complete(
            testsets_router.transfer_simple_testset(
                request=request,
                testset_id=UUID(testset_id),
            )
        )

        assert testset_response.count != 0, f"Testset with id {testset_id} not found!"

        testset = testset_response.testset
        testcases = testset.data.testcases
        testcases_data = [
            {**testcase.data, "id": str(testcase.id)} for testcase in testcases
        ]  # INEFFICIENT: might want to have testcase_id in testset data (caution with hashing)
        nof_testcases = len(testcases)

        testset_step_key = get_slug_from_name_and_id(testset.name, testset.id)
        # ----------------------------------------------------------------------

        # fetch application ----------------------------------------------------
        revision = loop.run_until_complete(
            fetch_app_variant_revision_by_id(revision_id),
        )

        assert revision is not None, f"App revision with id {revision_id} not found!"

        variant = loop.run_until_complete(
            fetch_app_variant_by_id(str(revision.variant_id)),
        )

        assert (
            variant is not None
        ), f"App variant with id {revision.variant_id} not found!"

        app = loop.run_until_complete(
            fetch_app_by_id(str(variant.app_id)),
        )

        assert app is not None, f"App with id {variant.app_id} not found!"

        deployment = loop.run_until_complete(
            get_deployment_by_id(str(revision.base.deployment_id))
        )

        assert (
            deployment is not None
        ), f"Deployment with id {revision.base.deployment_id} not found!"

        uri = parse_url(url=deployment.uri)

        assert uri is not None, f"Invalid URI for deployment {deployment.id}!"

        revision_parameters = revision.config_parameters

        assert (
            revision_parameters is not None
        ), f"Revision parameters for variant {variant.id} not found!"

        invocation_step_key = get_slug_from_name_and_id(app.app_name, revision.id)
        # ----------------------------------------------------------------------

        # fetch auto-evaluators ------------------------------------------------
        autoeval_configs = []

        for autoeval_id in autoeval_ids:
            autoeval_config = loop.run_until_complete(
                fetch_evaluator_config(autoeval_id)
            )

            autoeval_configs.append(autoeval_config)

        annotation_steps_keys = [
            get_slug_from_name_and_id(autoeval_config.name, autoeval_config.id)
            for autoeval_config in autoeval_configs
        ]

        nof_annotations = len(autoeval_configs)
        # ----------------------------------------------------------------------

        # initialize metrics ---------------------------------------------------
        raw_run_level_metrics = {
            invocation_step_key: {
                "duration": [],
                "errors": [],
                "costs": [],
                "tokens": [],
            },
            **{
                annotation_step_key: {
                    "errors": [],
                }
                for annotation_step_key in annotation_steps_keys
            },
        }

        annotation_metrics_keys = {key: {} for key in annotation_steps_keys}
        # ----------------------------------------------------------------------

        # just-in-time transfer of evaluators ----------------------------------
        evaluator_references = dict()

        for jdx, autoeval_id in enumerate(autoeval_ids):
            annotation_step_key = annotation_steps_keys[jdx]

            evaluator_response = loop.run_until_complete(
                evaluators_router.transfer_simple_evaluator(
                    request=request,
                    evaluator_id=UUID(autoeval_id),
                )
            )

            evaluator = evaluator_response.evaluator

            evaluator_references[annotation_step_key] = {}

            evaluator_references[annotation_step_key]["artifact"] = {
                "id": str(evaluator.id),
                "slug": evaluator.slug,
            }

            metrics_keys = get_metrics_keys_from_schema(
                schema=(evaluator.data.schemas.get("outputs")),
            )

            annotation_metrics_keys[annotation_step_key] = [
                {
                    "path": metric_key.get("path", "").replace("outputs.", "", 1),
                    "type": metric_key.get("type", ""),
                }
                for metric_key in metrics_keys
            ]
        # ----------------------------------------------------------------------

        # fetch evaluator workflows --------------------------------------------
        evaluators = dict()

        for annotation_step_key, references in evaluator_references.items():
            evaluators[annotation_step_key] = {}

            workflow_ref = Reference(**references["artifact"])

            workflow: Workflow = loop.run_until_complete(
                workflow_service.fetch_workflow(
                    project_id=project_id,
                    #
                    workflow_ref=workflow_ref,
                )
            )

            evaluators[annotation_step_key]["workflow"] = workflow

            workflow_revision: WorkflowRevision = loop.run_until_complete(
                workflow_service.fetch_workflow_revision(
                    project_id=project_id,
                    #
                    workflow_ref=workflow_ref,
                )
            )

            workflow_revision_ref = Reference(
                id=workflow_revision.id,
                slug=workflow_revision.slug,
            )

            evaluator_references[annotation_step_key][
                "revision"
            ] = workflow_revision_ref.model_dump(mode="json")

            evaluators[annotation_step_key]["revision"] = workflow_revision

            workflow_variant: WorkflowVariant = loop.run_until_complete(
                workflow_service.fetch_workflow_variant(
                    project_id=project_id,
                    workflow_variant_ref=Reference(
                        id=workflow_revision.variant_id,
                    ),
                )
            )

            workflow_variant_ref = Reference(
                id=workflow_variant.id,
                slug=workflow_variant.slug,
            )

            evaluator_references[annotation_step_key][
                "variant"
            ] = workflow_variant_ref.model_dump(mode="json")

            evaluators[annotation_step_key]["variant"] = workflow_variant

        # ----------------------------------------------------------------------

        # fetch provider keys from secrets -------------------------------------
        providers_keys = loop.run_until_complete(
            get_llm_providers_secrets(project_id),
        )
        # ----------------------------------------------------------------------

        # prepare credentials and headers --------------------------------------
        secret_token = loop.run_until_complete(
            sign_secret_token(
                user_id=str(user_id),
                project_id=str(project_id),
                workspace_id=str(project.workspace_id),
                organization_id=str(project.organization_id),
            )
        )

        headers = {}
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
            except Exception:  # pylint: disable=broad-exception-caught
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
        # ----------------------------------------------------------------------

        # initialize steps/mappings in run -------------------------------------
        input_step = {
            "key": testset_step_key,
            "type": "input",
            "origin": "auto",
            "references": {
                "testset": {"id": testset_id},
            },
        }

        invocation_step = {
            "key": invocation_step_key,
            "type": "invocation",
            "origin": "auto",
            "references": {
                "application": {"id": str(app.id)},
                "application_variant": {"id": str(variant.id)},
                "application_revision": {"id": str(revision.id)},
            },
            "inputs": [
                {"key": testset_step_key},
            ],
        }

        annotation_steps = [
            {
                "key": step_key,
                "type": "annotation",
                "origin": "auto",
                "references": {
                    "evaluator": evaluator_references[step_key]["artifact"],
                    "evaluator_variant": evaluator_references[step_key]["variant"],
                    "evaluator_revision": evaluator_references[step_key]["revision"],
                },
                "inputs": [
                    {"key": testset_step_key},
                    {"key": invocation_step_key},
                ],
            }
            for step_key in annotation_steps_keys
        ]

        steps = [input_step, invocation_step] + annotation_steps

        input_mappings = [
            {
                "column": {
                    "kind": "testset",
                    "name": key,
                },
                "step": {
                    "key": testset_step_key,
                    "path": f"data.{key}",
                },
            }
            for key in testcases[0].data.keys()
        ]

        invocation_mappings = [
            {
                "column": {
                    "kind": "invocation",
                    "name": "outputs",
                },
                "step": {
                    "key": invocation_step_key,
                    "path": "attributes.ag.data.outputs",
                },
            }
        ]

        annotation_mappings = [
            {
                "column": {
                    "kind": "annotation",
                    "name": metric_key["path"],
                },
                "step": {
                    "key": step_key,
                    "path": f"attributes.ag.data.outputs.{metric_key['path']}",
                },
            }
            for step_key in annotation_steps_keys
            for metric_key in annotation_metrics_keys[step_key]
        ]

        mappings = input_mappings + invocation_mappings + annotation_mappings

        run_edit_request = EvaluationRunEditRequest(
            run=EvaluationRunEdit(
                id=run_id,
                #
                name=evaluation_run_response.run.name,
                description=evaluation_run_response.run.description,
                #
                tags=evaluation_run_response.run.tags,
                meta=evaluation_run_response.run.meta,
                #
                status=EvaluationStatus.RUNNING,
                #
                data={"steps": steps, "mappings": mappings},
            )
        )

        evaluation_run_response = loop.run_until_complete(
            evaluations_router.edit_run(
                request=request,
                run_id=run_id,
                run_edit_request=run_edit_request,
            )
        )

        assert (
            evaluation_run_response.count != 0
        ), f"Failed to edit evaluation run {run_id}!"
        # ----------------------------------------------------------------------

        # create scenarios -----------------------------------------------------
        scenarios_create_request = EvaluationScenariosCreateRequest(
            scenarios=[
                EvaluationScenarioCreate(
                    run_id=run_id,
                    #
                    status=EvaluationStatus.RUNNING,
                )
                for _ in range(nof_testcases)
            ]
        )

        scenarios_response = loop.run_until_complete(
            evaluations_router.create_scenarios(
                request=request,
                scenarios_create_request=scenarios_create_request,
            )
        )

        assert (
            scenarios_response.count == nof_testcases
        ), f"Failed to create evaluation scenarios for run {run_id}!"

        scenarios = scenarios_response.scenarios
        # ----------------------------------------------------------------------

        # create input steps ---------------------------------------------------
        steps_create_request = EvaluationStepsCreateRequest(
            steps=[
                EvaluationStepCreate(
                    run_id=run_id,
                    scenario_id=scenario.id,
                    #
                    status=EvaluationStatus.SUCCESS,
                    #
                    key=testset_step_key,
                    #
                    testcase_id=testcases[idx].id,
                )
                for idx, scenario in enumerate(scenarios)
            ]
        )

        steps_response = loop.run_until_complete(
            evaluations_router.create_steps(
                request=request,
                steps_create_request=steps_create_request,
            )
        )

        assert (
            steps_response.count == nof_testcases
        ), f"Failed to create evaluation steps for run {run_id}!"
        # ----------------------------------------------------------------------

        # ----------------------------------------------------------------------
        _testcases = [testcase.model_dump(mode="json") for testcase in testcases]

        log.info(
            "[BATCH]     ",
            run_id=run_id,
            ids=[testset_id],
            count=len(_testcases),
            size=len(dumps(_testcases).encode("utf-8")),
        )
        # ----------------------------------------------------------------------

        # invoke the app -------------------------------------------------------
        invocations: List[InvokationResult] = loop.run_until_complete(
            llm_apps_service.batch_invoke(
                project_id=str(project_id),
                user_id=str(user_id),
                testset_data=testcases_data,  # type: ignore
                parameters=revision_parameters,  # type: ignore
                uri=uri,
                rate_limit_config=run_config,
                application_id=str(app.id),  # DO NOT REMOVE
                references={
                    "testset": {"id": testset_id},
                    "application": {"id": str(app.id)},
                    "application_variant": {"id": str(variant.id)},
                    "application_revision": {"id": str(revision.id)},
                },
            )
        )
        # ----------------------------------------------------------------------

        # create invocation steps ----------------------------------------------
        steps_create_request = EvaluationStepsCreateRequest(
            steps=[
                EvaluationStepCreate(
                    run_id=run_id,
                    scenario_id=scenario.id,
                    #
                    status=(
                        EvaluationStatus.SUCCESS
                        if not invocations[idx].result.error
                        else EvaluationStatus.FAILURE
                    ),
                    #
                    key=invocation_step_key,
                    #
                    trace_id=invocations[idx].trace_id,
                    error=(
                        invocations[idx].result.error.model_dump(mode="json")
                        if invocations[idx].result.error
                        else None
                    ),
                )
                for idx, scenario in enumerate(scenarios)
            ]
        )

        steps_response = loop.run_until_complete(
            evaluations_router.create_steps(
                request=request,
                steps_create_request=steps_create_request,
            )
        )

        assert (
            steps_response.count == nof_testcases
        ), f"Failed to create evaluation steps for run {run_id}!"
        # ----------------------------------------------------------------------

        run_has_errors = 0
        run_status = EvaluationStatus.SUCCESS

        # run evaluators -------------------------------------------------------
        for idx in range(nof_testcases):
            raw_scenario_level_metrics = {
                invocation_step_key: {
                    "duration": [],
                    "errors": [],
                    "costs": [],
                    "tokens": [],
                },
                **{
                    annotation_step_key: {
                        "errors": [],
                    }
                    for annotation_step_key in annotation_steps_keys
                },
            }

            scenario = scenarios[idx]
            testcase = testcases[idx]
            invocation = invocations[idx]

            scenario_has_errors = 0
            scenario_status = EvaluationStatus.SUCCESS

            raw_scenario_level_metrics[invocation_step_key]["errors"].append(
                invocation.result.error is not None
            )
            raw_scenario_level_metrics[invocation_step_key]["costs"].append(
                invocation.cost or 0.0
            )
            raw_scenario_level_metrics[invocation_step_key]["tokens"].append(
                invocation.tokens or 0.0
            )
            raw_scenario_level_metrics[invocation_step_key]["duration"].append(
                invocation.latency or 0.0
            )

            raw_run_level_metrics[invocation_step_key]["errors"].append(
                raw_scenario_level_metrics[invocation_step_key]["errors"][0]
            )
            raw_run_level_metrics[invocation_step_key]["costs"].append(
                raw_scenario_level_metrics[invocation_step_key]["costs"][0]
            )
            raw_run_level_metrics[invocation_step_key]["tokens"].append(
                raw_scenario_level_metrics[invocation_step_key]["tokens"][0]
            )
            raw_run_level_metrics[invocation_step_key]["duration"].append(
                raw_scenario_level_metrics[invocation_step_key]["duration"][0]
            )

            # skip the iteration if error in the invocation --------------------
            if invocation.result.error:
                log.error(
                    f"There is an error in invocation {invocation.trace_id} so we skip its evaluation"
                )

                scenario_has_errors += 1
                run_has_errors += 1
                scenario_status = EvaluationStatus.ERRORS
                run_status = EvaluationStatus.ERRORS

                error = invocation.result.error.model_dump(mode="json") is not None
            # ------------------------------------------------------------------

            # proceed with the evaluation otherwise ----------------------------
            else:
                # run the evaluators if no error in the invocation -------------
                for jdx in range(nof_annotations):
                    autoeval_config = autoeval_configs[jdx]
                    annotation_step_key = annotation_steps_keys[jdx]

                    step_has_errors = 0
                    step_status = EvaluationStatus.SUCCESS

                    references = {
                        "evaluator": evaluator_references[annotation_step_key][
                            "artifact"
                        ],
                        "evaluator_variant": evaluator_references[annotation_step_key][
                            "variant"
                        ],
                        "evaluator_revision": evaluator_references[annotation_step_key][
                            "revision"
                        ],
                        "testset": {"id": testset_id},
                        "testcase": {"id": str(testcase.id)},
                    }
                    links = {
                        invocation_step_key: {
                            "trace_id": invocation.trace_id,
                            "span_id": invocation.span_id,
                        }
                    }

                    # hash_id = make_hash_id(references=references, links=links)
                    # log.debug("generating annotation with hash_id", hash_id=hash_id)

                    # - invoke annotation workflow -----------------------------
                    workflow_revision = evaluators[annotation_step_key]["revision"]

                    workflow_service_request = WorkflowServiceRequest(
                        version="2025.07.14",
                        flags={
                            "is_annotation": True,
                            "inline": True,
                        },
                        tags=None,
                        meta=None,
                        data=WorkflowServiceData(
                            inputs=testcase.data,
                            # trace=
                            trace_parameters=revision_parameters,
                            trace_outputs=invocation.result.value["data"],
                            tree=(
                                VersionedTree(
                                    version=invocation.result.value.get("version"),
                                    nodes=invocation.result.value["tree"].get("nodes"),
                                )
                                if "tree" in invocation.result.value
                                else None
                            ),
                        ),
                        references=references,
                        links=links,
                        credentials=f"Secret {secret_token}",
                        secrets=providers_keys,
                    )

                    workflow_service_response = loop.run_until_complete(
                        workflow_service.invoke_workflow(
                            project_id=project_id,
                            user_id=user_id,
                            #
                            request=workflow_service_request,
                            revision=workflow_revision,
                        )
                    )

                    # if workflow_service_response.status.code == 200:
                    #     log.debug(
                    #         invocation=invocation_step_key,
                    #         annotation=annotation_step_key,
                    #         code=workflow_service_response.status.code,
                    #         outputs=workflow_service_response.data.outputs,
                    #     )

                    # ----------------------------------------------------------

                    # run evaluator --------------------------------------------
                    # result = loop.run_until_complete(
                    #     evaluators_service.evaluate(
                    #         evaluator_key=autoeval_config.evaluator_key,
                    #         output=invocation.result.value,
                    #         data_point=testcase.data,
                    #         settings_values=autoeval_config.settings_values,
                    #         app_params=revision_parameters,  # type: ignore
                    #         inputs=testcase.data,
                    #         lm_providers_keys=providers_keys,
                    #     )
                    # )

                    trace_id = None
                    error = None

                    has_error = workflow_service_response.status.code != 200

                    # if error in evaluator, no annotation, only step ----------
                    if has_error:
                        log.warn(
                            f"There is an error in annotation {annotation_step_key} for invocation {invocation.trace_id}."
                        )

                        step_has_errors += 1
                        scenario_has_errors += 1
                        run_has_errors += 1
                        step_status = EvaluationStatus.FAILURE
                        scenario_status = EvaluationStatus.ERRORS
                        run_status = EvaluationStatus.ERRORS

                        error = workflow_service_response.status.model_dump(mode="json")

                        raw_scenario_level_metrics[annotation_step_key][
                            "errors"
                        ].append(has_error)

                        raw_run_level_metrics[annotation_step_key]["errors"].append(
                            raw_scenario_level_metrics[annotation_step_key]["errors"][0]
                        )
                    # ----------------------------------------------------------

                    # else, first annotation, then step ------------------------
                    else:
                        outputs = workflow_service_response.data.outputs or {}

                        annotation_create_request = AnnotationCreateRequest(
                            annotation=AnnotationCreate(
                                origin=AnnotationOrigin.AUTO,
                                kind=AnnotationKind.EVAL,
                                channel=AnnotationChannel.API,  # hardcoded
                                #
                                data={"outputs": outputs},
                                #
                                references=references,
                                links=links,
                            )
                        )

                        annotation_response = loop.run_until_complete(
                            annotations_router.create_annotation(
                                request=request,
                                annotation_create_request=annotation_create_request,
                            )
                        )

                        assert (
                            annotation_response.count != 0
                        ), f"Failed to create annotation for invocation {invocation.trace_id} and autoeval {autoeval_config.id}"

                        metrics = annotation_response.annotation.data.get("outputs", {})

                        for key in metrics:
                            if (
                                key
                                not in raw_scenario_level_metrics[annotation_step_key]
                            ):
                                raw_scenario_level_metrics[annotation_step_key][
                                    key
                                ] = []
                            if key not in raw_run_level_metrics[annotation_step_key]:
                                raw_run_level_metrics[annotation_step_key][key] = []

                            raw_scenario_level_metrics[annotation_step_key][key].append(
                                metrics[key]
                            )

                            raw_run_level_metrics[annotation_step_key][key].append(
                                raw_scenario_level_metrics[annotation_step_key][key][0]
                            )

                        trace_id = annotation_response.annotation.trace_id
                    # ----------------------------------------------------------

                    steps_create_request = EvaluationStepsCreateRequest(
                        steps=[
                            EvaluationStepCreate(
                                run_id=run_id,
                                scenario_id=scenario.id,
                                #
                                status=step_status,
                                #
                                key=annotation_step_key,
                                #
                                trace_id=trace_id,
                                error=error,
                            )
                        ],
                    )

                    steps_response = loop.run_until_complete(
                        evaluations_router.create_steps(
                            request=request,
                            steps_create_request=steps_create_request,
                        )
                    )

                    assert (
                        steps_response.count == 1
                    ), f"Failed to create evaluation step for scenario with id {scenario.id}!"
            # ------------------------------------------------------------------

            scenario_edit_request = EvaluationScenarioEditRequest(
                scenario=EvaluationScenarioEdit(
                    id=scenario.id,
                    tags=scenario.tags,
                    meta=scenario.meta,
                    status=scenario_status,
                ),
            )

            scenario_response = loop.run_until_complete(
                evaluations_router.edit_scenario(
                    request=request,
                    scenario_id=scenario.id,
                    scenario_edit_request=scenario_edit_request,
                )
            )

            assert (
                scenario_response.count == 1
            ), f"Failed to edit evaluation scenario with id {scenario.id}!"

            if run_status != EvaluationStatus.FAILURE:
                try:
                    # save scenario-level metrics ------------------------------
                    scenario_level_metrics = process_raw_metrics(
                        raw_metrics=raw_scenario_level_metrics,
                        invocation_steps_keys=[invocation_step_key],
                        annotation_steps_keys=annotation_steps_keys,
                        annotation_metrics_keys=annotation_metrics_keys,
                    )

                    metrics_create_request = EvaluationMetricsCreateRequest(
                        metrics=[
                            EvaluationMetricCreate(
                                run_id=run_id,
                                scenario_id=scenario.id,
                                #
                                status=EvaluationStatus.SUCCESS,
                                #
                                data=scenario_level_metrics,
                            )
                        ],
                    )

                    metrics_response = loop.run_until_complete(
                        evaluations_router.create_metrics(
                            request=request,
                            metrics_create_request=metrics_create_request,
                        )
                    )

                    assert (
                        metrics_response.count == 1
                    ), f"Failed to create evaluation metrics for scenario with id {scenario.id}!"
                    # ----------------------------------------------------------

                except Exception as e:  # pylint: disable=broad-exception-caught
                    log.error(f"An error occurred during evaluation: {e}")
                    traceback.print_exc()
        # ----------------------------------------------------------------------

    except Exception as e:  # pylint: disable=broad-exception-caught
        log.error(f"An error occurred during evaluation: {e}")
        traceback.print_exc()

        # edit celery task state to FAILURE ------------------------------------
        self.update_state(state=states.FAILURE)

        run_status = EvaluationStatus.FAILURE

    if run_status != EvaluationStatus.FAILURE:
        try:
            # process and save metrics -----------------------------------------
            scenario_level_metrics = process_raw_metrics(
                raw_metrics=raw_run_level_metrics,
                invocation_steps_keys=[invocation_step_key],
                annotation_steps_keys=annotation_steps_keys,
                annotation_metrics_keys=annotation_metrics_keys,
            )

            metrics_create_request = EvaluationMetricsCreateRequest(
                metrics=[
                    EvaluationMetricCreate(
                        run_id=run_id,
                        #
                        status=EvaluationStatus.SUCCESS,
                        #
                        data=scenario_level_metrics,
                    )
                ],
            )

            metrics_response = loop.run_until_complete(
                evaluations_router.create_metrics(
                    request=request,
                    metrics_create_request=metrics_create_request,
                )
            )

            assert (
                metrics_response.count == 1
            ), f"Failed to create evaluation metrics for run with id {run_id}!"
            # ------------------------------------------------------------------

        except Exception as e:  # pylint: disable=broad-exception-caught
            log.error(f"An error occurred during aggregation: {e}")
            traceback.print_exc()

            # edit celery task state to FAILURE --------------------------------
            self.update_state(state=states.FAILURE)

            run_status = EvaluationStatus.FAILURE

    # edit evaluation run status -----------------------------------------------
    run_edit_request = EvaluationRunEditRequest(
        run=EvaluationRunEdit(
            id=run_id,
            #
            name=evaluation_run_response.run.name,
            description=evaluation_run_response.run.description,
            #
            tags=evaluation_run_response.run.tags,
            meta=evaluation_run_response.run.meta,
            #
            status=run_status,
            #
            data=evaluation_run_response.run.data,
        )
    )

    evaluation_run_response = loop.run_until_complete(
        evaluations_router.edit_run(
            request=request,
            run_id=run_id,
            run_edit_request=run_edit_request,
        )
    )

    # edit meters to avoid conting failed evaluations --------------------------
    if run_status == EvaluationStatus.FAILURE:
        loop.run_until_complete(
            check_entitlements(
                organization_id=project.organization_id,
                key=Counter.EVALUATIONS,
                delta=-1,
            )
        )

    log.info("[DONE]      ", run_id=run_id, project_id=project_id, user_id=user_id)

    return


PERCENTILE_LEVELS = {
    "p0.05": 0.05,
    "p0.1": 0.1,
    "p0.5": 0.5,
    "p1": 1,
    "p2.5": 2.5,
    "p5": 5,
    "p10": 10,
    "p12.5": 12.5,
    "p20": 20,
    "p25": 25,
    "p30": 30,
    "p37.5": 37.5,
    "p40": 40,
    "p50": 50,
    "p60": 60,
    "p62.5": 62.5,
    "p70": 70,
    "p75": 75,
    "p80": 80,
    "p87.5": 87.5,
    "p90": 90,
    "p95": 95,
    "p97.5": 97.5,
    "p99": 99,
    "p99.5": 99.5,
    "p99.9": 99.9,
    "p99.95": 99.95,
}
PERCENTILES_KEYS = list(PERCENTILE_LEVELS.keys())
PERCENTILES_VALUES = list(PERCENTILE_LEVELS.values())
IQR_LEVELS = {
    "iqr25": ("p37.5", "p62.5"),
    "iqr50": ("p25", "p75"),
    "iqr60": ("p20", "p80"),
    "iqr75": ("p12.5", "p87.5"),
    "iqr80": ("p10", "p90"),
    "iqr90": ("p5", "p95"),
    "iqr95": ("p2.5", "p97.5"),
    "iqr98": ("p1", "p99"),
    "iqr99": ("p0.5", "p99.5"),
    "iqr99.9": ("p0.05", "p99.95"),
}
IQR_ITEMS = list(IQR_LEVELS.items())


def get_metrics_keys_from_schema(schema=None, path=()) -> List[Dict[str, str]]:
    metrics = []

    if not isinstance(schema, dict) or "type" not in schema:
        return metrics

    metric_type = None

    t = schema["type"]

    if t == "object":
        if "properties" in schema:
            for key, prop in schema["properties"].items():
                metrics.extend(get_metrics_keys_from_schema(prop, path + (key,)))
        else:
            metric_type = "json"

    elif t == "array" and "items" in schema:
        if schema["items"].get("type") == "string" and "enum" in schema["items"]:
            metric_type = "categorical/multiple"

    elif t == "boolean":
        metric_type = "binary"

    elif t == "string":
        metric_type = "categorical/single" if "enum" in schema else "string"

    elif t == "number":
        metric_type = "numeric/continuous"

    elif t == "integer":
        metric_type = "numeric/discrete"

    if metric_type:
        metrics.append({"path": ".".join(path), "type": metric_type})

    return metrics


def get_metric_from_path(metrics: dict, path: str):
    keys = path.split(".")
    for key in keys:
        if isinstance(metrics, dict) and key in metrics:
            metrics = metrics[key]
        else:
            return None  # or raise KeyError(key)
    return metrics


def compute_count(values):
    if not values:
        return {
            "count": None,
        }

    _count = len(values)

    return {
        "count": _count,
    }


def compute_sum_mean(values):
    if not values:
        return {
            "sum": None,
            "mean": None,
        }

    _sum = sum(values)
    _mean = _sum / len(values)

    return {
        "sum": _sum,
        "mean": _mean,
    }


def compute_min_max_range(values):
    if not values:
        return {
            "min": None,
            "max": None,
            "range": None,
        }

    _min = min(values)
    _max = max(values)
    _range = _max - _min

    return {
        "min": _min,
        "max": _max,
        "range": _range,
    }


def compute_frequency_unique_top(values, top_k=5):
    if not values:
        return {
            "frequency": None,
            "unique": None,
        }

    _frequency = {True: 0, False: 0} | dict(StatisticsCounter(values))
    _unique = list(_frequency.keys())
    _rank = sorted(_frequency.items(), key=lambda x: x[1], reverse=True)[:top_k]
    _rank = [{"value": value, "count": count} for (value, count) in _rank]
    _frequency = [{"value": k, "count": v} for k, v in _frequency.items()]

    return {
        "frequency": _frequency,
        "unique": _unique,
        "rank": _rank,
    }


def compute_percentiles_iqrs(values):
    if not values or len(values) < 2:
        return {
            "percentiles": None,
            "iqrs": None,
        }

    _percentiles = dict(
        zip(
            PERCENTILES_KEYS,
            numpy.percentile(values, PERCENTILES_VALUES).tolist(),
        )
    )

    _iqrs = {
        label: _percentiles[high] - _percentiles[low]
        for label, (low, high) in IQR_ITEMS
    }

    return {
        "percentiles": _percentiles,
        "iqrs": _iqrs,
    }


def compute_distribution(
    values,
    *,
    min_value=None,
    max_value=None,
    discrete=False,
):
    _distribution = _compute_distribution(
        values,
        min_value=min_value,
        max_value=max_value,
        discrete=discrete,
    )

    _distribution = _normalize_distribution(
        _distribution,
    )

    return {
        "distribution": _distribution,
    }


def _compute_distribution(
    values,
    *,
    min_value=None,
    max_value=None,
    discrete=False,
):
    if not values:
        return None

    if discrete:
        counter = StatisticsCounter(values)

        _distribution = [{"value": k, "count": v} for k, v in sorted(counter.items())]

        return _distribution

    n = len(values)
    bins = math.ceil(math.sqrt(n))

    min_value = min(values) if min_value is None else min_value
    max_value = max(values) if max_value is None else max_value

    if min_value == max_value:
        _distribution = [{"value": min_value, "count": n}]

        return _distribution

    bin_size = (max_value - min_value) / bins
    precision = max(0, -int(math.floor(math.log10(bin_size)))) if bin_size else 0

    hist = {}
    for v in values:
        bin_index = int((v - min_value) / bin_size)
        if bin_index == bins:
            bin_index -= 1
        bin_start = round(min_value + bin_index * bin_size, precision)
        hist[bin_start] = hist.get(bin_start, 0) + 1

    _distribution = [{"value": k, "count": v} for k, v in sorted(hist.items())]

    return _distribution


def _normalize_distribution(distribution):
    if not distribution:
        return []

    total_count = sum(item["count"] for item in distribution)
    if total_count == 0:
        return distribution

    normalized_distribution = [
        {"value": item["value"], "count": item["count"] / total_count}
        for item in distribution
    ]

    return normalized_distribution


def _process_binary_metric(metric):
    if not metric:
        return {}

    return compute_count(metric) | compute_frequency_unique_top(metric)


def _process_string_metric(metric):
    if not metric:
        return {}

    return compute_count(metric)


def _process_json_metric(metric):
    if not metric:
        return {}

    return compute_count(metric)


def _process_continuous_metric(metric):
    if not metric:
        return {}

    return (
        compute_count(metric)
        | compute_sum_mean(metric)
        | compute_min_max_range(metric)
        | compute_distribution(metric)
        | compute_percentiles_iqrs(metric)
    )


def _process_discrete_metric(metric):
    if not metric:
        return {}

    return (
        compute_count(metric)
        | compute_sum_mean(metric)
        | compute_min_max_range(metric)
        | compute_distribution(metric, discrete=True)
        | compute_percentiles_iqrs(metric)
    )


def _process_class_metric(metric):
    if not metric:
        return {}

    return compute_count(metric) | compute_frequency_unique_top(metric)


def _process_labels_metric(metric):
    if not metric:
        return {}

    flat_metric = list(
        itertools.chain.from_iterable(
            sublist if sublist else [None] for sublist in metric
        )
    )

    count_metric = [len(labels) for labels in metric]

    return (
        compute_count(flat_metric)
        | compute_frequency_unique_top(flat_metric)
        | compute_distribution(count_metric, discrete=True)
    )


def process_raw_metrics(
    raw_metrics,
    invocation_steps_keys,
    annotation_steps_keys,
    annotation_metrics_keys,
):
    metrics = dict()

    # invocations metrics ------------------------------------------------------
    for invocation_step_key in invocation_steps_keys:
        duration = raw_metrics[invocation_step_key]["duration"]
        duration_statistics = _process_continuous_metric(metric=duration)

        errors = raw_metrics[invocation_step_key]["errors"]
        errors_statistics = _process_binary_metric(metric=errors)

        costs = raw_metrics[invocation_step_key]["costs"]
        costs_statistics = _process_continuous_metric(metric=costs)

        tokens = raw_metrics[invocation_step_key]["tokens"]
        tokens_statistics = _process_discrete_metric(metric=tokens)

        metrics[invocation_step_key] = {
            "duration": duration_statistics,
            "errors": errors_statistics,
            "costs": costs_statistics,
            "tokens": tokens_statistics,
        }

    # annotation metrics -------------------------------------------------------
    for annotation_step_key in annotation_steps_keys:
        errors = raw_metrics[annotation_step_key]["errors"]
        errors_statistics = _process_binary_metric(metric=errors)

        if annotation_step_key not in annotation_metrics_keys:
            log.warn(f"slug {annotation_step_key} not found in metrics keys. Skipping.")
            continue

        metrics_keys = annotation_metrics_keys[annotation_step_key]

        if not metrics_keys:
            log.warn(f"No metrics keys found for slug {annotation_step_key}. Skipping.")
            continue

        metric_statistics = {}

        for metric_key in metrics_keys:
            metric_path = metric_key["path"]
            metric_type = metric_key["type"]

            metric = get_metric_from_path(
                metrics=raw_metrics[annotation_step_key],
                path=metric_path,
            )

            match metric_type:
                case "numeric/continuous":
                    path_statistics = _process_continuous_metric(metric=metric)
                case "numeric/discrete":
                    path_statistics = _process_discrete_metric(metric=metric)
                case "binary":
                    path_statistics = _process_binary_metric(metric=metric)
                case "categorical/single":
                    path_statistics = _process_class_metric(metric=metric)
                case "categorical/multiple":
                    path_statistics = _process_labels_metric(metric=metric)
                case "string":
                    path_statistics = _process_string_metric(metric=metric)
                case "json":
                    path_statistics = _process_json_metric(metric=metric)
                case _:
                    log.warning(
                        f"Unknown metric type {metric_type} for path {metric_path}. Skipping."
                    )
                    continue

            metric_statistics[metric_path] = path_statistics

        metrics[annotation_step_key] = {
            "errors": errors_statistics,
            **metric_statistics,
        }

    return metrics
