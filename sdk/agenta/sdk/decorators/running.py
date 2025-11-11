from typing import Any, Callable, List, Awaitable, Dict, Optional
import asyncio
from functools import wraps
from inspect import iscoroutinefunction
from copy import deepcopy

from decorator import decorator

from agenta.sdk.context.running import (
    workflow_mode_enabled_context,
    workflow_registry_context,
    WorkflowRegistryContext,
)
from agenta.sdk.workflows.types import (
    WorkflowServiceRequest,
    WorkflowServiceResponse,
    WorkflowServiceInterface,
    WorkflowRevision,
    Schema,
)
from agenta.sdk.middleware.base import WorkflowMiddlewareDecorator

from agenta.sdk.middleware.auth import AuthMiddleware
from agenta.sdk.middleware.flags import FlagsMiddleware
from agenta.sdk.middleware.adapt import AdaptMiddleware


LATEST_VERSION = "2025.07.14"
DEFAULT_SCHEMAS = lambda: {}  # pylint: disable=unnecessary-lambda-assignment


class workflows:
    @classmethod
    def get_registry(cls) -> WorkflowRegistryContext:
        return deepcopy(workflow_registry_context.get())


class workflow:  # pylint: disable=invalid-name
    def __init__(
        self,
        version: Optional[str] = None,
        schemas: Optional[Dict[str, Schema]] = None,
    ):
        self.middleware: List[WorkflowMiddlewareDecorator] = [
            AuthMiddleware,
            FlagsMiddleware,
            AdaptMiddleware,
        ]

        self.version = version or LATEST_VERSION
        self.schemas = schemas or DEFAULT_SCHEMAS()

    def __call__(self, func: Callable[..., Any]) -> Callable[..., Any]:
        is_async = iscoroutinefunction(func)

        workflow_registry = workflow_registry_context.get()

        workflow_registry.version = workflow_registry.version or self.version

        if is_async:

            @wraps(func)
            async def async_wrapper(*args, **kwargs):
                if workflow_mode_enabled_context.get():
                    return await self._wrapped_async(func)(*args, **kwargs)
                return await func(*args, **kwargs)

            workflow_registry.handlers = {
                "invoke": async_wrapper,
                "inspect": self.make_interface_wrapper(self.version, self.schemas),
            }

            return async_wrapper

        else:

            @wraps(func)
            def sync_wrapper(*args, **kwargs):
                if workflow_mode_enabled_context.get():
                    return self._wrapped_async(func)(*args, **kwargs)
                return func(*args, **kwargs)

            return sync_wrapper

    def _wrapped_async(
        self,
        func: Callable[..., Any],
    ) -> Callable[..., Awaitable[WorkflowServiceResponse]]:
        @decorator
        async def async_wrapper(func, *args, **kwargs):
            result = (
                await func(*args, **kwargs)
                if iscoroutinefunction(func)
                else await asyncio.to_thread(func, *args, **kwargs)
            )

            return result

        @wraps(func)
        async def wrapper(*args, **kwargs):
            handler = async_wrapper(func, *args, **kwargs)
            request: WorkflowServiceRequest = (
                kwargs.pop("request")
                if "request" in kwargs
                else args[0]
                if len(args) > 0
                else None
            )
            revision: WorkflowRevision = (
                kwargs.pop("revision")
                if "revision" in kwargs
                else args[1]
                if len(args) > 1
                else None
            )

            _handler = handler
            for middleware in reversed(self.middleware):
                _handler = middleware(_handler)

            return await _handler(
                request=request,
                revision=revision,
            )

        return wrapper

    def make_interface_wrapper(self, path, schemas):
        async def interface_wrapper() -> WorkflowServiceResponse:
            return WorkflowServiceInterface(
                schemas={path: schemas},
            )

        return interface_wrapper
