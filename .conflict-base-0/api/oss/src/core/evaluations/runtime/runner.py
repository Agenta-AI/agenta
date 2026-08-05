from datetime import datetime
from typing import Any, List, Optional
from uuid import UUID

from agenta.sdk.evaluations.runtime.executor import EvaluationTaskRunner

from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


class TaskiqEvaluationTaskRunner(EvaluationTaskRunner):
    """API adapter from generic evaluation dispatch to Taskiq tasks."""

    def __init__(self, *, worker: Any):
        self.worker = worker

    async def process_run_from_source(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run_id: UUID,
        #
        newest: Optional[datetime] = None,
        oldest: Optional[datetime] = None,
    ) -> Any:
        kwargs = dict(
            project_id=project_id,
            user_id=user_id,
            #
            run_id=run_id,
        )
        if newest is not None:
            kwargs["newest"] = newest
        if oldest is not None:
            kwargs["oldest"] = oldest

        result = await self.worker.process_run_from_source.kiq(**kwargs)
        return result

    async def process_run_from_batch(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        run_id: UUID,
        #
        source_kind: str,
        #
        input_step_key: Optional[str] = None,
        #
        trace_ids: Optional[List[str]] = None,
        testcase_ids: Optional[List[UUID]] = None,
    ) -> Any:
        kwargs = dict(
            project_id=project_id,
            user_id=user_id,
            #
            run_id=run_id,
            #
            source_kind=source_kind,
        )
        if trace_ids is not None:
            kwargs["trace_ids"] = trace_ids
        if testcase_ids is not None:
            kwargs["testcase_ids"] = testcase_ids
        if input_step_key is not None:
            kwargs["input_step_key"] = input_step_key

        result = await self.worker.process_run_from_batch.kiq(**kwargs)
        return result

    async def process_rerun(
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
    ) -> Any:
        # Re-execute EXISTING scenarios by coordinate (the run-slice process(slice)
        # op): retry transiently-failed scenarios, run a newly-added evaluator
        # over existing scenarios, re-run a specific repeat, etc. Distinct verb
        # from process_run_from_batch, which ingests NEW source items into NEW
        # scenarios.
        kwargs: dict = dict(
            project_id=project_id,
            user_id=user_id,
            #
            run_id=run_id,
        )
        if scenario_ids is not None:
            kwargs["scenario_ids"] = scenario_ids
        if step_keys is not None:
            kwargs["step_keys"] = step_keys
        if repeat_idxs is not None:
            kwargs["repeat_idxs"] = repeat_idxs
        if overwrite:
            kwargs["overwrite"] = overwrite

        result = await self.worker.process_rerun.kiq(**kwargs)
        return result
