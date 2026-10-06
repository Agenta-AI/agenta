"""Domain exception base for gateways.

One domain base so the router decorator can catch broadly; no HTTP status on any
exception — mapping happens at the boundary (`apis/fastapi/gateways/exceptions.py`).
"""

# What a person reads when the platform's included models do not serve their organization:
# the LLM plane is off, the organization is outside its rollout, or its wallet is off. The
# operator's detail (which switch) goes to the logs, never to the person.
BUILTIN_MODELS_NOT_ENABLED_MESSAGE = (
    "Agenta's included models aren't enabled for your organization. "
    "Use your own provider key, or contact us."
)


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
    on the MCP data plane. `operator_hint` is logged where the refusal is rendered and
    never sent.
    """

    code: str = "gateway_disabled"
    flag: str = ""
    next_step: str = ""
    operator_hint: str = ""


class LLMGatewayDisabledError(GatewayPlaneDisabledError):
    """Reaches people on the cloud (an organization outside `llm-gateway-rollout`), so its
    message is theirs; the agent SDK branches on the code, not the text."""

    code = "llm_gateway_disabled"
    flag = "AGENTA_LLM_GATEWAY_ENABLED"
    operator_hint = (
        "The LLM gateway does not serve this organization: set "
        "AGENTA_LLM_GATEWAY_ENABLED=true on this deployment, and add the organization to "
        "the llm-gateway-rollout flag when rollout flags are on."
    )

    def __init__(self) -> None:
        super().__init__(BUILTIN_MODELS_NOT_ENABLED_MESSAGE)


class LLMGatewayConnectionNotServedError(LLMGatewayDisabledError):
    """The gateway serves this organization, but not agents on this connection.

    A Bedrock connection: the gateway relays Bedrock to `bedrock-mantle`, whose model ids
    differ from the Bedrock runtime ids people save (and which the connection test lists),
    and which has no Claude model in some regions. The run takes the vault path, as before
    the gateway. Same code as a plane that is off, because that is the one the agent SDK
    reads as "resolve from the vault".
    """

    # No switch turns this on, so the envelope names none.
    flag = ""
    operator_hint = (
        "Agents on a Bedrock connection resolve from the vault, not the LLM gateway."
    )

    def __init__(self) -> None:
        GatewayPlaneDisabledError.__init__(
            self, "This connection is not served through the LLM gateway."
        )


class MCPGatewayDisabledError(GatewayPlaneDisabledError):
    code = "mcp_gateway_disabled"
    flag = "AGENTA_MCP_GATEWAY_ENABLED"
    next_step = (
        "Connect the MCP server directly from the agent instead, or set "
        "AGENTA_MCP_GATEWAY_ENABLED=true on this deployment."
    )

    def __init__(self) -> None:
        super().__init__("The MCP gateway is disabled on this deployment.")
