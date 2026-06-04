import asyncio
from typing import Dict, List, Optional, Any, Tuple
from types import SimpleNamespace

from uuid import UUID

from agenta.sdk.evaluations.runtime.models import (
    EvaluationStep as SdkEvaluationStep,
    ResolvedSourceItem as SdkResolvedSourceItem,
)
from agenta.sdk.evaluations.runtime.planner import EvaluationPlanner
from agenta.sdk.evaluations.runtime.processor import (
    process_sources as sdk_process_evaluation_source_slice,
    run_status as compute_run_status,
)

from oss.src.utils.logging import get_module_logger

from oss.src.core.testcases.service import TestcasesService
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
    EvaluationClosedConflict,
)

from oss.src.core.evaluations.utils import (
    effective_is_split,
)
from oss.src.core.evaluations.runtime.adapters import (
    APICachedRunner,
    APIMetricsRefresher,
    APIResultSetter,
    APIScenarioEditor,
    APITraceFetcher,
    APIWorkflowRunner,
)
from oss.src.core.evaluations.runtime.models import (
    ProcessSummary,
    PlannedCell,
    ResolvedSourceItem,
    ScenarioBinding,
)
from oss.src.core.evaluations.runtime.sources import (
    resolve_direct_source_items,
)


log = get_module_logger(__name__)


def _cell_key(cell: Any) -> Tuple[str, int]:
    return cell.step_key, int(cell.repeat_idx or 0)


def _to_sdk_source_item(
    source_item: ResolvedSourceItem,
    *,
    step_key_fallback: Optional[str] = None,
) -> SdkResolvedSourceItem:
    """Shape an api-side ResolvedSourceItem into the SDK engine's input type.

    The ingest and re-execute paths build this identically; the only variation
    is the step key, which re-execute carries on the item and ingest derives
    from the run's input step. Keeping one helper removes that duplication.
    """
    return SdkResolvedSourceItem(
        kind=source_item.kind,
        step_key=source_item.step_key or step_key_fallback or "",
        references=source_item.references or {},
        trace_id=source_item.trace_id,
        span_id=source_item.span_id,
        testcase_id=source_item.testcase_id,
        testcase=source_item.testcase,
        trace=source_item.trace,
        inputs=source_item.inputs or getattr(source_item.testcase, "data", None),
        outputs=source_item.outputs,
    )


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


def _seed_context_from_source(
    *,
    source_item: ResolvedSourceItem,
    repeats: Optional[int],
) -> Dict[int, Dict[str, Any]]:
    """Build per-repeat upstream context from an ALREADY-HYDRATED source item.

    The API-side counterpart of the SDK's `_initial_context_by_repeat`, for the
    seeded ingest path: the trace was fetched once by the resolver and lives on
    the `ResolvedSourceItem`, so the runner's upstream context is read straight
    from it instead of re-fetching by id. Testcase sources carry no trace, so
    there is no upstream context to seed (returns {}).
    """
    trace = source_item.trace
    trace_id = source_item.trace_id
    if not trace and not trace_id:
        return {}
    if not trace_id:
        return {}

    context = {
        "trace": trace,
        "trace_id": str(trace_id),
        "span_id": source_item.span_id,
        "outputs": source_item.outputs,
    }
    count = max(repeats or 1, 1)
    return {repeat_idx: context for repeat_idx in range(count)}


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


async def _resolve_source_from_input_cells(
    *,
    project_id: UUID,
    input_steps: List[Any],
    cells_by_step: Dict[str, List[EvaluationResult]],
    tracing_service: Optional[Any],
    testcases_service: Optional[Any],
) -> Optional[SdkResolvedSourceItem]:
    """The input-cache ladder: recover a scenario's source from its stored cell.

    A scenario that already exists carries its source identity in its input
    result cell (a `trace_id` or `testcase_id`). This reads that id back and
    re-hydrates the trace/testcase payload — the same data the original run
    resolved — so cache reuse and evaluator inputs match. Returns None when the
    scenario has no usable input cell (nothing to reconstruct from); the caller
    treats that as "must be populated first".
    """
    source_item = _source_item_from_input_cells(
        input_steps=input_steps,
        cells_by_step=cells_by_step,
    )
    if source_item is None:
        return None

    hydrated = await resolve_direct_source_items(
        project_id=project_id,
        testcase_ids=[source_item.testcase_id] if source_item.testcase_id else None,
        trace_ids=[source_item.trace_id] if source_item.trace_id else None,
        testcases_service=testcases_service,
        tracing_service=tracing_service,
    )
    resolved = hydrated[0] if hydrated else source_item
    resolved.step_key = source_item.step_key
    return _to_sdk_source_item(resolved)


async def _run_sdk_source_slice(
    *,
    project_id: UUID,
    user_id: UUID,
    run: Any,
    evaluations_service: Any,
    sdk_source_items: List[SdkResolvedSourceItem],
    sdk_steps: List[SdkEvaluationStep],
    invocation_steps: List[Any],
    annotation_steps: List[Any],
    runners: Any,
    revisions: Any,
    #
    # --- the seams (the only things that differ between callers) ---
    create_scenario: Any,
    refresh_metrics: Any,
    log_pending: bool,
    timestamp: Optional[Any] = None,
    interval: Optional[int] = None,
    refresh_metrics_without_auto_results: bool = True,
    plan_cell_filter: Optional[Any] = None,
    initial_context_by_repeat: Optional[Any] = None,
    tracing_service: Optional[Any] = None,
) -> List[Any]:
    """The single execution call: drive the SDK engine over a source slice.

    Both the ingest path (NEW scenarios from source ids) and the re-execute path
    (EXISTING scenarios by coordinate) funnel through here. They differ only in
    the injected seams: the scenario factory (create vs reuse), the metrics
    refresher (inline vs deferred), `log_pending`, the cell filter, and the
    per-repeat context seed. Everything else is intrinsic to `run` + services
    and identical for both, so it lives here once.
    """
    return await sdk_process_evaluation_source_slice(
        run_id=run.id,
        source_items=sdk_source_items,
        steps=sdk_steps,
        repeats=run.data.repeats,
        create_scenario=create_scenario,
        set_results=APIResultSetter(
            project_id=project_id,
            user_id=user_id,
            timestamp=timestamp,
            interval=interval,
            evaluations_service=evaluations_service,
        ),
        edit_scenario=APIScenarioEditor(
            project_id=project_id,
            user_id=user_id,
            evaluations_service=evaluations_service,
        ),
        refresh_metrics=refresh_metrics,
        runners=runners,
        revisions=revisions,
        fetch_trace=(
            APITraceFetcher(
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
        log_pending=log_pending,
        refresh_metrics_without_auto_results=refresh_metrics_without_auto_results,
        batch_size=run.data.concurrency.batch_size if run.data.concurrency else None,
        max_retries=run.data.concurrency.max_retries if run.data.concurrency else None,
        retry_delay=run.data.concurrency.retry_delay if run.data.concurrency else None,
        initial_context_by_repeat=initial_context_by_repeat,
        plan_cell_filter=plan_cell_filter,
    )


async def _finalize_run_after_slice(
    *,
    project_id: UUID,
    user_id: UUID,
    run: Any,
    processed: List[Any],
    run_status_override: Optional[Any] = None,
    evaluations_service: Any,
    finalize_run_status: bool = True,
) -> None:
    """Shared "done" for `process`: finalize the RUN from the touched set.

    Per-scenario status is no longer written here — the engine
    (`process_sources`) owns that via the injected `edit_scenario` adapter, the
    same path for ingest, re-execute, and the SDK. This function is the
    remaining RUN-level post-process every slice owns:

      1. computes the run status from the touched set (or uses an override, e.g.
         FAILURE when the slice itself raised);
      2. if `finalize_run_status`, floors the run status across concurrent slices
         off the CURRENT run (not the caller's stale snapshot) and flips
         `is_active` off on a terminal status.

    `finalize_run_status=False` is the live-query loop, which never finalizes —
    it keeps ticking and leaves run status alone.
    """
    # 1. run status from the touched set (or the override). The rollup itself is
    # the shared engine verdict (same as the SDK); only the override + the
    # cross-slice floor below are API-specific.
    if run_status_override is not None:
        run_status = run_status_override
    else:
        run_status = compute_run_status(processed)

    if not finalize_run_status:
        return

    # 2. floor + is_active, off the CURRENT run (concurrent-slice safe).
    # Concurrent slices each hold a stale snapshot of `run`; finalize both floors
    # the status and flips `is_active`, so it must read the CURRENT run or a
    # late-finishing slice clobbers another's status/flags (e.g. resurrecting
    # is_active=True).
    current_run = await evaluations_service.fetch_run(
        project_id=project_id,
        run_id=run.id,
    )

    if (
        run.flags
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
        # not downgrade it. RUNNING/PENDING rank BELOW SUCCESS so a freshly
        # computed terminal status (incl. SUCCESS) always replaces a stale
        # RUNNING — otherwise a run pins at RUNNING forever.
        severity = {
            EvaluationStatus.FAILURE: 4,
            EvaluationStatus.ERRORS: 3,
            EvaluationStatus.SUCCESS: 2,
            EvaluationStatus.RUNNING: 1,
            EvaluationStatus.PENDING: 0,
        }
        if current_run and current_run.status:
            stored_severity = severity.get(current_run.status, 0)
            if stored_severity > severity.get(run_status, 0):
                run_status = current_run.status

    # When the run reaches a terminal status, it is no longer active. A
    # non-terminal status (RUNNING/PENDING) leaves it active so further slices
    # can continue. Base the flags on the freshly-fetched run so a concurrent
    # slice's flag updates are not lost, and only flip the one field this owns.
    final_flags = (current_run.flags if current_run else None) or run.flags
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
                id=run.id,
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
        # failure — leave its status as-is rather than erroring finalization.
        log.info(
            "[WORKER] finalize skipped: run closed mid-flight",
            run_id=str(run.id),
            run_status=str(run_status),
        )


class APISliceProcessor:
    """API `SliceProcessor`: re-execute the runnable cells in a slice.

    Unlike `process_evaluation_source_slice` (an INGEST loop that creates a new
    scenario per source item), this re-executes EXISTING scenarios addressed by
    a `RunSlice` — the retry / fill-missing / re-run-one-evaluator axis. For
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
        run_slice,
        seed_bindings: Optional[Dict[UUID, ScenarioBinding]] = None,
        refresh_metrics_without_auto_results: bool = True,
        finalize_run_status: bool = True,
    ) -> ProcessSummary:
        """Re-execute scenarios in the slice.

        When `seed_bindings` is supplied (the mint→populate→re-execute ingest
        flows: run/slice), each addressed scenario's source is taken from its
        binding's ALREADY-HYDRATED `ResolvedSourceItem` — no re-read of input
        cells, no per-id trace/testcase re-fetch. Bindings also carry the
        per-scenario `timestamp`/`interval` (live-query temporal coordinates).

        When `seed_bindings` is None (the run-slice retry flow), the source is
        recovered from the scenario's stored input cells as before.
        """
        seed_bindings = seed_bindings or {}
        run_id = run_slice.run_id
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
                scenario_ids=run_slice.scenario_ids,
                step_keys=run_slice.step_keys,
                repeat_idxs=run_slice.repeat_idxs,
            ),
        )
        # Inputs are always needed to rebuild the source binding even when the
        # slice's step_keys exclude them, so probe inputs separately per scenario.
        scenario_ids = (
            sorted(set(run_slice.scenario_ids or []), key=str)
            if run_slice.scenario_ids is not None
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

        requested_steps = set(run_slice.step_keys or [])
        requested_repeats = set(run_slice.repeat_idxs or [])
        force_rerun = run_slice.process_mode == "force"

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

        effective_is_split_value = effective_is_split(
            is_split=bool(run.flags and run.flags.is_split),
            has_application_steps=bool(invocation_steps),
            has_evaluator_steps=bool(annotation_steps),
        )

        # --- Recovery pass (per scenario): resolve each scenario's source,
        # compute its addressed/target cells and reuse, and recover its upstream
        # context. NO execution here — we collect, then run ONE batched slice so
        # the engine's gather+semaphore give cross-scenario concurrency (matching
        # the SDK and the design's process_slice(all scenarios)).
        scenarios_in_order: List[Any] = []
        batch_source_items: List[SdkResolvedSourceItem] = []
        target_keys_by_scenario: Dict[UUID, set] = {}
        context_by_scenario: Dict[UUID, Dict[int, Any]] = {}
        # timestamp/interval are constant across a single process call (seeded:
        # one value from _mint_and_bind; recovered: None), so capture once.
        slice_timestamp: Optional[Any] = None
        slice_interval: Optional[int] = None

        for scenario_id in scenario_ids:
            binding = seed_bindings.get(scenario_id)

            if binding is not None:
                # Seeded (ingest) path: the source is already hydrated in memory,
                # so skip the input-cell read and per-id re-fetch. Fresh scenarios
                # have no prior cells, hence no reuse to account for.
                existing_cell_keys: set = set()
                sdk_source_item = _to_sdk_source_item(binding.source)
                scenario_context = _seed_context_from_source(
                    source_item=binding.source,
                    repeats=run.data.repeats,
                )
                slice_timestamp = binding.timestamp
                slice_interval = binding.interval
            else:
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

                sdk_source_item = await _resolve_source_from_input_cells(
                    project_id=project_id,
                    input_steps=input_steps,
                    cells_by_step=cells_by_step,
                    tracing_service=self.tracing_service,
                    testcases_service=self.testcases_service,
                )
                if sdk_source_item is None:
                    # No populated input for this scenario (no trace_id/testcase_id
                    # to reconstruct from): there is nothing to run, so the line is
                    # skipped — not a failure (which means execution errored).
                    summary.skipped += 1
                    continue
                scenario_context = await _seed_context_by_repeat(
                    project_id=project_id,
                    scenario_cells=input_cells,
                    invocation_step_keys={step.key for step in invocation_steps},
                    tracing_service=self.tracing_service,
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

            scenarios_in_order.append(SimpleNamespace(id=scenario_id))
            batch_source_items.append(sdk_source_item)
            target_keys_by_scenario[scenario_id] = target_keys
            context_by_scenario[scenario_id] = scenario_context
            summary.created += len(target_keys)

        # --- Single batched execution over all recovered scenarios. The engine
        # creates scenarios via the ordered cursor, filters cells per-scenario,
        # and resolves each scenario's recovered context lazily via the callable.
        all_processed: List[Any] = []
        if batch_source_items:

            async def _scenario_context(
                scenario_id: UUID,
                _ctx: Dict[UUID, Dict[int, Any]] = context_by_scenario,
            ) -> Dict[int, Any]:
                return _ctx.get(scenario_id, {})

            def _plan_cell_filter(
                cell: Any,
                _keys: Dict[UUID, set] = target_keys_by_scenario,
            ) -> bool:
                return _cell_key(cell) in _keys.get(cell.scenario_id, set())

            all_processed = await _run_sdk_source_slice(
                project_id=project_id,
                user_id=user_id,
                run=run,
                evaluations_service=self.evaluations_service,
                sdk_source_items=batch_source_items,
                sdk_steps=sdk_steps_all,
                invocation_steps=invocation_steps,
                annotation_steps=annotation_steps,
                runners=runners,
                revisions=revisions,
                # reuse existing scenarios in order; do NOT mint new ones.
                create_scenario=_OrderedScenarios(scenarios_in_order),
                # process is a run-write op: it refreshes the touched scope's
                # metrics incrementally per-scenario (and rolls up), the same as
                # ingest — re-execute no longer opts out with a no-op.
                refresh_metrics=APIMetricsRefresher(
                    project_id=project_id,
                    user_id=user_id,
                    evaluations_service=self.evaluations_service,
                ),
                log_pending=True,
                refresh_metrics_without_auto_results=refresh_metrics_without_auto_results,
                # Seeded scenarios carry the run's temporal coordinates (live
                # query); recovered scenarios already have them on their cells.
                # Constant across the slice, so passed once.
                timestamp=slice_timestamp,
                interval=slice_interval,
                tracing_service=self.tracing_service,
                initial_context_by_repeat=_scenario_context,
                plan_cell_filter=_plan_cell_filter,
            )

            for item in all_processed:
                if item.has_pending:
                    summary.pending += 1
                if item.has_errors:
                    summary.failed += 1

        # Shared "done": write per-scenario status + finalize the run from the
        # touched set — identical to ingest (a re-run IS a run-state change).
        if all_processed:
            await _finalize_run_after_slice(
                project_id=project_id,
                user_id=user_id,
                run=run,
                processed=all_processed,
                evaluations_service=self.evaluations_service,
                finalize_run_status=finalize_run_status,
            )

        log.info(
            "[SLICE] re-execute complete",
            run_id=str(run_id),
            scenarios=len(scenario_ids),
            created=summary.created,
            pending=summary.pending,
            failed=summary.failed,
            skipped=summary.skipped,
            requested_steps=sorted(requested_steps) or None,
            requested_repeats=sorted(requested_repeats) or None,
        )
        return summary


class _OrderedScenarios:
    """`create_scenario` adapter handing back EXISTING scenarios in order.

    The engine calls `create_scenario(run_id)` once per source item; for a
    batched re-execute slice we hand back the recovered scenarios in the order
    their sources were collected, instead of minting new ones — the API analogue
    of the SDK's `_PreMintedScenarios`.

    Order/concurrency: the engine runs scenarios concurrently (gather +
    semaphore), so multiple coroutines call this. `create_scenario` is the FIRST
    statement of the engine's `_process_one` and this body has no `await`, so
    each task runs through the pop synchronously before any real suspension —
    i.e. the pops happen in source-item order, pairing scenario i with source i.
    The lock makes the index increment atomic so the ordering can never degrade
    into a double-hand-out if scheduling shifts.
    """

    def __init__(self, scenarios: List[Any]):
        self._scenarios = list(scenarios)
        self._idx = 0
        self._lock = asyncio.Lock()

    async def __call__(self, run_id: UUID):
        async with self._lock:
            scenario = self._scenarios[self._idx]
            self._idx += 1
            return scenario
