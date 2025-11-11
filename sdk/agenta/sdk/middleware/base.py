from typing import Protocol, Callable, Any

from agenta.sdk.workflows.types import (
    WorkflowServiceRequest,
    WorkflowServiceResponse,
    WorkflowRevision,
    WorkflowServiceHandler,
)


class WorkflowMiddleware(Protocol):
    async def __call__(
        self,
        request: WorkflowServiceRequest,
        revision: WorkflowRevision,
        handler: Callable,
    ) -> Any:
        ...


WorkflowMiddlewareDecorator = Callable[[WorkflowServiceHandler], WorkflowServiceHandler]


def middleware_as_decorator(
    middleware: WorkflowMiddleware | type[WorkflowMiddleware],
) -> WorkflowMiddlewareDecorator:
    middleware = middleware() if isinstance(middleware, type) else middleware

    def decorator(
        handler: WorkflowServiceHandler,
    ) -> WorkflowServiceHandler:
        async def wrapped(
            request: WorkflowServiceRequest,
            revision: WorkflowRevision,
        ) -> WorkflowServiceResponse:
            return await middleware(request, revision, handler)

        return wrapped

    return decorator
