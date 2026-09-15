"""Run the two-phase MCP OAuth connection flow, and renew the grants it stores."""

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple
from uuid import UUID

from mcp.shared.auth import OAuthClientInformationFull

from oss.src.core.gateways.mcps.oauth.client import MCPOAuthClient, same_issuer
from oss.src.core.gateways.mcps.oauth.dtos import (
    MCPOAuthAttempt,
    MCPOAuthAttemptCreate,
    MCPOAuthAuthorizationStart,
    MCPOAuthCompletion,
    MCPOAuthDiscovery,
)
from oss.src.core.gateways.mcps.oauth.interfaces import (
    MCPOAuthAttemptsDAOInterface,
    MCPOAuthRefresherInterface,
)
from oss.src.core.gateways.mcps.oauth.registration import (
    Resolver,
    identity_document_client_info,
    is_publicly_resolvable,
    registration_covers,
)
from oss.src.core.gateways.mcps.oauth.state import STATE_TTL_SECONDS, new_state
from oss.src.core.gateways.mcps.oauth.storage import (
    SecretsTokenStorage,
    grant_settings_expired,
)
from oss.src.core.gateways.mcps.oauth.types import (
    MCPOAuthCallerMismatchError,
    MCPOAuthClientNotRegisteredError,
    MCPOAuthIssuerChangedError,
    MCPOAuthRefreshFailedError,
    MCPOAuthStateExpiredError,
    MCPOAuthStateInvalidError,
    MCPOAuthTokenExchangeError,
    MCPOAuthRegistrationUnavailableError,
)
from oss.src.core.secrets.dtos import OAuthGrantSettingsDTO
from oss.src.core.secrets.services import VaultService

_CALLBACK_PATH = "/gateways/mcps/connect/callback"


def callback_redirect_uri(*, api_url: str) -> str:
    """Return the fixed OAuth callback URI."""
    return f"{api_url.rstrip('/')}{_CALLBACK_PATH}"


class MCPOAuthConnectService(MCPOAuthRefresherInterface):
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
        # One lock per connection. See `refresh_grant`.
        self._refresh_locks: Dict[Tuple[UUID, UUID], asyncio.Lock] = {}

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
        if stored is not None and registration_covers(
            stored, redirect_uri=redirect_uri
        ):
            return stored, "outbound"

        # A stored registration that does not cover the callback this deployment would
        # send is not reusable, and falls through to a fresh registration below (OR78).
        #
        # A registration under RFC 7591 is bound to the redirect URIs it was created
        # with. A deployment's public address changes whenever a tunnel is added,
        # rotated or dropped, and the stored registration was then found, its
        # `client_id` sent, and the authorization server refused it: the client it knows
        # is registered against an address the request no longer uses. Nothing
        # re-registered, so the connection stayed unconnectable until someone deleted
        # the record by hand, and the error the person saw was the authorization
        # server's, which says nothing about redirect URIs.
        #
        # `set_client_info` writes under the same issuer-derived slug, so the fresh
        # registration replaces the stale one rather than accumulating beside it.

        # Register when the authorization server says it accepts registrations, and fall
        # back to the identity document only when it does not.
        #
        # The order used to be the other way round, and it made every real server fail.
        # A client-id metadata document is a draft that almost nothing implements, so an
        # authorization server handed one sees a client id it has never issued and refuses
        # the authorization outright. Linear answers "the clientId provided does not match
        # to this client", and it advertises a registration endpoint, which is what it
        # actually wanted us to use. Dynamic client registration is RFC 7591 and is what
        # servers in this ecosystem support today.
        #
        # The document still has a job: an authorization server that advertises no
        # registration endpoint cannot be registered with, and then a public identity
        # document is the only way to name ourselves.
        if not discovery.registration_endpoint:
            if is_publicly_resolvable(self.api_url, **self._resolve_kwargs):
                return (
                    identity_document_client_info(
                        api_url=self.api_url, redirect_uri=redirect_uri
                    ),
                    "document",
                )
            raise MCPOAuthRegistrationUnavailableError(
                authorization_server=discovery.authorization_server
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
            endpoint_id=endpoint_id,
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

    async def claim(
        self,
        *,
        state: str,
        caller_user_id: Optional[UUID],
    ) -> MCPOAuthAttempt:
        """Consume the attempt the handle names and hand it to the caller.

        This is the first half of the callback, split from `complete()` so that the
        facts the caller must be authorised against — the project above all — are in
        the caller's hands BEFORE any code is exchanged or any grant is written. The
        record is consumed atomically (`DELETE ... RETURNING`), so there is no read
        that leaves the handle probeable, and a caller refused after this point has
        spent the attempt: single-use is the property that makes the handle safe, and
        the person must start the connection again.

        `caller_user_id` is the user behind the browser that presented the callback.
        The authorization server also holds the handle, so the attempt is checked
        against that caller before anything is consumed at all.
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

        return consumed

    async def complete(
        self,
        *,
        attempt: MCPOAuthAttempt,
        code: str,
    ) -> MCPOAuthCompletion:
        """Exchange the code for a grant and write it into the attempt's project.

        Takes the attempt `claim()` returned rather than the `state` handle: everything
        here writes, so the caller has already authorised itself against that record.
        """
        # Issuer, token endpoint and redirect URI come from the record, not from a
        # fresh discovery round: the server cannot move its token endpoint between the
        # redirect it was handed and the code it returns.
        storage = SecretsTokenStorage(
            vault_service=self.vault_service,
            project_id=attempt.project_id,
            server_url=attempt.server_url,
            # The connection the person pressed connect on, carried through the browser
            # leg on the attempt. The grant is written for that connection, so a second
            # account at the same server gets its own row instead of overwriting the
            # first one's.
            endpoint_id=attempt.endpoint_id,
            authorization_server=attempt.issuer,
        )

        if attempt.strategy == "document":
            # Identity-document client information is deterministic and not persisted.
            client_info = identity_document_client_info(
                api_url=self.api_url, redirect_uri=attempt.redirect_uri
            )
        else:
            client_info = await storage.get_client_info()
            if client_info is None:
                raise MCPOAuthClientNotRegisteredError(server_url=attempt.server_url)

        tokens = await self.client.exchange_token(
            token_endpoint=attempt.token_endpoint,
            code=code,
            code_verifier=attempt.code_verifier,
            redirect_uri=attempt.redirect_uri,
            client_info=client_info,
            resource=attempt.resource,
        )
        # `storage` carries the attempt's issuer, so the grant is written pinned to the
        # authorization server that actually issued it. `refresh_grant` requires that
        # pin to still hold before it presents the refresh token anywhere.
        grant = await storage.write_tokens(tokens)

        return MCPOAuthCompletion(
            project_id=attempt.project_id,
            user_id=attempt.user_id,
            endpoint_id=attempt.endpoint_id,
            server_url=attempt.server_url,
            secret_id=grant.id,
        )

    async def disconnect(
        self, *, project_id: UUID, endpoint_id: UUID, server_url: str
    ) -> bool:
        """Drop one connection's stored grant. Returns whether there was one.

        The inverse of `complete()`, and keyed the same way, so disconnecting one
        account at a server leaves every other connection to that server working.

        The client registration is not touched. It names this deployment to the
        authorization server rather than an account, and other connections there are
        still using it; re-registering on every disconnect would also mint a fresh
        client each time anyone reconnects.
        """
        # The outstanding consents go first. A consent already in flight completes
        # against the record it was issued, so a browser tab opened before this call
        # would otherwise finish afterwards and reconnect the account, leaving the
        # person who pressed Disconnect believing they had revoked it (D5). Dropped
        # before the grant, so there is no window in which the grant is gone and a
        # callback can still write a new one.
        await self.attempts_dao.drop_attempts_for_endpoint(
            project_id=project_id, endpoint_id=endpoint_id
        )

        storage = SecretsTokenStorage(
            vault_service=self.vault_service,
            project_id=project_id,
            server_url=server_url,
            endpoint_id=endpoint_id,
        )
        return await storage.delete_grant()

    # Refresh

    def _refresh_lock(self, *, project_id: UUID, endpoint_id: UUID) -> asyncio.Lock:
        return self._refresh_locks.setdefault((project_id, endpoint_id), asyncio.Lock())

    async def refresh_grant(
        self, *, project_id: UUID, endpoint_id: UUID, server_url: str
    ) -> None:
        """Renew one connection's stored grant, in place.

        **Concurrency.** Several relays can find one grant expired at the same moment,
        and a rotating authorization server invalidates a refresh token the instant it
        is spent, so two exchanges would leave one caller holding a token the server has
        already retired. Two mechanisms, in order:

        * Inside a worker, one `asyncio.Lock` per connection serializes the refresh, and
          the grant is re-read after the lock is taken. The second caller therefore
          finds a fresh token and performs no exchange at all. Per connection rather
          than per server: two accounts at one server hold two grants, and one waiting
          on the other's exchange would serialize calls that never touch the same row.
        * Across workers, nothing can serialize them without a distributed lock this
          module has no business introducing, so the losing exchange is expected to be
          refused. It is treated as a race, not a death: the grant is re-read, and if the
          winner has already written a live token it is used. Only when the re-read still
          shows an expired grant does this raise.

        The refreshed tokens are written back to the same vault row the endpoint's
        `secret_id` names, so the caller re-reads its own reference rather than being
        handed one.
        """
        async with self._refresh_lock(project_id=project_id, endpoint_id=endpoint_id):
            storage = SecretsTokenStorage(
                vault_service=self.vault_service,
                project_id=project_id,
                server_url=server_url,
                endpoint_id=endpoint_id,
            )

            stored = await storage.get_grant()
            if stored is None:
                raise MCPOAuthRefreshFailedError(
                    server_url=server_url, detail="no stored grant"
                )
            if not grant_settings_expired(stored):
                # Another coroutine in this worker refreshed while we waited.
                return
            if not stored.refresh_token:
                raise MCPOAuthRefreshFailedError(
                    server_url=server_url,
                    detail="the stored grant carries no refresh token",
                )
            if not stored.issuer:
                # Nothing to check the resource's answer against, so there is no safe
                # way to present this refresh token. Reconnecting writes the pin.
                raise MCPOAuthIssuerChangedError(
                    server_url=server_url, stored_issuer=None, named_issuer=None
                )

            # The token endpoint is rediscovered rather than stored — it is not part of a
            # grant, and a server may move it within its own authorization server. The
            # ISSUER is not rediscovered. Discovery's checks are only internally
            # consistent: the protected-resource document is published by the MCP server
            # itself, so a server that was honest at connect time can later name an
            # authorization server it controls and satisfy every one of them. Pinning the
            # refresh to the issuer that actually granted these tokens is what stops the
            # refresh token being handed to that new server.
            discovery = await self.client.discover(server_url=server_url)
            if not same_issuer(discovery.authorization_server, stored.issuer):
                raise MCPOAuthIssuerChangedError(
                    server_url=server_url,
                    stored_issuer=stored.issuer,
                    named_issuer=discovery.authorization_server,
                )
            # The pinned value, not the discovered one: the client registration is
            # addressed by issuer, and this keeps the rewritten grant pinned as it was.
            storage.authorization_server = stored.issuer

            client_info = await storage.get_client_info()
            if client_info is None:
                client_info = identity_document_client_info(
                    api_url=self.api_url,
                    redirect_uri=callback_redirect_uri(api_url=self.api_url),
                )

            try:
                refreshed = await self.client.refresh_token(
                    token_endpoint=discovery.token_endpoint,
                    refresh_token=stored.refresh_token,
                    client_info=client_info,
                    resource=discovery.resource,
                )
            except MCPOAuthTokenExchangeError as e:
                if await self._another_worker_refreshed(storage=storage, stored=stored):
                    return
                raise MCPOAuthRefreshFailedError(
                    server_url=server_url, detail=e.detail
                ) from e

            if not refreshed.refresh_token:
                # RFC 6749 s6: a server that does not rotate returns no new refresh
                # token, and the old one stays valid. Dropping it would make the next
                # expiry unrecoverable.
                refreshed.refresh_token = stored.refresh_token

            await storage.write_tokens(refreshed)

    @staticmethod
    async def _another_worker_refreshed(
        *, storage: SecretsTokenStorage, stored: OAuthGrantSettingsDTO
    ) -> bool:
        """Whether the row now holds a live grant someone else wrote."""
        current = await storage.get_grant()
        if current is None:
            return False
        if current.access_token == stored.access_token:
            return False
        return not grant_settings_expired(current)

    async def sweep_expired_attempts(self) -> int:
        """Drop attempts nobody came back for. Driven by the cron service."""
        return await self.attempts_dao.sweep_expired_attempts()
