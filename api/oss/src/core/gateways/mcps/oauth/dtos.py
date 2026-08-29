"""DTOs for the MCP OAuth client."""

from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel


class MCPOAuthDiscovery(BaseModel):
    """Feeds `MCPEndpointData.oauth` (`resource`, `authorization_server`,
    `scopes_offered`) and the connect-time scope checklist. No secret involved."""

    resource: str
    authorization_server: str
    scopes_offered: List[str] = []
    authorization_endpoint: str
    token_endpoint: str
    registration_endpoint: Optional[str] = None


class MCPOAuthAuthorizationStart(BaseModel):
    authorization_url: str
    state: str


class MCPOAuthCompletion(BaseModel):
    project_id: UUID
    server_url: str
    secret_id: UUID
