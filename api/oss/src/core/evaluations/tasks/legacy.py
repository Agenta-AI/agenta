from typing import Dict, List, Optional, Any

from uuid import UUID
from json import dumps

from fastapi import Request

from oss.src.utils.logging import get_module_logger
from oss.src.utils.common import is_ee
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
    build_repeat_indices,
    effective_is_split,
    fetch_traces_by_hash,
    fetch_trace,
    make_hash,
    plan_missing_traces,
    required_traces_for_step,
    select_traces_for_reuse,
)


log = get_module_logger(__name__)


def _resolve_runtime_uri(
    *,
    revision_data: Optional[Any],
) -> Optional[str]:
    if revision_data is None:
        return None

    return WorkflowsService._get_service_url(revision_data=revision_data)


def _extract_root_span(trace: Optional[Any]) -> Optional[Any]:
    if not trace:
        # log.debug("[TRACE]       [ROOT]", reason="missing-trace")
        return None

    spans = getattr(trace, "spans", None)

    if not isinstance(spans, dict):
        # log.debug(
        #     "[TRACE]       [ROOT]",
        #     trace_id=str(getattr(trace, "trace_id", None))
        #     if getattr(trace, "trace_id", None)
        #     else None,
        #     reason="spans-not-dict",
        #     spans_type=type(spans).__name__ if spans is not None else None,
        # )
        return None

    if not spans:
        # log.debug(
        #     "[TRACE]       [ROOT]",
        #     trace_id=str(getattr(trace, "trace_id", None))
        #     if getattr(trace, "trace_id", None)
        #     else None,
        #     reason="spans-empty",
        # )
        return None

    root_span = list(spans.values())[0]
    if isinstance(root_span, list):
        # log.debug(
        #     "[TRACE]       [ROOT]",
        #     trace_id=str(getattr(trace, "trace_id", None))
        #     if getattr(trace, "trace_id", None)
        #     else None,
        #     reason="first-span-is-list",
        #     span_keys=list(spans.keys()),
        #     first_list_len=len(root_span),
        # )
        return None

    # log.debug(
    #     "[TRACE]       [ROOT]",
    #     trace_id=str(getattr(trace, "trace_id", None))
    #     if getattr(trace, "trace_id", None)
    #     else None,
    #     reason="resolved",
    #     span_keys=list(spans.keys()),
    #     root_span_id=str(getattr(root_span, "span_id", None))
    #     if getattr(root_span, "span_id", None)
    #     else None,
    # )
    return root_span


def _build_trace_context(
    *,
    trace: Optional[Any],
    error: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    root_span = _extract_root_span(trace)
    trace_id = getattr(trace, "trace_id", None) if trace else None

    if not root_span or not trace_id:
        # log.debug(
        #     "[TRACE]       [CONTEXT]",
        #     trace_id=str(trace_id) if trace_id else None,
        #     has_root_span=bool(root_span),
        #     has_error=bool(error),
        #     error=error,
        # )
        return None

    # log.debug(
    #     "[TRACE]       [CONTEXT]",
    #     trace_id=str(trace_id),
    #     span_id=str(getattr(root_span, "span_id", None))
    #     if getattr(root_span, "span_id", None)
    #     else None,
    #     has_error=bool(error),
    # )
    return {
        "trace": trace,
        "trace_id": str(trace_id),
        "span_id": getattr(root_span, "span_id", None),
        "root_span": root_span,
        "error": error,
    }


async def _resolve_testset_input_specs(
    *,
    project_id: UUID,
    input_steps: List[Any],
    testsets_service: TestsetsService,
) -> List[Dict[str, Any]]:
    input_specs: List[Dict[str, Any]] = []

    for input_step in input_steps:
        input_refs = input_step.references or {}
        testset_revision_ref = input_refs.get("testset_revision")

        if not testset_revision_ref or not isinstance(testset_revision_ref.id, UUID):
            raise ValueError(
                f"Evaluation input step {input_step.key} missing testset_revision reference."
            )

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

        testset_variant = await testsets_service.fetch_testset_variant(
            project_id=project_id,
            testset_variant_ref=Reference(id=testset_revision.variant_id),
        )
        if not testset_variant:
            raise ValueError(
                f"Testset variant with id {testset_revision.variant_id} not found!"
            )

        testset = await testsets_service.fetch_testset(
            project_id=project_id,
            testset_ref=Reference(id=testset_variant.testset_id),
        )
        if not testset:
            raise ValueError(f"Testset with id {testset_variant.testset_id} not found!")

        testcases = testset_revision.data.testcases
        input_specs.append(
            {
                "step_key": input_step.key,
                "testset": testset,
                "testset_revision": testset_revision,
                "testcases": testcases,
                "testcases_data": [
                    {**testcase.data, "id": str(testcase.id)} for testcase in testcases
                ],
            }
        )

    return input_specs


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

    project = None
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
        repeats = run.data.repeats or 1
        repeat_indices = build_repeat_indices(repeats)
        is_cached = bool(run.flags.is_cached) if run.flags else False

        input_steps = [step for step in steps if step.type == "input"]
        invocation_steps = [step for step in steps if step.type == "invocation"]
        annotation_steps = [step for step in steps if step.type == "annotation"]

        log.info(
            "[STEPS]       ",
            run_id=run_id,
            count=len(steps),
            input_keys=[step.key for step in input_steps],
            invocation_keys=[step.key for step in invocation_steps],
            annotation_keys=[step.key for step in annotation_steps],
            step_types=[getattr(step, "type", None) for step in steps],
        )

        if not input_steps or len(invocation_steps) != 1:
            raise ValueError(
                f"Evaluation run with id {run_id} must have at least one input and exactly one invocation step."
            )

        invocation_step = invocation_steps[0]
        invocation_step_key = invocation_step.key
        is_split = effective_is_split(
            is_split=bool(run.flags.is_split) if run.flags else False,
            has_application_steps=True,
            has_evaluator_steps=bool(annotation_steps),
        )
        application_required_count = required_traces_for_step(
            repeats=repeats,
            is_split=is_split,
            step_kind="application",
            has_evaluator_steps=bool(annotation_steps),
        )
        evaluator_required_count = required_traces_for_step(
            repeats=repeats,
            is_split=is_split,
            step_kind="evaluator",
            has_evaluator_steps=bool(annotation_steps),
        )

        application_revision_ref = invocation_step.references.get(
            "application_revision"
        )
        if not application_revision_ref or not isinstance(
            application_revision_ref.id, UUID
        ):
            raise ValueError(
                f"Evaluation run with id {run_id} missing invocation.application_revision reference."
            )

        run_config = {
            "batch_size": 10,
            "max_retries": 3,
            "retry_delay": 3,
            "delay_between_batches": 5,
        }

        input_specs = await _resolve_testset_input_specs(
            project_id=project_id,
            input_steps=input_steps,
            testsets_service=testsets_service,
        )
        testset_revision_ids = [
            str(input_spec["testset_revision"].id) for input_spec in input_specs
        ]

        log.info("[TESTSET]     ", run_id=run_id, ids=testset_revision_ids)
        log.info(
            "[APPLICATION] ",
            run_id=run_id,
            ids=[str(application_revision_ref.id)],
        )
        # ----------------------------------------------------------------------

        # flatten scenario sources ---------------------------------------------
        scenario_specs = [
            {
                "input_step_key": input_spec["step_key"],
                "testset": input_spec["testset"],
                "testset_revision": input_spec["testset_revision"],
                "testcase": testcase,
                "testcase_data": testcase_data,
            }
            for input_spec in input_specs
            for testcase, testcase_data in zip(
                input_spec["testcases"],
                input_spec["testcases_data"],
            )
        ]
        nof_scenarios = len(scenario_specs)
        # ----------------------------------------------------------------------

        # fetch application ----------------------------------------------------
        application_revision = await applications_service.fetch_application_revision(
            project_id=project_id,
            application_revision_ref=application_revision_ref,
        )

        if application_revision is None:
            raise ValueError(
                f"App revision with id {application_revision_ref.id} not found!"
            )

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

        uri = _resolve_runtime_uri(revision_data=application_revision.data)

        if not uri:
            raise ValueError(
                f"No deployment URI found for revision {application_revision_ref.id}!"
            )

        # fetch evaluators -----------------------------------------------------
        evaluator_references = {step.key: step.references for step in annotation_steps}
        # log.debug(
        #     "[EVALUATORS]  ",
        #     run_id=run_id,
        #     count=len(annotation_steps),
        #     refs={
        #         step_key: (
        #             {
        #                 key: str(reference.id)
        #                 if getattr(reference, "id", None)
        #                 else None
        #                 for key, reference in (references or {}).items()
        #             }
        #         )
        #         for step_key, references in evaluator_references.items()
        #     },
        # )

        evaluators = {}
        for evaluator_key, evaluator_refs in evaluator_references.items():
            evaluators[evaluator_key] = await workflows_service.fetch_workflow_revision(
                project_id=project_id,
                #
                workflow_revision_ref=evaluator_refs.get("evaluator_revision"),
            )
        # log.debug(
        #     "[EVALUATORS]  [FETCH]",
        #     run_id=run_id,
        #     resolved={
        #         evaluator_key: (
        #             str(evaluator_revision.id)
        #             if evaluator_revision and evaluator_revision.id
        #             else None
        #         )
        #         for evaluator_key, evaluator_revision in evaluators.items()
        #     },
        # )
        # ----------------------------------------------------------------------

        # create scenarios -----------------------------------------------------
        scenarios_create = [
            EvaluationScenarioCreate(
                run_id=run_id,
                #
                status=EvaluationStatus.RUNNING,
            )
            for _ in range(nof_scenarios)
        ]

        scenarios = await evaluations_service.create_scenarios(
            project_id=project_id,
            user_id=user_id,
            #
            scenarios=scenarios_create,
        )

        if len(scenarios) != nof_scenarios:
            raise ValueError(f"Failed to create evaluation scenarios for run {run_id}!")
        # ----------------------------------------------------------------------

        # create input steps ---------------------------------------------------
        results_create = [
            EvaluationResultCreate(
                run_id=run_id,
                scenario_id=scenario.id,
                step_key=scenario_specs[idx]["input_step_key"],
                repeat_idx=repeat_idx,
                #
                status=EvaluationStatus.SUCCESS,
                #
                testcase_id=scenario_specs[idx]["testcase"].id,
            )
            for idx, scenario in enumerate(scenarios)
            for repeat_idx in repeat_indices
        ]

        steps = await evaluations_service.create_results(
            project_id=project_id,
            user_id=user_id,
            #
            results=results_create,
        )

        if len(steps) != nof_scenarios * len(repeat_indices):
            raise ValueError(f"Failed to create evaluation steps for run {run_id}!")
        # ----------------------------------------------------------------------

        # flatten testcases ----------------------------------------------------
        _testcases = [
            scenario_spec["testcase"].model_dump(mode="json")
            for scenario_spec in scenario_specs
        ]

        log.info(
            "[BATCH]     ",
            run_id=run_id,
            ids=testset_revision_ids,
            count=len(_testcases),
            size=len(dumps(_testcases).encode("utf-8")),
        )
        # ----------------------------------------------------------------------

        run_has_errors = 0
        run_has_pending = False
        run_status = EvaluationStatus.SUCCESS

        # run invocations / evaluators -----------------------------------------
        for idx in range(nof_scenarios):
            scenario = scenarios[idx]
            scenario_spec = scenario_specs[idx]
            testcase = scenario_spec["testcase"]
            testcase_data = scenario_spec["testcase_data"]
            testset = scenario_spec["testset"]
            testset_revision = scenario_spec["testset_revision"]

            scenario_has_errors = 0
            scenario_has_pending = False
            scenario_status = EvaluationStatus.SUCCESS
            application_references = {
                "testcase": {"id": str(testcase.id)},
                "testset": {"id": str(testset.id)},
                "testset_variant": {"id": str(testset_revision.variant_id)},
                "testset_revision": {"id": str(testset_revision.id)},
                "application": {"id": str(application.id)},
                "application_variant": {"id": str(application_variant.id)},
                "application_revision": {"id": str(application_revision.id)},
            }

            application_hash_id = make_hash(
                references=application_references,
                links=None,
            )
            cached_application_traces = []
            if is_cached and application_hash_id:
                cached_application_traces = await fetch_traces_by_hash(
                    tracing_service,
                    project_id,
                    hash_id=application_hash_id,
                    limit=application_required_count,
                )

            cached_application_contexts = []
            for reusable_trace in select_traces_for_reuse(
                traces=cached_application_traces,
                required_count=application_required_count,
            ):
                reusable_context = _build_trace_context(trace=reusable_trace)
                if reusable_context:
                    cached_application_contexts.append(reusable_context)

            missing_application_count = plan_missing_traces(
                required_count=application_required_count,
                reusable_count=len(cached_application_contexts),
            )

            invoked_application_contexts = []
            if missing_application_count > 0:
                invocations: List[
                    InvokationResult
                ] = await llm_apps_service.batch_invoke(
                    project_id=str(project_id),
                    user_id=str(user_id),
                    testset_data=[
                        testcase_data for _ in range(missing_application_count)
                    ],  # type: ignore[arg-type]
                    revision=application_revision,
                    uri=uri,
                    rate_limit_config=run_config,
                    application_id=str(application.id),
                    references=application_references,
                    scenarios=[
                        scenario.model_dump(
                            mode="json",
                            exclude_none=True,
                        )
                        for _ in range(missing_application_count)
                    ],
                )

                if len(invocations) != missing_application_count:
                    raise ValueError(
                        f"Unexpected batch invocation count for scenario {scenario.id}!"
                    )

                for invocation in invocations:
                    invocation_error = (
                        invocation.result.error.model_dump(mode="json")
                        if invocation.result and invocation.result.error
                        else None
                    )
                    invoked_trace = None
                    if not invocation_error and invocation.trace_id:
                        invoked_trace = await fetch_trace(
                            tracing_service=tracing_service,
                            project_id=project_id,
                            trace_id=invocation.trace_id,
                        )

                    invocation_context = (
                        _build_trace_context(
                            trace=invoked_trace,
                            error=invocation_error,
                        )
                        if invoked_trace
                        else None
                    )
                    if invocation_context:
                        invoked_application_contexts.append(invocation_context)
                    else:
                        invoked_application_contexts.append(
                            {
                                "trace": invoked_trace,
                                "trace_id": invocation.trace_id,
                                "span_id": invocation.span_id,
                                "root_span": None,
                                "error": invocation_error
                                or {
                                    "message": "Invocation trace missing or malformed."
                                },
                            }
                        )

            application_contexts = (
                cached_application_contexts + invoked_application_contexts
            )
            application_context_by_repeat: Dict[int, Dict[str, Any]] = {}
            if is_split:
                for repeat_idx, context in zip(repeat_indices, application_contexts):
                    application_context_by_repeat[repeat_idx] = context
            else:
                shared_context = (
                    application_contexts[0] if application_contexts else None
                )
                if shared_context:
                    for repeat_idx in repeat_indices:
                        application_context_by_repeat[repeat_idx] = shared_context

            invocation_results_create = []
            scenario_invocation_failed = False
            for repeat_idx in repeat_indices:
                application_context = application_context_by_repeat.get(repeat_idx)
                application_error = (
                    application_context.get("error")
                    if application_context
                    else {"message": "Invocation trace missing."}
                )
                has_invocation_error = not (
                    application_context
                    and application_context.get("trace_id")
                    and application_context.get("root_span")
                    and not application_error
                )
                if has_invocation_error:
                    scenario_invocation_failed = True

                invocation_results_create.append(
                    EvaluationResultCreate(
                        run_id=run_id,
                        scenario_id=scenario.id,
                        step_key=invocation_step_key,
                        repeat_idx=repeat_idx,
                        status=(
                            EvaluationStatus.FAILURE
                            if has_invocation_error
                            else EvaluationStatus.SUCCESS
                        ),
                        trace_id=(
                            application_context.get("trace_id")
                            if application_context
                            else None
                        ),
                        error=application_error if has_invocation_error else None,
                    )
                )

            created_invocation_results = await evaluations_service.create_results(
                project_id=project_id,
                user_id=user_id,
                results=invocation_results_create,
            )
            if len(created_invocation_results) != len(repeat_indices):
                raise ValueError(
                    f"Failed to create invocation results for scenario {scenario.id}!"
                )

            if scenario_invocation_failed:
                scenario_has_errors += 1

            for annotation_step in annotation_steps:
                annotation_step_key = annotation_step.key

                if annotation_step.origin in {"human", "custom"}:
                    # log.debug(
                    #     "[EVALUATOR]   [SKIP]",
                    #     run_id=run_id,
                    #     scenario_id=scenario.id,
                    #     step_key=annotation_step_key,
                    #     origin=annotation_step.origin,
                    #     reason="non-auto-origin",
                    # )
                    scenario_has_pending = True
                    run_has_pending = True
                    continue

                evaluator_revision = evaluators.get(annotation_step_key)
                if not evaluator_revision:
                    # log.warning(
                    #     "[EVALUATOR]   [MISSING]",
                    #     run_id=run_id,
                    #     scenario_id=scenario.id,
                    #     step_key=annotation_step_key,
                    #     references={
                    #         key: str(reference.id)
                    #         if getattr(reference, "id", None)
                    #         else None
                    #         for key, reference in (
                    #             evaluator_references.get(annotation_step_key, {}) or {}
                    #         ).items()
                    #     },
                    # )
                    log.error(
                        f"Evaluator revision for {annotation_step_key} not found!"
                    )
                    scenario_has_errors += 1
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

                base_references: Dict[str, Any] = {
                    **evaluator_references[annotation_step_key],
                    "testcase": {"id": str(testcase.id)},
                    "testset": {"id": str(testset.id)},
                    "testset_variant": {"id": str(testset_revision.variant_id)},
                    "testset_revision": {"id": str(testset_revision.id)},
                }

                evaluator_results_create = []
                if not is_split:
                    shared_application_context = application_context_by_repeat.get(
                        repeat_indices[0]
                    )
                    # log.debug(
                    #     "[EVALUATOR]   [PLAN]",
                    #     run_id=run_id,
                    #     scenario_id=scenario.id,
                    #     step_key=annotation_step_key,
                    #     repeats=repeat_indices,
                    #     is_split=is_split,
                    #     has_shared_application_context=bool(shared_application_context),
                    #     has_shared_root_span=bool(
                    #         shared_application_context
                    #         and shared_application_context.get("root_span")
                    #     ),
                    # )
                    if (
                        not shared_application_context
                        or not shared_application_context.get("root_span")
                    ):
                        scenario_has_errors += 1
                        scenario_status = EvaluationStatus.ERRORS
                        evaluator_results_create = [
                            EvaluationResultCreate(
                                run_id=run_id,
                                scenario_id=scenario.id,
                                step_key=annotation_step_key,
                                repeat_idx=repeat_idx,
                                status=EvaluationStatus.FAILURE,
                                error={
                                    "message": "Evaluator skipped because invocation trace is missing."
                                },
                            )
                            for repeat_idx in repeat_indices
                        ]
                    else:
                        shared_trace = shared_application_context["trace"]
                        shared_root_span = shared_application_context["root_span"]
                        shared_links = {
                            invocation_step_key: {
                                "trace_id": shared_application_context["trace_id"],
                                "span_id": shared_application_context["span_id"],
                            }
                        }
                        workflow_service_request_data = WorkflowServiceRequestData(
                            revision=_revision,
                            parameters=parameters,
                            testcase=testcase.model_dump(mode="json"),
                            inputs=testcase.data,
                            trace=shared_trace.model_dump(
                                mode="json",
                                exclude_none=True,
                            )
                            if shared_trace
                            else None,
                            outputs=(
                                (
                                    shared_root_span.model_dump(
                                        mode="json",
                                        exclude_none=True,
                                    )
                                    .get("attributes", {})
                                    .get("ag", {})
                                    .get("data", {})
                                ).get("outputs")
                                if shared_root_span
                                else None
                            ),
                        )
                        workflow_service_request = WorkflowServiceRequest(
                            version="2025.07.14",
                            flags=flags,
                            interface=interface,
                            configuration=configuration,
                            data=workflow_service_request_data,
                            references=base_references,
                            links=shared_links,
                        )
                        evaluator_hash_id = make_hash(
                            references=base_references,
                            links=shared_links,
                        )
                        cached_evaluator_traces = []
                        if is_cached and evaluator_hash_id:
                            cached_evaluator_traces = await fetch_traces_by_hash(
                                tracing_service,
                                project_id,
                                hash_id=evaluator_hash_id,
                                limit=evaluator_required_count,
                            )

                        reusable_evaluator_traces = select_traces_for_reuse(
                            traces=cached_evaluator_traces,
                            required_count=evaluator_required_count,
                        )
                        evaluator_results_create.extend(
                            EvaluationResultCreate(
                                run_id=run_id,
                                scenario_id=scenario.id,
                                step_key=annotation_step_key,
                                repeat_idx=repeat_idx,
                                status=EvaluationStatus.SUCCESS,
                                trace_id=str(reusable_trace.trace_id),
                            )
                            for repeat_idx, reusable_trace in zip(
                                repeat_indices,
                                reusable_evaluator_traces,
                            )
                            if reusable_trace and reusable_trace.trace_id
                        )

                        for repeat_idx in repeat_indices[
                            len(reusable_evaluator_traces) :
                        ]:
                            # log.debug(
                            #     "[EVALUATOR]   [INVOKE]",
                            #     run_id=run_id,
                            #     scenario_id=scenario.id,
                            #     step_key=annotation_step_key,
                            #     repeat_idx=repeat_idx,
                            #     cached_reuse_count=len(reusable_evaluator_traces),
                            #     trace_links=shared_links,
                            # )
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
                                result_error = (
                                    workflows_service_response.status.model_dump(
                                        mode="json",
                                        exclude_none=True,
                                    )
                                )
                                scenario_has_errors += 1
                                scenario_status = EvaluationStatus.ERRORS
                            elif result_trace_id:
                                fetched_evaluator_trace = await fetch_trace(
                                    tracing_service=tracing_service,
                                    project_id=project_id,
                                    trace_id=result_trace_id,
                                )
                                if not fetched_evaluator_trace:
                                    result_status = EvaluationStatus.FAILURE
                                    result_error = {
                                        "message": "Evaluator trace missing after invocation."
                                    }
                                    scenario_has_errors += 1
                                    scenario_status = EvaluationStatus.ERRORS
                            else:
                                result_status = EvaluationStatus.FAILURE
                                result_error = {
                                    "message": "Evaluator trace_id is missing."
                                }
                                scenario_has_errors += 1
                                scenario_status = EvaluationStatus.ERRORS

                            evaluator_results_create.append(
                                EvaluationResultCreate(
                                    run_id=run_id,
                                    scenario_id=scenario.id,
                                    step_key=annotation_step_key,
                                    repeat_idx=repeat_idx,
                                    status=result_status,
                                    trace_id=result_trace_id,
                                    error=result_error,
                                )
                            )
                else:
                    for repeat_idx in repeat_indices:
                        application_context = application_context_by_repeat.get(
                            repeat_idx
                        )
                        # log.debug(
                        #     "[EVALUATOR]   [PLAN]",
                        #     run_id=run_id,
                        #     scenario_id=scenario.id,
                        #     step_key=annotation_step_key,
                        #     repeat_idx=repeat_idx,
                        #     is_split=is_split,
                        #     has_application_context=bool(application_context),
                        #     has_root_span=bool(
                        #         application_context
                        #         and application_context.get("root_span")
                        #     ),
                        # )
                        if not application_context or not application_context.get(
                            "root_span"
                        ):
                            scenario_has_errors += 1
                            scenario_status = EvaluationStatus.ERRORS
                            evaluator_results_create.append(
                                EvaluationResultCreate(
                                    run_id=run_id,
                                    scenario_id=scenario.id,
                                    step_key=annotation_step_key,
                                    repeat_idx=repeat_idx,
                                    status=EvaluationStatus.FAILURE,
                                    error={
                                        "message": "Evaluator skipped because invocation trace is missing."
                                    },
                                )
                            )
                            continue

                        application_trace = application_context["trace"]
                        application_root_span = application_context["root_span"]
                        application_root_span_data = (
                            application_root_span.model_dump(
                                mode="json",
                                exclude_none=True,
                            )
                            .get("attributes", {})
                            .get("ag", {})
                            .get("data", {})
                        )
                        links = {
                            invocation_step_key: {
                                "trace_id": application_context["trace_id"],
                                "span_id": application_context["span_id"],
                            }
                        }
                        workflow_service_request = WorkflowServiceRequest(
                            version="2025.07.14",
                            flags=flags,
                            interface=interface,
                            configuration=configuration,
                            data=WorkflowServiceRequestData(
                                revision=_revision,
                                parameters=parameters,
                                testcase=testcase.model_dump(mode="json"),
                                inputs=testcase.data,
                                trace=application_trace.model_dump(
                                    mode="json",
                                    exclude_none=True,
                                )
                                if application_trace
                                else None,
                                outputs=application_root_span_data.get("outputs"),
                            ),
                            references=base_references,
                            links=links,
                        )
                        evaluator_hash_id = make_hash(
                            references=base_references,
                            links=links,
                        )
                        cached_evaluator_trace = None
                        if is_cached and evaluator_hash_id:
                            cached_matches = await fetch_traces_by_hash(
                                tracing_service,
                                project_id,
                                hash_id=evaluator_hash_id,
                                limit=1,
                            )
                            reusable_match = select_traces_for_reuse(
                                traces=cached_matches,
                                required_count=1,
                            )
                            if reusable_match:
                                cached_evaluator_trace = reusable_match[0]

                        if cached_evaluator_trace and cached_evaluator_trace.trace_id:
                            evaluator_results_create.append(
                                EvaluationResultCreate(
                                    run_id=run_id,
                                    scenario_id=scenario.id,
                                    step_key=annotation_step_key,
                                    repeat_idx=repeat_idx,
                                    status=EvaluationStatus.SUCCESS,
                                    trace_id=str(cached_evaluator_trace.trace_id),
                                )
                            )
                            continue

                        # log.debug(
                        #     "[EVALUATOR]   [INVOKE]",
                        #     run_id=run_id,
                        #     scenario_id=scenario.id,
                        #     step_key=annotation_step_key,
                        #     repeat_idx=repeat_idx,
                        #     trace_links=links,
                        # )
                        workflows_service_response = (
                            await workflows_service.invoke_workflow(
                                project_id=project_id,
                                user_id=user_id,
                                request=workflow_service_request,
                                annotate=True,
                            )
                        )

                        result_trace_id = workflows_service_response.trace_id
                        result_error = None
                        result_status = EvaluationStatus.SUCCESS
                        has_error = workflows_service_response.status.code != 200
                        if has_error:
                            result_status = EvaluationStatus.FAILURE
                            result_error = workflows_service_response.status.model_dump(
                                mode="json",
                                exclude_none=True,
                            )
                            scenario_has_errors += 1
                            scenario_status = EvaluationStatus.ERRORS
                        elif result_trace_id:
                            fetched_evaluator_trace = await fetch_trace(
                                tracing_service=tracing_service,
                                project_id=project_id,
                                trace_id=result_trace_id,
                            )
                            if not fetched_evaluator_trace:
                                result_status = EvaluationStatus.FAILURE
                                result_error = {
                                    "message": "Evaluator trace missing after invocation."
                                }
                                scenario_has_errors += 1
                                scenario_status = EvaluationStatus.ERRORS
                        else:
                            result_status = EvaluationStatus.FAILURE
                            result_error = {"message": "Evaluator trace_id is missing."}
                            scenario_has_errors += 1
                            scenario_status = EvaluationStatus.ERRORS

                        evaluator_results_create.append(
                            EvaluationResultCreate(
                                run_id=run_id,
                                scenario_id=scenario.id,
                                step_key=annotation_step_key,
                                repeat_idx=repeat_idx,
                                status=result_status,
                                trace_id=result_trace_id,
                                error=result_error,
                            )
                        )

                created_annotation_results = await evaluations_service.create_results(
                    project_id=project_id,
                    user_id=user_id,
                    results=evaluator_results_create,
                )
                # log.debug(
                #     "[EVALUATOR]   [RESULTS]",
                #     run_id=run_id,
                #     scenario_id=scenario.id,
                #     step_key=annotation_step_key,
                #     created=len(created_annotation_results),
                #     expected=len(repeat_indices),
                # )

                if len(created_annotation_results) != len(repeat_indices):
                    raise ValueError(
                        f"Failed to create evaluation results for scenario with id {scenario.id}!"
                    )

            final_scenario_status = (
                EvaluationStatus.PENDING
                if scenario_status == EvaluationStatus.SUCCESS and scenario_has_pending
                else scenario_status
            )

            if final_scenario_status == EvaluationStatus.ERRORS:
                run_has_errors += 1

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
    if run_status == EvaluationStatus.FAILURE and project is not None:
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
    tracing_service: TracingService,
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

        # fetch run ------------------------------------------------------------
        run = await evaluations_service.fetch_run(
            project_id=project_id,
            run_id=run_id,
        )

        if not run:
            raise ValueError(f"Evaluation run with id {run_id} not found!")
        if not run.data or not run.data.steps:
            raise ValueError(f"Evaluation run with id {run_id} has no steps!")
        repeats = run.data.repeats or 1
        repeat_indices = build_repeat_indices(repeats)
        is_cached = bool(run.flags.is_cached) if run.flags else False
        application_required_count = required_traces_for_step(
            repeats=repeats,
            is_split=False,
            step_kind="application",
            has_evaluator_steps=False,
        )

        steps = run.data.steps
        input_steps = [step for step in steps if step.type == "input"]
        invocation_steps = [step for step in steps if step.type == "invocation"]
        annotation_steps = [step for step in steps if step.type == "annotation"]

        if annotation_steps:
            raise ValueError(
                f"Evaluation run with id {run_id} contains annotation steps; "
                "use evaluate_batch_testset instead."
            )
        if not input_steps or len(invocation_steps) != 1:
            raise ValueError(
                f"Evaluation run with id {run_id} must have at least one input and exactly one invocation step."
            )

        invocation_step_key = invocation_steps[0].key
        invocation_refs = invocation_steps[0].references or {}

        application_revision_ref = invocation_refs.get("application_revision")
        if not application_revision_ref or not isinstance(
            application_revision_ref.id, UUID
        ):
            raise ValueError(
                f"Evaluation run with id {run_id} missing invocation.application_revision reference."
            )
        # ----------------------------------------------------------------------

        input_specs = await _resolve_testset_input_specs(
            project_id=project_id,
            input_steps=input_steps,
            testsets_service=testsets_service,
        )
        scenario_specs = [
            {
                "input_step_key": input_spec["step_key"],
                "testset": input_spec["testset"],
                "testset_revision": input_spec["testset_revision"],
                "testcase": testcase,
                "testcase_data": testcase_data,
            }
            for input_spec in input_specs
            for testcase, testcase_data in zip(
                input_spec["testcases"],
                input_spec["testcases_data"],
            )
        ]
        nof_scenarios = len(scenario_specs)
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

        uri = _resolve_runtime_uri(revision_data=application_revision.data)
        if not uri:
            raise ValueError(
                f"No deployment URI found for revision {application_revision_ref.id}!"
            )

        # create scenarios -----------------------------------------------------
        scenarios = await evaluations_service.create_scenarios(
            project_id=project_id,
            user_id=user_id,
            scenarios=[
                EvaluationScenarioCreate(
                    run_id=run_id,
                    status=EvaluationStatus.RUNNING,
                )
                for _ in range(nof_scenarios)
            ],
        )
        if len(scenarios) != nof_scenarios:
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
                    step_key=scenario_specs[idx]["input_step_key"],
                    repeat_idx=repeat_idx,
                    status=EvaluationStatus.SUCCESS,
                    testcase_id=scenario_specs[idx]["testcase"].id,
                )
                for idx, scenario in enumerate(scenarios)
                for repeat_idx in repeat_indices
            ],
        )
        if len(input_results) != nof_scenarios * len(repeat_indices):
            raise ValueError(f"Failed to create input results for run {run_id}!")
        # ----------------------------------------------------------------------

        # resolve cache / invoke application -----------------------------------
        run_config = {
            "batch_size": 10,
            "max_retries": 3,
            "retry_delay": 3,
            "delay_between_batches": 5,
        }
        scenario_invocations: Dict[tuple[int, int], Dict[str, Any]] = {}
        for idx, scenario in enumerate(scenarios):
            scenario_spec = scenario_specs[idx]
            testcase = scenario_spec["testcase"]
            testcase_data = scenario_spec["testcase_data"]
            testset = scenario_spec["testset"]
            testset_revision = scenario_spec["testset_revision"]
            references = {
                "testcase": {"id": str(testcase.id)},
                "testset": {"id": str(testset.id)},
                "testset_variant": {"id": str(testset_revision.variant_id)},
                "testset_revision": {"id": str(testset_revision.id)},
                "application": {"id": str(application.id)},
                "application_variant": {"id": str(application_variant.id)},
                "application_revision": {"id": str(application_revision.id)},
            }
            hash_id = make_hash(references=references, links=None)
            cached_traces = []
            if is_cached and hash_id:
                cached_traces = await fetch_traces_by_hash(
                    tracing_service,
                    project_id,
                    hash_id=hash_id,
                    limit=application_required_count,
                )
            reusable_traces = select_traces_for_reuse(
                traces=cached_traces,
                required_count=application_required_count,
            )
            for repeat_idx, reusable_trace in zip(repeat_indices, reusable_traces):
                scenario_invocations[(idx, repeat_idx)] = {
                    "status": EvaluationStatus.SUCCESS,
                    "trace_id": (
                        str(reusable_trace.trace_id)
                        if reusable_trace and reusable_trace.trace_id
                        else None
                    ),
                    "error": None,
                }

            missing_repeat_indices = repeat_indices[len(reusable_traces) :]
            if missing_repeat_indices:
                invocations = await llm_apps_service.batch_invoke(
                    project_id=str(project_id),
                    user_id=str(user_id),
                    testset_data=[
                        testcase_data for _ in range(len(missing_repeat_indices))
                    ],  # type: ignore[arg-type]
                    revision=application_revision,
                    uri=uri,
                    rate_limit_config=run_config,
                    application_id=str(application.id),
                    references=references,
                    scenarios=[
                        scenario.model_dump(
                            mode="json",
                            exclude_none=True,
                        )
                        for _ in range(len(missing_repeat_indices))
                    ],
                )
                if len(invocations) != len(missing_repeat_indices):
                    raise ValueError(
                        f"Unexpected batch invocation count for scenario {scenario.id}!"
                    )
                for repeat_idx, invocation in zip(missing_repeat_indices, invocations):
                    invocation_error = (
                        invocation.result.error.model_dump(mode="json")
                        if invocation.result and invocation.result.error
                        else None
                    )
                    scenario_invocations[(idx, repeat_idx)] = {
                        "status": (
                            EvaluationStatus.FAILURE
                            if invocation_error
                            else EvaluationStatus.SUCCESS
                        ),
                        "trace_id": invocation.trace_id,
                        "error": invocation_error,
                    }
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
                    repeat_idx=repeat_idx,
                    status=(
                        scenario_invocations.get((idx, repeat_idx), {}).get("status")
                        or EvaluationStatus.FAILURE
                    ),
                    trace_id=scenario_invocations.get((idx, repeat_idx), {}).get(
                        "trace_id"
                    ),
                    error=scenario_invocations.get((idx, repeat_idx), {}).get("error"),
                )
                for idx, scenario in enumerate(scenarios)
                for repeat_idx in repeat_indices
            ],
        )
        if len(invocation_results) != nof_scenarios * len(repeat_indices):
            raise ValueError(f"Failed to create invocation results for run {run_id}!")

        for idx, scenario in enumerate(scenarios):
            scenario_status = (
                EvaluationStatus.SUCCESS
                if all(
                    scenario_invocations.get((idx, repeat_idx), {}).get("status")
                    == EvaluationStatus.SUCCESS
                    for repeat_idx in repeat_indices
                )
                else EvaluationStatus.ERRORS
            )
            if not all(
                scenario_invocations.get((idx, repeat_idx), {}).get("status")
                == EvaluationStatus.SUCCESS
                for repeat_idx in repeat_indices
            ):
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
        repeats = run.data.repeats or 1
        repeat_indices = build_repeat_indices(repeats)
        is_cached = bool(run.flags.is_cached)

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
                            repeat_idx=repeat_idx,
                            status=EvaluationStatus.ERRORS,
                            testcase_id=source_testcase_id,
                            error={
                                "message": f"Testcase {source_testcase_id} not found."
                            },
                        )
                        for step in annotation_steps
                        for repeat_idx in repeat_indices
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
                            repeat_idx=repeat_idx,
                            status=EvaluationStatus.SUCCESS,
                            testcase_id=source_testcase_id,
                        )
                        for repeat_idx in repeat_indices
                    ],
                )
                if len(input_results) != len(repeat_indices):
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
                            repeat_idx=repeat_idx,
                            status=EvaluationStatus.SUCCESS,
                            trace_id=source_trace_id,
                        )
                        for repeat_idx in repeat_indices
                    ],
                )
                if len(input_results) != len(repeat_indices):
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
                            repeat_idx=repeat_idx,
                            status=EvaluationStatus.SUCCESS,
                            trace_id=source_trace_id,
                        )
                        for repeat_idx in repeat_indices
                    ],
                )
                if len(invocation_results) != len(repeat_indices):
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
                    hash_references: Dict[str, Any] = {
                        **(evaluator_references.get(annotation_step_key, {}) or {})
                    }
                    if source_testcase_id:
                        hash_references["testcase"] = {"id": str(source_testcase_id)}

                    hash_id = make_hash(
                        references=hash_references,
                        links=links,
                    )
                    cached_traces = []
                    if is_cached and hash_id and tracing_service is not None:
                        cached_traces = await fetch_traces_by_hash(
                            tracing_service,
                            project_id,
                            hash_id=hash_id,
                            limit=len(repeat_indices),
                        )

                    reusable_traces = select_traces_for_reuse(
                        traces=cached_traces,
                        required_count=len(repeat_indices),
                    )
                    _ = plan_missing_traces(
                        required_count=len(repeat_indices),
                        reusable_count=len(reusable_traces),
                    )

                    results_payload = [
                        EvaluationResultCreate(
                            run_id=run_id,
                            scenario_id=scenario.id,
                            step_key=annotation_step_key,
                            repeat_idx=repeat_idx,
                            status=EvaluationStatus.SUCCESS,
                            testcase_id=source_testcase_id,
                            trace_id=str(reusable_trace.trace_id),
                        )
                        for repeat_idx, reusable_trace in zip(
                            repeat_indices,
                            reusable_traces,
                        )
                        if reusable_trace and reusable_trace.trace_id
                    ]

                    for repeat_idx in repeat_indices[len(reusable_traces) :]:
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

                        results_payload.append(
                            EvaluationResultCreate(
                                run_id=run_id,
                                scenario_id=scenario.id,
                                step_key=annotation_step_key,
                                repeat_idx=repeat_idx,
                                status=result_status,
                                testcase_id=source_testcase_id,
                                trace_id=result_trace_id,
                                error=result_error,
                            )
                        )

                    step_results = await evaluations_service.create_results(
                        project_id=project_id,
                        user_id=user_id,
                        results=results_payload,
                    )
                    if len(step_results) != len(repeat_indices):
                        raise ValueError(
                            f"Failed to create annotation results for scenario {scenario.id}"
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
    tracing_service: TracingService,
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
        tracing_service=tracing_service,
        testcases_service=testcases_service,
        workflows_service=workflows_service,
        evaluations_service=evaluations_service,
    )
