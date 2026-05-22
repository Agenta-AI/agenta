from typing import List, Optional, Protocol
from uuid import UUID

from oss.src.core.evaluations.runtime.models import (
    ProcessSummary,
    TensorProbeSummary,
    TensorSlice,
)
from oss.src.core.evaluations.types import (
    EvaluationMetricsRefresh,
    EvaluationResult,
    EvaluationResultCreate,
    EvaluationResultQuery,
    EvaluationStatus,
)


def _empty_dimension(values: Optional[List[object]]) -> bool:
    return values == []


def _slice_is_empty(tensor_slice: TensorSlice) -> bool:
    return any(
        _empty_dimension(values)
        for values in (
            tensor_slice.scenario_ids,
            tensor_slice.step_keys,
            tensor_slice.repeat_idxs,
        )
    )


def _query_from_slice(tensor_slice: TensorSlice) -> EvaluationResultQuery:
    return EvaluationResultQuery(
        run_id=tensor_slice.run_id,
        scenario_ids=tensor_slice.scenario_ids,
        step_keys=tensor_slice.step_keys,
        repeat_idxs=tensor_slice.repeat_idxs,
    )


class SliceProcessor(Protocol):
    """Execution boundary for `process(slice)`.

    A slice processor takes the canonical output coordinate (existing
    scenarios x steps x repeats) and re-executes the runnable (`auto`) cells in
    that scope: it plans from the scenarios' existing source bindings, restricts
    to the requested `step_keys`/`repeat_idxs`, invokes only missing work,
    populates the result cells, and refreshes metrics for the affected scope.

    It is deliberately adapter-free at this seam so `runtime/` does not depend on
    `tasks/`: the concrete implementation (which closes over the tracing /
    testcases / workflows / applications services and the run's revisions) is
    wired at the composition root and injected here. The same shape lets the SDK
    or an in-memory test supply its own processor without changing tensor ops.
    """

    async def process(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        tensor_slice: TensorSlice,
    ) -> ProcessSummary: ...


class TensorSliceOperations:
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
        tensor_slice: TensorSlice,
    ) -> List[EvaluationResult]:
        if _slice_is_empty(tensor_slice):
            return []

        return await self.evaluations_service.query_results(
            project_id=project_id,
            result=_query_from_slice(tensor_slice),
        )

    async def populate(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        results: List[EvaluationResultCreate],
        refresh_metrics: bool = True,
    ) -> List[EvaluationResult]:
        if not results:
            return []

        created = await self.evaluations_service.create_results(
            project_id=project_id,
            user_id=user_id,
            results=results,
        )

        if refresh_metrics:
            await self._refresh_results_metrics(
                project_id=project_id,
                user_id=user_id,
                results=created,
            )

        return created

    async def probe_summary(
        self,
        *,
        project_id: UUID,
        tensor_slice: TensorSlice,
        expected_count: Optional[int] = None,
    ) -> TensorProbeSummary:
        results = await self.probe(
            project_id=project_id,
            tensor_slice=tensor_slice,
        )
        existing_count = len(results)
        expected = expected_count if expected_count is not None else existing_count

        return TensorProbeSummary(
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
        tensor_slice: TensorSlice,
        refresh_metrics: bool = True,
    ) -> List[UUID]:
        results = await self.probe(
            project_id=project_id,
            tensor_slice=tensor_slice,
        )
        result_ids = [result.id for result in results if result.id]
        if not result_ids:
            return []

        deleted = await self.evaluations_service.delete_results(
            project_id=project_id,
            result_ids=result_ids,
        )

        if refresh_metrics:
            await self._refresh_results_metrics(
                project_id=project_id,
                user_id=user_id,
                results=results,
            )

        return deleted

    async def process(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        tensor_slice: TensorSlice,
    ) -> ProcessSummary:
        """Execute the runnable cells in the slice and return what changed.

        This is the plan->execute->populate->refresh loop of the design's
        `process(slice)` operation. The actual execution is delegated to the
        injected `slice_processor`; this method owns only the slice-level
        guard (an empty dimension means "nothing addressed", so there is
        nothing to execute).

        Execution requires a wired `slice_processor`. Earlier this method
        silently refreshed metrics and returned an empty summary, which read as
        "executed the slice" while doing almost nothing (UEL-015) — so when no
        processor is wired we now fail loudly rather than masquerade.
        """
        if _slice_is_empty(tensor_slice):
            return ProcessSummary()

        if self.slice_processor is None:
            raise NotImplementedError(
                "process(slice) requires a wired slice_processor; "
                "TensorSliceOperations was constructed without one. "
                "Use probe/populate/prune for read/write/delete, or wire a "
                "SliceProcessor at the composition root to execute the slice."
            )

        return await self.slice_processor.process(
            project_id=project_id,
            user_id=user_id,
            tensor_slice=tensor_slice,
        )

    async def _refresh_results_metrics(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        results: List[EvaluationResult],
    ) -> None:
        scenario_ids = sorted(
            {result.scenario_id for result in results if result.scenario_id},
            key=str,
        )
        if not results:
            return

        await self.evaluations_service.refresh_metrics(
            project_id=project_id,
            user_id=user_id,
            metrics=EvaluationMetricsRefresh(
                run_id=results[0].run_id,
                scenario_ids=scenario_ids or None,
            ),
        )
