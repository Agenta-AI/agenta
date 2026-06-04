from datetime import datetime, timezone
from typing import Any, List, Literal, Optional
from uuid import UUID

from oss.src.core.evaluations.runtime.types import (
    ResolvedSourceItem,
    ScenarioBinding,
    RunSlice,
)
from oss.src.core.evaluations.runtime.operations import SliceOperations
from oss.src.core.evaluations.runtime.topology import classify_run_topology
from oss.src.core.evaluations.runtime.sources import (
    SourceResolution,
)
from oss.src.core.evaluations.runtime.adapters import (
    APIScenarioCreator,
)
from oss.src.core.evaluations.service import EvaluationsService
from oss.src.core.evaluations.types import (
    EvaluationRun,
    EvaluationRunEdit,
    EvaluationRunFlags,
    EvaluationStatus,
)
from oss.src.core.evaluations.tasks.processor import APISliceProcessor
from oss.src.core.queries.service import QueriesService
from oss.src.core.testcases.service import TestcasesService
from oss.src.core.testsets.service import TestsetsService
from oss.src.core.tracing.service import TracingService
from oss.src.core.workflows.service import WorkflowsService
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

EvaluationSliceSource = Literal["traces", "testcases"]


def _input_step_keys(run: EvaluationRun) -> List[str]:
    return [step.key for step in run.data.steps if step.type == "input"]


# =============================================================================
# RunProcessor — the worker-side orchestrator for a run's source flows.
#
# The services are injected ONCE in __init__ (the composition root builds it);
# every method reads them off `self` instead of threading them through call
# signatures. The shared `APISliceProcessor` / `SliceOperations` are built once
# here too.
#
# Every flow is: validate run -> resolve+mint+bind (the per-flow seam) ->
# re-execute via the slice processor with the hydrated source seeded in ->
# finalize. The only thing that differs per flow is HOW source items are
# produced; the mint/bind/execute/finalize machinery is shared. The input cell
# is written once, by the SDK on execute — not pre-written.
# =============================================================================


class RunProcessor:
    def __init__(
        self,
        *,
        evaluations_service: EvaluationsService,
        tracing_service: TracingService,
        testcases_service: TestcasesService,
        workflows_service: WorkflowsService,
        testsets_service: TestsetsService,
        queries_service: QueriesService,
    ):
        self.evaluations_service = evaluations_service
        self.tracing_service = tracing_service
        self.testcases_service = testcases_service
        self.workflows_service = workflows_service
        self.testsets_service = testsets_service
        self.queries_service = queries_service

        # Source resolution gets its services here too, instead of having them
        # threaded through every resolve call.
        self._sources = SourceResolution(
            queries_service=queries_service,
            testsets_service=testsets_service,
            testcases_service=testcases_service,
            tracing_service=tracing_service,
        )

        # Stateless: holds only the service; the request context
        # (project_id/user_id/...) is passed per create() call.
        self._scenario_creator = APIScenarioCreator(
            evaluations_service=evaluations_service,
        )

        # Built once; the seams (create vs reuse scenarios, etc.) are passed
        # per-call on `process`, not at construction.
        self._slice_processor = APISliceProcessor(
            evaluations_service=evaluations_service,
            tracing_service=tracing_service,
            testcases_service=testcases_service,
            workflows_service=workflows_service,
        )
        self._slice_operations = SliceOperations(
            slice_processor=self._slice_processor,
            evaluations_service=evaluations_service,
        )

    # --- shared machinery ---------------------------------------------------

    async def _fetch_validated_run(
        self,
        *,
        project_id: UUID,
        run_id: UUID,
        require: bool = False,
    ) -> Optional[EvaluationRun]:
        """Fetch a run and assert it has executable steps.

        `require=False` (default) returns None on a missing/empty run so the
        caller can warn-and-skip; `require=True` raises so a pre-execution error
        finalizes the run to FAILURE through the caller's handler.
        """
        run = await self.evaluations_service.fetch_run(
            project_id=project_id,
            run_id=run_id,
        )
        if not run or not run.data or not run.data.steps:
            if require:
                raise ValueError(f"Evaluation run with id {run_id} not found or empty!")
            return None
        return run

    async def _mint_and_bind(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run: EvaluationRun,
        #
        source_items: List[ResolvedSourceItem],
        default_step_key: str,
        #
        timestamp: Optional[datetime],
        interval: Optional[int],
    ) -> List[ScenarioBinding]:
        """Bulk-mint one scenario per source item and bind its hydrated source.

        Shared by every ingest flow. The source item is ALREADY hydrated (the
        resolver fetched the trace/testcase once), so the returned bindings carry
        it straight into the executor — no re-read, no per-id re-fetch downstream.

        The input cell is NOT written here. The SDK slice loop logs the input
        step first (before any runnable cell), writing the same
        `trace_id`/`testcase_id` and temporal coordinates via `APIResultSetter`.
        Pre-writing it here would just be overwritten by that log — a redundant
        DB round-trip per scenario. The durable input cell a later run-slice
        retry recovers from is the SDK's.
        """
        if not source_items:
            return []

        scenarios = await self._scenario_creator.create(
            project_id=project_id,
            user_id=user_id,
            #
            run_id=run.id,
            #
            count=len(source_items),
            #
            timestamp=timestamp,
            interval=interval,
        )

        bindings: List[ScenarioBinding] = []
        for scenario, source_item in zip(scenarios, source_items):
            step_key = source_item.step_key or default_step_key
            bound_source = source_item.model_copy(update={"step_key": step_key})
            bindings.append(
                ScenarioBinding(
                    scenario_id=scenario.id,
                    source=bound_source,
                    #
                    timestamp=timestamp,
                    interval=interval,
                )
            )
        return bindings

    async def _execute_bindings(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run_id: UUID,
        #
        bindings: List[ScenarioBinding],
        #
        should_refresh_metrics: bool = True,
        finalize_run_status: bool = True,
    ) -> None:
        """Re-execute freshly-minted scenarios with their hydrated source seeded in.

        `overwrite=True` because the scenarios are new: their runnable cells must
        be filled even though no result exists yet. `APISliceProcessor` owns
        per-scenario status writes and run finalization for terminal status.

        `should_refresh_metrics=False` (the query flow) skips the metric refresh
        for scenarios that produced no auto results — e.g. a live run whose only
        annotation step is human — matching the legacy query loop.

        `finalize_run_status=False` (the LIVE query flow) leaves the run RUNNING
        and active so the scheduler keeps polling; batch/testset runs finalize.
        """
        await self._slice_processor.process(
            project_id=project_id,
            user_id=user_id,
            #
            run_slice=RunSlice(
                run_id=run_id,
                scenario_ids=[binding.scenario_id for binding in bindings],
                overwrite=True,
            ),
            seed_bindings={binding.scenario_id: binding for binding in bindings},
            #
            should_refresh_metrics=should_refresh_metrics,
            finalize_run_status=finalize_run_status,
        )

    async def _finalize_run_terminal(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run_id: UUID,
        #
        status: EvaluationStatus,
    ) -> None:
        """Flip a run to a terminal status + inactive, tolerating a vanished run.

        Used for the two cases the slice processor's own finalize never sees: an
        empty result set (nothing to execute) and a pre-execution error.
        Re-fetches the run so it does not clobber concurrent flag updates.
        """
        try:
            current = await self.evaluations_service.fetch_run(
                project_id=project_id,
                #
                run_id=run_id,
            )
            if not current:
                return
            flags = (
                current.flags.model_copy() if current.flags else EvaluationRunFlags()
            )
            flags.is_active = False
            await self.evaluations_service.edit_run(
                project_id=project_id,
                user_id=user_id,
                #
                run=EvaluationRunEdit(
                    id=run_id,
                    #
                    name=current.name,
                    description=current.description,
                    #
                    flags=flags,
                    tags=current.tags,
                    meta=current.meta,
                    #
                    status=status,
                    #
                    data=current.data,
                ),
            )
        except Exception as finalize_error:  # pylint: disable=broad-exception-caught
            # Best-effort: a run closed mid-flight or vanished must not mask the
            # original outcome.
            log.error(
                "[EVAL] failed to finalize run",
                run_id=str(run_id),
                status=str(status),
                error=str(finalize_error),
            )

    # --- entry point 1: run_from_source — orchestrate a run by topology -----

    async def run_from_source(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run_id: UUID,
        #
        newest: Optional[datetime] = None,
        oldest: Optional[datetime] = None,
    ) -> bool:
        run = await self._fetch_validated_run(
            project_id=project_id,
            #
            run_id=run_id,
        )
        if not run:
            log.warning("[EVAL] [process-run] run not found or empty", run_id=run_id)
            return False

        topology = classify_run_topology(run)
        dispatch = topology.dispatch

        if dispatch and dispatch.source == "query":
            # Batch query runs window from the query revision's own bounds, not
            # the scheduler tick — so the tick's newest/oldest are dropped. Live
            # runs carry the tick's range for temporal bucketing.
            use_windowing = dispatch.mode == "batch"
            await self._run_query_source(
                project_id=project_id,
                user_id=user_id,
                #
                run=run,
                #
                newest=None if use_windowing else newest,
                oldest=None if use_windowing else oldest,
                #
                use_windowing=use_windowing,
            )
            return True

        if dispatch and dispatch.source == "testset" and dispatch.mode == "batch":
            await self._run_testset_source(
                project_id=project_id,
                user_id=user_id,
                #
                run=run,
            )
            return True

        if dispatch and dispatch.mode == "queue":
            # An open queue: direct trace/testcase batches arrive later via
            # run_from_batch and each finalizes its own scenarios. There is
            # nothing to execute at run-start; leave the run RUNNING and active.
            log.info(
                "[EVAL] [process-run] queue run started; awaiting batches",
                run_id=str(run.id),
            )
            return True

        log.warning(
            "[EVAL] [process-run] unsupported run topology",
            run_id=run_id,
            topology=topology.label,
            topology_status=topology.status,
            reason=topology.reason,
        )
        return False

    async def _run_testset_source(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run: EvaluationRun,
    ) -> None:
        """Resolve testset rows -> mint -> populate -> re-execute.

        Batch (non-live) runs finalize: an empty testset goes straight to SUCCESS
        so it does not hang RUNNING; a pre-execution error goes to FAILURE.

        No testcase re-fetch is needed: the testset revision already carries the
        full testcases, so the source items are hydrated up front.
        """
        try:
            input_steps = [step for step in run.data.steps if step.type == "input"]
            input_specs = await self._sources.resolve_testset_input_specs(
                project_id=project_id,
                #
                input_steps=input_steps,
            )
            source_items = [
                ResolvedSourceItem(
                    kind="testcase",
                    #
                    step_key=input_spec.step_key,
                    #
                    references={
                        "testcase": {"id": str(testcase.id)},
                        "testset": {"id": str(input_spec.testset_revision.testset_id)},
                        "testset_variant": {
                            "id": str(input_spec.testset_revision.variant_id)
                        },
                        "testset_revision": {"id": str(input_spec.testset_revision.id)},
                    },
                    #
                    testcase_id=testcase.id,
                    testcase=testcase,
                    #
                    inputs=testcase_data,
                )
                for input_spec in input_specs
                for testcase, testcase_data in zip(
                    input_spec.testcases,
                    input_spec.testcases_data,
                )
            ]
        except Exception as e:  # pylint: disable=broad-exception-caught
            log.error("[EVAL] [process-run] testset resolution failed", error=str(e))
            await self._finalize_run_terminal(
                project_id=project_id,
                user_id=user_id,
                #
                run_id=run.id,
                #
                status=EvaluationStatus.FAILURE,
            )
            return

        if not source_items:
            await self._finalize_run_terminal(
                project_id=project_id,
                user_id=user_id,
                #
                run_id=run.id,
                #
                status=EvaluationStatus.SUCCESS,
            )
            return

        try:
            bindings = await self._mint_and_bind(
                project_id=project_id,
                user_id=user_id,
                #
                run=run,
                #
                source_items=source_items,
                #
                default_step_key=(
                    _input_step_keys(run)[0] if _input_step_keys(run) else ""
                ),
                #
                timestamp=None,
                interval=None,
            )
            await self._execute_bindings(
                project_id=project_id,
                user_id=user_id,
                #
                run_id=run.id,
                #
                bindings=bindings,
            )
        except Exception as e:  # pylint: disable=broad-exception-caught
            log.error("[EVAL] [process-run] testset execution failed", error=str(e))
            await self._finalize_run_terminal(
                project_id=project_id,
                user_id=user_id,
                #
                run_id=run.id,
                #
                status=EvaluationStatus.FAILURE,
            )

    async def _run_query_source(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run: EvaluationRun,
        #
        newest: Optional[datetime],
        oldest: Optional[datetime],
        #
        use_windowing: bool,
    ) -> None:
        """Resolve query traces -> mint -> populate -> re-execute, per query step.

        timestamp/interval are TEMPORAL coordinates and only meaningful for LIVE
        runs (use_windowing=False), which bucket metrics over time. Batch query
        runs (use_windowing=True) have no temporal axis, so they stay None.

        Batch query runs finalize (empty -> SUCCESS, error -> FAILURE). Live runs
        intentionally never finalize — the scheduler keeps polling — so an empty
        tick or an error leaves the run untouched.
        """
        timestamp: Optional[datetime] = None
        interval: Optional[int] = None
        if not use_windowing:
            timestamp = oldest or datetime.now(timezone.utc)
            if newest and oldest:
                interval = int((newest - oldest).total_seconds() / 60)

        finalize = use_windowing

        try:
            source_items_by_step = await self._sources.resolve_query_source_items(
                project_id=project_id,
                #
                run=run,
                #
                newest=newest,
                oldest=oldest,
                #
                use_windowing=use_windowing,
            )
            total = sum(len(items) for items in source_items_by_step.values())

            if total == 0:
                # Live run: just wait for the next tick. Batch run: finalize
                # SUCCESS so it does not hang RUNNING.
                if finalize:
                    await self._finalize_run_terminal(
                        project_id=project_id,
                        user_id=user_id,
                        #
                        run_id=run.id,
                        #
                        status=EvaluationStatus.SUCCESS,
                    )
                return

            for step_key, source_items in source_items_by_step.items():
                if not source_items:
                    continue
                bindings = await self._mint_and_bind(
                    project_id=project_id,
                    user_id=user_id,
                    #
                    run=run,
                    #
                    source_items=source_items,
                    default_step_key=step_key,
                    #
                    timestamp=timestamp,
                    interval=interval,
                )
                await self._execute_bindings(
                    project_id=project_id,
                    user_id=user_id,
                    #
                    run_id=run.id,
                    #
                    bindings=bindings,
                    #
                    # Query runs only refresh metrics when auto results were
                    # created (a human-only live tick produces none) — matches
                    # the legacy query loop's should_refresh_metrics=False.
                    should_refresh_metrics=False,
                    # Live runs (finalize=False) keep ticking; batch runs finalize.
                    finalize_run_status=finalize,
                )
        except Exception as e:  # pylint: disable=broad-exception-caught
            log.error("[EVAL] [process-run] query flow failed", error=str(e))
            # A pre-execution error in a batch run never reaches the slice's own
            # finalize, so flip it to FAILURE here. Live runs keep ticking.
            if finalize:
                await self._finalize_run_terminal(
                    project_id=project_id,
                    user_id=user_id,
                    #
                    run_id=run.id,
                    #
                    status=EvaluationStatus.FAILURE,
                )

    # --- entry point 2: run_from_batch — ingest a DIRECT id batch -----------
    #
    # Ingest a batch of explicit trace_ids / testcase_ids into an open queue
    # run. Same mint -> populate -> re-execute as the run flows; the only
    # difference is the source comes from explicit ids.

    async def run_from_batch(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run_id: UUID,
        #
        source_kind: EvaluationSliceSource,
        #
        input_step_key: Optional[str] = None,
        #
        trace_ids: Optional[list[str]] = None,
        testcase_ids: Optional[list[UUID]] = None,
    ) -> bool:
        """Ingest a batch of DIRECT source ids (trace_ids / testcase_ids).

        NOTE: not idempotent. There is no dedup on source id, so dispatching the
        SAME batch twice mints a second set of scenarios for the same ids. The
        task is allow_concurrency=True, so a re-dispatch with a fresh job id also
        bypasses the singleton run lock. Acceptable today because batches are
        dispatched once per ingest.
        """
        if source_kind == "traces":
            ids: List[Any] = list(trace_ids or [])
        elif source_kind == "testcases":
            ids = list(testcase_ids or [])
        else:
            log.warning(
                "[EVAL] [process-slice] unsupported source kind",
                run_id=run_id,
                source_kind=source_kind,
            )
            return False

        if not ids:
            return True

        run = await self._fetch_validated_run(
            project_id=project_id,
            #
            run_id=run_id,
        )
        if not run:
            log.warning(
                "[EVAL] [process-slice] run not found or has no steps", run_id=run_id
            )
            return False

        input_keys = _input_step_keys(run)
        step_key = input_step_key or (input_keys[0] if input_keys else None)
        if step_key is None:
            log.warning("[EVAL] [process-slice] run has no input step", run_id=run_id)
            return False

        # Resolve the direct ids into hydrated source items (one batched fetch
        # for testcases; per-id for traces — same as before, but now only once).
        source_items = await self._sources.resolve_direct_source_items(
            project_id=project_id,
            #
            trace_ids=list(trace_ids or []) if source_kind == "traces" else None,
            testcase_ids=(
                list(testcase_ids or []) if source_kind == "testcases" else None
            ),
        )
        for source_item in source_items:
            source_item.step_key = step_key

        bindings = await self._mint_and_bind(
            project_id=project_id,
            user_id=user_id,
            #
            run=run,
            #
            source_items=source_items,
            default_step_key=step_key,
            #
            timestamp=None,
            interval=None,
        )
        await self._execute_bindings(
            project_id=project_id,
            user_id=user_id,
            #
            run_id=run_id,
            #
            bindings=bindings,
        )
        return True

    # --- entry point 3: rerun — re-execute EXISTING scenarios ---------------
    #
    # Re-execute EXISTING scenarios by coordinate. No mint; the source is
    # RECOVERED from stored input cells (no seed_bindings). Owns the
    # aggregate-metrics boundary the ingest flows don't.

    async def rerun(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run_id: UUID,
        #
        scenario_ids: Optional[List[UUID]] = None,
        step_keys: Optional[List[str]] = None,
        repeat_idxs: Optional[List[int]] = None,
        #
        overwrite: bool = False,
    ) -> bool:
        """Re-execute EXISTING scenarios addressed by a run coordinate slice.

        The coordinate counterpart of the ingest flows: it re-runs the runnable
        cells of scenarios that already exist (retry, fill-missing, or run a
        newly-added step). It rebuilds each scenario's source from its stored
        input cell rather than receiving a hydrated one — so NO seed_bindings.

        `process` is results-only by design; this entry point owns the metrics
        `refresh` boundary, invoking it after execution over the same slice scope.
        """
        run_slice = RunSlice(
            run_id=run_id,
            #
            scenario_ids=scenario_ids,
            step_keys=step_keys,
            repeat_idxs=repeat_idxs,
            #
            overwrite=overwrite,
        )

        await self._slice_operations.process(
            project_id=project_id,
            user_id=user_id,
            #
            run_slice=run_slice,
        )

        # Metrics boundary for the slice. `refresh` recomputes both the
        # per-scenario (variational) rows and the AGGREGATE the slice affected —
        # temporal buckets for live runs, the global row for non-live. `process`
        # already refreshed variational inline; recomputing it is idempotent.
        await self._slice_operations.refresh(
            project_id=project_id,
            user_id=user_id,
            #
            run_slice=run_slice,
        )
        return True
