from enum import Enum
from typing import Any, Dict, Optional

from pydantic import BaseModel, Field

from oss.src.core.shared.dtos import (
    Header,
    Identifier,
    Lifecycle,
    Metadata,
    Slug,
    Json,
)

# ---------------------------------------------------------------------------
# Connection Enums
# ---------------------------------------------------------------------------


class ConnectionProviderKind(str, Enum):
    COMPOSIO = "composio"
    AGENTA = "agenta"


class ConnectionAuthScheme(str, Enum):
    OAUTH = "oauth"
    API_KEY = "api_key"


# ---------------------------------------------------------------------------
# Connections (domain DTOs)
# ---------------------------------------------------------------------------


class ConnectionStatus(BaseModel):
    redirect_url: Optional[str] = None


class ConnectionCreateData(BaseModel):
    # Control inputs (from the API): route the provider auth-config type. Never
    # persisted — the service overwrites data wholesale before the DAO write.
    callback_url: Optional[str] = None
    auth_scheme: Optional[ConnectionAuthScheme] = None
    # Provider + service outputs (persisted): the service fills these from the
    # provider result before persistence. No secrets — the API key is entered on
    # the provider's hosted redirect UI, never in this payload.
    connected_account_id: Optional[str] = None
    auth_config_id: Optional[str] = None
    redirect_url: Optional[str] = None
    project_id: Optional[str] = None
    no_auth: Optional[bool] = None


class Connection(
    Identifier,
    Slug,
    Header,
    Lifecycle,
    Metadata,
):
    provider_key: ConnectionProviderKind
    integration_key: str
    #
    data: Optional[Json] = None
    #
    status: Optional[ConnectionStatus] = None

    @property
    def provider_connection_id(self) -> Optional[str]:
        """Get provider-specific connection ID from data."""
        if self.data and isinstance(self.data, dict):
            # For Composio, it's stored as "connected_account_id"
            return self.data.get("connected_account_id") or self.data.get(
                "provider_connection_id"
            )
        return None

    @property
    def is_active(self) -> bool:
        """Check if connection is active (not deleted)."""
        if self.flags and isinstance(self.flags, dict):
            return self.flags.get("is_active", False)
        return False

    @property
    def is_valid(self) -> bool:
        """Check if connection is valid (authenticated)."""
        if self.flags and isinstance(self.flags, dict):
            return self.flags.get("is_valid", False)
        return False

    @property
    def has_auth(self) -> bool:
        """False for a no-auth toolkit connection (no Composio auth config/account)."""
        return not (
            self.data and isinstance(self.data, dict) and self.data.get("no_auth")
        )


class ConnectionCreate(
    Slug,
    Header,
    Metadata,
):
    provider_key: ConnectionProviderKind
    integration_key: str
    #
    data: Optional[ConnectionCreateData] = None


class Usage(BaseModel):
    """Cross-domain usage of a connection (C7).

    Reports how many consumers reference a given connection. ``tools`` is True
    when the connection backs the tools domain; ``subscriptions`` counts trigger
    subscriptions that read the same shared row.
    """

    tools: bool = False
    subscriptions: int = 0


# ---------------------------------------------------------------------------
# Connection (adapter-level DTOs)
# ---------------------------------------------------------------------------


class ConnectionRequest(BaseModel):
    """Input DTO for initiating a provider connection via a gateway adapter."""

    user_id: str
    integration_key: str
    auth_scheme: Optional[str] = None
    callback_url: Optional[str] = None


class ConnectionResponse(BaseModel):
    """Output DTO from ConnectionsGatewayInterface.initiate_connection.

    The adapter builds ``connection_data`` with provider-specific fields so the
    service never needs to know which provider it is talking to.
    """

    provider_connection_id: str
    redirect_url: Optional[str] = None
    connection_data: Dict[str, Any] = Field(default_factory=dict)


class ConnectionStatusResponse(BaseModel):
    """Output DTO from ConnectionsGatewayInterface.get_connection_status."""

    status: Optional[str] = None
    is_valid: bool = False


class ConnectionRefreshResponse(BaseModel):
    """Output DTO from ConnectionsGatewayInterface.refresh_connection."""

    id: Optional[str] = None
    status: Optional[str] = None
    is_valid: Optional[bool] = None
    redirect_url: Optional[str] = None
    auth_config_id: Optional[str] = None
