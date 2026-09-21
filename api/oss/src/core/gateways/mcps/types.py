"""MCP gateway domain exceptions."""

from typing import List, Optional
from uuid import UUID

from oss.src.core.gateways.dtos import (
    GatewayConnectionRequirement,
    GatewayEndpointNamespace,
)
from oss.src.core.gateways.types import GatewaysError


class MCPEndpointNotFoundError(GatewaysError):
    def __init__(
        self,
        *,
        namespace: GatewayEndpointNamespace,
        name: str,
        provider: Optional[str] = None,
        integration: Optional[str] = None,
    ):
        self.namespace = namespace
        self.provider = provider
        self.integration = integration
        self.name = name
        target = "/".join(
            s for s in (namespace.value, provider, integration, name) if s
        )
        super().__init__(f"MCP endpoint not found: {target}")


class MCPToolNotAllowedError(GatewaysError):
    """The named tool is outside the endpoint policy."""

    def __init__(
        self,
        *,
        tool: str,
        namespace: GatewayEndpointNamespace,
        name: str,
        provider: Optional[str] = None,
        integration: Optional[str] = None,
    ):
        self.tool = tool
        self.namespace = namespace
        self.provider = provider
        self.integration = integration
        self.name = name
        target = "/".join(
            s for s in (namespace.value, provider, integration, name) if s
        )
        super().__init__(f"Tool {tool} not allowed on {target}")


class MCPAuthRequiredError(GatewaysError):
    """No usable OAuth grant is available for the endpoint."""

    def __init__(self, *, requirement: GatewayConnectionRequirement):
        self.requirement = requirement
        super().__init__(f"Authorization required for {requirement.target}")


class MCPScopeInsufficientError(GatewaysError):
    """The upstream requires additional OAuth scopes."""

    def __init__(
        self,
        *,
        target: str,
        scopes: List[str],
        endpoint_id: Optional[UUID] = None,
    ):
        self.target = target
        self.scopes = scopes
        self.endpoint_id = endpoint_id
        super().__init__(f"Additional scopes required for {target}: {scopes}")


class MCPUpstreamError(GatewaysError):
    def __init__(
        self,
        *,
        target: str,
        status_code: Optional[int] = None,
        detail: Optional[str] = None,
    ):
        self.target = target
        self.status_code = status_code
        self.detail = detail
        super().__init__(f"Upstream {target} failed ({status_code})")


class MCPAgentaToolNotEntitledError(GatewaysError):
    """A credential mint named callback tools its caller is not entitled to.

    Raised by the builtin Agenta MCP mint when the requested tool list is not within the
    bound the caller may narrow from. Carries the refused entries so the caller learns
    which ones, rather than guessing.
    """

    def __init__(self, *, tools: List[str]):
        self.tools = tools
        super().__init__(
            "Agenta MCP credential requested tools outside the entitled set: "
            + ", ".join(tools)
        )


class MCPConnectionNameTakenError(GatewaysError):
    """Another connection in this project already answers to this display name.

    The name is not merely a label. A harness renders one of this server's tools as
    `mcp__<name>__<tool>`, and the model chooses a tool by that string, so two
    connections sharing a name give the model no way to say which account it means and
    give the runner two tools it cannot tell apart.

    Compared after normalization rather than verbatim, because that rendering maps every
    character outside `[A-Za-z0-9_]` to an underscore: "Acme Notion" and "Acme-Notion"
    are two display names that produce one tool prefix, and refusing only exact matches
    would let that pair through.
    """

    def __init__(self, *, name: str, conflicting_slug: str):
        self.name = name
        self.conflicting_slug = conflicting_slug
        super().__init__(
            "Another connection in this project already uses this name; "
            "pick a different one."
        )
