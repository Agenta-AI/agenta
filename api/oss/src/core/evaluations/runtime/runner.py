from datetime import datetime
from typing import Any, List, Optional
from uuid import UUID

from agenta.sdk.evaluations.runtime.executor import EvaluationTaskRunner


class TaskiqEvaluationTaskRunner(EvaluationTaskRunner):
    """API adapter from generic evaluation dispatch to Taskiq tasks."""

    def __init__(self, *, worker: Any):
        self.worker = worker

    async def process_run(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        run_id: UUID,
        newest: Optional[datetime] = None,
        oldest: Optional[datetime] = None,
    ) -> Any:
        kwargs = dict(
            project_id=project_id,
            user_id=user_id,
            run_id=run_id,
        )
        if newest is not None:
            kwargs["newest"] = newest
        if oldest is not None:
            kwargs["oldest"] = oldest

        return await self.worker.process_run.kiq(**kwargs)

    async def process_slice(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        run_id: UUID,
        source_kind: str,
        trace_ids: Optional[List[str]] = None,
        testcase_ids: Optional[List[UUID]] = None,
        input_step_key: Optional[str] = None,
    ) -> Any:
        kwargs = dict(
            project_id=project_id,
            user_id=user_id,
            run_id=run_id,
            source_kind=source_kind,
        )
        if trace_ids is not None:
            kwargs["trace_ids"] = trace_ids
        if testcase_ids is not None:
            kwargs["testcase_ids"] = testcase_ids
        if input_step_key is not None:
            kwargs["input_step_key"] = input_step_key

        return await self.worker.process_slice.kiq(**kwargs)

    async def process_tensor_slice(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        run_id: UUID,
        scenario_ids: Optional[List[UUID]] = None,
        step_keys: Optional[List[str]] = None,
        repeat_idxs: Optional[List[int]] = None,
        process_mode: Optional[str] = None,
    ) -> Any:
        # Re-execute EXISTING scenarios by coordinate (the tensor process(slice)
        # op): retry transiently-failed scenarios, run a newly-added evaluator
        # over existing scenarios, re-run a specific repeat, etc. Distinct verb
        # from process_slice, which ingests NEW source items into NEW scenarios.
        kwargs: dict = dict(
            project_id=project_id,
            user_id=user_id,
            run_id=run_id,
        )
        if scenario_ids is not None:
            kwargs["scenario_ids"] = scenario_ids
        if step_keys is not None:
            kwargs["step_keys"] = step_keys
        if repeat_idxs is not None:
            kwargs["repeat_idxs"] = repeat_idxs
        if process_mode is not None:
            kwargs["process_mode"] = process_mode

        return await self.worker.process_tensor_slice.kiq(**kwargs)
