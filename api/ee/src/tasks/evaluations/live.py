from typing import List, Dict, Any
from uuid import UUID
import asyncio
from datetime import datetime

from celery import shared_task
from fastapi import Request

from oss.src.utils.logging import get_module_logger
from oss.src.services.auth_helper import sign_secret_token
from oss.src.services.db_manager import get_project_by_id
from oss.src.core.secrets.utils import get_llm_providers_secrets

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
from oss.src.core.testsets.service import TestsetsService
from oss.src.core.testsets.service import SimpleTestsetsService
from oss.src.core.workflows.service import WorkflowsService
from oss.src.core.evaluators.service import EvaluatorsService
from oss.src.core.evaluators.service import SimpleEvaluatorsService
from oss.src.core.evaluations.service import EvaluationsService
from oss.src.core.annotations.service import AnnotationsService

# from oss.src.apis.fastapi.tracing.utils import make_hash_id
from oss.src.apis.fastapi.tracing.router import TracingRouter
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
    EvaluationScenarioCreate,
    EvaluationScenarioEdit,
    EvaluationResultCreate,
)
from oss.src.core.shared.dtos import (
    Reference,
    Link,
)
from oss.src.core.tracing.dtos import (
    Filtering,
    Windowing,
    Formatting,
    Format,
    Focus,
    TracingQuery,
    OTelSpansTree as Trace,
    LogicalOperator,
    SimpleTraceReferences,
)
from oss.src.core.workflows.dtos import (
    WorkflowServiceData,
    WorkflowServiceRequest,
)
from oss.src.core.queries.dtos import (
    QueryRevision,
)
from oss.src.core.evaluators.dtos import (
    EvaluatorRevision,
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

annotations_service = AnnotationsService(
    tracing_router=tracing_router,
    evaluators_service=evaluators_service,
    simple_evaluators_service=simple_evaluators_service,
)

annotations_router = AnnotationsRouter(
    annotations_service=annotations_service,
)  # TODO: REMOVE/REPLACE ONCE ANNOTATE IS MOVED TO 'core'

# ------------------------------------------------------------------------------


@shared_task(
    name="src.tasks.evaluations.live.evaluate",
    queue="src.tasks.evaluations.live.evaluate",
    bind=True,
)
def evaluate(
    self,
    *,
    project_id: UUID,
    user_id: UUID,
    #
    run_id: UUID,
    #
    newest: datetime,
    oldest: datetime,
):
    request = Request(scope={"type": "http", "http_version": "1.1", "scheme": "http"})

    request.state.project_id = str(project_id)
    request.state.user_id = str(user_id)

    loop = asyncio.get_event_loop()

    # count in minutes
    timestamp = oldest
    interval = int((newest - oldest).total_seconds() / 60)

    try:
        # ----------------------------------------------------------------------
        log.info(
            "[SCOPE]     ",
            run_id=run_id,
            project_id=project_id,
            user_id=user_id,
        )

        log.info(
            "[RANGE]     ",
            run_id=run_id,
            timestamp=timestamp,
            interval=interval,
        )
        # ----------------------------------------------------------------------

        # fetch project --------------------------------------------------------
        project = loop.run_until_complete(
            get_project_by_id(project_id=str(project_id)),
        )
        # ----------------------------------------------------------------------

        # fetch provider keys from secrets -------------------------------------
        secrets = loop.run_until_complete(
            get_llm_providers_secrets(str(project_id)),
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

        # fetch evaluation run -------------------------------------------------
        run = loop.run_until_complete(
            evaluations_service.fetch_run(
                project_id=project_id,
                run_id=run_id,
            )
        )

        assert run, f"Evaluation run with id {run_id} not found!"

        assert run.data, f"Evaluation run with id {run_id} has no data!"

        assert run.data.steps, f"Evaluation run with id {run_id} has no steps!"

        steps = run.data.steps

        input_steps = {
            step.key: step for step in steps if step.type == "input"  # --------
        }
        invocation_steps = {
            step.key: step for step in steps if step.type == "invocation"
        }
        annotation_steps = {
            step.key: step for step in steps if step.type == "annotation"
        }

        input_steps_keys = list(input_steps.keys())
        invocation_steps_keys = list(invocation_steps.keys())
        annotation_steps_keys = list(annotation_steps.keys())

        nof_inputs = len(input_steps_keys)
        nof_invocations = len(invocation_steps_keys)
        nof_annotations = len(annotation_steps_keys)
        # ----------------------------------------------------------------------

        # initialize query variables -------------------------------------------
        query_revision_refs: Dict[str, Reference] = dict()
        #
        query_revisions: Dict[str, QueryRevision] = dict()
        query_references: Dict[str, Dict[str, Reference]] = dict()
        #
        query_traces: Dict[str, Dict[str, Trace]] = dict()
        # ----------------------------------------------------------------------

        # initialize evaluator variables ---------------------------------------
        evaluator_revision_refs: Dict[str, Reference] = dict()
        #
        evaluator_revisions: Dict[str, EvaluatorRevision] = dict()
        evaluator_references: Dict[str, Dict[str, Reference]] = dict()
        # ----------------------------------------------------------------------

        # get query steps references -------------------------------------------
        for input_step_key in input_steps_keys:
            query_refs = input_steps[input_step_key].references
            query_revision_ref = query_refs.get("query_revision")

            if query_revision_ref:
                query_revision_refs[input_step_key] = query_revision_ref

        # ----------------------------------------------------------------------

        # get evaluator steps references ---------------------------------------
        for annotation_step_key in annotation_steps_keys:
            evaluator_refs = annotation_steps[annotation_step_key].references
            evaluator_revision_ref = evaluator_refs.get("evaluator_revision")

            if evaluator_revision_ref:
                evaluator_revision_refs[annotation_step_key] = evaluator_revision_ref
        # ----------------------------------------------------------------------

        # fetch query revisions ------------------------------------------------
        for (
            query_step_key,
            query_revision_ref,
        ) in query_revision_refs.items():
            query_revision = loop.run_until_complete(
                queries_service.fetch_query_revision(
                    project_id=project_id,
                    #
                    query_revision_ref=query_revision_ref,
                )
            )

            if (
                not query_revision
                or not query_revision.id
                or not query_revision.slug
                or not query_revision.data
            ):
                log.warn(
                    f"Query revision with ref {query_revision_ref.model_dump(mode='json')} not found!"
                )
                continue

            query_step = input_steps[query_step_key]

            query_revisions[query_step_key] = query_revision
            query_references[query_step_key] = query_step.references
        # ----------------------------------------------------------------------

        # fetch evaluator revisions --------------------------------------------
        for (
            evaluator_step_key,
            evaluator_revision_ref,
        ) in evaluator_revision_refs.items():
            evaluator_revision = loop.run_until_complete(
                evaluators_service.fetch_evaluator_revision(
                    project_id=project_id,
                    #
                    evaluator_revision_ref=evaluator_revision_ref,
                )
            )

            if (
                not evaluator_revision
                or not evaluator_revision.id
                or not evaluator_revision.slug
                or not evaluator_revision.data
            ):
                log.warn(
                    f"Evaluator revision with ref {evaluator_revision_ref.model_dump(mode='json')} not found!"
                )
                continue

            evaluator_step = annotation_steps[evaluator_step_key]

            evaluator_revisions[evaluator_step_key] = evaluator_revision
            evaluator_references[evaluator_step_key] = evaluator_step.references
        # ----------------------------------------------------------------------

        # run query revisions --------------------------------------------------
        for query_step_key, query_revision in query_revisions.items():
            formatting = Formatting(
                focus=Focus.TRACE,
                format=Format.AGENTA,
            )
            filtering = Filtering(
                operator=LogicalOperator.AND,
                conditions=list(),
            )
            windowing = Windowing(
                oldest=oldest,
                newest=newest,
                next=None,
                limit=None,
                order="ascending",
                interval=None,
                rate=None,
            )

            if query_revision.data:
                if query_revision.data.filtering:
                    filtering = query_revision.data.filtering

                if query_revision.data.windowing:
                    windowing.rate = query_revision.data.windowing.rate

            query = TracingQuery(
                formatting=formatting,
                filtering=filtering,
                windowing=windowing,
            )

            tracing_response = loop.run_until_complete(
                tracing_router.query_spans(
                    request=request,
                    #
                    query=query,
                )
            )

            nof_traces = tracing_response.count

            log.info(
                "[TRACES]    ",
                run_id=run_id,
                count=nof_traces,
            )

            query_traces[query_step_key] = tracing_response.traces or dict()
        # ----------------------------------------------------------------------

        # run online evaluation ------------------------------------------------
        for query_step_key in query_traces.keys():
            if not query_traces[query_step_key].keys():
                continue

            # create scenarios -------------------------------------------------

            nof_traces = len(query_traces[query_step_key].keys())

            scenarios_create = [
                EvaluationScenarioCreate(
                    run_id=run_id,
                    timestamp=timestamp,
                    interval=interval,
                    #
                    status=EvaluationStatus.RUNNING,
                )
                for _ in range(nof_traces)
            ]

            scenarios = loop.run_until_complete(
                evaluations_service.create_scenarios(
                    project_id=project_id,
                    user_id=user_id,
                    #
                    scenarios=scenarios_create,
                )
            )

            if len(scenarios) != nof_traces:
                log.error(
                    "[LIVE] Could not create evaluation scenarios",
                    run_id=run_id,
                )
                continue
            # ------------------------------------------------------------------

            # create query steps -----------------------------------------------
            query_trace_ids = list(query_traces[query_step_key].keys())
            scenario_ids = [scenario.id for scenario in scenarios if scenario.id]

            results_create = [
                EvaluationResultCreate(
                    run_id=run_id,
                    scenario_id=scenario_id,
                    step_key=query_step_key,
                    repeat_idx=1,
                    timestamp=timestamp,
                    interval=interval,
                    #
                    status=EvaluationStatus.SUCCESS,
                    #
                    trace_id=query_trace_id,
                )
                for scenario_id, query_trace_id in zip(scenario_ids, query_trace_ids)
            ]

            results = loop.run_until_complete(
                evaluations_service.create_results(
                    project_id=project_id,
                    user_id=user_id,
                    #
                    results=results_create,
                )
            )

            assert (
                len(results) == nof_traces
            ), f"Failed to create evaluation results for run {run_id}!"
            # ------------------------------------------------------------------

            scenario_has_errors: Dict[int, int] = dict()
            scenario_status: Dict[int, EvaluationStatus] = dict()

            # iterate over query traces ----------------------------------------
            for idx, trace in enumerate(query_traces[query_step_key].values()):
                scenario_has_errors[idx] = 0
                scenario_status[idx] = EvaluationStatus.SUCCESS

                scenario = scenarios[idx]
                scenario_id = scenario_ids[idx]
                query_trace_id = query_trace_ids[idx]

                if not isinstance(trace.spans, dict):
                    log.warn(
                        f"Trace with id {query_trace_id} has no root spans",
                        run_id=run_id,
                    )
                    scenario_has_errors[idx] += 1
                    scenario_status[idx] = EvaluationStatus.ERRORS
                    continue

                root_span = list(trace.spans.values())[0]

                if isinstance(root_span, list):
                    log.warn(
                        f"More than one root span for trace with id {query_trace_id}",
                        run_id=run_id,
                    )
                    scenario_has_errors[idx] += 1
                    scenario_status[idx] = EvaluationStatus.ERRORS
                    continue

                query_span_id = root_span.span_id

                log.info(
                    "[TRACE]     ",
                    run_id=run_id,
                    trace_id=query_trace_id,
                )

                # run evaluator revisions --------------------------------------
                for (
                    evaluator_step_key,
                    evaluator_revision,
                ) in evaluator_revisions.items():
                    step_has_errors = 0
                    step_status = EvaluationStatus.SUCCESS

                    references: dict = evaluator_references[evaluator_step_key]
                    links: dict = dict(
                        query_step_key=Link(
                            trace_id=query_trace_id,
                            span_id=query_span_id,
                        )
                    )

                    parameters: dict = (
                        evaluator_revision.data.parameters or {}
                        if evaluator_revision.data
                        else {}
                    )
                    inputs: dict = {}
                    outputs: Any = None

                    trace_attributes: dict = root_span.attributes or {}
                    trace_ag_attributes: dict = trace_attributes.get("ag", {})
                    trace_data: dict = trace_ag_attributes.get("data", {})
                    trace_parameters: dict = trace_data.get("parameters", {})
                    trace_inputs: dict = trace_data.get("inputs", {})
                    trace_outputs: Any = trace_data.get("outputs")

                    workflow_service_data = WorkflowServiceData(
                        #
                        parameters=parameters,
                        inputs=inputs,
                        #
                        trace_parameters=trace_parameters,
                        trace_inputs=trace_inputs,
                        trace_outputs=trace_outputs,
                        #
                        trace=trace,
                    )

                    workflow_service_request = WorkflowServiceRequest(
                        version="2025.07.14",
                        #
                        flags={
                            "is_annotation": True,
                            "inline": True,
                        },
                        tags=None,
                        meta=None,
                        #
                        data=workflow_service_data,
                        #
                        references=references,
                        links=links,
                        #
                        credentials=credentials,
                        secrets=secrets,
                    )

                    workflow_revision = evaluator_revision

                    workflows_service_response = loop.run_until_complete(
                        workflows_service.invoke_workflow(
                            project_id=project_id,
                            user_id=user_id,
                            #
                            request=workflow_service_request,
                            revision=workflow_revision,
                        )
                    )

                    evaluator_trace_id = None
                    error = None

                    has_error = workflows_service_response.status.code != 200

                    # if error in evaluator, no annotation, only step ----------
                    if has_error:
                        log.warn(
                            f"There is an error in evaluator {evaluator_step_key} for query {query_trace_id}."
                        )

                        step_has_errors += 1
                        step_status = EvaluationStatus.FAILURE
                        scenario_has_errors[idx] += 1
                        scenario_status[idx] = EvaluationStatus.ERRORS

                        error = workflows_service_response.status.model_dump(
                            mode="json",
                            exclude_none=True,
                        )
                    # ----------------------------------------------------------

                    # else, first annotation, then step ------------------------
                    else:
                        outputs = (
                            workflows_service_response.data.outputs
                            if workflows_service_response.data
                            else None
                        )

                        annotation_create_request = AnnotationCreateRequest(
                            annotation=AnnotationCreate(
                                origin=AnnotationOrigin.AUTO,
                                kind=AnnotationKind.EVAL,
                                channel=AnnotationChannel.API,
                                #
                                data={"outputs": outputs},
                                #
                                references=SimpleTraceReferences(**references),
                                links=links,
                            )
                        )

                        annotation_response = loop.run_until_complete(
                            annotations_router.create_annotation(
                                request=request,
                                annotation_create_request=annotation_create_request,
                            )
                        )

                        if (
                            not annotation_response.count
                            or not annotation_response.annotation
                        ):
                            log.warn(
                                f"Failed to create annotation for query {query_trace_id} and evaluator {evaluator_revision.id}"
                            )
                            step_has_errors += 1
                            step_status = EvaluationStatus.FAILURE
                            scenario_has_errors[idx] += 1
                            scenario_status[idx] = EvaluationStatus.ERRORS
                            continue

                        evaluator_trace_id = annotation_response.annotation.trace_id
                    # ----------------------------------------------------------

                    results_create = [
                        EvaluationResultCreate(
                            run_id=run_id,
                            scenario_id=scenario_id,
                            step_key=evaluator_step_key,
                            repeat_idx=1,
                            timestamp=timestamp,
                            interval=interval,
                            #
                            status=step_status,
                            #
                            trace_id=evaluator_trace_id,
                            error=error,
                        )
                    ]

                    results = loop.run_until_complete(
                        evaluations_service.create_results(
                            project_id=project_id,
                            user_id=user_id,
                            #
                            results=results_create,
                        )
                    )

                    assert (
                        len(results) == 1
                    ), f"Failed to create evaluation result for scenario with id {scenario.id}!"
                # --------------------------------------------------------------

                scenario_edit = EvaluationScenarioEdit(
                    id=scenario.id,
                    tags=scenario.tags,
                    meta=scenario.meta,
                    status=scenario_status[idx],
                )

                scenario = loop.run_until_complete(
                    evaluations_service.edit_scenario(
                        project_id=project_id,
                        user_id=user_id,
                        #
                        scenario=scenario_edit,
                    )
                )

                if not scenario or not scenario.id:
                    log.error(
                        f"Failed to update evaluation scenario with id {scenario_id}!",
                        run_id=run_id,
                    )

                loop.run_until_complete(
                    evaluations_service.refresh_metrics(
                        project_id=project_id,
                        user_id=user_id,
                        #
                        run_id=run_id,
                        scenario_id=scenario_id,
                    )
                )
            # ------------------------------------------------------------------

        loop.run_until_complete(
            evaluations_service.refresh_metrics(
                project_id=project_id,
                user_id=user_id,
                #
                run_id=run_id,
                timestamp=timestamp,
                interval=interval,
            )
        )
    except Exception as e:  # pylint: disable=broad-exception-caught
        log.error(e, exc_info=True)

    log.info(
        "[DONE]      ",
        run_id=run_id,
    )

    return
