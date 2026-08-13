"""Shared vocabulary for both gateway planes (entities.md §4.1).

The gateways are a separate domain from `core/gateway/` (the integrations surface) and
define their own copies of the auth-scheme / connection-state vocabulary rather than
importing the existing triplicate copies in `core/gateway/connections/dtos.py`,
`core/tools/dtos.py` and `core/triggers/dtos.py` (OR4).
"""

from enum import Enum
from typing import Any, Dict, Optional

from pydantic import BaseModel, Field


class GatewayAuthScheme(str, Enum):
    """How an upstream authenticates us. The gateways' own copy (OR4, §4.1)."""

    OAUTH = "oauth"
    API_KEY = "api_key"
    NONE = "none"


class GatewayConnectionState(str, Enum):
    """Derived per caller at read time — never stored (§2.6)."""

    READY = "ready"  # a usable secret exists for this owner
    NEEDS_AUTH = "needs_auth"  # OAuth target with no grant for this owner; connect
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


class GatewayEndpointConfig(BaseModel):
    """Per-endpoint configuration, one concern for both planes (D21). Custom
    endpoints only; generated endpoints take the code defaults."""

    timeout_seconds: Optional[float] = None
    extra_headers: Optional[Dict[str, str]] = None
