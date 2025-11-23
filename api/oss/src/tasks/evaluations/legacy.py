from typing import Dict, List, Optional, Any
from uuid import UUID
from json import dumps
from asyncio import get_event_loop

from celery import shared_task, states

from fastapi import Request

from oss.src.utils.helpers import parse_url, get_slug_from_name_and_id
from oss.src.utils.logging import get_module_logger
from oss.src.utils.common import is_ee
from oss.src.services.auth_helper import sign_secret_token
from oss.src.services import llm_apps_service
from oss.src.models.shared_models import InvokationResult
from oss.src.services.db_manager import (
    fetch_app_by_id,
    fetch_app_variant_by_id,
    fetch_app_variant_revision_by_id,
    fetch_evaluator_config,
    get_deployment_by_id,
    get_project_by_id,
)
from oss.src.core.secrets.utils import get_llm_providers_secrets

if is_ee():
    from ee.src.utils.entitlements import check_entitlements, Counter

from oss.src.dbs.postgres.queries.dbes import (
    QueryArtifactDBE,
    QueryVariantDBE,
    QueryRevisionDBE,
)
from oss.src.dbs.postgres.testcases.dbes import (
    TestcaseBlobDBE,
)
from oss.src.dbs.postgres.testsets.dbes import (
    TestsetArtifactDBE,
    TestsetVariantDBE,
    TestsetRevisionDBE,
)
from oss.src.dbs.postgres.workflows.dbes import (
    WorkflowArtifactDBE,
    WorkflowVariantDBE,
    WorkflowRevisionDBE,
)

from oss.src.dbs.postgres.tracing.dao import TracingDAO
from oss.src.dbs.postgres.blobs.dao import BlobsDAO
from oss.src.dbs.postgres.git.dao import GitDAO
from oss.src.dbs.postgres.evaluations.dao import EvaluationsDAO

from oss.src.core.tracing.service import TracingService
from oss.src.core.queries.service import QueriesService
from oss.src.core.testcases.service import TestcasesService
from oss.src.core.testsets.service import TestsetsService, SimpleTestsetsService
from oss.src.core.workflows.service import WorkflowsService
from oss.src.core.evaluators.service import EvaluatorsService
from oss.src.core.evaluators.service import SimpleEvaluatorsService
from oss.src.core.evaluations.service import EvaluationsService
from oss.src.core.annotations.service import AnnotationsService

from oss.src.apis.fastapi.tracing.utils import make_hash_id
from oss.src.apis.fastapi.tracing.router import TracingRouter
from oss.src.apis.fastapi.testsets.router import SimpleTestsetsRouter
from oss.src.apis.fastapi.evaluators.router import SimpleEvaluatorsRouter
from oss.src.apis.fastapi.annotations.router import AnnotationsRouter

from oss.src.core.annotations.types import (
    AnnotationOrigin,
    AnnotationKind,
    AnnotationChannel,
)
from oss.src.apis.fastapi.annotations.models import (
    AnnotationCreate,
    AnnotationCreateRequest,
)

from oss.src.core.evaluations.types import (
    EvaluationStatus,
    EvaluationRunDataMappingStep,
    EvaluationRunDataMappingColumn,
    EvaluationRunDataMapping,
    EvaluationRunDataStepInput,
    EvaluationRunDataStep,
    EvaluationRunData,
    EvaluationRunFlags,
    EvaluationRunQueryFlags,
    EvaluationRun,
    EvaluationRunCreate,
    EvaluationRunEdit,
    EvaluationScenarioCreate,
    EvaluationScenarioEdit,
    EvaluationResultCreate,
    EvaluationMetricsCreate,
)

from oss.src.core.shared.dtos import Reference
from oss.src.core.workflows.dtos import (
    WorkflowServiceRequestData,
    WorkflowServiceResponseData,
    WorkflowServiceRequest,
    WorkflowServiceResponse,
    WorkflowServiceInterface,
    WorkflowRevisionData,
    WorkflowRevision,
    WorkflowVariant,
    Workflow,
)

from oss.src.core.queries.dtos import (
    QueryRevision,
    QueryVariant,
    Query,
)

from oss.src.core.evaluations.utils import (
    get_metrics_keys_from_schema,
    fetch_trace,
)


log = get_module_logger(__name__)


# DBS --------------------------------------------------------------------------

tracing_dao = TracingDAO()

testcases_dao = BlobsDAO(
    BlobDBE=TestcaseBlobDBE,
)

queries_dao = GitDAO(
    ArtifactDBE=QueryArtifactDBE,
    VariantDBE=QueryVariantDBE,
    RevisionDBE=QueryRevisionDBE,
)

testsets_dao = GitDAO(
    ArtifactDBE=TestsetArtifactDBE,
    VariantDBE=TestsetVariantDBE,
    RevisionDBE=TestsetRevisionDBE,
)

workflows_dao = GitDAO(
    ArtifactDBE=WorkflowArtifactDBE,
    VariantDBE=WorkflowVariantDBE,
    RevisionDBE=WorkflowRevisionDBE,
)

evaluations_dao = EvaluationsDAO()

# CORE -------------------------------------------------------------------------

tracing_service = TracingService(
    tracing_dao=tracing_dao,
)

queries_service = QueriesService(
    queries_dao=queries_dao,
)

testcases_service = TestcasesService(
    testcases_dao=testcases_dao,
)

testsets_service = TestsetsService(
    testsets_dao=testsets_dao,
    testcases_service=testcases_service,
)

simple_testsets_service = SimpleTestsetsService(
    testsets_service=testsets_service,
)

workflows_service = WorkflowsService(
    workflows_dao=workflows_dao,
)

evaluators_service = EvaluatorsService(
    workflows_service=workflows_service,
)

simple_evaluators_service = SimpleEvaluatorsService(
    evaluators_service=evaluators_service,
)

evaluations_service = EvaluationsService(
    evaluations_dao=evaluations_dao,
    tracing_service=tracing_service,
    queries_service=queries_service,
    testsets_service=testsets_service,
    evaluators_service=evaluators_service,
)

# APIS -------------------------------------------------------------------------

tracing_router = TracingRouter(
    tracing_service=tracing_service,
)

simple_testsets_router = SimpleTestsetsRouter(
    simple_testsets_service=simple_testsets_service,
)  # TODO: REMOVE/REPLACE ONCE TRANSFER IS MOVED TO 'core'

simple_evaluators_router = SimpleEvaluatorsRouter(
    simple_evaluators_service=simple_evaluators_service,
)  # TODO: REMOVE/REPLACE ONCE TRANSFER IS MOVED TO 'core'

annotations_service = AnnotationsService(
    tracing_router=tracing_router,
    evaluators_service=evaluators_service,
    simple_evaluators_service=simple_evaluators_service,
)

annotations_router = AnnotationsRouter(
    annotations_service=annotations_service,
)  # TODO: REMOVE/REPLACE ONCE ANNOTATE IS MOVED TO 'core'

# ------------------------------------------------------------------------------


async def setup_evaluation(
    *,
    project_id: UUID,
    user_id: UUID,
    #
    name: Optional[str] = None,
    description: Optional[str] = None,
    #
    testset_id: Optional[str] = None,
    query_id: Optional[str] = None,
    #
    revision_id: Optional[str] = None,
    #
    autoeval_ids: Optional[List[str]] = None,
) -> Optional[EvaluationRun]:
    request = Request(scope={"type": "http", "http_version": "1.1", "scheme": "http"})
    request.state.project_id = project_id
    request.state.user_id = user_id

    run = None

    # --------------------------------------------------------------------------
    log.info("[SETUP]     ", project_id=project_id, user_id=user_id)
    log.info("[TESTSET]   ", ids=[testset_id])
    log.info("[QUERY]     ", ids=[query_id])
    log.info("[INVOCATON] ", ids=[revision_id])
    log.info("[ANNOTATION]", ids=autoeval_ids)
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

        assert run is not None, "Failed to create evaluation run."
        # ----------------------------------------------------------------------

        # just-in-time transfer of testset -------------------------------------
        testset_input_steps_keys = list()

        testset_references = dict()
        testset = None

        if testset_id:
            testset_ref = Reference(id=UUID(testset_id))

            testset_response = await simple_testsets_router.transfer_simple_testset(
                request=request,
                testset_id=UUID(testset_id),
            )

            assert testset_response.count != 0, (
                f"Testset with id {testset_id} not found!"
            )

            testset = testset_response.testset
            testcases = testset.data.testcases

            testset_references["artifact"] = testset_ref

            testset_input_steps_keys.append(
                get_slug_from_name_and_id(testset.name, testset.id)
            )
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

            assert query is not None, f"Query with id {query_id} not found!"

            query_references["artifact"] = Reference(
                id=query.id,
                slug=query.slug,
            )

            query_revision = await queries_service.fetch_query_revision(
                project_id=project_id,
                #
                query_ref=query_ref,
            )

            assert query_revision is not None, (
                f"Query revision with id {query_id} not found!"
            )

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

            assert query_variant is not None, (
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
            revision = await fetch_app_variant_revision_by_id(revision_id)

            assert revision is not None, (
                f"App revision with id {revision_id} not found!"
            )

            application_references["revision"] = Reference(
                id=UUID(str(revision.id)),
            )

            variant = await fetch_app_variant_by_id(str(revision.variant_id))

            assert variant is not None, (
                f"App variant with id {revision.variant_id} not found!"
            )

            application_references["variant"] = Reference(
                id=UUID(str(variant.id)),
            )

            app = await fetch_app_by_id(str(variant.app_id))

            assert app is not None, f"App with id {variant.app_id} not found!"

            application_references["artifact"] = Reference(
                id=UUID(str(app.id)),
            )

            deployment = await get_deployment_by_id(str(revision.base.deployment_id))

            assert deployment is not None, (
                f"Deployment with id {revision.base.deployment_id} not found!"
            )

            uri = parse_url(url=deployment.uri)

            assert uri is not None, f"Invalid URI for deployment {deployment.id}!"

            revision_parameters = revision.config_parameters

            assert revision_parameters is not None, (
                f"Revision parameters for variant {variant.id} not found!"
            )

            invocation_steps_keys.append(
                get_slug_from_name_and_id(app.app_name, revision.id)
            )
        # ----------------------------------------------------------------------

        # fetch evaluators -----------------------------------------------------
        annotation_steps_keys = []

        if autoeval_ids:
            autoeval_configs = []

            for autoeval_id in autoeval_ids:
                autoeval_config = await fetch_evaluator_config(autoeval_id)

                autoeval_configs.append(autoeval_config)

            for autoeval_config in autoeval_configs:
                annotation_steps_keys.append(
                    get_slug_from_name_and_id(autoeval_config.name, autoeval_config.id)
                )
        # ----------------------------------------------------------------------

        # just-in-time transfer of evaluators ----------------------------------
        annotation_metrics_keys = {key: {} for key in annotation_steps_keys}
        evaluator_references = dict()

        for jdx, autoeval_id in enumerate(autoeval_ids):
            annotation_step_key = annotation_steps_keys[jdx]

            evaluator_response = (
                await simple_evaluators_router.transfer_simple_evaluator(
                    request=request,
                    evaluator_id=UUID(autoeval_id),
                )
            )

            evaluator = evaluator_response.evaluator

            assert evaluator is not None, f"Evaluator with id {autoeval_id} not found!"

            evaluator_references[annotation_step_key] = {}

            evaluator_references[annotation_step_key]["artifact"] = Reference(
                id=evaluator.id,
                slug=evaluator.slug,
            )

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

            workflow_ref = references["artifact"]

            workflow = await workflows_service.fetch_workflow(
                project_id=project_id,
                #
                workflow_ref=workflow_ref,
            )

            evaluators[annotation_step_key]["workflow"] = workflow

            workflow_revision = await workflows_service.fetch_workflow_revision(
                project_id=project_id,
                #
                workflow_ref=workflow_ref,
            )

            assert workflow_revision is not None, (
                f"Workflow revision with id {workflow_ref.id} not found!"
            )

            workflow_revision_ref = Reference(
                id=workflow_revision.id,
                slug=workflow_revision.slug,
            )

            evaluator_references[annotation_step_key]["revision"] = (
                workflow_revision_ref
            )

            evaluators[annotation_step_key]["revision"] = workflow_revision

            workflow_variant = await workflows_service.fetch_workflow_variant(
                project_id=project_id,
                workflow_variant_ref=Reference(
                    id=workflow_revision.variant_id,
                ),
            )

            assert workflow_variant is not None, (
                f"Workflow variant with id {workflow_revision.variant_id} not found!"
            )

            workflow_variant_ref = Reference(
                id=workflow_variant.id,
                slug=workflow_variant.slug,
            )

            evaluator_references[annotation_step_key]["variant"] = workflow_variant_ref

            evaluators[annotation_step_key]["variant"] = workflow_variant

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
                    # "testset_revision":
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
                    if testset_id and revision_id
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

        if testset_id and testset_input_step:
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
            if testset_id
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

        assert run, f"Failed to edit evaluation run {run_edit.id}!"
        # ----------------------------------------------------------------------

        log.info("[DONE]      ", run_id=run.id)

    except:  # pylint: disable=bare-except
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


@shared_task(
    name="src.tasks.evaluations.legacy.annotate",
    queue="src.tasks.evaluations.legacy.annotate",
    bind=True,
)
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
    request = Request(
        scope={
            "type": "http",
            "http_version": "1.1",
            "scheme": "http",
        }
    )
    request.state.project_id = str(project_id)
    request.state.user_id = str(user_id)

    loop = get_event_loop()

    run = None

    try:
        # ----------------------------------------------------------------------
        log.info("[SCOPE]     ", run_id=run_id, project_id=project_id, user_id=user_id)
        log.info("[TESTSET]   ", run_id=run_id, ids=[testset_id])
        log.info("[INVOCATON] ", run_id=run_id, ids=[revision_id])
        log.info("[ANNOTATION]", run_id=run_id, ids=autoeval_ids)
        # ----------------------------------------------------------------------

        # fetch project --------------------------------------------------------
        project = loop.run_until_complete(
            get_project_by_id(
                project_id=str(project_id),
            ),
        )
        # ----------------------------------------------------------------------

        # fetch secrets --------------------------------------------------------
        secrets = loop.run_until_complete(
            get_llm_providers_secrets(
                project_id=str(project_id),
            ),
        )
        # ----------------------------------------------------------------------

        # prepare credentials --------------------------------------------------
        secret_token = loop.run_until_complete(
            sign_secret_token(
                user_id=str(user_id),
                project_id=str(project_id),
                workspace_id=str(project.workspace_id),
                organization_id=str(project.organization_id),
            )
        )

        credentials = f"Secret {secret_token}"
        # ----------------------------------------------------------------------

        # fetch run ------------------------------------------------------------
        run = loop.run_until_complete(
            evaluations_service.fetch_run(
                project_id=project_id,
                #
                run_id=run_id,
            )
        )

        assert run, f"Evaluation run with id {run_id} not found!"

        assert run.data, f"Evaluation run with id {run_id} has no data!"

        assert run.data.steps, f"Evaluation run with id {run_id} has no steps!"

        steps = run.data.steps

        invocation_steps = [step for step in steps if step.type == "invocation"]
        annotation_steps = [step for step in steps if step.type == "annotation"]

        invocation_steps_keys = [step.key for step in invocation_steps]
        annotation_steps_keys = [step.key for step in annotation_steps]

        nof_annotations = len(annotation_steps)
        # ----------------------------------------------------------------------

        # fetch testset --------------------------------------------------------
        testset_response = loop.run_until_complete(
            simple_testsets_router.fetch_simple_testset(
                request=request,
                testset_id=testset_id,
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

        assert variant is not None, (
            f"App variant with id {revision.variant_id} not found!"
        )

        app = loop.run_until_complete(
            fetch_app_by_id(str(variant.app_id)),
        )

        assert app is not None, f"App with id {variant.app_id} not found!"

        deployment = loop.run_until_complete(
            get_deployment_by_id(str(revision.base.deployment_id)),
        )

        assert deployment is not None, (
            f"Deployment with id {revision.base.deployment_id} not found!"
        )

        uri = parse_url(url=deployment.uri)

        assert uri is not None, f"Invalid URI for deployment {deployment.id}!"

        revision_parameters = revision.config_parameters

        assert revision_parameters is not None, (
            f"Revision parameters for variant {variant.id} not found!"
        )
        # ----------------------------------------------------------------------

        # fetch evaluators -----------------------------------------------------
        evaluator_references = {step.key: step.references for step in annotation_steps}

        evaluators = {
            evaluator_key: loop.run_until_complete(
                workflows_service.fetch_workflow_revision(
                    project_id=project_id,
                    #
                    workflow_revision_ref=evaluator_refs.get("evaluator_revision"),
                )
            )
            for evaluator_key, evaluator_refs in evaluator_references.items()
        }
        # ----------------------------------------------------------------------

        # prepare headers ------------------------------------------------------
        headers = {}
        if credentials:
            headers = {"Authorization": credentials}
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

        # create scenarios -----------------------------------------------------
        scenarios_create = [
            EvaluationScenarioCreate(
                run_id=run_id,
                #
                status=EvaluationStatus.RUNNING,
            )
            for _ in range(nof_testcases)
        ]

        scenarios = loop.run_until_complete(
            evaluations_service.create_scenarios(
                project_id=project_id,
                user_id=user_id,
                #
                scenarios=scenarios_create,
            )
        )

        assert len(scenarios) == nof_testcases, (
            f"Failed to create evaluation scenarios for run {run_id}!"
        )
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

        steps = loop.run_until_complete(
            evaluations_service.create_results(
                project_id=project_id,
                user_id=user_id,
                #
                results=results_create,
            )
        )

        assert len(steps) == nof_testcases, (
            f"Failed to create evaluation steps for run {run_id}!"
        )
        # ----------------------------------------------------------------------

        # flatten testcases ----------------------------------------------------
        _testcases = [testcase.model_dump(mode="json") for testcase in testcases]

        log.info(
            "[BATCH]     ",
            run_id=run_id,
            ids=[testset_id],
            count=len(_testcases),
            size=len(dumps(_testcases).encode("utf-8")),
        )
        # ----------------------------------------------------------------------

        # invoke application ---------------------------------------------------
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
                scenarios=[
                    s.model_dump(
                        mode="json",
                        exclude_none=True,
                    )
                    for s in scenarios
                ],
            )
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

        steps = loop.run_until_complete(
            evaluations_service.create_results(
                project_id=project_id,
                user_id=user_id,
                #
                results=results_create,
            )
        )

        assert len(steps) == nof_testcases, (
            f"Failed to create evaluation steps for run {run_id}!"
        )
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

                error = invocation.result.error.model_dump(mode="json") is not None
            # ------------------------------------------------------------------

            # proceed with the evaluation otherwise ----------------------------
            else:
                if not invocation.trace_id:
                    log.warn(f"invocation trace_id is missing.")
                    scenario_has_errors += 1
                    scenario_status = EvaluationStatus.ERRORS
                    continue

                trace = None
                if invocation.trace_id:
                    trace = loop.run_until_complete(
                        fetch_trace(
                            tracing_router=tracing_router,
                            request=request,
                            trace_id=invocation.trace_id,
                        )
                    )

                if trace:
                    log.info(
                        f"Trace found  ",
                        scenario_id=scenario.id,
                        step_key=invocation_step_key,
                        trace_id=invocation.trace_id,
                    )
                else:
                    log.warn(
                        f"Trace missing",
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
                        "testset": {"id": testset_id},
                        "testcase": {"id": str(testcase.id)},
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
                    workflows_service_response = loop.run_until_complete(
                        workflows_service.invoke_workflow(
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
                            log.warn(f"annotation trace_id is missing.")
                            scenario_has_errors += 1
                            scenario_status = EvaluationStatus.ERRORS
                            continue

                        trace = None
                        if annotation.trace_id:
                            trace = loop.run_until_complete(
                                fetch_trace(
                                    tracing_router=tracing_router,
                                    request=request,
                                    trace_id=annotation.trace_id,
                                )
                            )

                        if trace:
                            log.info(
                                f"Trace found  ",
                                scenario_id=scenario.id,
                                step_key=annotation_step_key,
                                trace_id=annotation.trace_id,
                            )
                        else:
                            log.warn(
                                f"Trace missing",
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

                    steps = loop.run_until_complete(
                        evaluations_service.create_results(
                            project_id=project_id,
                            user_id=user_id,
                            #
                            results=results_create,
                        )
                    )

                    assert len(steps) == 1, (
                        f"Failed to create evaluation step for scenario with id {scenario.id}!"
                    )
            # ------------------------------------------------------------------

            scenario_edit = EvaluationScenarioEdit(
                id=scenario.id,
                tags=scenario.tags,
                meta=scenario.meta,
                status=scenario_status,
            )

            scenario = loop.run_until_complete(
                evaluations_service.edit_scenario(
                    project_id=project_id,
                    user_id=user_id,
                    #
                    scenario=scenario_edit,
                )
            )

            assert scenario, (
                f"Failed to edit evaluation scenario with id {scenario.id}!"
            )

            if scenario_status != EvaluationStatus.FAILURE:
                try:
                    metrics = loop.run_until_complete(
                        evaluations_service.refresh_metrics(
                            project_id=project_id,
                            user_id=user_id,
                            #
                            run_id=run_id,
                            scenario_id=scenario.id,
                        )
                    )

                    if not metrics:
                        log.warning(
                            f"Refreshing metrics failed for {run_id} | {scenario.id}"
                        )

                except Exception as e:
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

        self.update_state(state=states.FAILURE)

        run_status = EvaluationStatus.FAILURE

    if not run:
        log.info("[FAIL]      ", run_id=run_id, project_id=project_id, user_id=user_id)

    if run_status != EvaluationStatus.FAILURE:
        try:
            metrics = loop.run_until_complete(
                evaluations_service.refresh_metrics(
                    project_id=project_id,
                    user_id=user_id,
                    #
                    run_id=run_id,
                )
            )

            if not metrics:
                log.warning(f"Refreshing metrics failed for {run_id}")

                self.update_state(state=states.FAILURE)

                run_status = EvaluationStatus.FAILURE

        except Exception as e:  # pylint: disable=broad-exception-caught
            log.warning(f"Refreshing metrics failed for {run_id}", exc_info=True)

            self.update_state(state=states.FAILURE)

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

    loop.run_until_complete(
        evaluations_service.edit_run(
            project_id=project_id,
            user_id=user_id,
            #
            run=run_edit,
        )
    )

    # edit meters to avoid conting failed evaluations --------------------------
    if run_status == EvaluationStatus.FAILURE:
        if is_ee():
            loop.run_until_complete(
                check_entitlements(
                    organization_id=project.organization_id,
                    key=Counter.EVALUATIONS,
                    delta=-1,
                )
            )

    log.info("[DONE]      ", run_id=run_id, project_id=project_id, user_id=user_id)

    return
