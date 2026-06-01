from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict

from oss.src.core.evaluations.types import EvaluationStatus


class StepExecutionResult(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    status: EvaluationStatus
    trace_id: Optional[str] = None
    span_id: Optional[str] = None
    hash_id: Optional[str] = None
    error: Optional[Dict[str, Any]] = None
    outputs: Optional[Any] = None


class RunnableStepExecutor:
    """Backend compatibility shell for runnable execution adapters.

    This public worker-facing class is kept for now. New orchestration should
    target the SDK runtime WorkflowRunner protocol and keep backend workflow
    service details in this module.
    """

    async def execute(self, **kwargs: Any) -> StepExecutionResult:
        raise NotImplementedError


class WorkflowRunnableStepExecutor(RunnableStepExecutor):
    def __init__(self, *, workflows_service: Any):
        self.workflows_service = workflows_service

    async def execute(self, **kwargs: Any) -> StepExecutionResult:
        response = await self.workflows_service.invoke_workflow(**kwargs)
        status = getattr(response, "status", None)
        status_code = getattr(status, "code", None)
        has_error = status_code != 200
        error = None

        if has_error:
            error = (
                status.model_dump(mode="json", exclude_none=True)
                if hasattr(status, "model_dump")
                else {"code": status_code}
            )

        return StepExecutionResult(
            status=EvaluationStatus.FAILURE if has_error else EvaluationStatus.SUCCESS,
            trace_id=getattr(response, "trace_id", None),
            error=error,
            outputs=getattr(response, "outputs", None),
        )


class ApplicationBatchRunnableStepExecutor(RunnableStepExecutor):
    def __init__(self, *, batch_invoke: Any):
        self.batch_invoke = batch_invoke

    async def execute_batch(self, **kwargs: Any) -> List[Any]:
        return await self.batch_invoke(**kwargs)
