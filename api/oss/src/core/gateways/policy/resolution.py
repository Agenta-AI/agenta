"""`SecretsResolver` — the one lookup both gateways call to turn a `SecretRef`
into a `(secret, owner, payer)` triple (`entities.md` §7.2, WP2).

Pure orchestration over `VaultService` and `McpGrantsDAOInterface`; this module never
talks to Postgres, the vault's encryption, or the grants schema directly.
"""

from typing import Optional, Set

from oss.src.core.gateways.mcps.dtos import McpGrant
from oss.src.core.gateways.mcps.interfaces import McpGrantsDAOInterface
from oss.src.core.gateways.policy.dtos import (
    BoundSecretRef,
    SecretMode,
    SecretOwner,
    SecretOwnerKind,
    SecretRef,
    GrantRef,
    ProviderKeyRef,
    ResolvedSecret,
    SecretOrigin,
)
from oss.src.core.gateways.policy.interfaces import SecretsResolverInterface
from oss.src.core.gateways.policy.types import (
    SecretInvalidError,
    SecretNotFoundError,
)
from oss.src.core.secrets.dtos import SecretResponseDTO
from oss.src.core.secrets.enums import SecretKind
from oss.src.core.secrets.services import VaultService
from oss.src.utils.context import AuthScope


class SecretsResolver(SecretsResolverInterface):
    """`VaultService` + `McpGrantsDAOInterface`, composed (D23: both mockable)."""

    def __init__(
        self,
        *,
        vault_service: VaultService,
        mcp_grants_dao: McpGrantsDAOInterface,
    ) -> None:
        self.vault_service = vault_service
        self.mcp_grants_dao = mcp_grants_dao

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
        if isinstance(ref, GrantRef):
            return await self._resolve_grant(scope=scope, ref=ref, mode=mode)
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

    # --- GrantRef ---------------------------------------------------------------- #

    async def _resolve_grant(
        self, *, scope: AuthScope, ref: GrantRef, mode: SecretMode
    ) -> ResolvedSecret:
        target = f"endpoint:{ref.endpoint_id}"
        grant: Optional[McpGrant]

        if mode == SecretMode.PROJECT_ONLY:
            grant = await self.mcp_grants_dao.fetch_grant(
                project_id=scope.project_id, endpoint_id=ref.endpoint_id, user_id=None
            )
            if grant is None:
                raise SecretNotFoundError(
                    mode=mode, missing=SecretOwnerKind.PROJECT, target=target
                )
        elif mode == SecretMode.USER_REQUIRED:
            # Never followed by a user_id=None lookup — the whole point of this mode.
            grant = await self.mcp_grants_dao.fetch_grant(
                project_id=scope.project_id,
                endpoint_id=ref.endpoint_id,
                user_id=scope.user_id,
            )
            if grant is None:
                raise SecretNotFoundError(
                    mode=mode, missing=SecretOwnerKind.USER, target=target
                )
        elif mode == SecretMode.USER_OPTIONAL:
            grant = await self.mcp_grants_dao.fetch_grant(
                project_id=scope.project_id,
                endpoint_id=ref.endpoint_id,
                user_id=scope.user_id,
            )
            if grant is None:
                grant = await self.mcp_grants_dao.fetch_grant(
                    project_id=scope.project_id,
                    endpoint_id=ref.endpoint_id,
                    user_id=None,
                )
            if grant is None:
                # Narrower owner named even though the project lookup was also tried.
                raise SecretNotFoundError(
                    mode=mode, missing=SecretOwnerKind.USER, target=target
                )
        else:
            raise TypeError(f"Unsupported SecretMode: {mode!r}")

        if not grant.flags.is_valid:
            # Short-circuits before any vault read — an invalid grant never spends
            # a lookup on a secret it is about to refuse to use.
            raise SecretInvalidError(target=target)

        secret = await self.vault_service.get_secret_by_id(
            grant.secret_id, project_id=scope.project_id
        )
        if secret is None:
            # Dangling secret_id despite the FK: the constraint prevents this at
            # steady state, but the resolver must not trust an invariant it can't see.
            raise SecretInvalidError(target=target, detail="secret missing")

        owner_kind = (
            SecretOwnerKind.USER
            if grant.user_id is not None
            else SecretOwnerKind.PROJECT
        )
        return ResolvedSecret(
            secret=secret,
            owner=SecretOwner(kind=owner_kind, user_id=grant.user_id),
            origin=SecretOrigin.VAULT,
        )
