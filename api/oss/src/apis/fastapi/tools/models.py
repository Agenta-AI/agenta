from typing import List, Optional, Union

from pydantic import BaseModel

from oss.src.core.tools.dtos import (
    # Tool Catalog
    ToolCatalogAction,
    ToolCatalogActionDetails,
    ToolCatalogIntegration,
    ToolCatalogIntegrationDetails,
    ToolCatalogProvider,
    ToolCatalogProviderDetails,
    # Tool Connections
    ToolConnection,
    ToolConnectionCreate,
    # Tool Calls
    ToolResult,
)


# ---------------------------------------------------------------------------
# Tool Catalog
# ---------------------------------------------------------------------------


class ToolCatalogProviderResponse(BaseModel):
    count: int = 0
    provider: Optional[Union[ToolCatalogProvider, ToolCatalogProviderDetails]] = None


class ToolCatalogProvidersResponse(BaseModel):
    count: int = 0
    providers: List[Union[ToolCatalogProvider, ToolCatalogProviderDetails]] = []


class ToolCatalogIntegrationResponse(BaseModel):
    count: int = 0
    integration: Optional[
        Union[ToolCatalogIntegration, ToolCatalogIntegrationDetails]
    ] = None


class ToolCatalogIntegrationsResponse(BaseModel):
    count: int = 0
    total: int = 0
    cursor: Optional[str] = None
    integrations: List[
        Union[ToolCatalogIntegration, ToolCatalogIntegrationDetails]
    ] = []


class ToolCatalogActionResponse(BaseModel):
    count: int = 0
    action: Optional[Union[ToolCatalogAction, ToolCatalogActionDetails]] = None


class ToolCatalogActionsResponse(BaseModel):
    count: int = 0
    total: int = 0
    cursor: Optional[str] = None
    actions: List[Union[ToolCatalogAction, ToolCatalogActionDetails]] = []


# ---------------------------------------------------------------------------
# Tool Connections
# ---------------------------------------------------------------------------


class ToolConnectionCreateRequest(BaseModel):
    connection: ToolConnectionCreate


class ToolConnectionResponse(BaseModel):
    count: int = 0
    connection: Optional[ToolConnection] = None


class ToolConnectionsResponse(BaseModel):
    count: int = 0
    connections: List[ToolConnection] = []


# ---------------------------------------------------------------------------
# Tool Calls
# ---------------------------------------------------------------------------


class ToolCallResponse(BaseModel):
    call: ToolResult
