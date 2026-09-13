"""Run the two-phase MCP OAuth connection flow."""

from datetime import datetime, timedelta, timezone
from typing import List, Optional, Tuple
from uuid import UUID

from mcp.shared.auth import OAuthClientInformationFull

from oss.src.core.gateways.mcps.oauth.client import MCPOAuthClient
from oss.src.core.gateways.mcps.oauth.dtos import (
    MCPOAuthAttemptCreate,
    MCPOAuthAuthorizationStart,
    MCPOAuthCompletion,
    MCPOAuthDiscovery,
)
from oss.src.core.gateways.mcps.oauth.interfaces import MCPOAuthAttemptsDAOInterface
from oss.src.core.gateways.mcps.oauth.registration import (
    Resolver,
    identity_document_client_info,
    is_publicly_resolvable,
)
from oss.src.core.gateways.mcps.oauth.state import STATE_TTL_SECONDS, new_state
from oss.src.core.gateways.mcps.oauth.storage import SecretsTokenStorage
from oss.src.core.gateways.mcps.oauth.types import (
    MCPOAuthCallerMismatchError,
    MCPOAuthClientNotRegisteredError,
    MCPOAuthStateExpiredError,
    MCPOAuthStateInvalidError,
)
from oss.src.core.secrets.services import VaultService

_CALLBACK_PATH = "/gateways/mcps/connect/callback"


def callback_redirect_uri(*, api_url: str) -> str:
    """Return the fixed OAuth callback URI."""
    return f"{api_url.rstrip('/')}{_CALLBACK_PATH}"


class MCPOAuthConnectService:
    def __init__(
        self,
        *,
        vault_service: VaultService,
        client: MCPOAuthClient,
        api_url: str,
        attempts_dao: MCPOAuthAttemptsDAOInterface,
        resolve: Optional[Resolver] = None,
    ) -> None:
        self.vault_service = vault_service
        self.client = client
        self.api_url = api_url
        self.attempts_dao = attempts_dao
        # Tests may inject DNS resolution.
        self._resolve_kwargs = {"resolve": resolve} if resolve is not None else {}

    async def discover(self, *, server_url: str) -> MCPOAuthDiscovery:
        return await self.client.discover(server_url=server_url)

    async def _resolve_client_info(
        self,
        *,
        storage: SecretsTokenStorage,
        discovery: MCPOAuthDiscovery,
        redirect_uri: str,
        scopes: List[str],
    ) -> Tuple[OAuthClientInformationFull, str]:
        """Reuse registration, use an identity document, or register a client."""
        stored = await storage.get_client_info()
        if stored is not None:
            return stored, "outbound"

        if is_publicly_resolvable(self.api_url, **self._resolve_kwargs):
            return (
                identity_document_client_info(
                    api_url=self.api_url, redirect_uri=redirect_uri
                ),
                "document",
            )

        registered = await self.client.register(
            authorization_server=discovery.authorization_server,
            registration_endpoint=discovery.registration_endpoint,
            redirect_uri=redirect_uri,
            scopes=scopes,
        )
        await storage.set_client_info(registered)
        return registered, "outbound"

    async def begin(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        endpoint_id: UUID,
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

        client_info, strategy = await self._resolve_client_info(
            storage=storage,
            discovery=discovery,
            redirect_uri=redirect_uri,
            scopes=scopes,
        )

        pkce = self.client.build_pkce()
        state = new_state()

        # The record is written BEFORE the browser is sent anywhere. A handle that
        # reaches the authorization server always has a record behind it.
        await self.attempts_dao.create_attempt(
            attempt=MCPOAuthAttemptCreate(
                state=state,
                project_id=project_id,
                user_id=user_id,
                endpoint_id=endpoint_id,
                server_url=server_url,
                issuer=discovery.authorization_server,
                token_endpoint=discovery.token_endpoint,
                redirect_uri=redirect_uri,
                resource=discovery.resource,
                code_verifier=pkce.code_verifier,
                scopes=list(scopes),
                strategy=strategy,
                expires_at=datetime.now(timezone.utc)
                + timedelta(seconds=STATE_TTL_SECONDS),
            )
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

    async def complete(
        self,
        *,
        code: str,
        state: str,
        caller_user_id: Optional[UUID],
    ) -> MCPOAuthCompletion:
        """Exchange the code against the attempt the handle names.

        `caller_user_id` is the user behind the browser that presented the callback.
        The authorization server also holds the handle, so the attempt is checked
        against that caller before anything is consumed or written.
        """
        attempt = await self.attempts_dao.fetch_attempt(state=state)
        if attempt is None:
            raise MCPOAuthStateInvalidError()

        # Refuse before consuming: a stranger presenting someone else's handle must
        # not be able to burn it, and this path writes nothing at all.
        if caller_user_id is None or caller_user_id != attempt.user_id:
            raise MCPOAuthCallerMismatchError()

        consumed = await self.attempts_dao.consume_attempt(state=state)
        if consumed is None:
            # Another callback took it between the read and the delete.
            raise MCPOAuthStateInvalidError()

        if consumed.expires_at <= datetime.now(timezone.utc):
            raise MCPOAuthStateExpiredError()

        # Issuer, token endpoint and redirect URI come from the record, not from a
        # fresh discovery round: the server cannot move its token endpoint between the
        # redirect it was handed and the code it returns.
        storage = SecretsTokenStorage(
            vault_service=self.vault_service,
            project_id=consumed.project_id,
            server_url=consumed.server_url,
            authorization_server=consumed.issuer,
        )

        if consumed.strategy == "document":
            # Identity-document client information is deterministic and not persisted.
            client_info = identity_document_client_info(
                api_url=self.api_url, redirect_uri=consumed.redirect_uri
            )
        else:
            client_info = await storage.get_client_info()
            if client_info is None:
                raise MCPOAuthClientNotRegisteredError(server_url=consumed.server_url)

        tokens = await self.client.exchange_token(
            token_endpoint=consumed.token_endpoint,
            code=code,
            code_verifier=consumed.code_verifier,
            redirect_uri=consumed.redirect_uri,
            client_info=client_info,
            resource=consumed.resource,
        )
        grant = await storage.write_tokens(tokens)

        return MCPOAuthCompletion(
            project_id=consumed.project_id,
            user_id=consumed.user_id,
            endpoint_id=consumed.endpoint_id,
            server_url=consumed.server_url,
            secret_id=grant.id,
        )

    async def sweep_expired_attempts(self) -> int:
        """Drop attempts nobody came back for. Driven by the cron service."""
        return await self.attempts_dao.sweep_expired_attempts()
