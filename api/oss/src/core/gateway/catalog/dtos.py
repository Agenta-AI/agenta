"""Shared catalog DTOs for the gateway.

Providers and integrations are shared across tools and triggers (same Composio
toolkits), so they live here once and both domains consume them directly —
mirroring how `gateway/connections/dtos.py::Connection` is shared. The split
leaves (tool *actions* vs trigger *events*) stay in their own domains.
"""

from enum import Enum
from typing import List, Optional

from pydantic import BaseModel


class CatalogProviderKind(str, Enum):
    COMPOSIO = "composio"
    AGENTA = "agenta"


class CatalogAuthScheme(str, Enum):
    OAUTH = "oauth"
    API_KEY = "api_key"


class CatalogProvider(BaseModel):
    key: CatalogProviderKind
    #
    name: str
    description: Optional[str] = None
    #
    integrations_count: Optional[int] = None


class CatalogIntegration(BaseModel):
    key: str
    #
    name: str
    description: Optional[str] = None
    #
    categories: List[str] = []
    logo: Optional[str] = None
    url: Optional[str] = None
    #
    actions_count: Optional[int] = None
    #
    auth_schemes: Optional[List[CatalogAuthScheme]] = None
