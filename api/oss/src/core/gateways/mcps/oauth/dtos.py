"""DTOs for the MCP OAuth client."""

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class MCPOAuthDiscovery(BaseModel):
    """Feeds `MCPEndpointData.oauth` (`resource`, `authorization_server`,
    `scopes_offered`) and the connect-time scope checklist. No secret involved."""

    resource: str
    authorization_server: str
    scopes_offered: List[str] = []
    authorization_endpoint: str
    token_endpoint: str
    registration_endpoint: Optional[str] = None
    client_id_metadata_document_supported: bool = False
    token_endpoint_auth_methods_supported: list[str] = Field(default_factory=list)


class MCPOAuthAuthorizationStart(BaseModel):
    authorization_url: str
    state: str


class MCPOAuthCompletion(BaseModel):
    project_id: UUID
    user_id: UUID
    endpoint_id: UUID
    server_url: str
    secret_id: UUID


class MCPOAuthAttemptCreate(BaseModel):
    """One authorization attempt, as `begin()` records it.

    Everything here used to travel inside the `state` parameter. It stays server-side
    instead, so the PKCE verifier never reaches the authorization server and the
    callback is bound to the project, the endpoint, the issuer and the user that
    started the flow rather than to whatever a signed blob claimed.
    """

    state: str
    project_id: UUID
    user_id: UUID
    endpoint_id: UUID
    server_url: str
    issuer: str
    token_endpoint: str
    redirect_uri: str
    resource: Optional[str] = None
    code_verifier: str
    scopes: List[str] = Field(default_factory=list)
    strategy: str = "outbound"
    expires_at: datetime


class MCPOAuthAttempt(MCPOAuthAttemptCreate):
    """A recorded authorization attempt, addressed by its opaque `state`."""

    id: UUID
