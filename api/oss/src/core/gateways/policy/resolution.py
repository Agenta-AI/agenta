"""`SecretsResolver` — the one lookup both gateways call to turn a `SecretRef`
into a `(secret, owner, payer)` triple (`entities.md` §7.2, WP2).

Pure orchestration over `VaultService`; this module never talks to Postgres or the
vault's encryption directly.
"""

from typing import Optional, Set

from oss.src.core.gateways.policy.dtos import (
    BoundSecretRef,
    SecretMode,
    SecretOwner,
    SecretOwnerKind,
    SecretRef,
    ProviderKeyRef,
    ResolvedSecret,
    SecretOrigin,
)
from oss.src.core.gateways.policy.interfaces import SecretsResolverInterface
from oss.src.core.gateways.policy.types import (
    SecretNotFoundError,
)
from oss.src.core.secrets.dtos import SecretResponseDTO
from oss.src.core.secrets.enums import SecretKind
from oss.src.core.secrets.services import VaultService
from oss.src.utils.context import AuthScope


class SecretsResolver(SecretsResolverInterface):
    """`VaultService`, wrapped (D23: mockable)."""

    def __init__(
        self,
        *,
        vault_service: VaultService,
    ) -> None:
        self.vault_service = vault_service

    async def resolve(
        self,
        *,
        scope: AuthScope,
        #
        ref: SecretRef,
        mode: SecretMode,
    ) -> ResolvedSecret:
        if isinstance(ref, BoundSecretRef):
            return await self._resolve_bound_secret(scope=scope, ref=ref, mode=mode)
        if isinstance(ref, ProviderKeyRef):
            return await self._resolve_provider_key(scope=scope, ref=ref, mode=mode)
        raise TypeError(f"Unsupported SecretRef type: {type(ref)!r}")

    async def available_provider_keys(self, *, scope: AuthScope) -> Set[str]:
        secrets = await self.vault_service.list_secrets(project_id=scope.project_id)
        return {
            secret.data.kind.value
            for secret in secrets
            if secret.kind in (SecretKind.PROVIDER_KEY, SecretKind.CUSTOM_PROVIDER)
        }

    # --- BoundSecretRef -------------------------------------------------------- #

    async def _fetch_bound_secret(
        self, *, scope: AuthScope, ref: BoundSecretRef
    ) -> Optional[SecretResponseDTO]:
        return await self.vault_service.get_secret_by_id(
            ref.secret_id, project_id=scope.project_id
        )

    async def _resolve_bound_secret(
        self, *, scope: AuthScope, ref: BoundSecretRef, mode: SecretMode
    ) -> ResolvedSecret:
        target = f"secret:{ref.secret_id}"

        # No owner column exists on a bound secret today (secrets.md): every mode
        # degrades to the same project-only lookup until user-owned secrets ship.
        # The branch stays explicit so only the per-mode lookup changes later.
        if mode == SecretMode.PROJECT_ONLY:
            secret = await self._fetch_bound_secret(scope=scope, ref=ref)
        elif mode == SecretMode.USER_REQUIRED:
            secret = await self._fetch_bound_secret(scope=scope, ref=ref)
        elif mode == SecretMode.USER_OPTIONAL:
            secret = await self._fetch_bound_secret(scope=scope, ref=ref)
        else:
            raise TypeError(f"Unsupported SecretMode: {mode!r}")

        if secret is None:
            raise SecretNotFoundError(
                mode=mode, missing=SecretOwnerKind.PROJECT, target=target
            )
        return ResolvedSecret(
            secret=secret,
            owner=SecretOwner(kind=SecretOwnerKind.PROJECT),
            origin=SecretOrigin.VAULT,
        )

    # --- ProviderKeyRef --------------------------------------------------------- #

    async def _match_provider_secret(
        self, *, scope: AuthScope, ref: ProviderKeyRef
    ) -> Optional[SecretResponseDTO]:
        secrets = await self.vault_service.list_secrets(project_id=scope.project_id)
        return next(
            (
                secret
                for secret in secrets
                if secret.kind == SecretKind.PROVIDER_KEY
                and secret.data.kind == ref.provider_key
            ),
            None,
        ) or next(
            (
                secret
                for secret in secrets
                if secret.kind == SecretKind.CUSTOM_PROVIDER
                and secret.data.kind == ref.provider_key
            ),
            None,
        )

    async def _resolve_provider_key(
        self, *, scope: AuthScope, ref: ProviderKeyRef, mode: SecretMode
    ) -> ResolvedSecret:
        target = f"provider:{ref.provider_key}"

        # Same degenerate-today, explicit-forever branch as BoundSecretRef: no
        # (project, user) provider-key lookup exists yet.
        if mode == SecretMode.PROJECT_ONLY:
            match = await self._match_provider_secret(scope=scope, ref=ref)
        elif mode == SecretMode.USER_REQUIRED:
            match = await self._match_provider_secret(scope=scope, ref=ref)
        elif mode == SecretMode.USER_OPTIONAL:
            match = await self._match_provider_secret(scope=scope, ref=ref)
        else:
            raise TypeError(f"Unsupported SecretMode: {mode!r}")

        if match is None:
            raise SecretNotFoundError(
                mode=mode, missing=SecretOwnerKind.PROJECT, target=target
            )
        return ResolvedSecret(
            secret=match,
            owner=SecretOwner(kind=SecretOwnerKind.PROJECT),
            origin=SecretOrigin.VAULT,
        )
