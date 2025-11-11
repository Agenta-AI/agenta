from agenta.sdk.utils.logging import get_module_logger

from agenta.sdk.middleware.base import (
    WorkflowMiddleware,
    middleware_as_decorator,
)
from agenta.sdk.workflows.types import (
    WorkflowServiceRequest,
    WorkflowServiceResponse,
    WorkflowRevision,
    WorkflowServiceHandler,
)

from agenta.sdk.context.tracing import (
    tracing_context_manager,
    tracing_context,
)


log = get_module_logger(__name__)


@middleware_as_decorator
class FlagsMiddleware(WorkflowMiddleware):
    def __init__(self):
        pass

    async def __call__(
        self,
        request: WorkflowServiceRequest,
        revision: WorkflowRevision,
        handler: WorkflowServiceHandler,
    ) -> WorkflowServiceResponse:
        ctx = tracing_context.get()

        if isinstance(request.flags, dict) and request.flags.get("is_annotation"):
            ctx.type = "annotation"

        with tracing_context_manager(context=ctx):
            return await handler(request, revision)
