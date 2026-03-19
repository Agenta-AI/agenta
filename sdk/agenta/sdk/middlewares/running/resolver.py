# /agenta/sdk/middlewares/running/resolver.py
from typing import Callable, Any, Optional, Dict

import httpx
import agenta as ag

from agenta.sdk.utils.logging import get_module_logger
from agenta.sdk.models.workflows import (
    WorkflowRequestData,
    WorkflowInvokeRequest,
    WorkflowRevisionData,
)
from agenta.sdk.contexts.running import RunningContext
from agenta.sdk.engines.running.utils import (
    retrieve_handler,
)
from agenta.sdk.engines.running.errors import InvalidInterfaceURIV0Error


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


async def resolve_revision(
    *,
    request: Optional[WorkflowInvokeRequest] = None,
    revision: Optional[WorkflowRevisionData] = None,
) -> Optional[WorkflowRevisionData]:
    """Resolve WorkflowRevisionData from multiple sources.

    Priority order:
    1. Provided revision parameter (direct, e.g. from workflow constructor)
    2. request.data.revision dict → coerced to WorkflowRevisionData
    3. RunningContext.revision dict → coerced to WorkflowRevisionData
    """
    if revision is not None:
        return revision

    if request and request.data and request.data.revision:
        rev_dict = request.data.revision
        # revision dict is the full WorkflowRevision dump; data sub-key holds the actual fields
        data_dict = rev_dict.get("data") if isinstance(rev_dict, dict) else None
        if data_dict:
            return WorkflowRevisionData(**data_dict)

    ctx = RunningContext.get()
    if ctx.revision:
        if isinstance(ctx.revision, WorkflowRevisionData):
            return ctx.revision
        if isinstance(ctx.revision, dict):
            # revision-shaped: {"data": {"uri": ...}} — or bare WorkflowRevisionData dict
            _data = ctx.revision.get("data") if "data" in ctx.revision else ctx.revision
            if _data:
                return WorkflowRevisionData(**_data)
    return None


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
        request: WorkflowInvokeRequest,
        call_next: Callable[[WorkflowInvokeRequest], Any],
    ):
        revision = await resolve_revision(request=request)

        # Resolve embeds in parameters if enabled (via flags.resolve)
        resolve_flag = (request.flags or {}).get("resolve", True)
        if (
            resolve_flag
            and revision
            and revision.parameters
            and _has_embed_markers(revision.parameters)
        ):
            try:
                log.info("Resolving embeds in configuration parameters")
                resolved_params = await resolve_embeds(
                    parameters=revision.parameters,
                    credentials=request.credentials,
                )
                revision.parameters = resolved_params
                log.info("Embeds resolution completed successfully")
            except Exception as e:
                log.error(f"Embeds resolution failed: {e}")
                raise

        handler = await resolve_handler(uri=(revision.uri if revision else None))

        ctx = RunningContext.get()
        ctx.revision = (
            {"data": revision.model_dump(mode="json", exclude_none=True)}
            if revision
            else None
        )
        ctx.handler = handler

        if not request.data:
            request.data = WorkflowRequestData()

        if revision:
            request.data.parameters = request.data.parameters or revision.parameters

        return await call_next(request)
