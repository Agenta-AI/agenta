import asyncio
from functools import partial
from typing import Dict, List, Mapping, Optional, Any, Tuple
from types import SimpleNamespace

from uuid import UUID

from agenta.sdk.evaluations.runtime.planner import EvaluationPlanner
from agenta.sdk.evaluations.runtime.processor import (
    process_sources as sdk_process_evaluation_source_slice,
    Concurrency,
    CreateScenario,
    InitialContextSeed,
    PlanCellFilter,
    RefreshMetrics,
)
from agenta.sdk.evaluations.runtime.status import (
    run_status as compute_run_status,
    ProcessedScenario,
)

from oss.src.utils.logging import get_module_logger

from oss.src.core.testcases.service import TestcasesService
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
from oss.src.core.evaluations.runtime.types import (
    EvaluationStep,
    ProcessSummary,
    PlannedCell,
    ResolvedSourceItem,
    ScenarioBinding,
)
from oss.src.core.evaluations.runtime.sources import (
    SourceResolution,
)


log = get_module_logger(__name__)


def _cell_key(cell: Any) -> Tuple[str, int]:
    return cell.step_key, int(cell.repeat_idx or 0)


def _with_resolved_inputs(
    *,
    source_item: ResolvedSourceItem,
) -> ResolvedSourceItem:
    """Return a copy of the source item with its `inputs` defaulted.

    The engine reads `inputs` as the input-step payload; when a testcase source
    carries none, fall back to the testcase's own `.data`. Both the ingest and
    re-execute paths normalize identically, so one helper covers both.
    """
    return source_item.model_copy(
        update={
            "step_key": source_item.step_key or "",
            "inputs": source_item.inputs or getattr(source_item.testcase, "data", None),
        }
    )


def _cell_is_addressed(
    *,
    cell: PlannedCell,
    #
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


def _source_item_from_input_cells(
    *,
    cells_by_step: Dict[str, List[EvaluationResult]],
    input_steps: List[Any],
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
                #
                trace_id=cell.trace_id,
            )
        if cell.testcase_id:
            return ResolvedSourceItem(
                kind="testcase",
                step_key=step.key,
                #
                testcase_id=cell.testcase_id,
            )
    return None


class _BoundResultSetter:
    """Per-slice binder presenting the engine's `ResultSetter.set(cell=...)` seam.

    The engine writes cells context-free; this binds the stateless
    `APIResultSetter` to one slice's request context (project_id/user_id +
    temporal coordinates). It holds no service — only the context and a
    reference to the shared, stateless setter.
    """

    def __init__(
        self,
        setter: APIResultSetter,
        *,
        project_id: UUID,
        user_id: UUID,
        timestamp: Any,
        interval: Optional[int],
    ):
        self._setter = setter
        self._project_id = project_id
        self._user_id = user_id
        self._timestamp = timestamp
        self._interval = interval

    async def set(
        self,
        *,
        cell,
        trace_id=None,
        hash_id=None,
        testcase_id=None,
        error=None,
    ) -> Any:
        return await self._setter.set(
            cell=cell,
            trace_id=trace_id,
            hash_id=hash_id,
            testcase_id=testcase_id,
            error=error,
            project_id=self._project_id,
            user_id=self._user_id,
            timestamp=self._timestamp,
            interval=self._interval,
        )


class _BoundRunner:
    """Per-slice binder presenting the engine's `WorkflowRunner` seam.

    The engine drives runners context-free (`execute(request)` /
    `execute_batch(requests, semaphore)`); this binds the stateless runner to
    one run's execution identity (project_id/user_id). Holds no service — only
    the context and a reference to the shared runner.
    """

    def __init__(
        self,
        runner: Any,
        *,
        project_id: UUID,
        user_id: UUID,
    ):
        self._runner = runner
        self._project_id = project_id
        self._user_id = user_id

    async def execute(self, *, request: Any) -> Any:
        return await self._runner.execute(
            request=request,
            project_id=self._project_id,
            user_id=self._user_id,
        )

    async def execute_batch(self, *, requests: Any, semaphore: Any = None) -> Any:
        return await self._runner.execute_batch(
            requests=requests,
            semaphore=semaphore,
            project_id=self._project_id,
            user_id=self._user_id,
        )


async def _finalize_run_after_slice(
    *,
    project_id: UUID,
    user_id: UUID,
    #
    run: EvaluationRun,
    #
    processed: List[ProcessedScenario],
    run_status_override: Optional[EvaluationStatus] = None,
    finalize_run_status: bool = True,
    #
    evaluations_service: EvaluationsService,
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
        #
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

    # Full-PUT off the current run; only status and is_active are finalize's to set.
    _run = current_run or run
    try:
        await evaluations_service.edit_run(
            project_id=project_id,
            user_id=user_id,
            #
            run=EvaluationRunEdit(
                id=_run.id,
                #
                name=_run.name,
                description=_run.description,
                #
                flags=final_flags,
                tags=_run.tags,
                meta=_run.meta,
                #
                status=run_status,
                #
                data=_run.data,
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
        tracing_service: Optional[TracingService] = None,
        testcases_service: Optional[TestcasesService] = None,
        workflows_service: Optional[WorkflowsService] = None,
        evaluations_service: EvaluationsService,
    ):
        self.tracing_service = tracing_service
        self.testcases_service = testcases_service
        self.workflows_service = workflows_service
        self.evaluations_service = evaluations_service

        # Stateless collaborators, built ONCE here and reused across every
        # slice. The per-slice request context (project_id/user_id/timestamp)
        # is bound at the call boundary via the _Bound* binders / partial.
        self._sources = SourceResolution(
            testcases_service=testcases_service,
            tracing_service=tracing_service,
        )
        self._scenario_editor = APIScenarioEditor(
            evaluations_service=evaluations_service,
        )
        self._result_setter = APIResultSetter(
            evaluations_service=evaluations_service,
        )
        self._metrics_refresher = APIMetricsRefresher(
            evaluations_service=evaluations_service,
        )
        self._trace_fetcher = (
            APITraceFetcher(tracing_service=tracing_service)
            if tracing_service is not None
            else None
        )

    async def _seed_context_by_repeat(
        self,
        *,
        project_id: UUID,
        #
        scenario_cells: List[EvaluationResult],
        invocation_step_keys: set[str],
    ) -> Dict[int, Dict[str, Any]]:
        trace_ids_by_repeat = {
            int(cell.repeat_idx or 0): cell.trace_id
            for cell in scenario_cells
            if cell.step_key in invocation_step_keys and cell.trace_id
        }
        if not trace_ids_by_repeat:
            return {}

        hydrated = await self._sources.resolve_direct_source_items(
            project_id=project_id,
            #
            trace_ids=list(dict.fromkeys(trace_ids_by_repeat.values())),
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
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run: EvaluationRun,
        #
        invocation_steps: List[Any],
        annotation_steps: List[Any],
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
            if self.workflows_service is None:
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
            application_revision = await self.workflows_service.fetch_workflow_revision(
                project_id=project_id,
                #
                workflow_revision_ref=application_revision_ref,
            )
            if application_revision is None:
                raise ValueError(
                    f"App revision with id {application_revision_ref.id} not found!"
                )
            runners[invocation_step.key] = _BoundRunner(
                APICachedRunner(
                    runner=APIWorkflowRunner(workflows_service=self.workflows_service),
                    #
                    enabled=bool(run.flags and run.flags.is_cached),
                    #
                    tracing_service=self.tracing_service,
                ),
                project_id=project_id,
                user_id=user_id,
            )
            revisions[invocation_step.key] = application_revision

        auto_annotation_steps = [
            step for step in annotation_steps if step.origin not in {"human", "custom"}
        ]
        if auto_annotation_steps and self.workflows_service is None:
            raise ValueError("workflows_service is required for auto annotation steps")
        for annotation_step in auto_annotation_steps:
            evaluator_revision_ref = (annotation_step.references or {}).get(
                "evaluator_revision"
            )
            evaluator_revision = (
                await self.workflows_service.fetch_workflow_revision(  # type: ignore[union-attr]
                    project_id=project_id,
                    #
                    workflow_revision_ref=evaluator_revision_ref,
                )
                if evaluator_revision_ref
                else None
            )
            if evaluator_revision is None:
                continue
            runners[annotation_step.key] = _BoundRunner(
                APICachedRunner(
                    runner=APIWorkflowRunner(workflows_service=self.workflows_service),
                    #
                    enabled=bool(run.flags and run.flags.is_cached),
                    #
                    tracing_service=self.tracing_service,
                ),
                project_id=project_id,
                user_id=user_id,
            )
            revisions[annotation_step.key] = evaluator_revision

        return runners, revisions

    async def _resolve_source_from_input_cells(
        self,
        *,
        project_id: UUID,
        #
        cells_by_step: Dict[str, List[EvaluationResult]],
        input_steps: List[Any],
    ) -> Optional[ResolvedSourceItem]:
        """The input-cache ladder: recover a scenario's source from its stored cell.

        A scenario that already exists carries its source identity in its input
        result cell (a `trace_id` or `testcase_id`). This reads that id back and
        re-hydrates the trace/testcase payload — the same data the original run
        resolved — so cache reuse and evaluator inputs match. Returns None when the
        scenario has no usable input cell (nothing to reconstruct from); the caller
        treats that as "must be populated first".
        """
        source_item = _source_item_from_input_cells(
            cells_by_step=cells_by_step,
            input_steps=input_steps,
        )
        if source_item is None:
            return None

        hydrated = await self._sources.resolve_direct_source_items(
            project_id=project_id,
            #
            trace_ids=[source_item.trace_id] if source_item.trace_id else None,
            testcase_ids=[source_item.testcase_id] if source_item.testcase_id else None,
        )
        resolved = hydrated[0] if hydrated else source_item
        resolved.step_key = source_item.step_key
        return _with_resolved_inputs(source_item=resolved)

    async def _run_sdk_source_slice(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run: EvaluationRun,
        #
        steps: List[EvaluationStep],
        #
        source_items: List[ResolvedSourceItem],
        #
        revisions: Mapping[str, Any],
        #
        runners: Mapping[str, Any],
        #
        timestamp: Optional[Any] = None,
        interval: Optional[int] = None,
        #
        create_scenario: CreateScenario,
        refresh_metrics: RefreshMetrics,
        #
        should_set_pending: bool,
        should_refresh_metrics: bool = True,
        #
        plan_cell_filter: Optional[PlanCellFilter] = None,
        initial_context_seed: Optional[InitialContextSeed] = None,
    ) -> List[ProcessedScenario]:
        """The single execution call: drive the SDK engine over a source slice.

        Both the ingest path (NEW scenarios from source ids) and the re-execute path
        (EXISTING scenarios by coordinate) funnel through here. They differ only in
        the injected seams: the scenario factory (create vs reuse), the metrics
        refresher (inline vs deferred), `should_set_pending`, the cell filter, and the
        per-repeat context seed. Everything else is intrinsic to `run` + services
        and identical for both, so it lives here once.

        The data-seam adapters are built once on the processor (`self._*`); only the
        per-slice request context is bound here via the cheap `_Bound*` / partial
        wrappers so the engine can drive them through its context-free seams.
        """
        return await sdk_process_evaluation_source_slice(
            run_id=run.id,
            #
            steps=steps,
            repeats=run.data.repeats if run.data and run.data.repeats else 1,
            #
            source_items=source_items,
            #
            revisions=revisions,
            #
            runners=runners,
            #
            create_scenario=create_scenario,
            edit_scenario=partial(
                self._scenario_editor,
                project_id=project_id,
                user_id=user_id,
            ),
            set_results=_BoundResultSetter(
                self._result_setter,
                project_id=project_id,
                user_id=user_id,
                timestamp=timestamp,
                interval=interval,
            ),
            refresh_metrics=refresh_metrics,
            fetch_trace=(
                partial(self._trace_fetcher, project_id=project_id)
                if self._trace_fetcher is not None
                else None
            ),
            #
            is_split=effective_is_split(
                is_split=bool(run.flags and run.flags.is_split),
                #
                has_application_steps=any(step.type == "invocation" for step in steps),
                has_evaluator_steps=any(step.type == "annotation" for step in steps),
            ),
            should_set_pending=should_set_pending,
            should_refresh_metrics=should_refresh_metrics,
            #
            concurrency=(
                Concurrency(
                    batch_size=run.data.concurrency.batch_size,
                    max_retries=run.data.concurrency.max_retries,
                    retry_delay=run.data.concurrency.retry_delay,
                )
                if run.data and run.data.concurrency
                else None
            ),
            #
            plan_cell_filter=plan_cell_filter,
            initial_context_seed=initial_context_seed,
        )

    async def process(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run_slice,
        seed_bindings: Optional[Dict[UUID, ScenarioBinding]] = None,
        #
        should_refresh_metrics: bool = True,
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
            #
            result=EvaluationResultQuery(
                run_id=run_id,
                #
                scenario_ids=run_slice.scenario_ids,
                step_keys=run_slice.step_keys,
                repeat_idxs=run_slice.repeat_idxs,
            ),
        )
        # Inputs are always needed to rebuild the source binding even when the
        # slice's step_keys exclude them, so this fetch omits step_keys (unlike
        # the slice-scoped `existing` probe above).
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

        # One batched input fetch for all non-seeded scenarios, grouped in memory:
        # a per-scenario query here is N round trips on a rerun over many scenarios.
        non_seeded_ids = [
            scenario_id
            for scenario_id in scenario_ids
            if seed_bindings.get(scenario_id) is None
        ]
        input_cells_by_scenario: Dict[UUID, List[EvaluationResult]] = {}
        if non_seeded_ids:
            recovered_cells = await self.evaluations_service.query_results(
                project_id=project_id,
                #
                result=EvaluationResultQuery(
                    run_id=run_id,
                    #
                    scenario_ids=non_seeded_ids,
                ),
            )
            for cell in recovered_cells:
                input_cells_by_scenario.setdefault(cell.scenario_id, []).append(cell)

        runners, revisions = await self._resolve_runners_and_revisions(
            project_id=project_id,
            user_id=user_id,
            #
            run=run,
            #
            invocation_steps=invocation_steps,
            annotation_steps=annotation_steps,
        )

        requested_steps = set(run_slice.step_keys or [])
        requested_repeats = set(run_slice.repeat_idxs or [])
        force_rerun = run_slice.overwrite

        steps_all = [
            EvaluationStep(
                key=step.key,
                type=step.type,
                origin=step.origin,
                #
                references=step.references or {},
                #
                inputs=[step_input.key for step_input in (step.inputs or [])],
            )
            for step in steps
        ]

        summary = ProcessSummary()

        effective_is_split_value = effective_is_split(
            is_split=bool(run.flags and run.flags.is_split),
            #
            has_application_steps=bool(invocation_steps),
            has_evaluator_steps=bool(annotation_steps),
        )

        # --- Recovery pass (per scenario): resolve each scenario's source,
        # compute its addressed/target cells and reuse, and recover its upstream
        # context. NO execution here — we collect, then run ONE batched slice so
        # the engine's gather+semaphore give cross-scenario concurrency (matching
        # the SDK and the design's process_slice(all scenarios)).
        scenarios_in_order: List[Any] = []
        batch_source_items: List[ResolvedSourceItem] = []
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
                source_item = _with_resolved_inputs(source_item=binding.source)
                scenario_context = _seed_context_from_source(
                    source_item=binding.source,
                    repeats=run.data.repeats,
                )
                slice_timestamp = binding.timestamp
                slice_interval = binding.interval
            else:
                input_cells = input_cells_by_scenario.get(scenario_id, [])
                cells_by_step: Dict[str, List[EvaluationResult]] = {}
                for cell in input_cells:
                    cells_by_step.setdefault(cell.step_key, []).append(cell)
                existing_cell_keys = {_cell_key(cell) for cell in input_cells}

                source_item = await self._resolve_source_from_input_cells(
                    project_id=project_id,
                    #
                    input_steps=input_steps,
                    cells_by_step=cells_by_step,
                )
                if source_item is None:
                    # No populated input for this scenario (no trace_id/testcase_id
                    # to reconstruct from): there is nothing to run, so the line is
                    # skipped — not a failure (which means execution errored).
                    summary.skipped += 1
                    continue
                scenario_context = await self._seed_context_by_repeat(
                    project_id=project_id,
                    #
                    scenario_cells=input_cells,
                    invocation_step_keys={step.key for step in invocation_steps},
                )
            preview_plan = EvaluationPlanner().plan(
                run_id=run_id,
                #
                steps=steps_all,
                repeats=run.data.repeats,
                #
                scenario_id=scenario_id,
                source=source_item,
                #
                is_split=effective_is_split_value,
            )
            addressed_cells = [
                cell
                for cell in preview_plan.cells
                if _cell_is_addressed(
                    cell=cell,
                    #
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
            batch_source_items.append(source_item)
            target_keys_by_scenario[scenario_id] = target_keys
            context_by_scenario[scenario_id] = scenario_context
            summary.created += len(target_keys)

        # --- Single batched execution over all recovered scenarios. The engine
        # creates scenarios via the ordered cursor, filters cells per-scenario,
        # and resolves each scenario's recovered context lazily via the callable.
        all_processed: List[ProcessedScenario] = []
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

            all_processed = await self._run_sdk_source_slice(
                project_id=project_id,
                user_id=user_id,
                #
                run=run,
                #
                steps=steps_all,
                #
                source_items=batch_source_items,
                #
                revisions=revisions,
                #
                runners=runners,
                #
                # Seeded scenarios carry the run's temporal coordinates (live
                # query); recovered scenarios already have them on their cells.
                # Constant across the slice, so passed once.
                timestamp=slice_timestamp,
                interval=slice_interval,
                # reuse existing scenarios in order; do NOT mint new ones.
                create_scenario=_OrderedScenarios(scenarios_in_order),
                # process is a run-write op: it refreshes the touched scope's
                # metrics incrementally per-scenario (and rolls up), the same as
                # ingest — re-execute no longer opts out with a no-op. The
                # refresher is stateless; the request ctx binds via partial so
                # the engine can call it context-free as refresh_metrics(run_id,
                # scenario_id).
                refresh_metrics=partial(
                    self._metrics_refresher,
                    project_id=project_id,
                    user_id=user_id,
                ),
                should_set_pending=True,
                should_refresh_metrics=should_refresh_metrics,
                #
                initial_context_seed=_scenario_context,
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
                #
                run=run,
                #
                processed=all_processed,
                #
                finalize_run_status=finalize_run_status,
                #
                evaluations_service=self.evaluations_service,
            )

        log.info(
            "[SLICE] re-execute complete",
            run_id=str(run_id),
            #
            scenarios=len(scenario_ids),
            #
            created=summary.created,
            pending=summary.pending,
            failed=summary.failed,
            skipped=summary.skipped,
            #
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

    async def __call__(self, *, run_id: UUID):
        async with self._lock:
            scenario = self._scenarios[self._idx]
            self._idx += 1
            return scenario
