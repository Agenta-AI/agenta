"""`MCPOAuthConnectService` (specs-wp17.md "The two-phase connect service").

`begin()`/`complete()` are the only entry points WP18's two routes need. Neither touches
an `MCPEndpoint` row — `complete()` returns the written secret's id, and wiring it onto
`endpoint.secret_id` stays `edit_endpoint`'s job (entities.md §9: "the same door every
other field uses").
"""

from typing import List
from uuid import UUID

from oss.src.core.gateways.mcps.oauth.client import MCPOAuthClient
from oss.src.core.gateways.mcps.oauth.dtos import (
    MCPOAuthAuthorizationStart,
    MCPOAuthCompletion,
    MCPOAuthDiscovery,
)
from oss.src.core.gateways.mcps.oauth.state import decode_state, make_state
from oss.src.core.gateways.mcps.oauth.storage import SecretsTokenStorage
from oss.src.core.gateways.mcps.oauth.types import (
    MCPOAuthClientNotRegisteredError,
    MCPOAuthStateInvalidError,
)
from oss.src.core.secrets.services import VaultService

_CALLBACK_PATH = "/gateways/mcps/connect/callback"


def callback_redirect_uri(*, api_url: str) -> str:
    """The fixed redirect URI registered with every authorization server — never
    per-flow (specs-wp17.md: disambiguated by `state`, not by the URL)."""
    return f"{api_url.rstrip('/')}{_CALLBACK_PATH}"


class MCPOAuthConnectService:
    def __init__(
        self,
        *,
        vault_service: VaultService,
        client: MCPOAuthClient,
        api_url: str,
        secret_key: str,
    ) -> None:
        self.vault_service = vault_service
        self.client = client
        self.api_url = api_url
        self.secret_key = secret_key

    async def discover(self, *, server_url: str) -> MCPOAuthDiscovery:
        return await self.client.discover(server_url=server_url)

    async def begin(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        server_url: str,
        scopes: List[str],
    ) -> MCPOAuthAuthorizationStart:
        discovery = await self.client.discover(server_url=server_url)
        redirect_uri = callback_redirect_uri(api_url=self.api_url)

        storage = SecretsTokenStorage(
            vault_service=self.vault_service,
            project_id=project_id,
            server_url=server_url,
            authorization_server=discovery.authorization_server,
        )

        client_info = await storage.get_client_info()
        if client_info is None:
            client_info = await self.client.register(
                authorization_server=discovery.authorization_server,
                registration_endpoint=discovery.registration_endpoint,
                redirect_uri=redirect_uri,
                scopes=scopes,
            )
            await storage.set_client_info(client_info)

        pkce = self.client.build_pkce()
        state = make_state(
            project_id=project_id,
            user_id=user_id,
            server_url=server_url,
            code_verifier=pkce.code_verifier,
            scopes=scopes,
            secret_key=self.secret_key,
        )

        authorization_url = self.client.authorization_url(
            authorization_endpoint=discovery.authorization_endpoint,
            client_id=client_info.client_id or "",
            redirect_uri=redirect_uri,
            code_challenge=pkce.code_challenge,
            state=state,
            scopes=scopes,
            resource=discovery.resource,
        )

        return MCPOAuthAuthorizationStart(
            authorization_url=authorization_url, state=state
        )

    async def complete(self, *, code: str, state: str) -> MCPOAuthCompletion:
        payload = decode_state(state, secret_key=self.secret_key)
        if payload is None:
            raise MCPOAuthStateInvalidError()

        project_id = UUID(payload["project_id"])
        server_url = payload["server_url"]
        code_verifier = payload["code_verifier"]

        discovery = await self.client.discover(server_url=server_url)
        redirect_uri = callback_redirect_uri(api_url=self.api_url)

        storage = SecretsTokenStorage(
            vault_service=self.vault_service,
            project_id=project_id,
            server_url=server_url,
            authorization_server=discovery.authorization_server,
        )

        client_info = await storage.get_client_info()
        if client_info is None:
            raise MCPOAuthClientNotRegisteredError(server_url=server_url)

        tokens = await self.client.exchange_token(
            token_endpoint=discovery.token_endpoint,
            code=code,
            code_verifier=code_verifier,
            redirect_uri=redirect_uri,
            client_info=client_info,
            resource=discovery.resource,
        )
        grant = await storage.write_tokens(tokens)

        return MCPOAuthCompletion(
            project_id=project_id, server_url=server_url, secret_id=grant.id
        )
