"""Gateway exception -> HTTP mapping (entities.md §9).

Written once, shared by both planes' routers — tools and triggers currently duplicate
`handle_adapter_exceptions()` verbatim per router, which is a habit not repeated here.
Modelled on `apis/fastapi/tools/router.py::handle_adapter_exceptions()`.
"""

from functools import wraps


def handle_gateway_exceptions():
    """Map gateway domain exceptions to HTTP.

    `*NotFoundError` -> 404. `PolicyDeniedError` / `EntitlementDeniedError` -> 403.
    `*NotAllowedError` -> 403. `CeilingExceededError` -> 400, its body naming the
    ceiling, the requested and the allowed values (D25). `McpAuthRequiredError` ->
    409 carrying the `GatewayConnectionRequirement` (an interaction, not a failure
    — D17). `*UpstreamError` -> 424, or 502 when the upstream answered >=500 (the
    424/502 split tools and triggers already use).
    """

    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            raise NotImplementedError

        return wrapper

    return decorator
