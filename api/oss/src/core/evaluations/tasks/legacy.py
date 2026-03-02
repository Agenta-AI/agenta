from typing import Dict, List, Optional, Any
from uuid import UUID
from json import dumps

from fastapi import Request

from oss.src.utils.helpers import parse_url, get_slug_from_name_and_id
from oss.src.utils.logging import get_module_logger
from oss.src.utils.common import is_ee
from oss.src.services.auth_service import sign_secret_token
from oss.src.services import llm_apps_service
from oss.src.models.shared_models import InvokationResult
from oss.src.services.db_manager import get_project_by_id
from oss.src.core.secrets.utils import get_llm_providers_secrets

if is_ee():
    from ee.src.utils.entitlements import check_entitlements, Counter


from oss.src.core.queries.service import QueriesService
from oss.src.core.testsets.service import TestsetsService
from oss.src.core.applications.services import ApplicationsService
from oss.src.core.workflows.service import WorkflowsService
from oss.src.core.evaluators.service import EvaluatorsService
from oss.src.core.evaluators.service import SimpleEvaluatorsService
from oss.src.core.evaluations.service import EvaluationsService

from oss.src.apis.fastapi.tracing.router import TracingRouter


from oss.src.core.evaluations.types import (
    EvaluationStatus,
    EvaluationRunDataMappingStep,
    EvaluationRunDataMappingColumn,
    EvaluationRunDataMapping,
    EvaluationRunDataStepInput,
    EvaluationRunDataStep,
    EvaluationRunData,
    EvaluationRunFlags,
    EvaluationRun,
    EvaluationRunCreate,
    EvaluationRunEdit,
    EvaluationScenarioCreate,
    EvaluationScenarioEdit,
    EvaluationResultCreate,
    EvaluationMetricsRefresh,
)

from oss.src.core.shared.dtos import Reference
from oss.src.core.workflows.dtos import (
    WorkflowServiceRequestData,
    WorkflowServiceRequest,
)


from oss.src.core.evaluations.utils import (
    get_metrics_keys_from_schema,
    fetch_trace,
)


log = get_module_logger(__name__)


# ------------------------------------------------------------------------------


async def setup_evaluation(
    *,
    project_id: UUID,
    user_id: UUID,
    #
    name: Optional[str] = None,
    description: Optional[str] = None,
    #
    testset_revision_id: Optional[str] = None,
    #
    query_id: Optional[str] = None,
    #
    revision_id: Optional[str] = None,
    #
    evaluator_ids: Optional[List[str]] = None,
    evaluator_revision_ids: Optional[List[str]] = None,
    #
    testsets_service: TestsetsService,
    queries_service: QueriesService,
    workflows_service: WorkflowsService,
    applications_service: ApplicationsService,
    evaluators_service: EvaluatorsService,
    evaluations_service: EvaluationsService,
) -> Optional[EvaluationRun]:
    request = Request(scope={"type": "http", "http_version": "1.1", "scheme": "http"})
    request.state.project_id = project_id
    request.state.user_id = user_id

    run = None

    # --------------------------------------------------------------------------
    log.info("[SETUP]       ", project_id=project_id, user_id=user_id)
    log.info("[TESTSET]     ", ids=[testset_revision_id])
    log.info("[QUERY]       ", ids=[query_id])
    log.info("[APPLICATION] ", ids=[revision_id])
    log.info("[EVALUATOR]   ", ids=evaluator_ids)
    # --------------------------------------------------------------------------

    try:
        # create evaluation run ------------------------------------------------
        run_create = EvaluationRunCreate(
            name=name,
            description=description,
            #
            flags=(
                EvaluationRunFlags(
                    is_closed=False,
                    is_live=True,
                    is_active=True,
                )
                if query_id
                else None
            ),
            #
            status=EvaluationStatus.PENDING,
        )

        run = await evaluations_service.create_run(
            project_id=project_id,
            user_id=user_id,
            #
            run=run_create,
        )

        if run is None:
            raise ValueError("Failed to create evaluation run.")
        # ----------------------------------------------------------------------

        # testset --------------------------------------------------------------
        testset_input_steps_keys = list()

        testset_references = dict()
        testset = None

        if testset_revision_id:
            testset_revision_ref = Reference(id=UUID(testset_revision_id))

            testset_revision = await testsets_service.fetch_testset_revision(
                project_id=project_id,
                testset_revision_ref=testset_revision_ref,
            )

            if testset_revision is None:
                raise ValueError(
                    f"Testset revision with id {testset_revision_id} not found!"
                )

            testset_ref = Reference(id=testset_revision.testset_id)

            testset = await testsets_service.fetch_testset(
                project_id=project_id,
                testset_ref=testset_ref,
            )

            if testset is None:
                raise ValueError(
                    f"Testset with id {testset_revision.testset_id} not found!"
                )

            testcases = testset_revision.data.testcases

            testset_references["artifact"] = testset_ref
            testset_references["revision"] = testset_revision_ref

            testset_input_steps_keys.append(testset_revision.slug)
        # ----------------------------------------------------------------------

        # fetch query ----------------------------------------------------------
        query_input_steps_keys = list()

        query_references = dict()
        query_revision = None

        if query_id:
            query_ref = Reference(id=UUID(query_id))

            query = await queries_service.fetch_query(
                project_id=project_id,
                #
                query_ref=query_ref,
            )

            if query is None:
                raise ValueError(f"Query with id {query_id} not found!")

            query_references["artifact"] = Reference(
                id=query.id,
                slug=query.slug,
            )

            query_revision = await queries_service.fetch_query_revision(
                project_id=project_id,
                #
                query_ref=query_ref,
            )

            if query_revision is None:
                raise ValueError(f"Query revision with id {query_id} not found!")

            query_revision_ref = Reference(
                id=query_revision.id,
                slug=query_revision.slug,
            )

            query_references["revision"] = query_revision_ref

            query_variant = await queries_service.fetch_query_variant(
                project_id=project_id,
                query_variant_ref=Reference(
                    id=query_revision.variant_id,
                ),
            )

            if query_variant is None:
                raise ValueError(
                    f"Query variant with id {query_revision.variant_id} not found!"
                )

            query_variant_ref = Reference(
                id=query_variant.id,
                slug=query_variant.slug,
            )

            query_references["variant"] = query_variant_ref

            query_input_steps_keys.append(query_revision.slug)
        # ----------------------------------------------------------------------

        # fetch application ----------------------------------------------------
        invocation_steps_keys = list()

        application_references = dict()

        if revision_id:
            application_revision = (
                await applications_service.fetch_application_revision(
                    project_id=project_id,
                    application_revision_ref=Reference(id=UUID(revision_id)),
                )
            )

            if application_revision is None:
                raise ValueError(f"App revision with id {revision_id} not found!")

            application_variant = await applications_service.fetch_application_variant(
                project_id=project_id,
                application_variant_ref=Reference(
                    id=application_revision.application_variant_id
                ),
            )

            if application_variant is None:
                raise ValueError(
                    f"Application variant with id {application_revision.application_variant_id} not found!"
                )

            application = await applications_service.fetch_application(
                project_id=project_id,
                application_ref=Reference(id=application_variant.application_id),
            )

            if application is None:
                raise ValueError(
                    f"Application with id {application_variant.application_id} not found!"
                )

            application_references["revision"] = Reference(
                id=application_revision.id,
            )

            application_references["variant"] = Reference(
                id=application_variant.id,
            )

            application_references["artifact"] = Reference(
                id=application.id,
            )

            invocation_steps_keys.append(
                get_slug_from_name_and_id(
                    application.name or application.slug,
                    application_revision.id,
                )
            )
        # ----------------------------------------------------------------------

        # fetch evaluators -----------------------------------------------------
        annotation_steps_keys = []
        annotation_metrics_keys = dict()
        evaluator_references = dict()

        if evaluator_ids:
            for evaluator_id in evaluator_ids:
                # fetch evaluator (artifact)
                evaluator = await evaluators_service.fetch_evaluator(
                    project_id=project_id,
                    evaluator_ref=Reference(id=UUID(evaluator_id)),
                )

                if evaluator is None:
                    raise ValueError(f"Evaluator with id {evaluator_id} not found!")

                annotation_step_key = evaluator.slug

                # fetch evaluator variant
                evaluator_variant = await evaluators_service.fetch_evaluator_variant(
                    project_id=project_id,
                    evaluator_ref=Reference(id=evaluator.id),
                )

                if evaluator_variant is None:
                    raise ValueError(
                        f"Evaluator variant for evaluator {evaluator_id} not found!"
                    )

                # fetch evaluator revision
                evaluator_revision_ref = (
                    Reference(
                        id=UUID(evaluator_revision_ids[len(annotation_steps_keys)])
                    )
                    if evaluator_revision_ids
                    else None
                )

                evaluator_revision = await evaluators_service.fetch_evaluator_revision(
                    project_id=project_id,
                    evaluator_ref=Reference(id=evaluator.id),
                    evaluator_variant_ref=Reference(id=evaluator_variant.id),
                    evaluator_revision_ref=evaluator_revision_ref,
                )

                if evaluator_revision is None:
                    raise ValueError(
                        f"Evaluator revision for evaluator {evaluator_id} not found!"
                    )

                # collect step key
                annotation_steps_keys.append(annotation_step_key)

                # collect references
                evaluator_references[annotation_step_key] = {
                    "artifact": Reference(
                        id=evaluator.id,
                        slug=evaluator.slug,
                    ),
                    "variant": Reference(
                        id=evaluator_variant.id,
                        slug=evaluator_variant.slug,
                    ),
                    "revision": Reference(
                        id=evaluator_revision.id,
                        slug=evaluator_revision.slug,
                    ),
                }

                # collect metrics
                metrics_keys = get_metrics_keys_from_schema(
                    schema=(
                        evaluator_revision.data.schemas.outputs
                        if evaluator_revision.data and evaluator_revision.data.schemas
                        else None
                    ),
                )

                annotation_metrics_keys[annotation_step_key] = [
                    {
                        "path": metric_key.get("path", "").replace("outputs.", "", 1),
                        "type": metric_key.get("type", ""),
                    }
                    for metric_key in metrics_keys
                ]
        # ----------------------------------------------------------------------

        # initialize steps/mappings in run -------------------------------------
        testset_input_step = (
            EvaluationRunDataStep(
                key=testset_input_steps_keys[0],
                type="input",
                origin="auto",
                references={
                    "testset": testset_references["artifact"],
                    # "testset_variant":
                    "testset_revision": testset_references["revision"],
                },
            )
            if testset and testset.id
            else None
        )

        query_input_step = (
            EvaluationRunDataStep(
                key=query_input_steps_keys[0],
                type="input",
                origin="auto",
                references={
                    "query": query_references["artifact"],
                    "query_variant": query_references["variant"],
                    "query_revision": query_references["revision"],
                },
            )
            if query_id
            else None
        )

        invocation_step = (
            EvaluationRunDataStep(
                key=invocation_steps_keys[0],
                type="invocation",
                origin="auto",
                references={
                    "application": application_references["artifact"],
                    "application_variant": application_references["variant"],
                    "application_revision": application_references["revision"],
                },
                inputs=[
                    EvaluationRunDataStepInput(
                        key=testset_input_steps_keys[0],
                    ),
                ],
            )
            if revision_id
            else None
        )

        annotation_steps = [
            EvaluationRunDataStep(
                key=step_key,
                type="annotation",
                origin="auto",
                references={
                    "evaluator": evaluator_references[step_key]["artifact"],
                    "evaluator_variant": evaluator_references[step_key]["variant"],
                    "evaluator_revision": evaluator_references[step_key]["revision"],
                },
                inputs=(
                    [
                        EvaluationRunDataStepInput(
                            key=testset_input_steps_keys[0],
                        ),
                        EvaluationRunDataStepInput(
                            key=invocation_steps_keys[0],
                        ),
                    ]
                    if testset_revision_id and revision_id
                    else [
                        EvaluationRunDataStepInput(
                            key=query_input_steps_keys[0],
                        ),
                    ]
                ),
            )
            for step_key in annotation_steps_keys
        ]

        steps: List[EvaluationRunDataStep] = list()

        if testset_revision_id and testset_input_step:
            steps.append(testset_input_step)
        if query_id and query_input_step:
            steps.append(query_input_step)
        if revision_id and invocation_step:
            steps.append(invocation_step)

        steps.extend(annotation_steps)

        testset_input_mappings = (
            [
                EvaluationRunDataMapping(
                    column=EvaluationRunDataMappingColumn(
                        kind="testset",
                        name=key,
                    ),
                    step=EvaluationRunDataMappingStep(
                        key=testset_input_steps_keys[0],
                        path=f"data.{key}",
                    ),
                )
                for key in testcases[0].data.keys()
            ]
            if testset_revision_id
            else []
        )

        query_input_mappings = (
            [
                EvaluationRunDataMapping(
                    column=EvaluationRunDataMappingColumn(
                        kind="query",
                        name="data",
                    ),
                    step=EvaluationRunDataMappingStep(
                        key=query_input_steps_keys[0],
                        path="attributes.ag.data",
                    ),
                )
            ]
            if query_id
            else []
        )

        invocation_mappings = (
            [
                EvaluationRunDataMapping(
                    column=EvaluationRunDataMappingColumn(
                        kind="invocation",
                        name="outputs",
                    ),
                    step=EvaluationRunDataMappingStep(
                        key=step_key,
                        path="attributes.ag.data.outputs",
                    ),
                )
                for step_key in invocation_steps_keys
            ]
            if invocation_steps_keys
            else []
        )

        annotation_mappings = [
            EvaluationRunDataMapping(
                column=EvaluationRunDataMappingColumn(
                    kind="annotation",
                    name=metric_key["path"],
                ),
                step=EvaluationRunDataMappingStep(
                    key=step_key,
                    path=f"attributes.ag.data.outputs{'.' + metric_key['path'] if metric_key['path'] else ''}",
                ),
            )
            for step_key in annotation_steps_keys
            for metric_key in annotation_metrics_keys[step_key]
        ]

        mappings: List[EvaluationRunDataMapping] = (
            testset_input_mappings
            + query_input_mappings
            + invocation_mappings
            + annotation_mappings
        )

        run_edit = EvaluationRunEdit(
            id=run.id,
            #
            name=run.name,
            description=run.description,
            #
            flags=run.flags,
            tags=run.tags,
            meta=run.meta,
            #
            status=EvaluationStatus.RUNNING,
            #
            data=EvaluationRunData(
                steps=steps,
                mappings=mappings,
            ),
        )

        run = await evaluations_service.edit_run(
            project_id=project_id,
            user_id=user_id,
            #
            run=run_edit,
        )

        if not run:
            raise ValueError(f"Failed to edit evaluation run {run_edit.id}!")
        # ----------------------------------------------------------------------

        log.info("[DONE]      ", run_id=run.id)

    except Exception:  # pylint: disable=broad-exception-caught
        if run and run.id:
            log.error("[FAIL]      ", run_id=run.id, exc_info=True)

            await evaluations_service.delete_run(
                project_id=project_id,
                #
                run_id=run.id,
            )
        else:
            log.error("[FAIL]", exc_info=True)

        run = None

    return run


async def evaluate_batch_testset(
    *,
    project_id: UUID,
    user_id: UUID,
    #
    run_id: UUID,
    #
    tracing_router: TracingRouter,
    testsets_service: TestsetsService,
    queries_service: QueriesService,
    workflows_service: WorkflowsService,
    applications_service: ApplicationsService,
    evaluations_service: EvaluationsService,
    #
    simple_evaluators_service: SimpleEvaluatorsService,
):
    """
    Annotates an application revision applied to a testset using auto evaluator(s).

    All testset, application, and evaluator information is extracted from the
    evaluation run's data.steps references.

    Args:
        project_id (UUID): The ID of the project.
        user_id (UUID): The ID of the user.
        run_id (UUID): The ID of the evaluation run.

    Returns:
        None
    """
    request = Request(
        scope={
            "type": "http",
            "http_version": "1.1",
            "scheme": "http",
        }
    )
    request.state.project_id = str(project_id)
    request.state.user_id = str(user_id)

    run = None

    try:
        # ----------------------------------------------------------------------
        log.info(
            "[SCOPE]       ", run_id=run_id, project_id=project_id, user_id=user_id
        )
        # ----------------------------------------------------------------------

        # fetch project --------------------------------------------------------
        project = await get_project_by_id(
            project_id=str(project_id),
        )
        # ----------------------------------------------------------------------

        # fetch secrets --------------------------------------------------------
        _ = await get_llm_providers_secrets(
            project_id=str(project_id),
        )
        # ----------------------------------------------------------------------

        # prepare credentials --------------------------------------------------
        secret_token = await sign_secret_token(
            user_id=str(user_id),
            project_id=str(project_id),
            workspace_id=str(project.workspace_id),
            organization_id=str(project.organization_id),
        )

        credentials = f"Secret {secret_token}"
        # ----------------------------------------------------------------------

        # fetch run ------------------------------------------------------------
        run = await evaluations_service.fetch_run(
            project_id=project_id,
            #
            run_id=run_id,
        )

        if not run:
            raise ValueError(f"Evaluation run with id {run_id} not found!")

        if not run.data:
            raise ValueError(f"Evaluation run with id {run_id} has no data!")

        if not run.data.steps:
            raise ValueError(f"Evaluation run with id {run_id} has no steps!")

        steps = run.data.steps

        invocation_steps = [step for step in steps if step.type == "invocation"]
        annotation_steps = [step for step in steps if step.type == "annotation"]

        invocation_steps_keys = [step.key for step in invocation_steps]
        annotation_steps_keys = [step.key for step in annotation_steps]

        nof_annotations = len(annotation_steps)

        # extract references from run steps ------------------------------------
        input_steps = [step for step in steps if step.type == "input"]

        testset_revision_id = None
        if input_steps and "testset_revision" in input_steps[0].references:
            testset_revision_id = str(input_steps[0].references["testset_revision"].id)

        revision_id = None
        if (
            invocation_steps
            and "application_revision" in invocation_steps[0].references
        ):
            revision_id = str(invocation_steps[0].references["application_revision"].id)

        run_config = {
            "batch_size": 10,
            "max_retries": 3,
            "retry_delay": 3,
            "delay_between_batches": 5,
        }

        log.info("[TESTSET]     ", run_id=run_id, ids=[testset_revision_id])
        log.info("[APPLICATION] ", run_id=run_id, ids=[revision_id])
        # ----------------------------------------------------------------------

        # fetch testset --------------------------------------------------------
        testset_revision_ref = Reference(id=UUID(testset_revision_id))

        testset_revision = await testsets_service.fetch_testset_revision(
            project_id=project_id,
            testset_revision_ref=testset_revision_ref,
        )

        if testset_revision is None:
            raise ValueError(
                f"Testset revision with id {testset_revision_id} not found!"
            )

        testset_ref = Reference(id=testset_revision.testset_id)

        testset = await testsets_service.fetch_testset(
            project_id=project_id,
            testset_ref=testset_ref,
        )

        if testset is None:
            raise ValueError(
                f"Testset with id {testset_revision.testset_id} not found!"
            )

        testset_id = testset_revision.testset_id

        testcases = testset_revision.data.testcases
        testcases_data = [
            {**testcase.data, "id": str(testcase.id)} for testcase in testcases
        ]  # INEFFICIENT: might want to have testcase_id in testset data (caution with hashing)
        nof_testcases = len(testcases)

        testset_step_key = testset_revision.slug
        # ----------------------------------------------------------------------

        # fetch application ----------------------------------------------------
        if revision_id is None:
            raise ValueError(f"App revision with id {revision_id} not found!")

        application_revision = await applications_service.fetch_application_revision(
            project_id=project_id,
            application_revision_ref=Reference(id=UUID(revision_id)),
        )

        if application_revision is None:
            raise ValueError(f"App revision with id {revision_id} not found!")

        application_variant = await applications_service.fetch_application_variant(
            project_id=project_id,
            application_variant_ref=Reference(
                id=application_revision.application_variant_id
            ),
        )

        if application_variant is None:
            raise ValueError(
                f"Application variant with id {application_revision.application_variant_id} not found!"
            )

        application = await applications_service.fetch_application(
            project_id=project_id,
            application_ref=Reference(id=application_variant.application_id),
        )

        if application is None:
            raise ValueError(
                f"Application with id {application_variant.application_id} not found!"
            )

        deployment_uri = None
        if application_revision.data:
            deployment_uri = application_revision.data.url or getattr(
                application_revision.data, "uri", None
            )

        if not deployment_uri:
            raise ValueError(f"No deployment URI found for revision {revision_id}!")

        uri = parse_url(url=deployment_uri)
        if uri is None:
            raise ValueError(f"Invalid URI for revision {revision_id}!")

        revision_parameters = (
            application_revision.data.parameters if application_revision.data else None
        )
        if revision_parameters is None:
            raise ValueError(
                f"Revision parameters for revision {revision_id} not found!"
            )
        # ----------------------------------------------------------------------

        # fetch evaluators -----------------------------------------------------
        evaluator_references = {step.key: step.references for step in annotation_steps}

        evaluators = {}
        for evaluator_key, evaluator_refs in evaluator_references.items():
            evaluators[evaluator_key] = await workflows_service.fetch_workflow_revision(
                project_id=project_id,
                #
                workflow_revision_ref=evaluator_refs.get("evaluator_revision"),
            )
        # ----------------------------------------------------------------------

        # prepare headers ------------------------------------------------------
        headers = {}
        if credentials:
            headers = {"Authorization": credentials}
        headers["ngrok-skip-browser-warning"] = "1"

        openapi_parameters = None
        openapi_is_chat = None
        max_recursive_depth = 5
        runtime_prefix = uri
        route_path = ""

        while max_recursive_depth > 0 and not openapi_parameters:
            try:
                (
                    openapi_parameters,
                    openapi_is_chat,
                ) = await llm_apps_service.get_parameters_from_openapi(
                    runtime_prefix + "/openapi.json",
                    route_path,
                    headers,
                )
            except Exception:  # pylint: disable=broad-exception-caught
                openapi_parameters = None
                openapi_is_chat = None

            if not openapi_parameters:
                max_recursive_depth -= 1
                if not runtime_prefix.endswith("/"):
                    route_path = "/" + runtime_prefix.split("/")[-1] + route_path
                    runtime_prefix = "/".join(runtime_prefix.split("/")[:-1])
                else:
                    route_path = ""
                    runtime_prefix = runtime_prefix[:-1]

        (
            openapi_parameters,
            openapi_is_chat,
        ) = await llm_apps_service.get_parameters_from_openapi(
            runtime_prefix + "/openapi.json",
            route_path,
            headers,
        )
        # ----------------------------------------------------------------------

        # create scenarios -----------------------------------------------------
        scenarios_create = [
            EvaluationScenarioCreate(
                run_id=run_id,
                #
                status=EvaluationStatus.RUNNING,
            )
            for _ in range(nof_testcases)
        ]

        scenarios = await evaluations_service.create_scenarios(
            project_id=project_id,
            user_id=user_id,
            #
            scenarios=scenarios_create,
        )

        if len(scenarios) != nof_testcases:
            raise ValueError(f"Failed to create evaluation scenarios for run {run_id}!")
        # ----------------------------------------------------------------------

        # create input steps ---------------------------------------------------
        results_create = [
            EvaluationResultCreate(
                run_id=run_id,
                scenario_id=scenario.id,
                step_key=testset_step_key,
                #
                status=EvaluationStatus.SUCCESS,
                #
                testcase_id=testcases[idx].id,
            )
            for idx, scenario in enumerate(scenarios)
        ]

        steps = await evaluations_service.create_results(
            project_id=project_id,
            user_id=user_id,
            #
            results=results_create,
        )

        if len(steps) != nof_testcases:
            raise ValueError(f"Failed to create evaluation steps for run {run_id}!")
        # ----------------------------------------------------------------------

        # flatten testcases ----------------------------------------------------
        _testcases = [testcase.model_dump(mode="json") for testcase in testcases]

        log.info(
            "[BATCH]     ",
            run_id=run_id,
            ids=[testset_revision_id],
            count=len(_testcases),
            size=len(dumps(_testcases).encode("utf-8")),
        )
        # ----------------------------------------------------------------------

        # invoke application ---------------------------------------------------
        invocations: List[InvokationResult] = await llm_apps_service.batch_invoke(
            project_id=str(project_id),
            user_id=str(user_id),
            testset_data=testcases_data,  # type: ignore
            parameters=revision_parameters,  # type: ignore
            uri=uri,
            rate_limit_config=run_config,
            application_id=str(application.id),  # DO NOT REMOVE
            references={
                "testset": {"id": str(testset_id)},
                "testset_revision": {"id": str(testset_revision_id)},
                "application": {"id": str(application.id)},
                "application_variant": {"id": str(application_variant.id)},
                "application_revision": {"id": str(application_revision.id)},
            },
            scenarios=[
                s.model_dump(
                    mode="json",
                    exclude_none=True,
                )
                for s in scenarios
            ],
        )
        # ----------------------------------------------------------------------

        # create invocation results --------------------------------------------
        results_create = [
            EvaluationResultCreate(
                run_id=run_id,
                scenario_id=scenario.id,
                step_key=invocation_steps_keys[0],
                #
                status=(
                    EvaluationStatus.SUCCESS
                    if not invocations[idx].result.error
                    else EvaluationStatus.FAILURE
                ),
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

        steps = await evaluations_service.create_results(
            project_id=project_id,
            user_id=user_id,
            #
            results=results_create,
        )

        if len(steps) != nof_testcases:
            raise ValueError(f"Failed to create evaluation steps for run {run_id}!")
        # ----------------------------------------------------------------------

        run_has_errors = 0
        run_status = EvaluationStatus.SUCCESS

        # run evaluators -------------------------------------------------------
        for idx in range(nof_testcases):
            scenario = scenarios[idx]
            testcase = testcases[idx]
            invocation = invocations[idx]
            invocation_step_key = invocation_steps_keys[0]

            scenario_has_errors = 0
            scenario_status = EvaluationStatus.SUCCESS

            # skip the iteration if error in the invocation --------------------
            if invocation.result.error:
                log.error(
                    f"There is an error in invocation {invocation.trace_id} so we skip its evaluation"
                )

                scenario_has_errors += 1
                run_has_errors += 1
                scenario_status = EvaluationStatus.ERRORS
                run_status = EvaluationStatus.ERRORS

                error = invocation.result.error.model_dump(mode="json")
            # ------------------------------------------------------------------

            # proceed with the evaluation otherwise ----------------------------
            else:
                if not invocation.trace_id:
                    log.warn("invocation trace_id is missing.")
                    scenario_has_errors += 1
                    scenario_status = EvaluationStatus.ERRORS
                    continue

                trace = None
                if invocation.trace_id:
                    trace = await fetch_trace(
                        tracing_router=tracing_router,
                        request=request,
                        trace_id=invocation.trace_id,
                    )

                if trace:
                    log.info(
                        "Trace found  ",
                        scenario_id=scenario.id,
                        step_key=invocation_step_key,
                        trace_id=invocation.trace_id,
                    )
                else:
                    log.warn(
                        "Trace missing",
                        scenario_id=scenario.id,
                        step_key=invocation_step_key,
                        trace_id=invocation.trace_id,
                    )
                    scenario_has_errors += 1
                    scenario_status = EvaluationStatus.ERRORS
                    continue

                if not isinstance(trace.spans, dict):
                    log.warn(
                        f"Trace with id {invocation.trace_id} has no root spans",
                    )
                    scenario_has_errors += 1
                    scenario_status = EvaluationStatus.ERRORS
                    continue

                root_span = list(trace.spans.values())[0]

                if isinstance(root_span, list):
                    log.warn(
                        f"More than one root span for trace with id {invocation.trace_id}.",
                    )
                    scenario_has_errors += 1
                    scenario_status = EvaluationStatus.ERRORS
                    continue

                # run the evaluators if no error in the invocation -------------
                for jdx in range(nof_annotations):
                    annotation_step_key = annotation_steps_keys[jdx]

                    step_has_errors = 0
                    step_status = EvaluationStatus.SUCCESS

                    references: Dict[str, Any] = {
                        **evaluator_references[annotation_step_key],
                        "testcase": {"id": str(testcase.id)},
                        "testset": {"id": str(testset_id)},
                        "testset_revision": {"id": str(testset_revision_id)},
                    }
                    links: Dict[str, Any] = {
                        invocation_steps_keys[0]: {
                            "trace_id": invocation.trace_id,
                            "span_id": invocation.span_id,
                        }
                    }

                    # invoke annotation workflow -------------------------------
                    evaluator_revision = evaluators[annotation_step_key]

                    if not evaluator_revision:
                        log.error(
                            f"Evaluator revision for {annotation_step_key} not found!"
                        )
                        step_has_errors += 1
                        scenario_has_errors += 1
                        run_has_errors += 1
                        step_status = EvaluationStatus.FAILURE
                        scenario_status = EvaluationStatus.ERRORS
                        run_status = EvaluationStatus.ERRORS
                        continue

                    _revision = evaluator_revision.model_dump(
                        mode="json",
                        exclude_none=True,
                    )
                    interface = (
                        dict(
                            uri=evaluator_revision.data.uri,
                            url=evaluator_revision.data.url,
                            headers=evaluator_revision.data.headers,
                            schemas=evaluator_revision.data.schemas,
                        )
                        if evaluator_revision.data
                        else dict()
                    )
                    configuration = (
                        dict(
                            script=evaluator_revision.data.script,
                            parameters=evaluator_revision.data.parameters,
                        )
                        if evaluator_revision.data
                        else dict()
                    )
                    parameters = configuration.get("parameters")

                    _testcase = testcase.model_dump(mode="json")
                    inputs = testcase.data
                    if isinstance(inputs, dict):
                        if "testcase_dedup_id" in inputs:
                            del inputs["testcase_dedup_id"]

                    _trace: Optional[dict] = (
                        trace.model_dump(
                            mode="json",
                            exclude_none=True,
                        )
                        if trace
                        else None
                    )

                    _root_span = root_span.model_dump(mode="json", exclude_none=True)
                    testcase_data = testcase.data

                    root_span_attributes: dict = _root_span.get("attributes") or {}
                    root_span_attributes_ag: dict = root_span_attributes.get("ag") or {}
                    root_span_attributes_ag_data: dict = (
                        root_span_attributes_ag.get("data") or {}
                    )
                    root_span_attributes_ag_data_outputs = (
                        root_span_attributes_ag_data.get("outputs")
                    )
                    root_span_attributes_ag_data_inputs = (
                        root_span_attributes_ag_data.get("inputs")
                    )

                    outputs = root_span_attributes_ag_data_outputs
                    inputs = testcase_data or root_span_attributes_ag_data_inputs

                    workflow_service_request_data = WorkflowServiceRequestData(
                        revision=_revision,
                        parameters=parameters,
                        #
                        testcase=_testcase,
                        inputs=inputs,
                        #
                        trace=_trace,
                        outputs=outputs,
                    )

                    flags = (
                        evaluator_revision.flags.model_dump(
                            mode="json",
                            exclude_none=True,
                            exclude_unset=True,
                        )
                        if evaluator_revision.flags
                        else None
                    )

                    workflow_service_request = WorkflowServiceRequest(
                        version="2025.07.14",
                        #
                        flags=flags,
                        #
                        interface=interface,
                        configuration=configuration,
                        #
                        data=workflow_service_request_data,
                        #
                        references=references,
                        links=links,
                    )

                    log.info(
                        "Invoking evaluator...  ",
                        scenario_id=scenario.id,
                        testcase_id=testcase.id,
                        trace_id=invocation.trace_id,
                        uri=interface.get("uri"),
                    )
                    workflows_service_response = (
                        await workflows_service.invoke_workflow(
                            project_id=project_id,
                            user_id=user_id,
                            #
                            request=workflow_service_request,
                            #
                            annotate=True,
                        )
                    )
                    log.info(
                        "Invoked evaluator      ",
                        scenario_id=scenario.id,
                        trace_id=workflows_service_response.trace_id,
                    )
                    # ----------------------------------------------------------

                    # run evaluator --------------------------------------------
                    trace_id = workflows_service_response.trace_id

                    error = None
                    has_error = workflows_service_response.status.code != 200

                    # if error in evaluator, no annotation, only step ----------
                    if has_error:
                        log.warn(
                            f"There is an error in annotation {annotation_step_key} for invocation {invocation.trace_id}."
                        )
                        log.error(
                            "[EVAL][ANNOTATION][ERROR]",
                            scenario_id=scenario.id,
                            invocation_trace_id=invocation.trace_id,
                            evaluator_trace_id=workflows_service_response.trace_id,
                            status=workflows_service_response.status.model_dump(
                                mode="json"
                            )
                            if workflows_service_response.status
                            else None,
                            data=workflows_service_response.data.model_dump(
                                mode="json", exclude_none=True
                            )
                            if workflows_service_response.data
                            else None,
                        )

                        step_has_errors += 1
                        scenario_has_errors += 1
                        run_has_errors += 1
                        step_status = EvaluationStatus.FAILURE
                        scenario_status = EvaluationStatus.ERRORS
                        run_status = EvaluationStatus.ERRORS

                        error = workflows_service_response.status.model_dump(
                            mode="json"
                        )

                    # ----------------------------------------------------------

                    # else, first annotation, then step ------------------------
                    else:
                        outputs = (
                            workflows_service_response.data.outputs
                            if workflows_service_response.data
                            else None
                        )

                        annotation = workflows_service_response

                        trace_id = annotation.trace_id

                        if not annotation.trace_id:
                            log.warn("annotation trace_id is missing.")
                            scenario_has_errors += 1
                            scenario_status = EvaluationStatus.ERRORS
                            continue

                        trace = None
                        if annotation.trace_id:
                            trace = await fetch_trace(
                                tracing_router=tracing_router,
                                request=request,
                                trace_id=annotation.trace_id,
                            )

                        if trace:
                            log.info(
                                "Trace found  ",
                                scenario_id=scenario.id,
                                step_key=annotation_step_key,
                                trace_id=annotation.trace_id,
                            )
                        else:
                            log.warn(
                                "Trace missing",
                                scenario_id=scenario.id,
                                step_key=annotation_step_key,
                                trace_id=annotation.trace_id,
                            )
                            scenario_has_errors += 1
                            scenario_status = EvaluationStatus.ERRORS
                            continue
                    # ----------------------------------------------------------

                    results_create = [
                        EvaluationResultCreate(
                            run_id=run_id,
                            scenario_id=scenario.id,
                            step_key=annotation_step_key,
                            #
                            status=step_status,
                            #
                            trace_id=trace_id,
                            error=error,
                        )
                    ]

                    steps = await evaluations_service.create_results(
                        project_id=project_id,
                        user_id=user_id,
                        #
                        results=results_create,
                    )

                    if len(steps) != 1:
                        raise ValueError(
                            f"Failed to create evaluation step for scenario with id {scenario.id}!"
                        )
            # ------------------------------------------------------------------

            scenario_edit = EvaluationScenarioEdit(
                id=scenario.id,
                tags=scenario.tags,
                meta=scenario.meta,
                status=scenario_status,
            )

            scenario = await evaluations_service.edit_scenario(
                project_id=project_id,
                user_id=user_id,
                #
                scenario=scenario_edit,
            )

            if not scenario:
                raise ValueError(
                    f"Failed to edit evaluation scenario with id {scenario.id}!"
                )

            if scenario_status != EvaluationStatus.FAILURE:
                try:
                    metrics = await evaluations_service.refresh_metrics(
                        project_id=project_id,
                        user_id=user_id,
                        #
                        metrics=EvaluationMetricsRefresh(
                            run_id=run_id,
                            scenario_id=scenario.id,
                        ),
                    )

                    if not metrics:
                        log.warning(
                            f"Refreshing metrics failed for {run_id} | {scenario.id}"
                        )

                except Exception:
                    log.warning(
                        f"Refreshing metrics failed for {run_id} | {scenario.id}",
                        exc_info=True,
                    )
        # ----------------------------------------------------------------------

    except Exception as e:  # pylint: disable=broad-exception-caught
        log.error(
            f"An error occurred during evaluation: {e}",
            exc_info=True,
        )

        run_status = EvaluationStatus.FAILURE

    if not run:
        log.info("[FAIL]      ", run_id=run_id, project_id=project_id, user_id=user_id)
        return

    if run_status != EvaluationStatus.FAILURE:
        try:
            metrics = await evaluations_service.refresh_metrics(
                project_id=project_id,
                user_id=user_id,
                #
                metrics=EvaluationMetricsRefresh(
                    run_id=run_id,
                ),
            )

            if not metrics:
                log.warning(f"Refreshing metrics failed for {run_id}")

                run_status = EvaluationStatus.FAILURE

        except Exception:  # pylint: disable=broad-exception-caught
            log.warning(f"Refreshing metrics failed for {run_id}", exc_info=True)

            run_status = EvaluationStatus.FAILURE

    # edit evaluation run status -----------------------------------------------
    run_edit = EvaluationRunEdit(
        id=run_id,
        #
        name=run.name,
        description=run.description,
        #
        tags=run.tags,
        meta=run.meta,
        #
        status=run_status,
        #
        data=run.data,
    )

    await evaluations_service.edit_run(
        project_id=project_id,
        user_id=user_id,
        #
        run=run_edit,
    )

    # edit meters to avoid counting failed evaluations --------------------------
    if run_status == EvaluationStatus.FAILURE:
        if is_ee():
            await check_entitlements(
                organization_id=project.organization_id,
                key=Counter.EVALUATIONS,
                delta=-1,
            )

    log.info("[DONE]      ", run_id=run_id, project_id=project_id, user_id=user_id)

    return
