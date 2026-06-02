from typing import Dict, List, Optional, Any, Tuple
from types import SimpleNamespace

from uuid import UUID

from agenta.sdk.evaluations.runtime.models import (
    EvaluationStep as SdkEvaluationStep,
    ResolvedSourceItem as SdkResolvedSourceItem,
)
from agenta.sdk.evaluations.runtime.planner import EvaluationPlanner
from agenta.sdk.evaluations.runtime.processor import (
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
    EvaluationResult,
    EvaluationResultQuery,
    EvaluationScenarioEdit,
    EvaluationClosedConflict,
)

from oss.src.core.evaluations.utils import (
    effective_is_split,
)
from oss.src.core.evaluations.runtime.adapters import (
    APICachedRunner,
    APIMetricsRefresher,
    APIResultLogger,
    APIScenarioFactory,
    APITraceLoader,
    APIWorkflowRunner,
)
from oss.src.core.evaluations.runtime.models import (
    ProcessSummary,
    PlannedCell,
    ResolvedSourceItem,
)
from oss.src.core.evaluations.runtime.sources import (
    resolve_direct_source_items,
    resolve_testset_input_specs,
)


log = get_module_logger(__name__)


def _cell_key(cell: Any) -> Tuple[str, int]:
    return cell.step_key, int(cell.repeat_idx or 0)


def _cell_is_addressed(
    *,
    cell: PlannedCell,
    requested_steps: set[str],
    requested_repeats: set[int],
) -> bool:
    if requested_steps and cell.step_key not in requested_steps:
        return False
    if requested_repeats and cell.repeat_idx not in requested_repeats:
        return False
    return True


async def _seed_context_by_repeat(
    *,
    project_id: UUID,
    scenario_cells: List[EvaluationResult],
    invocation_step_keys: set[str],
    tracing_service: Optional[TracingService],
) -> Dict[int, Dict[str, Any]]:
    trace_ids_by_repeat = {
        int(cell.repeat_idx or 0): cell.trace_id
        for cell in scenario_cells
        if cell.step_key in invocation_step_keys and cell.trace_id
    }
    if not trace_ids_by_repeat:
        return {}

    hydrated = await resolve_direct_source_items(
        project_id=project_id,
        trace_ids=list(dict.fromkeys(trace_ids_by_repeat.values())),
        tracing_service=tracing_service,
    )
    trace_items = {item.trace_id: item for item in hydrated if item.trace_id}
    context_by_repeat: Dict[int, Dict[str, Any]] = {}

    for repeat_idx, trace_id in trace_ids_by_repeat.items():
        item = trace_items.get(trace_id)
        context_by_repeat[repeat_idx] = {
            "trace": item.trace if item is not None else None,
            "trace_id": trace_id,
            "span_id": item.span_id if item is not None else None,
            "outputs": item.outputs if item is not None else None,
        }

    return context_by_repeat


async def _resolve_runners_and_revisions(
    *,
    project_id: UUID,
    user_id: UUID,
    run: EvaluationRun,
    invocation_steps: List[Any],
    annotation_steps: List[Any],
    tracing_service: Optional[TracingService],
    workflows_service: Optional[WorkflowsService],
    applications_service: Optional[ApplicationsService],
) -> tuple[Dict[str, Any], Dict[str, Any]]:
    """Wire one cache-aware runner + its revision per executable step.

    The returned `runners` are `APICachedRunner`s, so hashed-trace reuse
    (cache lookup by step references/links before invoking) is handled here for
    both ingest and slice re-execution. `auto` annotations are wired; `human`
    and `custom` annotations are not (the backend never executes them).
    """
    run_id = run.id
    runners: Dict[str, Any] = {}
    revisions: Dict[str, Any] = {}

    if invocation_steps:
        if applications_service is None:
            raise ValueError("applications_service is required for invocation steps")
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
        application_revision = await applications_service.fetch_application_revision(
            project_id=project_id,
            application_revision_ref=application_revision_ref,
        )
        if application_revision is None:
            raise ValueError(
                f"App revision with id {application_revision_ref.id} not found!"
            )
        runners[invocation_step.key] = APICachedRunner(
            runner=APIWorkflowRunner(
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
        runners[annotation_step.key] = APICachedRunner(
            runner=APIWorkflowRunner(
                project_id=project_id,
                user_id=user_id,
                workflows_service=workflows_service,
            ),
            tracing_service=tracing_service,
            project_id=project_id,
            enabled=bool(run.flags and run.flags.is_cached),
        )
        revisions[annotation_step.key] = evaluator_revision

    return runners, revisions


def _source_item_from_input_cells(
    *,
    input_steps: List[Any],
    cells_by_step: Dict[str, List[EvaluationResult]],
) -> Optional[ResolvedSourceItem]:
    """Rebuild the scenario's source binding from its stored input result cells.

    A slice addresses EXISTING scenarios, so the source is not re-resolved from
    a query/testset — it is recovered from the input step's already-written
    cell, which carries the bound `trace_id` (trace/query source) or
    `testcase_id` (testcase/testset source). Trace/testcase context is
    re-hydrated by the slice processor's trace loader / testcase fetch so cache
    reuse and evaluator inputs match the original run.
    """
    for step in input_steps:
        cells = cells_by_step.get(step.key) or []
        if not cells:
            continue
        cell = cells[0]
        if cell.trace_id:
            return ResolvedSourceItem(
                kind="trace",
                step_key=step.key,
                trace_id=cell.trace_id,
            )
        if cell.testcase_id:
            return ResolvedSourceItem(
                kind="testcase",
                step_key=step.key,
                testcase_id=cell.testcase_id,
            )
    return None


class APISliceProcessor:
    """API `SliceProcessor`: re-execute the runnable cells in a slice.

    Unlike `process_evaluation_source_slice` (an INGEST loop that creates a new
    scenario per source item), this re-executes EXISTING scenarios addressed by
    a `TensorSlice` — the retry / fill-missing / re-run-one-evaluator axis. For
    each scenario in the slice it: rebuilds the source binding from the stored
    input cells, re-hydrates trace/testcase context, plans only the requested
    `step_keys`/`repeat_idxs`, runs the cache-aware runners (so hashed traces are
    reused), populates the result cells, and refreshes metrics. Modified steps
    re-run because the plan is rebuilt from the run's CURRENT graph and the
    fresh evaluator revisions resolved here.
    """

    def __init__(
        self,
        *,
        evaluations_service: EvaluationsService,
        tracing_service: Optional[TracingService] = None,
        testcases_service: Optional[TestcasesService] = None,
        workflows_service: Optional[WorkflowsService] = None,
        applications_service: Optional[ApplicationsService] = None,
    ):
        self.evaluations_service = evaluations_service
        self.tracing_service = tracing_service
        self.testcases_service = testcases_service
        self.workflows_service = workflows_service
        self.applications_service = applications_service

    async def process(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        tensor_slice,
    ) -> ProcessSummary:
        run_id = tensor_slice.run_id
        run = await self.evaluations_service.fetch_run(
            project_id=project_id,
            run_id=run_id,
        )
        if not run or not run.data or not run.data.steps:
            return ProcessSummary()

        steps = run.data.steps
        input_steps = [step for step in steps if step.type == "input"]
        invocation_steps = [step for step in steps if step.type == "invocation"]
        annotation_steps = [step for step in steps if step.type == "annotation"]

        # Probe the existing cells in the slice scope, grouped by scenario.
        existing = await self.evaluations_service.query_results(
            project_id=project_id,
            result=EvaluationResultQuery(
                run_id=run_id,
                scenario_ids=tensor_slice.scenario_ids,
                step_keys=tensor_slice.step_keys,
                repeat_idxs=tensor_slice.repeat_idxs,
            ),
        )
        # Inputs are always needed to rebuild the source binding even when the
        # slice's step_keys exclude them, so probe inputs separately per scenario.
        scenario_ids = (
            sorted(set(tensor_slice.scenario_ids or []), key=str)
            if tensor_slice.scenario_ids is not None
            else sorted(
                {cell.scenario_id for cell in existing if cell.scenario_id},
                key=str,
            )
        )
        if not scenario_ids:
            return ProcessSummary()

        runners, revisions = await _resolve_runners_and_revisions(
            project_id=project_id,
            user_id=user_id,
            run=run,
            invocation_steps=invocation_steps,
            annotation_steps=annotation_steps,
            tracing_service=self.tracing_service,
            workflows_service=self.workflows_service,
            applications_service=self.applications_service,
        )

        requested_steps = set(tensor_slice.step_keys or [])
        requested_repeats = set(tensor_slice.repeat_idxs or [])
        force_rerun = tensor_slice.process_mode == "force"

        sdk_steps_all = [
            SdkEvaluationStep(
                key=step.key,
                type=step.type,
                origin=step.origin,
                references=step.references or {},
                inputs=[step_input.key for step_input in (step.inputs or [])],
            )
            for step in steps
        ]

        summary = ProcessSummary()

        for scenario_id in scenario_ids:
            input_cells = await self.evaluations_service.query_results(
                project_id=project_id,
                result=EvaluationResultQuery(
                    run_id=run_id,
                    scenario_id=scenario_id,
                ),
            )
            cells_by_step: Dict[str, List[EvaluationResult]] = {}
            for cell in input_cells:
                cells_by_step.setdefault(cell.step_key, []).append(cell)
            existing_cell_keys = {_cell_key(cell) for cell in input_cells}

            source_item = _source_item_from_input_cells(
                input_steps=input_steps,
                cells_by_step=cells_by_step,
            )
            if source_item is None:
                summary.failed += 1
                continue

            # Re-hydrate source context so cache reuse / evaluator inputs match.
            hydrated = await resolve_direct_source_items(
                project_id=project_id,
                testcase_ids=[source_item.testcase_id]
                if source_item.testcase_id
                else None,
                trace_ids=[source_item.trace_id] if source_item.trace_id else None,
                testcases_service=self.testcases_service,
                tracing_service=self.tracing_service,
            )
            resolved = hydrated[0] if hydrated else source_item
            resolved.step_key = source_item.step_key

            sdk_source_item = SdkResolvedSourceItem(
                kind=resolved.kind,
                step_key=resolved.step_key,
                references=resolved.references or {},
                trace_id=resolved.trace_id,
                span_id=resolved.span_id,
                testcase_id=resolved.testcase_id,
                testcase=resolved.testcase,
                trace=resolved.trace,
                inputs=resolved.inputs or getattr(resolved.testcase, "data", None),
                outputs=resolved.outputs,
            )
            initial_context_by_repeat = await _seed_context_by_repeat(
                project_id=project_id,
                scenario_cells=input_cells,
                invocation_step_keys={step.key for step in invocation_steps},
                tracing_service=self.tracing_service,
            )
            effective_is_split_value = effective_is_split(
                is_split=bool(run.flags and run.flags.is_split),
                has_application_steps=bool(invocation_steps),
                has_evaluator_steps=bool(annotation_steps),
            )
            preview_plan = EvaluationPlanner().plan(
                run_id=run_id,
                scenario_id=scenario_id,
                source=sdk_source_item,
                steps=sdk_steps_all,
                repeats=run.data.repeats,
                is_split=effective_is_split_value,
            )
            addressed_cells = [
                cell
                for cell in preview_plan.cells
                if _cell_is_addressed(
                    cell=cell,
                    requested_steps=requested_steps,
                    requested_repeats=requested_repeats,
                )
            ]
            if not force_rerun:
                summary.reused += sum(
                    1
                    for cell in addressed_cells
                    if _cell_key(cell) in existing_cell_keys
                )
            target_keys = {
                _cell_key(cell)
                for cell in addressed_cells
                if force_rerun or _cell_key(cell) not in existing_cell_keys
            }
            if not target_keys:
                continue

            processed = await sdk_process_evaluation_source_slice(
                run_id=run_id,
                source_items=[sdk_source_item],
                steps=sdk_steps_all,
                repeats=run.data.repeats,
                create_scenario=_ExistingScenario(scenario_id),
                result_logger=APIResultLogger(
                    project_id=project_id,
                    user_id=user_id,
                    timestamp=None,
                    interval=None,
                    evaluations_service=self.evaluations_service,
                ),
                # process() writes result cells only; metric refresh is the
                # separate `refresh` op invoked by the caller on the right
                # boundary. The SDK loop requires a callback, so pass a no-op.
                refresh_metrics=_noop_refresh_metrics,
                runners=runners,
                revisions=revisions,
                trace_loader=(
                    APITraceLoader(
                        project_id=project_id,
                        tracing_service=self.tracing_service,
                    )
                    if self.tracing_service is not None
                    else None
                ),
                is_split=effective_is_split_value,
                log_pending=True,
                refresh_metrics_without_auto_results=True,
                batch_size=run.data.concurrency.batch_size
                if run.data.concurrency
                else None,
                max_retries=run.data.concurrency.max_retries
                if run.data.concurrency
                else None,
                retry_delay=run.data.concurrency.retry_delay
                if run.data.concurrency
                else None,
                initial_context_by_repeat=initial_context_by_repeat,
                plan_cell_filter=lambda cell: _cell_key(cell) in target_keys,
            )

            summary.created += len(target_keys)
            for item in processed:
                if item.has_pending:
                    summary.pending += 1
                if item.has_errors:
                    summary.failed += 1

        log.info(
            "[SLICE] re-execute complete",
            run_id=str(run_id),
            scenarios=len(scenario_ids),
            created=summary.created,
            pending=summary.pending,
            failed=summary.failed,
            requested_steps=sorted(requested_steps) or None,
            requested_repeats=sorted(requested_repeats) or None,
        )
        return summary


class _ExistingScenario:
    """`create_scenario` adapter that returns an existing scenario by id.

    The SDK slice loop calls `create_scenario(run_id)` and uses `.id`; for
    re-execution we hand it the existing scenario rather than minting a new one,
    so results are populated against the scenario the slice addressed.
    """

    def __init__(self, scenario_id: UUID):
        self._scenario = SimpleNamespace(id=scenario_id)

    async def __call__(self, run_id: UUID):
        return self._scenario


async def _noop_refresh_metrics(run_id: UUID, scenario_id):
    """No-op refresh callback for `process` (results-only).

    The SDK slice loop requires a `refresh_metrics` callback, but `process` no
    longer refreshes metrics — that is the separate `refresh` op. This satisfies
    the contract without recomputing anything.
    """
    return None


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
    log.info(
        "[WORKER] process_testset_source_run: start",
        run_id=str(run_id),
        project_id=str(project_id),
    )

    run = await evaluations_service.fetch_run(
        project_id=project_id,
        run_id=run_id,
    )
    if not run:
        raise ValueError(f"Evaluation run with id {run_id} not found!")
    if not run.data or not run.data.steps:
        raise ValueError(f"Evaluation run with id {run_id} has no data steps!")

    log.info(
        "[WORKER] process_testset_source_run: run fetched",
        run_id=str(run_id),
        run_name=run.name,
        run_status=str(run.status),
        steps=[
            {"key": s.key, "type": s.type, "origin": s.origin} for s in run.data.steps
        ],
        repeats=run.data.repeats,
        concurrency=run.data.concurrency.model_dump() if run.data.concurrency else None,
    )

    input_steps = [step for step in run.data.steps if step.type == "input"]
    input_specs = await _resolve_testset_input_specs(
        project_id=project_id,
        input_steps=input_steps,
        testsets_service=testsets_service,
    )

    log.info(
        "[WORKER] process_testset_source_run: input specs resolved",
        run_id=str(run_id),
        input_specs=[
            {
                "step_key": spec["step_key"],
                "testset_id": str(spec["testset"].id),
                "testset_revision_id": str(spec["testset_revision"].id),
                "testcase_count": len(spec["testcases"]),
            }
            for spec in input_specs
        ],
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
    log.info(
        "[WORKER] process_evaluation_source_slice: start",
        run_id=str(run_id),
        project_id=str(project_id),
        source_items_count=len(source_items) if source_items else 0,
        testcase_ids_count=len(testcase_ids) if testcase_ids else 0,
        trace_ids_count=len(trace_ids) if trace_ids else 0,
        require_queue=require_queue,
        update_run_status=update_run_status,
    )

    run: Optional[EvaluationRun] = None
    run_status = EvaluationStatus.SUCCESS

    try:
        run = await evaluations_service.fetch_run(
            project_id=project_id,
            run_id=run_id,
        )
        if not run:
            raise ValueError(f"Evaluation run with id {run_id} not found!")
        if not run.data or not run.data.steps:
            raise ValueError(f"Evaluation run with id {run_id} has no data steps!")

        steps = run.data.steps
        input_steps = [step for step in steps if step.type == "input"]
        invocation_steps = [step for step in steps if step.type == "invocation"]
        annotation_steps = [step for step in steps if step.type == "annotation"]

        log.info(
            "[WORKER] process_evaluation_source_slice: run fetched",
            run_id=str(run_id),
            run_name=run.name,
            run_status=str(run.status),
            total_steps=len(steps),
            input_steps=[
                {
                    "key": s.key,
                    "references": {
                        k: (v.id if hasattr(v, "id") else v)
                        for k, v in (s.references or {}).items()
                    },
                }
                for s in input_steps
            ],
            invocation_steps=[
                {
                    "key": s.key,
                    "references": {
                        k: str(v.id) if hasattr(v, "id") else v
                        for k, v in (s.references or {}).items()
                    },
                }
                for s in invocation_steps
            ],
            annotation_steps=[
                {
                    "key": s.key,
                    "origin": s.origin,
                    "references": {
                        k: str(v.id) if hasattr(v, "id") else v
                        for k, v in (s.references or {}).items()
                    },
                }
                for s in annotation_steps
            ],
            repeats=run.data.repeats,
            concurrency=run.data.concurrency.model_dump()
            if run.data.concurrency
            else None,
            flags=run.flags.model_dump() if run.flags else None,
        )

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
        if require_queue:
            queue_step_key = input_step_key or (
                source_items[0].step_key
                if source_items and source_items[0].step_key
                else None
            )
            source_step = (
                next(
                    (step for step in input_steps if step.key == queue_step_key),
                    None,
                )
                if queue_step_key is not None
                else None
            )
            source_step_refs = source_step.references if source_step else {}
            source_item_kinds = {item.kind for item in source_items}
            has_trace_payload = bool(trace_ids) or "trace" in source_item_kinds
            has_testcase_payload = bool(testcase_ids) or "testcase" in source_item_kinds
            accepts_trace_batch = bool(
                run.flags
                and has_trace_payload
                and (
                    run.flags.has_traces
                    or (
                        run.flags.has_queries
                        and bool((source_step_refs or {}).get("query_revision"))
                    )
                )
            )
            accepts_testcase_batch = bool(
                run.flags
                and has_testcase_payload
                and (
                    run.flags.has_testcases
                    or (
                        run.flags.has_testsets
                        and bool((source_step_refs or {}).get("testset_revision"))
                    )
                )
            )
            if not (accepts_trace_batch or accepts_testcase_batch):
                raise ValueError(
                    f"Evaluation run with id {run_id} is not configured for queue batching!"
                )

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

        runners, revisions = await _resolve_runners_and_revisions(
            project_id=project_id,
            user_id=user_id,
            run=run,
            invocation_steps=invocation_steps,
            annotation_steps=annotation_steps,
            tracing_service=tracing_service,
            workflows_service=workflows_service,
            applications_service=applications_service,
        )

        log.info(
            "[WORKER] process_evaluation_source_slice: runners/revisions resolved",
            run_id=str(run_id),
            runner_keys=list(runners.keys()),
            revision_keys=list(revisions.keys()),
            sdk_source_items_count=len(sdk_source_items),
            sdk_steps=[{"key": s.key, "type": s.type} for s in sdk_steps],
        )

        processed = await sdk_process_evaluation_source_slice(
            run_id=run_id,
            source_items=sdk_source_items,
            steps=sdk_steps,
            repeats=run.data.repeats,
            create_scenario=APIScenarioFactory(
                project_id=project_id,
                user_id=user_id,
                timestamp=timestamp,
                interval=interval,
                evaluations_service=evaluations_service,
            ),
            result_logger=APIResultLogger(
                project_id=project_id,
                user_id=user_id,
                timestamp=timestamp,
                interval=interval,
                evaluations_service=evaluations_service,
            ),
            refresh_metrics=APIMetricsRefresher(
                project_id=project_id,
                user_id=user_id,
                timestamp=timestamp,
                interval=interval,
                evaluations_service=evaluations_service,
            ),
            runners=runners,
            revisions=revisions,
            trace_loader=(
                APITraceLoader(
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
            batch_size=run.data.concurrency.batch_size
            if run.data.concurrency
            else None,
            max_retries=run.data.concurrency.max_retries
            if run.data.concurrency
            else None,
            retry_delay=run.data.concurrency.retry_delay
            if run.data.concurrency
            else None,
        )

        log.info(
            "[WORKER] process_evaluation_source_slice: SDK complete",
            run_id=str(run_id),
            processed_count=len(processed),
            scenarios_with_errors=sum(1 for i in processed if i.has_errors),
            scenarios_with_pending=sum(1 for i in processed if i.has_pending),
            scenarios_with_auto_results=sum(
                1 for i in processed if i.auto_results_created
            ),
            result_step_keys=[list(i.results.keys()) for i in processed],
        )

        for item in processed:
            scenario_status = (
                EvaluationStatus.ERRORS
                if item.has_errors
                else EvaluationStatus.PENDING
                if item.has_pending
                else EvaluationStatus.SUCCESS
            )
            try:
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
            except EvaluationClosedConflict:
                # The run was closed (locked) mid-flight by a user. Closing is a
                # lock, not a failure signal — skip the write and let the slice
                # finish; the finalize below will also tolerate the lock.
                log.info(
                    "[WORKER] scenario write skipped: run closed mid-flight",
                    run_id=str(run_id),
                    scenario_id=str(item.scenario.id),
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
        and (
            run.flags.has_traces
            or run.flags.has_testcases
            or run.flags.has_queries
            or run.flags.has_testsets
        )
        and run_status != EvaluationStatus.FAILURE
    ):
        # Only terminal "bad" statuses floor across slices: if an earlier slice
        # already marked the run FAILURE/ERRORS, a later SUCCESS-only slice must
        # not downgrade it. The transient RUNNING/PENDING states rank BELOW
        # SUCCESS so a freshly computed terminal status (incl. SUCCESS) always
        # replaces a stale RUNNING — otherwise a run pins at RUNNING forever.
        severity = {
            EvaluationStatus.FAILURE: 4,
            EvaluationStatus.ERRORS: 3,
            EvaluationStatus.SUCCESS: 2,
            EvaluationStatus.RUNNING: 1,
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
        # When the run reaches a terminal status, it is no longer active. A
        # non-terminal status (RUNNING/PENDING) leaves the run active so further
        # slices can continue.
        final_flags = run.flags
        if final_flags is not None and run_status in (
            EvaluationStatus.SUCCESS,
            EvaluationStatus.ERRORS,
            EvaluationStatus.FAILURE,
        ):
            final_flags = final_flags.model_copy(update={"is_active": False})

        try:
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
                    flags=final_flags,
                    data=run.data,
                ),
            )
        except EvaluationClosedConflict:
            # The run was closed (locked) mid-flight. Closing is a lock, not a
            # failure — the user deliberately froze the run, so leave its status
            # as-is rather than turning finalization into an error.
            log.info(
                "[WORKER] finalize skipped: run closed mid-flight",
                run_id=str(run_id),
                run_status=str(run_status),
            )

    log.info("[DONE]      ", run_id=run_id, project_id=project_id, user_id=user_id)
    return
