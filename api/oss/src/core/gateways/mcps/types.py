"""MCP plane domain exceptions (entities.md §5)."""

from typing import List, Optional

from oss.src.core.gateways.dtos import (
    GatewayConnectionRequirement,
    GatewayEndpointNamespace,
)
from oss.src.core.gateways.types import GatewaysError


class McpEndpointNotFoundError(GatewaysError):
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


class McpToolNotAllowedError(GatewaysError):
    """The named tool is outside the endpoint's tool policy (§2.4)."""

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


class McpAuthRequiredError(GatewaysError):
    """No usable grant for this owner on an OAuth endpoint. Carries the
    requirement so the boundary can return the connect affordance instead of a
    bare failure (D17)."""

    def __init__(self, *, requirement: GatewayConnectionRequirement):
        self.requirement = requirement
        super().__init__(f"Authorization required for {requirement.target}")


class McpScopeInsufficientError(GatewaysError):
    """A step-up scope challenge from the upstream (D17; `mcp.md`). Raised by
    the OAuth checkpoint's client; until then unreachable. Declared now so the
    interaction path can be typed against it."""

    def __init__(self, *, target: str, scopes: List[str]):
        self.target = target
        self.scopes = scopes
        super().__init__(f"Additional scopes required for {target}: {scopes}")


class McpUpstreamError(GatewaysError):
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
