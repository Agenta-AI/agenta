# /agenta/sdk/middlewares/running/resolver.py
from typing import Callable, Any, Optional

from agenta.sdk.utils.logging import get_module_logger
from agenta.sdk.models.workflows import (
    WorkflowServiceRequestData,
    WorkflowServiceResponseData,
    WorkflowServiceRequest,
    WorkflowServiceInterface,
    WorkflowServiceConfiguration,
)
from agenta.sdk.contexts.running import RunningContext
from agenta.sdk.workflows.utils import (
    retrieve_handler,
    retrieve_interface,
    retrieve_configuration,
)
from agenta.sdk.workflows.errors import InvalidInterfaceURIV0Error


log = get_module_logger(__name__)


async def resolve_interface(
    *,
    request: Optional[WorkflowServiceRequest] = None,
    interface: Optional[WorkflowServiceInterface] = None,
) -> Optional[WorkflowServiceInterface]:
    """Resolve the workflow service interface from multiple sources.

    Checks for interface in this priority order:
    1. Provided interface parameter
    2. Interface from the request
    3. Interface from the RunningContext

    Args:
        request: Optional workflow service request that may contain an interface
        interface: Optional interface to use directly

    Returns:
        The resolved WorkflowServiceInterface or None if not found
    """
    if interface is not None:
        return interface

    if request and request.interface:
        return request.interface

    ctx = RunningContext.get()
    return ctx.interface


async def resolve_configuration(
    *,
    request: Optional[WorkflowServiceRequest] = None,
    configuration: Optional[WorkflowServiceConfiguration] = None,
) -> Optional[WorkflowServiceConfiguration]:
    """Resolve workflow parameters from multiple sources.

    Checks for parameters in this priority order:
    1. Provided parameters parameter
    2. Parameters from request.data.parameters
    3. Parameters from the RunningContext

    Args:
        request: Optional workflow service request that may contain parameters
        parameters: Optional parameters dict to use directly

    Returns:
        The resolved parameters dict or None if not found
    """
    if configuration is not None:
        return configuration

    if request and request.configuration:
        return request.configuration

    ctx = RunningContext.get()
    return ctx.configuration


async def resolve_handler(
    *,
    uri: Optional[str] = None,
):
    """Retrieve and validate a workflow handler by its URI.

    Looks up a registered handler function using the provided URI.
    Raises an exception if the URI is None or if no handler is found.

    Args:
        uri: The service URI identifying the handler to retrieve

    Returns:
        The resolved handler callable

    Raises:
        InvalidInterfaceURIV0Error: If uri is None or if no handler found for the URI
    """
    if uri is None:
        raise InvalidInterfaceURIV0Error(got="None")

    handler = retrieve_handler(uri)

    if handler is None:
        raise InvalidInterfaceURIV0Error(got=uri)

    return handler


class ResolverMiddleware:
    """Middleware that resolves workflow components before execution.

    This middleware is responsible for resolving three critical components needed
    to execute a workflow:

    1. **Interface**: The WorkflowServiceInterface containing the service URI and schemas
    2. **Parameters**: Configuration parameters for the workflow
    3. **Handler**: The actual callable function that implements the workflow logic

    The middleware resolves these components from various sources (request, context, registry)
    and stores them in the RunningContext for downstream middleware and the handler to use.
    It also ensures the request.data.parameters is populated for the workflow execution.
    """

    async def __call__(
        self,
        request: WorkflowServiceRequest,
        call_next: Callable[[WorkflowServiceRequest], Any],
    ):
        """Resolve workflow components and populate the running context.

        Args:
            request: The workflow service request being processed
            call_next: The next middleware or handler in the chain

        Returns:
            The result from calling the next middleware/handler in the chain

        Raises:
            InvalidInterfaceURIV0Error: If the handler cannot be resolved from the interface URI
        """
        interface = await resolve_interface(request=request)
        configuration = await resolve_configuration(request=request)
        handler = await resolve_handler(uri=(interface.uri if interface else None))

        ctx = RunningContext.get()
        ctx.interface = interface
        ctx.configuration = configuration
        ctx.handler = handler

        if not request.data:
            request.data = WorkflowServiceRequestData()

        request.data.parameters = (
            request.data.parameters or configuration.parameters
            if configuration
            else None
        )

        return await call_next(request)
