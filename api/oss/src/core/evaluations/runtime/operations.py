from typing import List, Optional, Protocol
from uuid import UUID

from oss.src.core.evaluations.runtime.models import (
    ProcessSummary,
    RunProbeSummary,
    RunSlice,
)
from oss.src.core.evaluations.types import (
    EvaluationMetricsRefresh,
    EvaluationResult,
    EvaluationResultCreate,
    EvaluationResultQuery,
    EvaluationScenarioQuery,
    EvaluationStatus,
)


def _empty_dimension(values: Optional[List[object]]) -> bool:
    return values == []


def _slice_is_empty(run_slice: RunSlice) -> bool:
    return any(
        _empty_dimension(values)
        for values in (
            run_slice.scenario_ids,
            run_slice.step_keys,
            run_slice.repeat_idxs,
        )
    )


def _query_from_slice(run_slice: RunSlice) -> EvaluationResultQuery:
    return EvaluationResultQuery(
        run_id=run_slice.run_id,
        scenario_ids=run_slice.scenario_ids,
        step_keys=run_slice.step_keys,
        repeat_idxs=run_slice.repeat_idxs,
    )


class SliceProcessor(Protocol):
    """Execution boundary for `process(slice)`.

    A slice processor takes the canonical output coordinate (existing
    scenarios x steps x repeats) and re-executes the runnable cells in that
    scope: it plans from the scenarios' existing source bindings, restricts to
    the requested `step_keys`/`repeat_idxs`, invokes only missing work, and
    populates the result cells. It does NOT refresh metrics — that is the
    separate `refresh` op, invoked by the caller on the right boundary.

    It is deliberately adapter-free at this seam so `runtime/` does not depend on
    `tasks/`: the concrete implementation (which closes over the tracing /
    testcases / workflows / applications services and the run's revisions) is
    wired at the composition root and injected here. The same shape lets the SDK
    or an in-memory test supply its own processor without changing run operations.
    """

    async def process(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        run_slice: RunSlice,
    ) -> ProcessSummary: ...


class SliceOperations:
    def __init__(
        self,
        *,
        evaluations_service,
        slice_processor: Optional[SliceProcessor] = None,
    ):
        self.evaluations_service = evaluations_service
        self.slice_processor = slice_processor

    async def probe(
        self,
        *,
        project_id: UUID,
        run_slice: RunSlice,
    ) -> List[EvaluationResult]:
        if _slice_is_empty(run_slice):
            return []

        return await self.evaluations_service.query_results(
            project_id=project_id,
            result=_query_from_slice(run_slice),
        )

    async def populate(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        results: List[EvaluationResultCreate],
    ) -> List[EvaluationResult]:
        # `populate` only writes result cells. Metrics are a separate operation
        # (`refresh`): the three metric kinds refresh on different boundaries
        # (scenario-complete / interval / run), so the caller decides when.
        if not results:
            return []

        return await self.evaluations_service.set_results(
            project_id=project_id,
            user_id=user_id,
            results=results,
        )

    async def probe_summary(
        self,
        *,
        project_id: UUID,
        run_slice: RunSlice,
        expected_count: Optional[int] = None,
    ) -> RunProbeSummary:
        results = await self.probe(
            project_id=project_id,
            run_slice=run_slice,
        )
        existing_count = len(results)
        expected = expected_count if expected_count is not None else existing_count

        return RunProbeSummary(
            existing_count=existing_count,
            missing_count=max(0, expected - existing_count),
            success_count=sum(
                1 for result in results if result.status == EvaluationStatus.SUCCESS
            ),
            failure_count=sum(
                1
                for result in results
                if result.status
                in {
                    EvaluationStatus.FAILURE,
                    EvaluationStatus.ERRORS,
                }
            ),
            pending_count=sum(
                1 for result in results if result.status == EvaluationStatus.PENDING
            ),
            any_count=existing_count,
        )

    async def prune(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        run_slice: RunSlice,
    ) -> List[UUID]:
        # `prune` removes result cells, then re-triggers a metrics refresh over
        # the affected scope so aggregates recompute over the now-smaller cell
        # set. Every run-write op (populate / process / prune) re-triggers
        # refresh after touching cells — prune leaves nothing stale. It does NOT
        # touch steps or scenarios; those are the shape ops on the service
        # (add_steps/remove_steps, add_scenarios/remove_scenarios).
        if _slice_is_empty(run_slice):
            return []
        # prune only needs the ids to delete, so use the ID-only query rather
        # than hydrating full result DTOs via `probe`.
        result_ids = await self.evaluations_service.query_result_ids(
            project_id=project_id,
            result=_query_from_slice(run_slice),
        )
        if not result_ids:
            return []

        deleted = await self.evaluations_service.delete_results(
            project_id=project_id,
            result_ids=result_ids,
        )
        await self.refresh(
            project_id=project_id,
            user_id=user_id,
            run_slice=run_slice,
        )
        return deleted

    async def process(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        run_slice: RunSlice,
    ) -> ProcessSummary:
        """Execute the runnable cells in the slice and return what changed.

        This is the plan->execute->populate loop of the design's `process(slice)`
        operation — results only. Metrics are refreshed by the separate
        `refresh` op, not here. The actual execution is delegated to the
        injected `slice_processor`; this method owns only the slice-level
        guard (an empty dimension means "nothing addressed", so there is
        nothing to execute).

        Execution requires a wired `slice_processor`. Earlier this method
        silently refreshed metrics and returned an empty summary, which read as
        "executed the slice" while doing almost nothing (UEL-015) — so when no
        processor is wired we now fail loudly rather than masquerade.
        """
        if _slice_is_empty(run_slice):
            return ProcessSummary()

        if self.slice_processor is None:
            raise NotImplementedError(
                "process(slice) requires a wired slice_processor; "
                "SliceOperations was constructed without one. "
                "Use probe/populate/prune for read/write/delete, or wire a "
                "SliceProcessor at the composition root to execute the slice."
            )

        return await self.slice_processor.process(
            project_id=project_id,
            user_id=user_id,
            run_slice=run_slice,
        )

    async def refresh(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        run_slice: RunSlice,
    ) -> None:
        """Recompute metrics over the slice's scope — variational AND aggregate.

        First-class peer of probe/process/populate/prune. The three metric kinds
        refresh on different boundaries (scenario-complete, interval, run), so a
        complete refresh does both layers:

          1. variational — the per-scenario rows for the slice's scenarios;
          2. aggregate — temporal buckets (live runs, which aggregate over time)
             or the single global row (non-live runs).

        Callers that already refreshed variational inside `process` can still
        call this; recomputing the per-scenario rows is idempotent. Kept separate
        from process/populate so writes do not implicitly recompute — the caller
        invokes `refresh` once, at the right boundary.
        """
        if _slice_is_empty(run_slice):
            return

        run_id = run_slice.run_id

        # 1. Variational — per-scenario rows for the addressed scenarios.
        await self.evaluations_service.refresh_metrics(
            project_id=project_id,
            user_id=user_id,
            metrics=EvaluationMetricsRefresh(
                run_id=run_id,
                scenario_ids=run_slice.scenario_ids,
            ),
        )

        # 2. Aggregate — temporal (live) or global (non-live).
        run = await self.evaluations_service.fetch_run(
            project_id=project_id,
            run_id=run_id,
        )
        if not run:
            return

        is_live = bool(run.flags and run.flags.is_live)

        if not is_live:
            # Non-live: one global aggregate (no scenario, no timestamp).
            await self.evaluations_service.refresh_metrics(
                project_id=project_id,
                user_id=user_id,
                metrics=EvaluationMetricsRefresh(run_id=run_id),
            )
            return

        # Live: recompute the temporal buckets the slice touched. Group the
        # slice's scenarios' timestamps by interval so each affected
        # (interval, timestamp) bucket is recomputed.
        scenarios = await self.evaluations_service.query_scenarios(
            project_id=project_id,
            scenario=EvaluationScenarioQuery(
                run_id=run_id,
                ids=run_slice.scenario_ids,
            ),
        )
        timestamps_by_interval: dict[int, set] = {}
        for scenario in scenarios:
            if scenario.timestamp is None or scenario.interval is None:
                continue
            timestamps_by_interval.setdefault(scenario.interval, set()).add(
                scenario.timestamp
            )

        if not timestamps_by_interval:
            # No temporal buckets on the slice's scenarios — fall back to the
            # global aggregate so the run is not left with stale metrics.
            await self.evaluations_service.refresh_metrics(
                project_id=project_id,
                user_id=user_id,
                metrics=EvaluationMetricsRefresh(run_id=run_id),
            )
            return

        for interval, timestamps in timestamps_by_interval.items():
            await self.evaluations_service.refresh_metrics(
                project_id=project_id,
                user_id=user_id,
                metrics=EvaluationMetricsRefresh(
                    run_id=run_id,
                    timestamps=sorted(timestamps),
                    interval=interval,
                ),
            )
