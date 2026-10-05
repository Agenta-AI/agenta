"""Domain exception base for gateways.

One domain base so the router decorator can catch broadly; no HTTP status on any
exception — mapping happens at the boundary (`apis/fastapi/gateways/exceptions.py`).
"""


class GatewaysError(Exception):
    """Base exception for the gateways domain."""

    def __init__(self, message: str = "Gateways error"):
        self.message = message
        super().__init__(self.message)


class GatewayEndpointInactiveError(GatewaysError):
    """The operator's switch is off (§2.6). One type for both planes: the flag, the
    refusal and the reason are identical, only the endpoint named differs."""

    def __init__(self, *, target: str):
        self.target = target
        self.flag = "is_active"
        super().__init__(f"Endpoint is deactivated: {target}")


class GatewayPlaneDisabledError(GatewaysError):
    """A whole gateway plane is switched off for this deployment.

    Distinct from :class:`GatewayEndpointInactiveError`, which refuses one endpoint an
    operator deactivated and leaves the plane serving. This one says the plane itself does
    not serve, so no endpoint on it is reachable and a caller that has a pre-gateway path
    should take it rather than retry.

    The code, the message and the environment variable to change all live on the subclass,
    so the refusal reads the same wherever it is rendered: as the shared envelope on the
    control plane, as an OpenAI-shaped error on the LLM data plane, and as a JSON-RPC error
    on the MCP data plane.
    """

    code: str = "gateway_disabled"
    flag: str = ""
    next_step: str = ""


class LLMGatewayDisabledError(GatewayPlaneDisabledError):
    code = "llm_gateway_disabled"
    flag = "AGENTA_LLM_GATEWAY_ENABLED"
    next_step = (
        "Resolve the model from the project's vault key instead, or set "
        "AGENTA_LLM_GATEWAY_ENABLED=true on this deployment."
    )

    def __init__(self) -> None:
        super().__init__("The LLM gateway is disabled on this deployment.")


class MCPGatewayDisabledError(GatewayPlaneDisabledError):
    code = "mcp_gateway_disabled"
    flag = "AGENTA_MCP_GATEWAY_ENABLED"
    next_step = (
        "Connect the MCP server directly from the agent instead, or set "
        "AGENTA_MCP_GATEWAY_ENABLED=true on this deployment."
    )

    def __init__(self) -> None:
        super().__init__("The MCP gateway is disabled on this deployment.")
