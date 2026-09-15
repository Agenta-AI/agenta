"""The product switches that decide whether each gateway plane serves.

Both routers stay mounted whichever way the switches sit. A plane that is off refuses with
the shared gateway envelope and a code the caller can branch on, rather than disappearing
into a 404: the agent SDK reads `llm_gateway_disabled` as "resolve this model from the
vault the way you used to" and `mcp_gateway_disabled` as "dial this MCP server directly",
and it can only do that if the refusal names itself. An unmounted route would look to the
SDK exactly like a typo in a URL.

`env` is read per call, never captured at import, so an operator flipping the variable and
restarting the process is all it takes, and a test can set it without rebuilding the app.
"""

from fastapi import Depends, HTTPException, status

from oss.src.apis.fastapi.gateways.exceptions import plane_disabled_envelope
from oss.src.core.gateways.types import (
    GatewayPlaneDisabledError,
    LLMGatewayDisabledError,
    MCPGatewayDisabledError,
)
from oss.src.utils.env import env


def _refuse(exc: GatewayPlaneDisabledError) -> HTTPException:
    # 403, not 404 or 503: the route exists and the deployment is healthy, the operator has
    # decided this plane does not serve. Retrying changes nothing, which is what separates
    # it from the 502/424 an upstream failure sends.
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=plane_disabled_envelope(exc),
    )


def require_llm_gateway_enabled() -> None:
    """Router dependency: refuse every LLM gateway route while the plane is off."""
    if not env.llm_gateway.enabled:
        raise _refuse(LLMGatewayDisabledError())


def require_mcp_gateway_enabled() -> None:
    """Router dependency: refuse every MCP gateway route while the plane is off."""
    if not env.mcp_gateway.enabled:
        raise _refuse(MCPGatewayDisabledError())


LLM_GATEWAY_ENABLED = Depends(require_llm_gateway_enabled)
MCP_GATEWAY_ENABLED = Depends(require_mcp_gateway_enabled)
