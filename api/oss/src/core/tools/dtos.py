from typing import Any, Dict, List, Literal, Optional
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from oss.src.core.shared.dtos import (
    Tags,
    Windowing,
)


# ---------------------------------------------------------------------------
# Catalog query DTOs
# ---------------------------------------------------------------------------


class ActionQuery(BaseModel):
    """Filter criteria for catalog actions (POST /tools/catalog/query)."""

    name: Optional[str] = None  # ilike %name%
    description: Optional[str] = None  # ilike %description%
    provider_key: Optional[str] = None  # exact match
    integration_key: Optional[str] = None  # exact match
    tags: Optional[Tags] = None  # jsonb contains


class ActionQueryRequest(BaseModel):
    """POST /tools/catalog/query request body."""

    action: Optional[ActionQuery] = None
    #
    windowing: Optional[Windowing] = None


# ---------------------------------------------------------------------------
# Tool query DTOs
# ---------------------------------------------------------------------------


class ToolQueryFlags(BaseModel):
    """Boolean flags for tool filtering."""

    is_connected: Optional[bool] = (
        None  # true=connected only, false=unconnected, None=all
    )


class ToolQuery(BaseModel):
    """Filter criteria for tools (POST /tools/query)."""

    name: Optional[str] = None  # ilike %name%
    description: Optional[str] = None  # ilike %description%
    provider_key: Optional[str] = None  # exact match
    integration_key: Optional[str] = None  # exact match
    tags: Optional[Tags] = None  # jsonb contains
    flags: Optional[ToolQueryFlags] = None


class ToolQueryRequest(BaseModel):
    """POST /tools/query request body."""

    tool: Optional[ToolQuery] = None
    #
    include_connections: Optional[bool] = True
    #
    windowing: Optional[Windowing] = None


# ---------------------------------------------------------------------------
# Connection DTOs
# ---------------------------------------------------------------------------


class ConnectionCreate(BaseModel):
    """Payload for creating a new connection."""

    slug: str
    name: Optional[str] = None
    description: Optional[str] = None
    mode: Literal["oauth", "api_key"]
    callback_url: Optional[str] = None
    credentials: Optional[Dict[str, str]] = None


class Connection(BaseModel):
    """Persisted connection entity."""

    id: UUID
    slug: str
    name: Optional[str] = None
    description: Optional[str] = None
    #
    provider_key: str
    integration_key: str
    #
    provider_connection_id: Optional[str] = None
    auth_config_id: Optional[str] = None
    #
    is_active: bool = True
    is_valid: bool = False
    status: Optional[str] = None
    #
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    created_by_id: Optional[UUID] = None


class ConnectResult(BaseModel):
    """Result of a connect operation."""

    connection: Connection
    redirect_url: Optional[str] = None


# ---------------------------------------------------------------------------
# Adapter DTOs — what adapters return
# ---------------------------------------------------------------------------


class CatalogProvider(BaseModel):
    """Provider summary (e.g. Composio, Agenta)."""

    key: str
    name: str
    description: Optional[str] = None
    integrations_count: int = 0
    enabled: bool = True


class CatalogIntegration(BaseModel):
    """Integration summary (e.g. Gmail, GitHub)."""

    key: str
    name: str
    description: Optional[str] = None
    logo: Optional[str] = None
    auth_schemes: List[str] = []
    actions_count: int = 0
    categories: List[str] = []
    no_auth: bool = False
    connections_count: int = 0


class CatalogAction(BaseModel):
    """Action from the catalog (leaf entity)."""

    key: str
    name: str
    description: Optional[str] = None
    tags: Optional[Tags] = None
    input_schema: Optional[Dict[str, Any]] = None
    output_schema: Optional[Dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Execution DTOs
# ---------------------------------------------------------------------------


class ExecutionResult(BaseModel):
    """Result from adapter.execute()."""

    data: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    successful: bool = True
