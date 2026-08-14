"""Shared vocabulary for both gateway planes (entities.md §4.1).

The gateways are a separate domain from `core/gateway/` (the integrations surface) and
define their own copies of the auth-scheme / connection-state vocabulary rather than
importing the existing triplicate copies in `core/gateway/connections/dtos.py`,
`core/tools/dtos.py` and `core/triggers/dtos.py` (OR4).
"""

from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# Inbound headers that authenticate the caller INTO the gateway (D13, D31). They are
# ours, never the upstream's, and are stripped on both planes before any relay.
GATEWAY_ONLY_HEADERS = frozenset({"x-ag-credentials", "authorization"})


class GatewayAuthScheme(str, Enum):
    """How an upstream authenticates us. The gateways' own copy (OR4, §4.1)."""

    OAUTH = "oauth"
    API_KEY = "api_key"
    NONE = "none"


class GatewayConnectionState(str, Enum):
    """Derived per caller at read time — never stored (§2.6)."""

    READY = "ready"  # a usable secret exists for this owner
    NEEDS_AUTH = "needs_auth"  # OAuth target with no usable secret; connect
    NEEDS_INPUT = "needs_input"  # a secret must be supplied before use


class GatewayConnectAffordance(BaseModel):
    """The call to make when a secret is missing — an interaction, not a
    failure (D17). Same shape as the tools domain's ConnectAffordance."""

    endpoint: str
    body: Dict[str, Any] = Field(default_factory=dict)


class GatewayConnectionRequirement(BaseModel):
    """One target's secret state, returned from discovery and from a refused
    call. `connect` is present exactly when the state is not READY."""

    target: str  # route path under the plane, e.g. "builtin/composio/notion/my-notion"
    state: GatewayConnectionState
    connect: Optional[GatewayConnectAffordance] = None


class GatewayEndpointNamespace(str, Enum):
    """The first URL segment under either plane — the same three words on both
    (§2.3, D30). The namespace selects the backend, and splits on whose secret pays:
    builtin is ours and bills through us, standard and custom are the user's."""

    BUILTIN = "builtin"  # our account; a provider segment follows (agenta, composio)
    STANDARD = "standard"  # a known shape, the user's secret; generated, never a row
    CUSTOM = "custom"  # a row; configurable


class GatewayEndpointRoute(BaseModel):
    """Where and how to dial an upstream — the two fields both planes share (§2.4).
    `headers` is addressing, never a secret: `Authorization` is derived from the
    resolved secret and overwrites whatever is set here (§7.2)."""

    base_url: Optional[str] = None
    headers: Optional[Dict[str, str]] = None


class GatewayEndpointFilter(BaseModel):
    """One name filter, the same shape for LLM models and MCP tools (§2.4).

    Absent list = no constraint from that side; `allowlist: []` refuses everything;
    `denylist` always wins. Exact names only — a glob syntax would need its own
    decision on both planes at once.
    """

    allowlist: Optional[List[str]] = None
    denylist: Optional[List[str]] = None

    def allows(self, name: str) -> bool:
        if self.denylist is not None and name in self.denylist:
            return False
        if self.allowlist is None:
            return True
        return name in self.allowlist

    def enumerate(self) -> List[str]:
        """What can be listed, which is only ever the allowlist minus the denylist —
        with no allowlist the gateway does not know the upstream's catalogue (§2.4)."""
        return [name for name in (self.allowlist or []) if self.allows(name)]


class GatewayEndpointSettings(BaseModel):
    """Per-endpoint settings, one concern for both planes (D21). Custom endpoints
    only; generated endpoints take the code defaults."""

    timeout_seconds: Optional[float] = None
