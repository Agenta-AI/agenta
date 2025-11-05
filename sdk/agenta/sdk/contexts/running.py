from typing import Optional, Union, Callable
from contextvars import Token, ContextVar
from contextlib import contextmanager


from pydantic import BaseModel

from agenta.sdk.models.workflows import (
    WorkflowServiceInterface,
    WorkflowServiceConfiguration,
)


class RunningContext(BaseModel):
    flags: Optional[dict] = None
    tags: Optional[dict] = None
    meta: Optional[dict] = None

    aggregate: Optional[Union[bool, Callable]] = None  # stream to batch
    annotate: Optional[bool] = None  # annotation vs invocation

    interface: Optional[WorkflowServiceInterface] = None
    configuration: Optional[WorkflowServiceConfiguration] = None
    parameters: Optional[dict] = None
    schemas: Optional[dict] = None

    secrets: Optional[list] = None
    credentials: Optional[str] = None

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


@contextmanager
def running_context_manager(context: RunningContext):
    token = RunningContext.set(context)
    try:
        yield
    finally:
        RunningContext.reset(token)
