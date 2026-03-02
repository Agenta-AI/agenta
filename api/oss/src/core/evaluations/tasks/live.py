from typing import Dict, Any, Optional
from uuid import UUID
from datetime import datetime

from redis.asyncio import Redis
from fastapi import Request

from oss.src.utils.logging import get_module_logger
from oss.src.utils.env import env

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
from oss.src.tasks.asyncio.tracing.worker import TracingWorker


from oss.src.core.evaluations.types import (
    EvaluationMetricsRefresh,
    EvaluationStatus,
    EvaluationScenarioCreate,
    EvaluationScenarioEdit,
    EvaluationResultCreate,
)
from oss.src.core.shared.dtos import (
    Reference,
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
)
from oss.src.core.workflows.dtos import (
    WorkflowServiceRequestData,
    WorkflowServiceRequest,
)
from oss.src.core.queries.dtos import (
    QueryRevisionData,
    QueryRevision,
)
from oss.src.core.evaluators.dtos import (
    EvaluatorRevisionData,
    EvaluatorRevision,
)

from oss.src.core.evaluations.utils import fetch_trace


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

# Redis client and TracingWorker for publishing spans to Redis Streams
if env.redis.uri_durable:
    redis_client = Redis.from_url(env.redis.uri_durable, decode_responses=False)
    tracing_worker = TracingWorker(
        service=tracing_service,
        redis_client=redis_client,
        stream_name="streams:tracing",
        consumer_group="worker-tracing",
    )
else:
    raise RuntimeError("REDIS_URI_DURABLE is required for tracing worker")

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
    #
)

# APIS -------------------------------------------------------------------------

tracing_router = TracingRouter(
    tracing_service=tracing_service,
    tracing_worker=tracing_worker,
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


async def evaluate_live_query(
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

        # fetch evaluation run -------------------------------------------------
        run = await evaluations_service.fetch_run(
            project_id=project_id,
            run_id=run_id,
        )

        if not run:
            raise ValueError(f"Evaluation run with id {run_id} not found!")

        if not run.data:
            raise ValueError(f"Evaluation run with id {run_id} has no data!")

        if not run.data.steps:
            raise ValueError(f"Evaluation run with id {run_id} has no steps!")

        steps = run.data.steps

        input_steps = {
            step.key: step
            for step in steps
            if step.type == "input"  # --------
        }
        invocation_steps = {
            step.key: step for step in steps if step.type == "invocation"
        }
        annotation_steps = {
            step.key: step for step in steps if step.type == "annotation"
        }

        input_steps_keys = list(input_steps.keys())
        invocation_steps_keys = list(invocation_steps.keys())  # noqa: F841
        annotation_steps_keys = list(annotation_steps.keys())

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
            query_revision = await queries_service.fetch_query_revision(
                project_id=project_id,
                #
                query_revision_ref=query_revision_ref,
            )

            if query_revision and not query_revision.data:
                query_revision.data = QueryRevisionData()

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
            evaluator_revision = await evaluators_service.fetch_evaluator_revision(
                project_id=project_id,
                #
                evaluator_revision_ref=evaluator_revision_ref,
            )

            if evaluator_revision and not evaluator_revision.data:
                evaluator_revision.data = EvaluatorRevisionData()

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

            tracing_response = await tracing_router.query_spans(
                request=request,
                #
                query=query,
            )

            nof_traces = tracing_response.count

            log.info(
                "[TRACES]    ",
                run_id=run_id,
                count=nof_traces,
            )

            query_traces[query_step_key] = tracing_response.traces or dict()
        # ----------------------------------------------------------------------

        total_traces = sum(len(traces) for traces in query_traces.values())
        if total_traces == 0:
            return

        # run online evaluation ------------------------------------------------
        any_results_created = False
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

            scenarios = await evaluations_service.create_scenarios(
                project_id=project_id,
                user_id=user_id,
                #
                scenarios=scenarios_create,
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
                    repeat_idx=0,
                    timestamp=timestamp,
                    interval=interval,
                    #
                    status=EvaluationStatus.SUCCESS,
                    #
                    trace_id=query_trace_id,
                )
                for scenario_id, query_trace_id in zip(scenario_ids, query_trace_ids)
            ]

            results = await evaluations_service.create_results(
                project_id=project_id,
                user_id=user_id,
                #
                results=results_create,
            )

            if len(results) != nof_traces:
                raise ValueError(
                    f"Failed to create evaluation results for run {run_id}!"
                )
            # ------------------------------------------------------------------

            scenario_has_errors: Dict[int, int] = dict()
            scenario_status: Dict[int, EvaluationStatus] = dict()

            # iterate over query traces ----------------------------------------
            for idx, trace in enumerate(query_traces[query_step_key].values()):
                scenario_results_created = False
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
                for jdx in range(nof_annotations):
                    annotation_step_key = annotation_steps_keys[jdx]

                    step_has_errors = 0
                    step_status = EvaluationStatus.SUCCESS

                    references: Dict[str, Any] = {
                        **evaluator_references[annotation_step_key],
                    }
                    links: Dict[str, Any] = {
                        query_step_key: dict(
                            trace_id=query_trace_id,
                            span_id=query_span_id,
                        )
                    }

                    # invoke annotation workflow -------------------------------
                    evaluator_revision = evaluator_revisions[annotation_step_key]

                    if not evaluator_revision:
                        log.error(
                            f"Evaluator revision for {annotation_step_key} not found!"
                        )
                        step_has_errors += 1
                        scenario_has_errors[idx] += 1
                        # run_has_errors += 1
                        step_status = EvaluationStatus.FAILURE
                        scenario_status[idx] = EvaluationStatus.ERRORS
                        # run_status = EvaluationStatus.ERRORS
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

                    _testcase = None
                    inputs = None

                    _trace: Optional[dict] = (
                        trace.model_dump(
                            mode="json",
                            exclude_none=True,
                        )
                        if trace
                        else None
                    )

                    _root_span = root_span.model_dump(mode="json", exclude_none=True)
                    testcase_data = None

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
                        trace_id=query_trace_id,
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

                    trace_id = workflows_service_response.trace_id

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

                        annotation = workflows_service_response

                        trace_id = annotation.trace_id

                        if not annotation.trace_id:
                            log.warn("annotation trace_id is missing.")
                            scenario_has_errors[idx] += 1
                            scenario_status[idx] = EvaluationStatus.ERRORS
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
                            scenario_has_errors[idx] += 1
                            scenario_status[idx] = EvaluationStatus.ERRORS
                            continue
                    # ----------------------------------------------------------

                    results_create = [
                        EvaluationResultCreate(
                            run_id=run_id,
                            scenario_id=scenario_id,
                            step_key=annotation_step_key,
                            #
                            timestamp=timestamp,
                            interval=interval,
                            #
                            status=step_status,
                            #
                            trace_id=trace_id,
                            error=error,
                        )
                    ]

                    results = await evaluations_service.create_results(
                        project_id=project_id,
                        user_id=user_id,
                        #
                        results=results_create,
                    )

                    if len(results) != 1:
                        raise ValueError(
                            f"Failed to create evaluation result for scenario with id {scenario.id}!"
                        )
                    scenario_results_created = True
                    any_results_created = True
                # --------------------------------------------------------------

                scenario_edit = EvaluationScenarioEdit(
                    id=scenario.id,
                    tags=scenario.tags,
                    meta=scenario.meta,
                    status=scenario_status[idx],
                )

                scenario = await evaluations_service.edit_scenario(
                    project_id=project_id,
                    user_id=user_id,
                    #
                    scenario=scenario_edit,
                )

                if not scenario or not scenario.id:
                    log.error(
                        f"Failed to update evaluation scenario with id {scenario_id}!",
                        run_id=run_id,
                    )

                if scenario_results_created:
                    await evaluations_service.refresh_metrics(
                        project_id=project_id,
                        user_id=user_id,
                        #
                        metrics=EvaluationMetricsRefresh(
                            run_id=run_id,
                            scenario_id=scenario_id,
                        ),
                    )
            # ------------------------------------------------------------------

        if any_results_created:
            await evaluations_service.refresh_metrics(
                project_id=project_id,
                user_id=user_id,
                #
                metrics=EvaluationMetricsRefresh(
                    run_id=run_id,
                    timestamp=timestamp,
                    interval=interval,
                ),
            )
    except Exception as e:  # pylint: disable=broad-exception-caught
        log.error(e, exc_info=True)

    log.info(
        "[DONE]      ",
        run_id=run_id,
    )

    return
