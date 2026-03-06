# /agenta/sdk/middlewares/running/resolver.py
from typing import Callable, Any, Optional, Dict

import httpx
import agenta as ag

from agenta.sdk.utils.logging import get_module_logger
from agenta.sdk.models.workflows import (
    WorkflowServiceRequestData,
    WorkflowServiceRequest,
    WorkflowServiceInterface,
    WorkflowServiceConfiguration,
)
from agenta.sdk.contexts.running import RunningContext
from agenta.sdk.workflows.utils import (
    retrieve_handler,
)
from agenta.sdk.workflows.errors import InvalidInterfaceURIV0Error


log = get_module_logger(__name__)

# Internal embeds resolution defaults (not user-configurable)
_EMBEDS_MAX_CHECKS = 20
_EMBEDS_MAX_DEPTH = 10
_EMBEDS_MAX_COUNT = 100
_EMBEDS_ERROR_POLICY = "exception"

# The embed marker key used in configuration dicts
_AG_EMBED_MARKER = "@ag.embed"


def _has_embed_markers(config: Any, _depth: int = 0) -> bool:
    """Check if a configuration contains any @ag.embed markers.

    Traverses the config recursively to detect object embeds (dict keys)
    or string embeds (substring tokens).

    Args:
        config: Configuration value to inspect
        _depth: Current recursion depth (guards against pathological inputs)

    Returns:
        True if any embed markers are found, False otherwise
    """
    if _depth > _EMBEDS_MAX_CHECKS:
        return False

    if isinstance(config, dict):
        if _AG_EMBED_MARKER in config:
            return True
        return any(_has_embed_markers(v, _depth + 1) for v in config.values())

    if isinstance(config, list):
        return any(_has_embed_markers(item, _depth + 1) for item in config)

    if isinstance(config, str):
        return _AG_EMBED_MARKER in config

    return False


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


async def resolve_embeds(
    *,
    parameters: Dict[str, Any],
    credentials: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Resolve @ag.embed references in parameters by calling the API.

    This function calls the API resolution endpoint to resolve any embedded
    references in the configuration parameters.

    Uses internal defaults for max_depth, max_embed_count, and error_policy.

    Args:
        parameters: Parameters dict that may contain embeds
        credentials: API key for authentication

    Returns:
        Resolved parameters dict with embeds inlined

    Raises:
        Exception: If resolution fails (based on internal error policy)
    """
    max_depth = _EMBEDS_MAX_DEPTH
    max_embed_count = _EMBEDS_MAX_COUNT
    error_policy = _EMBEDS_ERROR_POLICY
    try:
        if not ag.async_api:
            log.warning("No backend client available - skipping embeds resolution")
            return parameters

        api_url = ag.async_api._client_wrapper._base_url

        headers = {}
        if credentials:
            headers["Authorization"] = credentials

        # Call the API to resolve embeds in the parameters
        # We use a stub for the workflow revision,
        # with just 'parameters' to avoid unnecessary data fetching.
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{api_url}/preview/workflows/revisions/resolve",
                headers=headers,
                json={
                    "workflow_revision": {"data": {"parameters": parameters}},
                    "max_depth": max_depth,
                    "max_embeds": max_embed_count,
                    "error_policy": error_policy,
                },
                timeout=30.0,
            )

            response.raise_for_status()
            result = response.json()

            revision = result.get("workflow_revision")
            if revision and revision.get("data"):
                return revision["data"].get("parameters", parameters)

        return parameters

    except Exception as e:
        log.error(f"Failed to resolve embeds: {e}")
        if error_policy == "exception":
            raise
        return parameters


class ResolverMiddleware:
    """Middleware that resolves workflow components before execution.

    This middleware is responsible for resolving critical components needed
    to execute a workflow:

    1. **Interface**: The WorkflowServiceInterface containing the service URI and schemas
    2. **Configuration**: Configuration parameters for the workflow
    3. **Embeds**: Resolves @ag.embed references in configuration (if resolve=True)
    4. **Handler**: The actual callable function that implements the workflow logic

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

        # Resolve embeds in configuration if enabled (via flags.resolve)
        # Only call the API if markers are actually present - avoids a second
        # round trip when the config was already fetched with resolve=True.
        resolve_flag = (request.flags or {}).get("resolve", True)
        if (
            resolve_flag
            and configuration
            and configuration.parameters
            and _has_embed_markers(configuration.parameters)
        ):
            try:
                log.info("Resolving embeds in configuration parameters")
                resolved_params = await resolve_embeds(
                    parameters=configuration.parameters,
                    credentials=request.credentials,
                )
                configuration.parameters = resolved_params
                log.info("Embeds resolution completed successfully")
            except Exception as e:
                log.error(f"Embeds resolution failed: {e}")
                # Error policy is handled internally by resolve_embeds
                raise

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
