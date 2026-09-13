"""Vault-backed OAuth token storage."""

import time
from typing import Optional
from uuid import NAMESPACE_URL, UUID, uuid5

from mcp.shared.auth import OAuthClientInformationFull, OAuthToken

from oss.src.core.secrets.dtos import (
    CreateSecretDTO,
    OAuthGrantDTO,
    OAuthGrantSettingsDTO,
    OAuthProviderDTO,
    OAuthProviderSettingsDTO,
    SecretDTO,
    SecretResponseDTO,
    UpdateSecretDTO,
)
from oss.src.core.secrets.enums import SecretKind
from oss.src.core.secrets.services import VaultService
from oss.src.core.secrets.types import SecretSlugConflict
from oss.src.core.shared.dtos import Header
from oss.src.utils.helpers import get_slug_from_name_and_id


# A grant this close to its expiry counts as expired. Long enough that a token cannot die
# between the check and the upstream call it authorizes, short enough that a healthy
# hour-long token is not renewed on every request. One definition, because the data plane
# decides whether to ask for a refresh and the OAuth service decides whether to perform
# one: were they to disagree, a call would bounce between them.
REFRESH_SKEW_SECONDS = 60


def grant_settings_expired(
    grant: Optional[OAuthGrantSettingsDTO], *, skew: int = REFRESH_SKEW_SECONDS
) -> bool:
    """Whether a stored grant needs renewing before it is used.

    A grant whose authorization server stated no lifetime is never treated as expired:
    nothing here knows when it dies, and guessing would renew a working token on every
    call. Such a grant still dies as a 401 from the upstream, which is the behaviour for
    every token whose end nobody can predict.
    """
    if grant is None or grant.expires_at is None:
        return False
    return grant.expires_at - skew <= time.time()


def _server_slug(server_url: str) -> str:
    return get_slug_from_name_and_id("oauth-grant", uuid5(NAMESPACE_URL, server_url))


def _issuer_slug(issuer_url: str) -> str:
    return get_slug_from_name_and_id("oauth-provider", uuid5(NAMESPACE_URL, issuer_url))


class SecretsTokenStorage:
    """Store OAuth grants by server and client registration by authorization server.

    Both records are addressed by a slug derived from a URL (`uuid5`), so two callbacks
    completing at once compute the same slug and both find nothing to update. The write
    is therefore create-first, and the loser of the unique index on `(project_id, slug)`
    converts its refusal into the update it would have made had it read a moment later
    (OR61). Postgres arbitrates; nothing serializes these writers in Python, which would
    only work inside one worker anyway.
    """

    def __init__(
        self,
        *,
        vault_service: VaultService,
        project_id: UUID,
        server_url: str,
        authorization_server: Optional[str] = None,
    ) -> None:
        self.vault_service = vault_service
        self.project_id = project_id
        self.server_url = server_url
        self.authorization_server = authorization_server

    # Tokens

    async def _find_grant(self) -> Optional[SecretResponseDTO]:
        secrets = await self.vault_service.list_secrets(project_id=self.project_id)
        return next(
            (
                s
                for s in secrets
                if s.kind == SecretKind.OAUTH_GRANT
                and s.data.grant.server == self.server_url
            ),
            None,
        )

    async def get_grant(self) -> Optional[OAuthGrantSettingsDTO]:
        """The stored grant as it is recorded, issuer included.

        `get_tokens` below answers the same question in the OAuth client's vocabulary,
        which has no room for the issuer. A renewal needs the issuer, so it reads this.
        """
        grant = await self._find_grant()
        return grant.data.grant if grant is not None else None

    async def get_tokens(self) -> Optional[OAuthToken]:
        grant = await self._find_grant()
        if grant is None:
            return None
        data = grant.data.grant
        expires_in = (
            int(data.expires_at - time.time()) if data.expires_at is not None else None
        )
        return OAuthToken(
            access_token=data.access_token,
            # MCP authorization uses bearer tokens.
            token_type="Bearer",
            expires_in=expires_in,
            scope=" ".join(data.scopes) if data.scopes else None,
            refresh_token=data.refresh_token,
        )

    async def set_tokens(self, tokens: OAuthToken) -> None:
        await self.write_tokens(tokens)

    async def write_tokens(self, tokens: OAuthToken) -> SecretResponseDTO:
        """Write tokens and return the persisted secret."""
        expires_at = (
            int(time.time()) + tokens.expires_in
            if tokens.expires_in is not None
            else None
        )
        grant_settings = OAuthGrantSettingsDTO(
            server=self.server_url,
            access_token=tokens.access_token,
            refresh_token=tokens.refresh_token,
            expires_at=expires_at,
            scopes=tokens.scope.split() if tokens.scope else [],
            # Pinned at the moment of the write. A renewal refuses to present these
            # tokens to any other authorization server, however the resource's own
            # metadata document may read by then.
            issuer=self.authorization_server,
        )
        secret = SecretDTO(
            kind=SecretKind.OAUTH_GRANT,
            data=OAuthGrantDTO(grant=grant_settings),
        )

        slug = _server_slug(self.server_url)
        existing = await self._find_grant()
        if existing is not None:
            return await self._update(existing=existing, secret=secret)

        try:
            return await self.vault_service.create_secret(
                project_id=self.project_id,
                create_secret_dto=CreateSecretDTO(
                    slug=slug,
                    header=Header(name=f"OAuth grant — {self.server_url}"),
                    secret=secret,
                ),
            )
        except SecretSlugConflict:
            return await self._update_by_slug(slug=slug, secret=secret)

    # Client registration

    async def _find_provider(self) -> Optional[SecretResponseDTO]:
        target = self.authorization_server or self.server_url
        secrets = await self.vault_service.list_secrets(project_id=self.project_id)
        return next(
            (
                s
                for s in secrets
                if s.kind == SecretKind.OAUTH_PROVIDER
                and s.data.provider.issuer_url == target
            ),
            None,
        )

    async def get_client_info(self) -> Optional[OAuthClientInformationFull]:
        provider = await self._find_provider()
        if provider is None:
            return None
        settings = provider.data.provider
        # The secret lives in the settings field the vault knows how to redact, never in
        # the registration metadata beside it; put it back only here, where the caller is
        # the OAuth client itself.
        return OAuthClientInformationFull.model_validate(
            {
                **settings.extra["client_info"],
                "client_secret": settings.client_secret or None,
            }
        )

    async def set_client_info(self, client_info: OAuthClientInformationFull) -> None:
        issuer = self.authorization_server or self.server_url
        provider_settings = OAuthProviderSettingsDTO(
            client_id=client_info.client_id or "",
            client_secret=client_info.client_secret or "",
            issuer_url=issuer,
            scopes=(client_info.scope or "").split(),
            # The rest of the dynamic-client-registration response is kept because the MCP
            # client needs it back verbatim (redirect URIs, grant and auth methods, token
            # endpoint auth). The client secret is excluded: a second copy in a free-form
            # map is a copy nothing redacts, and the outer field above already holds it.
            extra={
                "client_info": client_info.model_dump(
                    mode="json", exclude={"client_secret"}
                )
            },
        )
        secret = SecretDTO(
            kind=SecretKind.OAUTH_PROVIDER,
            data=OAuthProviderDTO(provider=provider_settings),
        )

        slug = _issuer_slug(issuer)
        existing = await self._find_provider()
        if existing is not None:
            await self._update(existing=existing, secret=secret)
            return

        try:
            await self.vault_service.create_secret(
                project_id=self.project_id,
                create_secret_dto=CreateSecretDTO(
                    slug=slug,
                    header=Header(name=f"OAuth client — {issuer}"),
                    secret=secret,
                ),
            )
        except SecretSlugConflict:
            await self._update_by_slug(slug=slug, secret=secret)

    # Writes

    async def _update(
        self, *, existing: SecretResponseDTO, secret: SecretDTO
    ) -> SecretResponseDTO:
        updated = await self.vault_service.update_secret(
            secret_id=existing.id,
            update_secret_dto=UpdateSecretDTO(secret=secret),
            project_id=self.project_id,
        )
        return updated or existing

    async def _update_by_slug(
        self, *, slug: str, secret: SecretDTO
    ) -> SecretResponseDTO:
        """Apply the write the create lost, to the row that won the slug.

        The winner is read back by the same slug this call tried to claim, so there is no
        window in which the row could be a different one: the index that refused the
        create is the index this read goes through.
        """
        winner = await self.vault_service.get_secret_by_slug(
            secret_slug=slug,
            project_id=self.project_id,
        )
        if winner is None:
            # The winner was deleted between the refusal and this read. Nothing holds
            # the slug now, so the original create is the right call again.
            return await self.vault_service.create_secret(
                project_id=self.project_id,
                create_secret_dto=CreateSecretDTO(
                    slug=slug,
                    header=Header(name=f"OAuth record — {self.server_url}"),
                    secret=secret,
                ),
            )
        return await self._update(existing=winner, secret=secret)
