from typing import Dict, List, Optional, Any

from uuid import UUID

from agenta.sdk.evaluations.runtime.models import (
    EvaluationStep as SdkEvaluationStep,
    ResolvedSourceItem as SdkResolvedSourceItem,
)
from agenta.sdk.evaluations.runtime.source_slice import (
    process_evaluation_source_slice as sdk_process_evaluation_source_slice,
)

from oss.src.utils.logging import get_module_logger

from oss.src.core.testcases.service import TestcasesService
from oss.src.core.testsets.service import TestsetsService
from oss.src.core.applications.service import ApplicationsService
from oss.src.core.workflows.service import WorkflowsService
from oss.src.core.evaluations.service import EvaluationsService

from oss.src.core.tracing.service import TracingService


from oss.src.core.evaluations.types import (
    EvaluationStatus,
    EvaluationRun,
    EvaluationRunEdit,
    EvaluationScenarioEdit,
)

from oss.src.core.evaluations.utils import (
    effective_is_split,
)
from oss.src.core.evaluations.runtime.adapters import (
    BackendCachedRunner,
    BackendMetricsRefresher,
    BackendResultLogger,
    BackendScenarioFactory,
    BackendTraceLoader,
    BackendWorkflowRunner,
)
from oss.src.core.evaluations.runtime.models import ResolvedSourceItem
from oss.src.core.evaluations.runtime.sources import (
    resolve_direct_source_items,
    resolve_testset_input_specs,
)


log = get_module_logger(__name__)


async def _resolve_testset_input_specs(
    *,
    project_id: UUID,
    input_steps: List[Any],
    testsets_service: TestsetsService,
) -> List[Dict[str, Any]]:
    return [
        {
            "step_key": spec.step_key,
            "testset": spec.testset,
            "testset_revision": spec.testset_revision,
            "testcases": spec.testcases,
            "testcases_data": spec.testcases_data,
        }
        for spec in await resolve_testset_input_specs(
            project_id=project_id,
            input_steps=input_steps,
            testsets_service=testsets_service,
        )
    ]


async def process_testset_source_run(
    *,
    project_id: UUID,
    user_id: UUID,
    #
    run_id: UUID,
    #
    tracing_service: TracingService,
    testsets_service: TestsetsService,
    workflows_service: WorkflowsService,
    applications_service: ApplicationsService,
    evaluations_service: EvaluationsService,
):
    """Resolve testset rows, then process them through the unified source loop."""
    run = await evaluations_service.fetch_run(
        project_id=project_id,
        run_id=run_id,
    )
    if not run:
        raise ValueError(f"Evaluation run with id {run_id} not found!")
    if not run.data or not run.data.steps:
        raise ValueError(f"Evaluation run with id {run_id} has no data steps!")

    input_steps = [step for step in run.data.steps if step.type == "input"]
    input_specs = await _resolve_testset_input_specs(
        project_id=project_id,
        input_steps=input_steps,
        testsets_service=testsets_service,
    )
    source_items = [
        ResolvedSourceItem(
            kind="testcase",
            step_key=input_spec["step_key"],
            references={
                "testcase": {"id": str(testcase.id)},
                "testset": {"id": str(input_spec["testset"].id)},
                "testset_variant": {
                    "id": str(input_spec["testset_revision"].variant_id)
                },
                "testset_revision": {"id": str(input_spec["testset_revision"].id)},
            },
            testcase_id=testcase.id,
            testcase=testcase,
            inputs=testcase_data,
        )
        for input_spec in input_specs
        for testcase, testcase_data in zip(
            input_spec["testcases"],
            input_spec["testcases_data"],
        )
    ]

    return await process_evaluation_source_slice(
        project_id=project_id,
        user_id=user_id,
        run_id=run_id,
        source_items=source_items,
        require_queue=False,
        update_run_status=True,
        refresh_metrics_without_auto_results=True,
        tracing_service=tracing_service,
        workflows_service=workflows_service,
        applications_service=applications_service,
        evaluations_service=evaluations_service,
    )


async def process_evaluation_source_slice(
    *,
    project_id: UUID,
    user_id: UUID,
    run_id: UUID,
    testcase_ids: Optional[List[UUID]] = None,
    trace_ids: Optional[List[str]] = None,
    source_items: Optional[List[ResolvedSourceItem]] = None,
    input_step_key: Optional[str] = None,
    timestamp: Optional[Any] = None,
    interval: Optional[int] = None,
    require_queue: bool = True,
    update_run_status: bool = True,
    refresh_metrics_without_auto_results: bool = True,
    tracing_service: Optional[TracingService] = None,
    testcases_service: Optional[TestcasesService] = None,
    workflows_service: Optional[WorkflowsService] = None,
    applications_service: Optional[ApplicationsService] = None,
    evaluations_service: EvaluationsService,
):
    """Resolve backend adapters, then delegate execution to the SDK runtime."""
    run: Optional[EvaluationRun] = None
    run_status = EvaluationStatus.SUCCESS

    try:
        run = await evaluations_service.fetch_run(
            project_id=project_id,
            run_id=run_id,
        )
        if not run:
            raise ValueError(f"Evaluation run with id {run_id} not found!")
        if require_queue and (not run.flags or not run.flags.is_queue):
            raise ValueError(
                f"Evaluation run with id {run_id} is not configured for ad-hoc batching!"
            )
        if not run.data or not run.data.steps:
            raise ValueError(f"Evaluation run with id {run_id} has no data steps!")

        steps = run.data.steps
        input_steps = [step for step in steps if step.type == "input"]
        invocation_steps = [step for step in steps if step.type == "invocation"]
        annotation_steps = [step for step in steps if step.type == "annotation"]
        if len(invocation_steps) > 1:
            raise ValueError(
                f"Evaluation run with id {run_id} has more than one invocation step."
            )

        if input_step_key is not None and not any(
            step.key == input_step_key for step in input_steps
        ):
            raise ValueError(
                f"Evaluation run with id {run_id} has no input step '{input_step_key}'!"
            )

        testcase_ids = testcase_ids or []
        trace_ids = trace_ids or []
        source_items = source_items or []
        if not source_items and not testcase_ids and not trace_ids:
            raise ValueError(
                f"Evaluation run with id {run_id} has no source items, testcase_ids, or trace_ids!"
            )
        if trace_ids and tracing_service is None:
            raise ValueError("tracing_service is required for trace batches")
        if testcase_ids and testcases_service is None:
            raise ValueError("testcases_service is required for testcase batches")

        if not source_items:
            source_items = await resolve_direct_source_items(
                project_id=project_id,
                testcase_ids=testcase_ids,
                trace_ids=trace_ids,
                testcases_service=testcases_service,
                tracing_service=tracing_service,
            )
        effective_input_step_key = (
            input_step_key
            or (
                source_items[0].step_key
                if source_items and source_items[0].step_key
                else None
            )
            or (input_steps[0].key if input_steps else "")
        )
        sdk_source_items = [
            SdkResolvedSourceItem(
                kind=source_item.kind,
                step_key=source_item.step_key or effective_input_step_key,
                references=source_item.references or {},
                trace_id=source_item.trace_id,
                span_id=source_item.span_id,
                testcase_id=source_item.testcase_id,
                testcase=source_item.testcase,
                trace=source_item.trace,
                inputs=source_item.inputs
                or getattr(source_item.testcase, "data", None),
                outputs=source_item.outputs,
            )
            for source_item in source_items
        ]

        sdk_steps = [
            SdkEvaluationStep(
                key=step.key,
                type=step.type,
                origin=step.origin,
                references=step.references or {},
                inputs=[step_input.key for step_input in (step.inputs or [])],
            )
            for step in steps
        ]

        runners: Dict[str, Any] = {}
        revisions: Dict[str, Any] = {}

        if invocation_steps:
            if applications_service is None:
                raise ValueError(
                    "applications_service is required for invocation steps"
                )
            if workflows_service is None:
                raise ValueError("workflows_service is required for invocation steps")
            invocation_step = invocation_steps[0]
            application_revision_ref = invocation_step.references.get(
                "application_revision"
            )
            if not application_revision_ref or not isinstance(
                application_revision_ref.id, UUID
            ):
                raise ValueError(
                    f"Evaluation run with id {run_id} missing invocation.application_revision reference."
                )
            application_revision = (
                await applications_service.fetch_application_revision(
                    project_id=project_id,
                    application_revision_ref=application_revision_ref,
                )
            )
            if application_revision is None:
                raise ValueError(
                    f"App revision with id {application_revision_ref.id} not found!"
                )
            runners[invocation_step.key] = BackendCachedRunner(
                runner=BackendWorkflowRunner(
                    project_id=project_id,
                    user_id=user_id,
                    workflows_service=workflows_service,
                ),
                tracing_service=tracing_service,
                project_id=project_id,
                enabled=bool(run.flags and run.flags.is_cached),
            )
            revisions[invocation_step.key] = application_revision

        auto_annotation_steps = [
            step for step in annotation_steps if step.origin not in {"human", "custom"}
        ]
        if auto_annotation_steps and workflows_service is None:
            raise ValueError("workflows_service is required for auto annotation steps")
        for annotation_step in auto_annotation_steps:
            evaluator_revision_ref = (annotation_step.references or {}).get(
                "evaluator_revision"
            )
            evaluator_revision = (
                await workflows_service.fetch_workflow_revision(  # type: ignore[union-attr]
                    project_id=project_id,
                    workflow_revision_ref=evaluator_revision_ref,
                )
                if evaluator_revision_ref
                else None
            )
            if evaluator_revision is None:
                continue
            runners[annotation_step.key] = BackendCachedRunner(
                runner=BackendWorkflowRunner(
                    project_id=project_id,
                    user_id=user_id,
                    workflows_service=workflows_service,
                ),
                tracing_service=tracing_service,
                project_id=project_id,
                enabled=bool(run.flags and run.flags.is_cached),
            )
            revisions[annotation_step.key] = evaluator_revision

        processed = await sdk_process_evaluation_source_slice(
            run_id=run_id,
            source_items=sdk_source_items,
            steps=sdk_steps,
            repeats=run.data.repeats,
            create_scenario=BackendScenarioFactory(
                project_id=project_id,
                user_id=user_id,
                timestamp=timestamp,
                interval=interval,
                evaluations_service=evaluations_service,
            ),
            result_logger=BackendResultLogger(
                project_id=project_id,
                user_id=user_id,
                timestamp=timestamp,
                interval=interval,
                evaluations_service=evaluations_service,
            ),
            refresh_metrics=BackendMetricsRefresher(
                project_id=project_id,
                user_id=user_id,
                timestamp=timestamp,
                interval=interval,
                evaluations_service=evaluations_service,
            ),
            runners=runners,
            revisions=revisions,
            trace_loader=(
                BackendTraceLoader(
                    project_id=project_id,
                    tracing_service=tracing_service,
                )
                if tracing_service is not None
                else None
            ),
            is_split=effective_is_split(
                is_split=bool(run.flags and run.flags.is_split),
                has_application_steps=bool(invocation_steps),
                has_evaluator_steps=bool(annotation_steps),
            ),
            log_pending=False,
            refresh_metrics_without_auto_results=refresh_metrics_without_auto_results,
        )

        for item in processed:
            scenario_status = (
                EvaluationStatus.ERRORS
                if item.has_errors
                else EvaluationStatus.PENDING
                if item.has_pending
                else EvaluationStatus.SUCCESS
            )
            await evaluations_service.edit_scenario(
                project_id=project_id,
                user_id=user_id,
                scenario=EvaluationScenarioEdit(
                    id=item.scenario.id,
                    tags=getattr(item.scenario, "tags", None),
                    meta=getattr(item.scenario, "meta", None),
                    status=scenario_status,
                ),
            )

        if any(item.has_errors for item in processed):
            run_status = EvaluationStatus.ERRORS
        elif any(item.has_pending for item in processed):
            run_status = EvaluationStatus.RUNNING
        else:
            run_status = EvaluationStatus.SUCCESS

    except Exception as e:  # pylint: disable=broad-exception-caught
        log.error(
            f"An error occurred during source slice evaluation: {e}",
            exc_info=True,
        )
        run_status = EvaluationStatus.FAILURE

    if not run:
        return

    if (
        update_run_status
        and run.flags
        and run.flags.is_queue
        and run_status != EvaluationStatus.FAILURE
    ):
        severity = {
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
            stored_severity = severity.get(current_run.status, 0)
            if stored_severity > severity.get(run_status, 0):
                run_status = current_run.status

    if update_run_status:
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
