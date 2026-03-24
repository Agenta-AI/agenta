from typing import Dict, List, Optional, Any

from uuid import UUID
from json import dumps

from fastapi import Request

from oss.src.utils.helpers import parse_url
from oss.src.utils.logging import get_module_logger
from oss.src.utils.common import is_ee
from oss.src.services.auth_service import sign_secret_token
from oss.src.services import llm_apps_service
from oss.src.models.shared_models import InvokationResult
from oss.src.services.db_manager import get_project_by_id

if is_ee():
    from ee.src.utils.entitlements import check_entitlements, Counter


from oss.src.core.queries.service import QueriesService
from oss.src.core.testcases.service import TestcasesService
from oss.src.core.testsets.service import TestsetsService
from oss.src.core.applications.service import ApplicationsService
from oss.src.core.workflows.service import WorkflowsService
from oss.src.core.evaluators.service import SimpleEvaluatorsService
from oss.src.core.evaluations.service import EvaluationsService

from oss.src.core.tracing.service import TracingService


from oss.src.core.evaluations.types import (
    EvaluationStatus,
    EvaluationRun,
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
    fetch_trace,
)


log = get_module_logger(__name__)


async def evaluate_batch_testset(
    *,
    project_id: UUID,
    user_id: UUID,
    #
    run_id: UUID,
    #
    tracing_service: TracingService,
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

        log.info(
            "[STEPS]       ",
            run_id=run_id,
            invocation_step_keys=invocation_steps_keys,
            annotation_step_keys=annotation_steps_keys,
            annotation_origins=[step.origin for step in annotation_steps],
            nof_annotations=nof_annotations,
        )

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
            schemas=(
                application_revision.data.schemas.model_dump(
                    mode="json",
                    exclude_none=True,
                )
                if application_revision.data and application_revision.data.schemas
                else None
            ),
            is_chat=(
                application_revision.flags.is_chat
                if application_revision.flags
                else None
            ),
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
        run_has_pending = False
        run_status = EvaluationStatus.SUCCESS

        # run evaluators -------------------------------------------------------
        for idx in range(nof_testcases):
            scenario = scenarios[idx]
            testcase = testcases[idx]
            invocation = invocations[idx]
            invocation_step_key = invocation_steps_keys[0]

            scenario_has_errors = 0
            scenario_has_pending = False
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
                        tracing_service=tracing_service,
                        project_id=project_id,
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
                    annotation_step = annotation_steps[jdx]

                    step_has_errors = 0
                    step_status = EvaluationStatus.SUCCESS

                    if annotation_step.origin in {"human", "custom"}:
                        log.info(
                            "[EVAL][SKIP]  ",
                            scenario_id=scenario.id,
                            step_key=annotation_step_key,
                            origin=annotation_step.origin,
                            reason="non-auto annotation step",
                        )
                        scenario_has_pending = True
                        run_has_pending = True
                        # Human/custom steps are not auto-invoked here.
                        # Results are created later by the annotator via the annotation submission flow.
                        continue

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

                    log.info(
                        "[EVAL][STEP]  ",
                        scenario_id=scenario.id,
                        step_key=annotation_step_key,
                        origin=annotation_step.origin,
                        evaluator_revision_id=(
                            str(evaluator_revision.id)
                            if getattr(evaluator_revision, "id", None)
                            else None
                        ),
                        evaluator_revision_slug=evaluator_revision.slug,
                        evaluator_uri=(
                            evaluator_revision.data.uri
                            if evaluator_revision.data
                            else None
                        ),
                    )

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
                                tracing_service=tracing_service,
                                project_id=project_id,
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

                    log.info(
                        "[EVAL][WRITE] ",
                        scenario_id=scenario.id,
                        step_key=annotation_step_key,
                        created_results=len(steps),
                        status=step_status,
                        trace_id=trace_id,
                        has_error=bool(error),
                    )

                    if len(steps) != 1:
                        raise ValueError(
                            f"Failed to create evaluation step for scenario with id {scenario.id}!"
                        )
            # ------------------------------------------------------------------

            final_scenario_status = (
                EvaluationStatus.PENDING
                if scenario_status == EvaluationStatus.SUCCESS and scenario_has_pending
                else scenario_status
            )

            scenario_edit = EvaluationScenarioEdit(
                id=scenario.id,
                tags=scenario.tags,
                meta=scenario.meta,
                status=final_scenario_status,
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

        if run_status != EvaluationStatus.FAILURE:
            if run_has_errors:
                run_status = EvaluationStatus.ERRORS
            elif run_has_pending:
                run_status = EvaluationStatus.RUNNING
            else:
                run_status = EvaluationStatus.SUCCESS

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
        flags=run.flags,
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


async def evaluate_batch_invocation(
    *,
    project_id: UUID,
    user_id: UUID,
    #
    run_id: UUID,
    #
    testsets_service: TestsetsService,
    applications_service: ApplicationsService,
    evaluations_service: EvaluationsService,
):
    """
    Run batch invocation over a testset without evaluator steps.

    This loop creates scenarios and input/invocation results, but does not
    invoke evaluator workflows and does not refresh evaluation metrics.
    """
    run = None
    run_status = EvaluationStatus.SUCCESS

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
            run_id=run_id,
        )

        if not run:
            raise ValueError(f"Evaluation run with id {run_id} not found!")
        if not run.data or not run.data.steps:
            raise ValueError(f"Evaluation run with id {run_id} has no steps!")

        steps = run.data.steps
        input_steps = [step for step in steps if step.type == "input"]
        invocation_steps = [step for step in steps if step.type == "invocation"]
        annotation_steps = [step for step in steps if step.type == "annotation"]

        if annotation_steps:
            raise ValueError(
                f"Evaluation run with id {run_id} contains annotation steps; "
                "use evaluate_batch_testset instead."
            )
        if len(input_steps) != 1 or len(invocation_steps) != 1:
            raise ValueError(
                f"Evaluation run with id {run_id} must have exactly one input and one invocation step."
            )

        input_step_key = input_steps[0].key
        invocation_step_key = invocation_steps[0].key
        input_refs = input_steps[0].references or {}
        invocation_refs = invocation_steps[0].references or {}

        testset_revision_ref = input_refs.get("testset_revision")
        if not testset_revision_ref or not isinstance(testset_revision_ref.id, UUID):
            raise ValueError(
                f"Evaluation run with id {run_id} missing input.testset_revision reference."
            )

        application_revision_ref = invocation_refs.get("application_revision")
        if not application_revision_ref or not isinstance(
            application_revision_ref.id, UUID
        ):
            raise ValueError(
                f"Evaluation run with id {run_id} missing invocation.application_revision reference."
            )
        # ----------------------------------------------------------------------

        # fetch testset --------------------------------------------------------
        testset_revision = await testsets_service.fetch_testset_revision(
            project_id=project_id,
            testset_revision_ref=testset_revision_ref,
        )
        if not testset_revision:
            raise ValueError(
                f"Testset revision with id {testset_revision_ref.id} not found!"
            )
        if not testset_revision.data or not testset_revision.data.testcases:
            raise ValueError(
                f"Testset revision with id {testset_revision_ref.id} has no testcases!"
            )

        testset_variant_ref = Reference(id=testset_revision.variant_id)
        testset_variant = await testsets_service.fetch_testset_variant(
            project_id=project_id,
            testset_variant_ref=testset_variant_ref,
        )
        if not testset_variant:
            raise ValueError(
                f"Testset variant with id {testset_revision.variant_id} not found!"
            )

        testset_ref = Reference(id=testset_variant.testset_id)
        testset = await testsets_service.fetch_testset(
            project_id=project_id,
            testset_ref=testset_ref,
        )
        if not testset:
            raise ValueError(f"Testset with id {testset_ref.id} not found!")

        testcases = testset_revision.data.testcases
        testcases_data = [
            {**testcase.data, "id": str(testcase.id)} for testcase in testcases
        ]
        nof_testcases = len(testcases)
        # ----------------------------------------------------------------------

        # fetch application ----------------------------------------------------
        application_revision = await applications_service.fetch_application_revision(
            project_id=project_id,
            application_revision_ref=application_revision_ref,
        )
        if not application_revision:
            raise ValueError(
                f"Application revision with id {application_revision_ref.id} not found!"
            )

        application_variant = await applications_service.fetch_application_variant(
            project_id=project_id,
            application_variant_ref=Reference(
                id=application_revision.application_variant_id
            ),
        )
        if not application_variant:
            raise ValueError(
                f"Application variant with id {application_revision.application_variant_id} not found!"
            )

        application = await applications_service.fetch_application(
            project_id=project_id,
            application_ref=Reference(id=application_variant.application_id),
        )
        if not application:
            raise ValueError(
                f"Application with id {application_variant.application_id} not found!"
            )

        deployment_uri = None
        if application_revision.data:
            deployment_uri = application_revision.data.url or getattr(
                application_revision.data, "uri", None
            )
        if not deployment_uri:
            raise ValueError(
                f"No deployment URI found for revision {application_revision_ref.id}!"
            )

        uri = parse_url(url=deployment_uri)
        if uri is None:
            raise ValueError(f"Invalid URI for revision {application_revision_ref.id}!")

        revision_parameters = (
            application_revision.data.parameters if application_revision.data else None
        )
        if revision_parameters is None:
            raise ValueError(
                f"Revision parameters for revision {application_revision_ref.id} not found!"
            )
        # ----------------------------------------------------------------------

        # create scenarios -----------------------------------------------------
        scenarios = await evaluations_service.create_scenarios(
            project_id=project_id,
            user_id=user_id,
            scenarios=[
                EvaluationScenarioCreate(
                    run_id=run_id,
                    status=EvaluationStatus.RUNNING,
                )
                for _ in range(nof_testcases)
            ],
        )
        if len(scenarios) != nof_testcases:
            raise ValueError(f"Failed to create evaluation scenarios for run {run_id}!")
        # ----------------------------------------------------------------------

        # create input results -------------------------------------------------
        input_results = await evaluations_service.create_results(
            project_id=project_id,
            user_id=user_id,
            results=[
                EvaluationResultCreate(
                    run_id=run_id,
                    scenario_id=scenario.id,
                    step_key=input_step_key,
                    status=EvaluationStatus.SUCCESS,
                    testcase_id=testcases[idx].id,
                )
                for idx, scenario in enumerate(scenarios)
            ],
        )
        if len(input_results) != nof_testcases:
            raise ValueError(f"Failed to create input results for run {run_id}!")
        # ----------------------------------------------------------------------

        # invoke application ---------------------------------------------------
        run_config = {
            "batch_size": 10,
            "max_retries": 3,
            "retry_delay": 3,
            "delay_between_batches": 5,
        }
        headers = {"Authorization": credentials} if credentials else {}
        headers["ngrok-skip-browser-warning"] = "1"
        _ = headers  # keep parity with legacy setup flow

        invocations: List[InvokationResult] = await llm_apps_service.batch_invoke(
            project_id=str(project_id),
            user_id=str(user_id),
            testset_data=testcases_data,  # type: ignore[arg-type]
            parameters=revision_parameters,  # type: ignore[arg-type]
            uri=uri,
            rate_limit_config=run_config,
            schemas=(
                application_revision.data.schemas.model_dump(
                    mode="json",
                    exclude_none=True,
                )
                if application_revision.data and application_revision.data.schemas
                else None
            ),
            is_chat=(
                application_revision.flags.is_chat
                if application_revision.flags
                else None
            ),
            application_id=str(application.id),
            references={
                "testset": {"id": str(testset.id)},
                "testset_revision": {"id": str(testset_revision.id)},
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
        if len(invocations) != nof_testcases:
            raise ValueError(f"Unexpected batch invocation count for run {run_id}!")
        # ----------------------------------------------------------------------

        # create invocation results + finalize scenarios ------------------------
        run_has_errors = 0
        invocation_results = await evaluations_service.create_results(
            project_id=project_id,
            user_id=user_id,
            results=[
                EvaluationResultCreate(
                    run_id=run_id,
                    scenario_id=scenario.id,
                    step_key=invocation_step_key,
                    status=(
                        EvaluationStatus.SUCCESS
                        if not invocations[idx].result.error
                        else EvaluationStatus.FAILURE
                    ),
                    trace_id=invocations[idx].trace_id,
                    error=(
                        invocations[idx].result.error.model_dump(mode="json")
                        if invocations[idx].result.error
                        else None
                    ),
                )
                for idx, scenario in enumerate(scenarios)
            ],
        )
        if len(invocation_results) != nof_testcases:
            raise ValueError(f"Failed to create invocation results for run {run_id}!")

        for idx, scenario in enumerate(scenarios):
            invocation = invocations[idx]
            scenario_status = (
                EvaluationStatus.SUCCESS
                if not invocation.result.error
                else EvaluationStatus.ERRORS
            )
            if invocation.result.error:
                run_has_errors += 1

            edited_scenario = await evaluations_service.edit_scenario(
                project_id=project_id,
                user_id=user_id,
                scenario=EvaluationScenarioEdit(
                    id=scenario.id,
                    tags=scenario.tags,
                    meta=scenario.meta,
                    status=scenario_status,
                ),
            )
            if not edited_scenario:
                raise ValueError(
                    f"Failed to edit evaluation scenario with id {scenario.id}!"
                )

        if run_has_errors:
            run_status = EvaluationStatus.ERRORS
        # ----------------------------------------------------------------------

    except Exception as e:  # pylint: disable=broad-exception-caught
        log.error(
            f"An error occurred during batch invocation: {e}",
            exc_info=True,
        )
        run_status = EvaluationStatus.FAILURE

    if not run:
        log.info("[FAIL]      ", run_id=run_id, project_id=project_id, user_id=user_id)
        return

    await evaluations_service.edit_run(
        project_id=project_id,
        user_id=user_id,
        run=EvaluationRunEdit(
            id=run_id,
            name=run.name,
            description=run.description,
            tags=run.tags,
            meta=run.meta,
            status=run_status,
            flags=run.flags,
            data=run.data,
        ),
    )

    if run_status == EvaluationStatus.FAILURE and is_ee():
        await check_entitlements(
            organization_id=project.organization_id,  # type: ignore[attr-defined]
            key=Counter.EVALUATIONS,
            delta=-1,
        )

    log.info("[DONE]      ", run_id=run_id, project_id=project_id, user_id=user_id)
    return


async def _evaluate_batch_items(
    *,
    project_id: UUID,
    user_id: UUID,
    #
    run_id: UUID,
    #
    testcase_ids: Optional[List[UUID]] = None,
    trace_ids: Optional[List[str]] = None,
    #
    tracing_service: Optional[TracingService] = None,
    testcases_service: Optional[TestcasesService] = None,
    workflows_service: WorkflowsService,
    evaluations_service: EvaluationsService,
):
    request = Request(
        scope={
            "type": "http",
            "http_version": "1.1",
            "scheme": "http",
        }
    )
    request.state.project_id = str(project_id)
    request.state.user_id = str(user_id)

    run: Optional[EvaluationRun] = None
    scenarios = []
    run_status = EvaluationStatus.SUCCESS

    try:
        run = await evaluations_service.fetch_run(
            project_id=project_id,
            run_id=run_id,
        )
        if not run:
            raise ValueError(f"Evaluation run with id {run_id} not found!")
        if not run.flags or not run.flags.is_queue:
            raise ValueError(
                f"Evaluation run with id {run_id} is not configured for ad-hoc batching!"
            )
        if not run.data or not run.data.steps:
            raise ValueError(f"Evaluation run with id {run_id} has no data steps!")

        testcase_ids = testcase_ids or []
        trace_ids = trace_ids or []
        if not testcase_ids and not trace_ids:
            raise ValueError(
                f"Evaluation run with id {run_id} has no testcase_ids or trace_ids!"
            )
        if trace_ids and tracing_service is None:
            raise ValueError("tracing_service is required for trace batches")
        if testcase_ids and testcases_service is None:
            raise ValueError("testcases_service is required for testcase batches")

        steps = run.data.steps
        input_steps = [step for step in steps if step.type == "input"]
        invocation_steps = [step for step in steps if step.type == "invocation"]
        annotation_steps = [step for step in steps if step.type == "annotation"]

        input_step_key = input_steps[0].key if input_steps else None
        invocation_step_key = invocation_steps[0].key if invocation_steps else None
        evaluator_references = {
            step.key: step.references or {} for step in annotation_steps
        }
        evaluator_revisions: Dict[str, Any] = {}
        for annotation_step_key, annotation_refs in evaluator_references.items():
            evaluator_revision_ref = annotation_refs.get("evaluator_revision")
            evaluator_revisions[annotation_step_key] = (
                await workflows_service.fetch_workflow_revision(
                    project_id=project_id,
                    workflow_revision_ref=evaluator_revision_ref,
                )
                if evaluator_revision_ref
                else None
            )

        testcases = (
            await testcases_service.fetch_testcases(
                project_id=project_id,
                testcase_ids=testcase_ids,
            )
            if testcase_ids
            else []
        )
        testcases_by_id = {
            testcase.id: testcase for testcase in testcases if testcase.id
        }

        scenario_items = []
        for testcase_id in testcase_ids:
            testcase = testcases_by_id.get(testcase_id)
            scenario_items.append(
                dict(
                    kind="testcase",
                    testcase=testcase,
                    testcase_id=testcase_id,
                    trace_id=None,
                )
            )
        for trace_id in trace_ids:
            scenario_items.append(
                dict(
                    kind="trace",
                    testcase=None,
                    testcase_id=None,
                    trace_id=trace_id,
                )
            )

        scenarios = await evaluations_service.create_scenarios(
            project_id=project_id,
            user_id=user_id,
            scenarios=[
                EvaluationScenarioCreate(
                    run_id=run_id,
                    status=EvaluationStatus.RUNNING,
                )
                for _ in scenario_items
            ],
        )
        if len(scenarios) != len(scenario_items):
            raise ValueError(f"Failed to create scenarios for run {run_id}")

        run_has_errors = False
        run_has_pending = False

        for idx, scenario in enumerate(scenarios):
            scenario_status = EvaluationStatus.SUCCESS
            scenario_has_pending = False
            scenario_item = scenario_items[idx]

            source_testcase = scenario_item["testcase"]
            source_testcase_id = scenario_item["testcase_id"]
            source_trace_id = scenario_item["trace_id"]

            _trace = None
            inputs = None
            outputs = None
            query_span_id = None

            if source_testcase_id and source_testcase is None:
                run_has_errors = True
                scenario_status = EvaluationStatus.ERRORS
                await evaluations_service.create_results(
                    project_id=project_id,
                    user_id=user_id,
                    results=[
                        EvaluationResultCreate(
                            run_id=run_id,
                            scenario_id=scenario.id,
                            step_key=step.key,
                            status=EvaluationStatus.ERRORS,
                            testcase_id=source_testcase_id,
                            error={
                                "message": f"Testcase {source_testcase_id} not found."
                            },
                        )
                        for step in annotation_steps
                    ],
                )

            if source_testcase_id and source_testcase and input_step_key:
                input_results = await evaluations_service.create_results(
                    project_id=project_id,
                    user_id=user_id,
                    results=[
                        EvaluationResultCreate(
                            run_id=run_id,
                            scenario_id=scenario.id,
                            step_key=input_step_key,
                            status=EvaluationStatus.SUCCESS,
                            testcase_id=source_testcase_id,
                        )
                    ],
                )
                if len(input_results) != 1:
                    raise ValueError(
                        f"Failed to create input result for scenario {scenario.id}"
                    )

            if source_testcase and source_testcase.data:
                inputs = source_testcase.data

            if source_trace_id:
                trace = await fetch_trace(
                    project_id=project_id,
                    trace_id=source_trace_id,
                    tracing_service=tracing_service,
                )
                if not trace or not isinstance(trace.spans, dict):
                    scenario_status = EvaluationStatus.ERRORS
                    run_has_errors = True
                else:
                    root_span = list(trace.spans.values())[0]
                    if isinstance(root_span, list):
                        scenario_status = EvaluationStatus.ERRORS
                        run_has_errors = True
                    else:
                        query_span_id = root_span.span_id
                        _trace = trace.model_dump(mode="json", exclude_none=True)
                        _root_span = root_span.model_dump(
                            mode="json", exclude_none=True
                        )

                        root_span_attributes: dict = _root_span.get("attributes") or {}
                        root_span_ag: dict = root_span_attributes.get("ag") or {}
                        root_span_ag_data: dict = root_span_ag.get("data") or {}
                        outputs = root_span_ag_data.get("outputs")
                        if not inputs:
                            inputs = root_span_ag_data.get("inputs")

            if (
                source_trace_id
                and input_step_key
                and scenario_status == EvaluationStatus.SUCCESS
            ):
                input_results = await evaluations_service.create_results(
                    project_id=project_id,
                    user_id=user_id,
                    results=[
                        EvaluationResultCreate(
                            run_id=run_id,
                            scenario_id=scenario.id,
                            step_key=input_step_key,
                            status=EvaluationStatus.SUCCESS,
                            trace_id=source_trace_id,
                        )
                    ],
                )
                if len(input_results) != 1:
                    raise ValueError(
                        f"Failed to create trace input result for scenario {scenario.id}"
                    )

            if (
                source_trace_id
                and invocation_step_key
                and scenario_status == EvaluationStatus.SUCCESS
            ):
                invocation_results = await evaluations_service.create_results(
                    project_id=project_id,
                    user_id=user_id,
                    results=[
                        EvaluationResultCreate(
                            run_id=run_id,
                            scenario_id=scenario.id,
                            step_key=invocation_step_key,
                            status=EvaluationStatus.SUCCESS,
                            trace_id=source_trace_id,
                        )
                    ],
                )
                if len(invocation_results) != 1:
                    raise ValueError(
                        f"Failed to create invocation result for scenario {scenario.id}"
                    )

            if scenario_status == EvaluationStatus.SUCCESS:
                for annotation_step in annotation_steps:
                    annotation_step_key = annotation_step.key
                    if annotation_step.origin in {"human", "custom"}:
                        scenario_has_pending = True
                        run_has_pending = True
                        # Human/custom steps are not auto-invoked here.
                        # Results are created later by the annotator via the annotation submission flow.
                        continue

                    evaluator_revision = evaluator_revisions.get(annotation_step_key)
                    if not evaluator_revision:
                        run_has_errors = True
                        scenario_status = EvaluationStatus.ERRORS
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
                    flags = (
                        evaluator_revision.flags.model_dump(
                            mode="json",
                            exclude_none=True,
                            exclude_unset=True,
                        )
                        if evaluator_revision.flags
                        else None
                    )

                    links: Dict[str, Any] = {}
                    source_step_key = invocation_step_key or input_step_key
                    if source_step_key and source_trace_id and query_span_id:
                        links[source_step_key] = dict(
                            trace_id=source_trace_id,
                            span_id=query_span_id,
                        )

                    workflow_service_request = WorkflowServiceRequest(
                        version="2025.07.14",
                        flags=flags,
                        interface=interface,
                        configuration=configuration,
                        data=WorkflowServiceRequestData(
                            revision=_revision,
                            parameters=parameters,
                            testcase=(
                                source_testcase.model_dump(
                                    mode="json", exclude_none=True
                                )
                                if source_testcase
                                else None
                            ),
                            inputs=inputs,
                            trace=_trace,
                            outputs=outputs,
                        ),
                        references=evaluator_references.get(annotation_step_key, {}),
                        links=links,
                    )

                    workflows_service_response = (
                        await workflows_service.invoke_workflow(
                            project_id=project_id,
                            user_id=user_id,
                            request=workflow_service_request,
                            annotate=True,
                        )
                    )

                    has_error = workflows_service_response.status.code != 200
                    result_trace_id = workflows_service_response.trace_id
                    result_error = None
                    result_status = EvaluationStatus.SUCCESS
                    if has_error:
                        result_status = EvaluationStatus.FAILURE
                        result_error = workflows_service_response.status.model_dump(
                            mode="json",
                            exclude_none=True,
                        )
                        scenario_status = EvaluationStatus.ERRORS
                        run_has_errors = True

                    step_results = await evaluations_service.create_results(
                        project_id=project_id,
                        user_id=user_id,
                        results=[
                            EvaluationResultCreate(
                                run_id=run_id,
                                scenario_id=scenario.id,
                                step_key=annotation_step_key,
                                status=result_status,
                                testcase_id=source_testcase_id,
                                trace_id=result_trace_id,
                                error=result_error,
                            )
                        ],
                    )
                    if len(step_results) != 1:
                        raise ValueError(
                            f"Failed to create annotation result for scenario {scenario.id}"
                        )

            final_scenario_status = (
                EvaluationStatus.PENDING
                if scenario_status == EvaluationStatus.SUCCESS and scenario_has_pending
                else scenario_status
            )
            await evaluations_service.edit_scenario(
                project_id=project_id,
                user_id=user_id,
                scenario=EvaluationScenarioEdit(
                    id=scenario.id,
                    tags=scenario.tags,
                    meta=scenario.meta,
                    status=final_scenario_status,
                ),
            )

            try:
                await evaluations_service.refresh_metrics(
                    project_id=project_id,
                    user_id=user_id,
                    metrics=EvaluationMetricsRefresh(
                        run_id=run_id,
                        scenario_id=scenario.id,
                    ),
                )
            except Exception:  # pylint: disable=broad-exception-caught
                log.warning(
                    f"Refreshing metrics failed for {run_id} | {scenario.id}",
                    exc_info=True,
                )

        if run_has_errors:
            run_status = EvaluationStatus.ERRORS
        elif run_has_pending:
            run_status = EvaluationStatus.RUNNING
        else:
            run_status = EvaluationStatus.SUCCESS

    except Exception as e:  # pylint: disable=broad-exception-caught
        log.error(
            f"An error occurred during batch items evaluation: {e}",
            exc_info=True,
        )
        run_status = EvaluationStatus.FAILURE

    if not run:
        return

    # For ad-hoc/queue runs (multiple independent batches writing to the same run),
    # re-fetch the current stored status and never downgrade it to a less severe state.
    # This prevents a later successful batch from overwriting ERRORS from an earlier one.
    if run.flags and run.flags.is_queue and run_status != EvaluationStatus.FAILURE:
        _severity = {
            EvaluationStatus.FAILURE: 4,
            EvaluationStatus.ERRORS: 3,
            EvaluationStatus.RUNNING: 2,
            EvaluationStatus.SUCCESS: 1,
            EvaluationStatus.PENDING: 0,
        }
        current_run = await evaluations_service.fetch_run(
            project_id=project_id,
            run_id=run_id,
        )
        if current_run and current_run.status:
            stored_severity = _severity.get(current_run.status, 0)
            if stored_severity > _severity.get(run_status, 0):
                run_status = current_run.status

    try:
        if run_status != EvaluationStatus.FAILURE:
            await evaluations_service.refresh_metrics(
                project_id=project_id,
                user_id=user_id,
                metrics=EvaluationMetricsRefresh(run_id=run_id),
            )
    except Exception:  # pylint: disable=broad-exception-caught
        log.warning(f"Refreshing metrics failed for {run_id}", exc_info=True)
        run_status = EvaluationStatus.FAILURE

    await evaluations_service.edit_run(
        project_id=project_id,
        user_id=user_id,
        run=EvaluationRunEdit(
            id=run_id,
            name=run.name,
            description=run.description,
            tags=run.tags,
            meta=run.meta,
            status=run_status,
            flags=run.flags,
            data=run.data,
        ),
    )

    log.info("[DONE]      ", run_id=run_id, project_id=project_id, user_id=user_id)

    return


async def evaluate_batch_traces(
    *,
    project_id: UUID,
    user_id: UUID,
    #
    run_id: UUID,
    trace_ids: List[str],
    #
    tracing_service: TracingService,
    workflows_service: WorkflowsService,
    evaluations_service: EvaluationsService,
):
    return await _evaluate_batch_items(
        project_id=project_id,
        user_id=user_id,
        run_id=run_id,
        #
        trace_ids=trace_ids,
        tracing_service=tracing_service,
        workflows_service=workflows_service,
        evaluations_service=evaluations_service,
    )


async def evaluate_batch_testcases(
    *,
    project_id: UUID,
    user_id: UUID,
    #
    run_id: UUID,
    testcase_ids: List[UUID],
    #
    testcases_service: TestcasesService,
    workflows_service: WorkflowsService,
    evaluations_service: EvaluationsService,
):
    return await _evaluate_batch_items(
        project_id=project_id,
        user_id=user_id,
        run_id=run_id,
        #
        testcase_ids=testcase_ids,
        testcases_service=testcases_service,
        workflows_service=workflows_service,
        evaluations_service=evaluations_service,
    )
