"""Resolve gateway secret references through the vault service.

Pure orchestration over `VaultService`; this module never talks to Postgres or the
vault's encryption directly.

The resolver is built per plane (M5). Every plane reads the project's own rows for a
provider scan and a project slug. Only the LLM plane also answers an organization
connection, and only one an agent named by scope `organization` (by slug, or by id through
a bound reference). The MCP plane never reads, lists or answers an organization row.
"""

from typing import List, Optional, Set
from uuid import UUID

from oss.src.core.gateways.policy.dtos import (
    BoundSecretRef,
    GatewayPlane,
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
from oss.src.core.secrets.services import VaultService
from oss.src.utils.context import AuthScope


def _provider_family(secret: SecretResponseDTO) -> Optional[str]:
    kind = getattr(secret.data, "kind", None)
    kind = getattr(kind, "value", kind)
    return str(kind) if kind else None


def provider_candidates(
    *, secrets: List[SecretResponseDTO], provider_key: str
) -> List[SecretResponseDTO]:
    """Today's tie rule: `provider_key` rows of the provider first, then `custom_provider`
    rows of that provider kind, each in stored order."""

    def _kind(secret) -> Optional[str]:
        kind = getattr(secret.data, "kind", None)
        return None if kind is None else str(getattr(kind, "value", kind))

    keys = [
        s
        for s in secrets
        if s.kind == SecretKind.PROVIDER_KEY and _kind(s) == provider_key
    ]
    customs = [
        s
        for s in secrets
        if s.kind == SecretKind.CUSTOM_PROVIDER and _kind(s) == provider_key
    ]
    return keys + customs


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
    def _serves_organization(self) -> bool:
        return self.plane == GatewayPlane.LLM

    async def _secrets(self, *, scope: AuthScope) -> List[SecretResponseDTO]:
        """The project's own rows: the provider scan and project slugs read only these."""
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
    ) -> ResolvedSecret:
        if isinstance(ref, BoundSecretRef):
            return await self._resolve_bound_secret(scope=scope, ref=ref)
        if isinstance(ref, ProviderKeyRef):
            return await self._resolve_provider_key(scope=scope, ref=ref)
        raise TypeError(f"Unsupported SecretRef type: {type(ref)!r}")

    async def available_provider_keys(self, *, scope: AuthScope) -> Set[str]:
        secrets = await self._secrets(scope=scope)
        return {
            secret.data.kind.value
            for secret in secrets
            if secret.kind in (SecretKind.PROVIDER_KEY, SecretKind.CUSTOM_PROVIDER)
        }

    async def organization_connection(
        self, *, scope: AuthScope, slug: str
    ) -> Optional[SecretResponseDTO]:
        """The organization row an agent named by scope `organization` and `slug`, when it
        is available to the project. None on a plane that serves no organization row."""
        if not self._serves_organization:
            return None
        return await self.vault_service.get_organization_connection(
            organization_id=scope.organization_id,
            project_id=scope.project_id,
            slug=slug,
        )

    async def personal_provider_key(
        self, *, scope: AuthScope, user_id: UUID, provider_key: str
    ) -> Optional[SecretResponseDTO]:
        """The person's own provider key in the run's organization (M7), or None. Only
        the LLM plane serves one; the caller has checked the run's signed binding."""
        if self.plane != GatewayPlane.LLM or scope.organization_id is None:
            return None
        secret = await self.vault_service.personal_secret_for_service(
            organization_id=scope.organization_id,
            user_id=user_id,
            service=provider_key,
        )
        if secret is None or secret.kind != SecretKind.PROVIDER_KEY:
            return None
        return secret

    async def provider_connection_by_slug(
        self, *, scope: AuthScope, slug: str
    ) -> Optional[NamedProviderConnection]:
        # A project slug names a project row only.
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
                secret_id=secret.id, provider_key=provider_key
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
        if ref.owner_kind == SecretOwnerKind.ORGANIZATION and self._serves_organization:
            # Only an organization row available to this project; never a substitute.
            return await self.vault_service.get_available_organization_secret_by_id(
                organization_id=scope.organization_id,
                project_id=scope.project_id,
                secret_id=ref.secret_id,
            )
        # An organization reference on a project-only plane, or a user reference (M7):
        # nothing is read.
        return None

    async def _resolve_bound_secret(
        self, *, scope: AuthScope, ref: BoundSecretRef
    ) -> ResolvedSecret:
        target = f"secret:{ref.secret_id}"

        secret = await self._fetch_bound_secret(scope=scope, ref=ref)

        if secret is None:
            raise SecretNotFoundError(missing=ref.owner_kind, target=target)
        return ResolvedSecret(
            secret=secret,
            owner=self._owner(scope=scope, secret=secret),
            origin=SecretOrigin.VAULT,
        )

    # --- ProviderKeyRef --------------------------------------------------------- #

    async def _match_provider_secret(
        self, *, scope: AuthScope, ref: ProviderKeyRef
    ) -> Optional[SecretResponseDTO]:
        # The project's own rows, with today's tie rule (`provider_key` before
        # `custom_provider`). An organization row is never a candidate: an agent uses one
        # only when it names it.
        candidates = provider_candidates(
            secrets=await self._secrets(scope=scope), provider_key=ref.provider_key
        )
        return candidates[0] if candidates else None

    async def _resolve_provider_key(
        self, *, scope: AuthScope, ref: ProviderKeyRef
    ) -> ResolvedSecret:
        target = f"provider:{ref.provider_key}"

        match = await self._match_provider_secret(scope=scope, ref=ref)

        if match is None:
            raise SecretNotFoundError(missing=SecretOwnerKind.PROJECT, target=target)
        return ResolvedSecret(
            secret=match,
            owner=self._owner(scope=scope, secret=match),
            origin=SecretOrigin.VAULT,
        )
