"""Resolve gateway secret references through the vault service.

Pure orchestration over `VaultService`; this module never talks to Postgres or the
vault's encryption directly.

The resolver is built per plane (M5). The LLM plane reads the project's effective set:
its own rows, then the organization credentials it inherits. Every other plane (MCP) is
project-only: it never reads, lists or answers an organization row, whatever a provider
is called (an organization key of family `mock` exists in both catalogs).
"""

from typing import List, Optional, Set

from oss.src.core.gateways.policy.dtos import (
    BoundSecretRef,
    GatewayPlane,
    SecretMode,
    SecretOwner,
    SecretOwnerKind,
    SecretRef,
    ProviderKeyRef,
    ResolvedSecret,
    SecretOrigin,
)
from oss.src.core.gateways.policy.interfaces import (
    NamedProviderConnection,
    SecretsResolverInterface,
)
from oss.src.core.gateways.policy.types import (
    SecretNotFoundError,
)
from oss.src.core.secrets.dtos import SecretResponseDTO
from oss.src.core.secrets.enums import SecretKind
from oss.src.core.secrets.inheritance import provider_candidates
from oss.src.core.secrets.services import VaultService
from oss.src.utils.context import AuthScope


def _provider_family(secret: SecretResponseDTO) -> Optional[str]:
    kind = getattr(secret.data, "kind", None)
    kind = getattr(kind, "value", kind)
    return str(kind) if kind else None


class SecretsResolver(SecretsResolverInterface):
    """Vault-backed secret resolver for one gateway plane."""

    def __init__(
        self,
        *,
        vault_service: VaultService,
        plane: GatewayPlane,
    ) -> None:
        self.vault_service = vault_service
        self.plane = plane

    @property
    def _inherits(self) -> bool:
        return self.plane == GatewayPlane.LLM

    async def _secrets(self, *, scope: AuthScope) -> List[SecretResponseDTO]:
        """The rows this plane may use: the effective set (LLM) or the project's rows."""
        if self._inherits:
            return await self.vault_service.list_effective_secrets(
                organization_id=scope.organization_id,
                project_id=scope.project_id,
            )
        return await self.vault_service.list_secrets(project_id=scope.project_id)

    def _owner(self, *, scope: AuthScope, secret: SecretResponseDTO) -> SecretOwner:
        if secret.owner is not None:
            return secret.owner
        return SecretOwner(kind=SecretOwnerKind.PROJECT, id=scope.project_id)

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
        secrets = await self._secrets(scope=scope)
        return {
            secret.data.kind.value
            for secret in secrets
            if secret.kind in (SecretKind.PROVIDER_KEY, SecretKind.CUSTOM_PROVIDER)
        }

    async def provider_connection_by_slug(
        self, *, scope: AuthScope, slug: str
    ) -> Optional[NamedProviderConnection]:
        # Project rows come first in the effective set, so a project row with the slug
        # wins over the organization row it overrides.
        secrets = await self._secrets(scope=scope)

        for secret in secrets or []:
            if secret.kind != SecretKind.PROVIDER_KEY or secret.slug != slug:
                continue
            if secret.id is None:
                continue
            provider_key = _provider_family(secret)
            if not provider_key:
                continue
            return NamedProviderConnection(
                secret_id=secret.id,
                provider_key=provider_key,
                owner_kind=self._owner(scope=scope, secret=secret).kind,
            )

        return None

    async def has_connection(self, *, scope: AuthScope, slug: str) -> bool:
        secrets = await self._secrets(scope=scope)
        return any(secret.slug == slug for secret in secrets or [])

    # --- BoundSecretRef -------------------------------------------------------- #

    async def _fetch_bound_secret(
        self, *, scope: AuthScope, ref: BoundSecretRef
    ) -> Optional[SecretResponseDTO]:
        if ref.owner_kind == SecretOwnerKind.PROJECT:
            # Today's project-scoped read by id, on every plane.
            return await self.vault_service.get_secret_by_id(
                ref.secret_id, project_id=scope.project_id
            )
        if ref.owner_kind == SecretOwnerKind.ORGANIZATION and self._inherits:
            # Only an inherited row available to this project; never a substitute.
            return await self.vault_service.get_effective_secret_by_id(
                organization_id=scope.organization_id,
                project_id=scope.project_id,
                secret_id=ref.secret_id,
                owner_kind=SecretOwnerKind.ORGANIZATION,
            )
        # An organization reference on a project-only plane, or a user reference (M7):
        # nothing is read.
        return None

    async def _resolve_bound_secret(
        self, *, scope: AuthScope, ref: BoundSecretRef, mode: SecretMode
    ) -> ResolvedSecret:
        target = f"secret:{ref.secret_id}"

        # No owner column exists on a bound secret for users yet (secrets.md): every mode
        # degrades to the same owner-kind lookup until user-owned secrets ship. The branch
        # stays explicit so only the per-mode lookup changes later.
        if mode not in (
            SecretMode.PROJECT_ONLY,
            SecretMode.USER_REQUIRED,
            SecretMode.USER_OPTIONAL,
        ):
            raise TypeError(f"Unsupported SecretMode: {mode!r}")
        secret = await self._fetch_bound_secret(scope=scope, ref=ref)

        if secret is None:
            raise SecretNotFoundError(mode=mode, missing=ref.owner_kind, target=target)
        return ResolvedSecret(
            secret=secret,
            owner=self._owner(scope=scope, secret=secret),
            origin=SecretOrigin.VAULT,
        )

    # --- ProviderKeyRef --------------------------------------------------------- #

    async def _match_provider_secret(
        self, *, scope: AuthScope, ref: ProviderKeyRef
    ) -> Optional[SecretResponseDTO]:
        secrets = await self._secrets(scope=scope)
        # The project's candidates first, with today's tie rule inside the group
        # (`provider_key` before `custom_provider`); inherited ones only when the project
        # has none. On the project-only plane every row is a project row.
        own: List[SecretResponseDTO] = []
        inherited: List[SecretResponseDTO] = []
        for secret in secrets:
            is_own = secret.owner is None or secret.owner.kind == SecretOwnerKind.PROJECT
            (own if is_own else inherited).append(secret)
        for group in (own, inherited):
            candidates = provider_candidates(secrets=group, provider_key=ref.provider_key)
            if candidates:
                return candidates[0]
        return None

    async def _resolve_provider_key(
        self, *, scope: AuthScope, ref: ProviderKeyRef, mode: SecretMode
    ) -> ResolvedSecret:
        target = f"provider:{ref.provider_key}"

        # Same degenerate-today, explicit-forever branch as BoundSecretRef: no
        # (project, user) provider-key lookup exists yet.
        if mode not in (
            SecretMode.PROJECT_ONLY,
            SecretMode.USER_REQUIRED,
            SecretMode.USER_OPTIONAL,
        ):
            raise TypeError(f"Unsupported SecretMode: {mode!r}")
        match = await self._match_provider_secret(scope=scope, ref=ref)

        if match is None:
            raise SecretNotFoundError(
                mode=mode, missing=SecretOwnerKind.PROJECT, target=target
            )
        return ResolvedSecret(
            secret=match,
            owner=self._owner(scope=scope, secret=match),
            origin=SecretOrigin.VAULT,
        )
