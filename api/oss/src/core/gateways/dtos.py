"""Shared DTOs for the LLM and MCP gateway planes."""

from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# This platform credential is removed before relaying upstream.
GATEWAY_ONLY_HEADERS = frozenset({"x-ag-credentials"})


class GatewayAuthScheme(str, Enum):
    """How the gateway authenticates to an upstream."""

    OAUTH = "oauth"
    API_KEY = "api_key"
    NONE = "none"


class GatewayConnectionState(str, Enum):
    """Connection state for one caller and endpoint."""

    READY = "ready"  # a usable secret exists for this owner
    NEEDS_AUTH = "needs_auth"  # OAuth target with no usable secret; connect
    NEEDS_INPUT = "needs_input"  # a secret must be supplied before use


class GatewayConnectAffordance(BaseModel):
    """Connection action needed to authorize an endpoint."""

    endpoint: str
    body: Dict[str, Any] = Field(default_factory=dict)


class GatewayConnectionRequirement(BaseModel):
    """One target's secret state, returned from discovery and from a refused
    call. `connect` is present exactly when the state is not READY."""

    target: str  # route path under the plane, e.g. "builtin/composio/notion/my-notion"
    state: GatewayConnectionState
    connect: Optional[GatewayConnectAffordance] = None


class GatewayEndpointNamespace(str, Enum):
    """Gateway route namespace."""

    BUILTIN = "builtin"  # our account; a provider segment follows (agenta, composio)
    STANDARD = "standard"  # a known shape, the user's secret; generated, never a row
    CUSTOM = "custom"  # a row; configurable


class GatewayEndpointRoute(BaseModel):
    """Shared non-secret upstream address and headers."""

    base_url: Optional[str] = None
    headers: Optional[Dict[str, str]] = None


class GatewayEndpointFilter(BaseModel):
    """Allowlist and denylist filter for models or tools."""

    allowlist: Optional[List[str]] = None
    denylist: Optional[List[str]] = None

    def allows(self, name: str) -> bool:
        if self.denylist is not None and name in self.denylist:
            return False
        if self.allowlist is None:
            return True
        return name in self.allowlist

    def enumerate(self) -> List[str]:
        """Return the allowed names that can be listed without upstream discovery."""
        return [name for name in (self.allowlist or []) if self.allows(name)]


class GatewayEndpointSettings(BaseModel):
    """Shared endpoint settings."""

    timeout_seconds: Optional[float] = None
