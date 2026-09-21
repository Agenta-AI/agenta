"""The product switches that decide whether each gateway plane serves.

Both routers stay mounted whichever way the switches sit. A plane that is off refuses with
the shared gateway envelope and a code the caller can branch on, rather than disappearing
into a 404: the agent SDK reads `llm_gateway_disabled` as "resolve this model from the
vault the way you used to" and `mcp_gateway_disabled` as "dial this MCP server directly",
and it can only do that if the refusal names itself. An unmounted route would look to the
SDK exactly like a typo in a URL.

The attribute is read per call, never captured at import, so both switches are checked
against the process's current configuration on every request and neither router has to be
rebuilt for one to take effect.

The value behind it is another matter, and the comment here used to say otherwise. Each
plane's `enabled` is a Pydantic field default, evaluated by `_parse_bool_env` when the
class is defined, so the environment variable is read once at import. Setting it later
changes nothing. A test that needs a plane off patches `env.llm_gateway.enabled` or
`env.mcp_gateway.enabled` directly, which is what every case in
`test_gateways_plane_flags.py` does; an operator restarts the process (D16).
"""

from fastapi import Depends

from oss.src.apis.fastapi.gateways.exceptions import plane_disabled_http_exception
from oss.src.core.gateways.types import (
    LLMGatewayDisabledError,
    MCPGatewayDisabledError,
)
from oss.src.utils.env import env


def require_llm_gateway_enabled() -> None:
    """Router dependency: refuse every LLM gateway route while the plane is off."""
    if not env.llm_gateway.enabled:
        raise plane_disabled_http_exception(LLMGatewayDisabledError())


def require_mcp_gateway_enabled() -> None:
    """Router dependency: refuse every MCP gateway route while the plane is off."""
    if not env.mcp_gateway.enabled:
        raise plane_disabled_http_exception(MCPGatewayDisabledError())


LLM_GATEWAY_ENABLED = Depends(require_llm_gateway_enabled)
MCP_GATEWAY_ENABLED = Depends(require_mcp_gateway_enabled)
