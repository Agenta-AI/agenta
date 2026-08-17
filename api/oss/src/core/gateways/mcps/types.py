"""MCP plane domain exceptions (entities.md §5)."""

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


class MCPAuthRequiredError(GatewaysError):
    """No usable grant for this owner on an OAuth endpoint. Carries the
    requirement so the boundary can return the connect affordance instead of a
    bare failure (D17)."""

    def __init__(self, *, requirement: GatewayConnectionRequirement):
        self.requirement = requirement
        super().__init__(f"Authorization required for {requirement.target}")


class MCPScopeInsufficientError(GatewaysError):
    """A step-up scope challenge from the upstream (D17; `mcp.md`; WP19). Raised by
    `MCPGatewayService.relay` when a `custom` OAuth endpoint's upstream answers 403
    with an RFC 6750 `insufficient_scope` challenge. `endpoint_id` is optional so the
    boundary can attach a connect affordance without widening every existing caller
    (specs-wp17.md/wp18.md's own precedent — WP17's tests construct this with only
    `target`/`scopes`)."""

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
