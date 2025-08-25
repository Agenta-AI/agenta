from typing import Dict, Any, Optional
from contextvars import ContextVar
from contextlib import contextmanager

from pydantic import BaseModel

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


@contextmanager
async def async_workflow_mode_enabled():
    token = workflow_mode_enabled_context.set(True)
    try:
        yield
    finally:
        workflow_mode_enabled_context.reset(token)


class WorkflowRegistryContext(BaseModel):
    version: Optional[str] = None
    handlers: Dict[str, Any] = {}


workflow_registry_context: ContextVar[WorkflowRegistryContext] = ContextVar(
    "ag.workflow_registry",
    default=WorkflowRegistryContext(),
)
