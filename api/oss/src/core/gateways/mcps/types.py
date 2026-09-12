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
