"""Serves the OAuth client identity document (specs-wp20.md).

Fetched by an authorization server, never by an authenticated caller — the path is
listed in `middlewares/auth.py`'s `_PUBLIC_ENDPOINTS`. One static, deployment-wide
document; nothing here reads a project, a secret, or any request state.
"""

from fastapi import APIRouter

from oss.src.core.gateways.mcps.oauth.registration import client_metadata_document
from oss.src.core.gateways.mcps.oauth.service import callback_redirect_uri
from oss.src.utils.env import env


class MCPOAuthClientMetadataRouter:
    def __init__(self) -> None:
        self.router = APIRouter()
        self.router.add_api_route(
            "/oauth/client-metadata.json",
            self.get_client_metadata,
            methods=["GET"],
            operation_id="get_mcp_oauth_client_metadata",
            include_in_schema=False,
        )

    async def get_client_metadata(self) -> dict:
        redirect_uri = callback_redirect_uri(api_url=env.agenta.api_url)
        document = client_metadata_document(
            api_url=env.agenta.api_url, redirect_uri=redirect_uri
        )
        return document.model_dump(mode="json", exclude_none=True)
