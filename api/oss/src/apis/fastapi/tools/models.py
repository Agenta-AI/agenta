from typing import Any, List, Optional, Union

from agenta.sdk.agents.tools import (
    BuiltinToolConfig,
    GatewayToolConfig,
    ToolConfigurationError,
    coerce_tool_configs,
)
from pydantic import BaseModel, Field, field_validator

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
    # Tool resolution
    ToolReference,
    ResolvedTool,
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


# ---------------------------------------------------------------------------
# Tool resolution
# ---------------------------------------------------------------------------


class ToolResolveRequest(BaseModel):
    tools: List[ToolReference] = Field(default_factory=list)

    @field_validator("tools", mode="before")
    @classmethod
    def _coerce_tools(cls, value: Any) -> List[ToolReference]:
        try:
            configs = coerce_tool_configs(value or []).tool_configs
        except ToolConfigurationError as exc:
            raise ValueError(str(exc)) from exc
        unsupported = [
            config
            for config in configs
            if not isinstance(config, (BuiltinToolConfig, GatewayToolConfig))
        ]
        if unsupported:
            raise ValueError("/tools/resolve accepts only builtin and gateway tools")
        return configs


class ToolResolveResponse(BaseModel):
    count: int = 0
    builtins: List[str] = Field(default_factory=list)
    custom: List[ResolvedTool] = Field(default_factory=list)
