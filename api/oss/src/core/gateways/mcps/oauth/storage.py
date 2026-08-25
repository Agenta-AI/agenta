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
from oss.src.core.shared.dtos import Header
from oss.src.utils.helpers import get_slug_from_name_and_id


def _server_slug(server_url: str) -> str:
    return get_slug_from_name_and_id("oauth-grant", uuid5(NAMESPACE_URL, server_url))


def _issuer_slug(issuer_url: str) -> str:
    return get_slug_from_name_and_id("oauth-provider", uuid5(NAMESPACE_URL, issuer_url))


class SecretsTokenStorage:
    """Store OAuth grants by server and client registration by authorization server."""

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
        )
        secret = SecretDTO(
            kind=SecretKind.OAUTH_GRANT,
            data=OAuthGrantDTO(grant=grant_settings),
        )

        existing = await self._find_grant()
        if existing is not None:
            updated = await self.vault_service.update_secret(
                secret_id=existing.id,
                update_secret_dto=UpdateSecretDTO(secret=secret),
                project_id=self.project_id,
            )
            return updated or existing

        return await self.vault_service.create_secret(
            project_id=self.project_id,
            create_secret_dto=CreateSecretDTO(
                slug=_server_slug(self.server_url),
                header=Header(name=f"OAuth grant — {self.server_url}"),
                secret=secret,
            ),
        )

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
        return OAuthClientInformationFull.model_validate(
            provider.data.provider.extra["client_info"]
        )

    async def set_client_info(self, client_info: OAuthClientInformationFull) -> None:
        issuer = self.authorization_server or self.server_url
        provider_settings = OAuthProviderSettingsDTO(
            client_id=client_info.client_id or "",
            client_secret=client_info.client_secret or "",
            issuer_url=issuer,
            scopes=(client_info.scope or "").split(),
            extra={"client_info": client_info.model_dump(mode="json")},
        )
        secret = SecretDTO(
            kind=SecretKind.OAUTH_PROVIDER,
            data=OAuthProviderDTO(provider=provider_settings),
        )

        existing = await self._find_provider()
        if existing is not None:
            await self.vault_service.update_secret(
                secret_id=existing.id,
                update_secret_dto=UpdateSecretDTO(secret=secret),
                project_id=self.project_id,
            )
            return

        await self.vault_service.create_secret(
            project_id=self.project_id,
            create_secret_dto=CreateSecretDTO(
                slug=_issuer_slug(issuer),
                header=Header(name=f"OAuth client — {issuer}"),
                secret=secret,
            ),
        )
