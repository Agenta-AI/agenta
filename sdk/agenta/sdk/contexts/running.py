from typing import Optional, Callable  # Callable used for handler field
from contextvars import Token, ContextVar
from contextlib import contextmanager, asynccontextmanager

from pydantic import BaseModel

from agenta.sdk.models.workflows import (
    WorkflowServiceInterface,
    WorkflowServiceConfiguration,
)


class RunningContext(BaseModel):
    flags: Optional[dict] = None
    tags: Optional[dict] = None
    meta: Optional[dict] = None

    interface: Optional[WorkflowServiceInterface] = None
    configuration: Optional[WorkflowServiceConfiguration] = None
    parameters: Optional[dict] = None
    schemas: Optional[dict] = None

    credentials: Optional[str] = None
    secrets: Optional[list] = None

    local_secrets: Optional[list] = None
    vault_secrets: Optional[list] = None

    handler: Optional[Callable] = None

    @classmethod
    def get(cls) -> "RunningContext":
        try:
            return running_context.get()
        except LookupError:
            return RunningContext()

    @classmethod
    def set(cls, ctx: "RunningContext") -> Token:
        return running_context.set(ctx)

    @classmethod
    def reset(cls, token: Token) -> None:
        return running_context.reset(token)


running_context: ContextVar[RunningContext] = ContextVar("running_context")

workflow_mode_enabled_context: ContextVar[bool] = ContextVar(
    "ag.workflow_context_enabled",
    default=False,
)


@contextmanager
def workflow_mode_enabled():
    token = workflow_mode_enabled_context.set(True)
    try:
        yield
    finally:
        workflow_mode_enabled_context.reset(token)


@asynccontextmanager
async def async_workflow_mode_enabled():
    token = workflow_mode_enabled_context.set(True)
    try:
        yield
    finally:
        workflow_mode_enabled_context.reset(token)


@contextmanager
def running_context_manager(context: RunningContext):
    token = RunningContext.set(context)
    try:
        yield
    finally:
        RunningContext.reset(token)
