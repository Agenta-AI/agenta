"""Ports the gateway policy depends on: secret resolution, spend admission, usage."""

from abc import ABC, abstractmethod
from typing import Optional, Set
from uuid import UUID

from pydantic import BaseModel

from oss.src.core.gateways.policy.dtos import (
    GatewayOutcome,
    GatewayTarget,
    SecretMode,
    SecretRef,
    ResolvedSecret,
    SpendAdmission,
)
from oss.src.utils.context import AuthScope


class NamedProviderConnection(BaseModel):
    """Which stored connection a slug names, and which provider family it speaks.

    Names only, never a value: the pair is what a route is built from, and it travels
    where `ResolvedSecret` must not (the resolve endpoint answers with route metadata
    while the credential stays in the API process)."""

    secret_id: UUID
    provider_key: str


class SecretsResolverInterface(ABC):
    """Resolve one secret for either gateway plane."""

    @abstractmethod
    async def resolve(
        self,
        *,
        scope: AuthScope,
        #
        ref: SecretRef,
        mode: SecretMode,
    ) -> ResolvedSecret:
        """Resolve one secret for one call.

        The mode logic, in full (`secrets.md`):
          PROJECT_ONLY  -> the project secret; SecretNotFoundError(PROJECT) if absent.
          USER_REQUIRED -> the (project, user) secret; SecretNotFoundError(USER)
                           if absent — NEVER falls back.
          USER_OPTIONAL -> the (project, user) secret if present, else the
                           project's; SecretNotFoundError(USER) naming the
                           narrower owner if neither exists.

        User-owned secrets are not currently resolved.

        By ref arm:
          ProviderKeyRef -> scan the project's provider_key / custom_provider
                            secrets for the provider, as the SDK's settings
                            builder does today (`models.md`).
          BoundSecretRef -> VaultService.get_secret_by_id, scoped to the project.
                            Both planes' endpoints name their secret this way,
                            OAuth included; SecretInvalidError when the
                            endpoint's is_valid is False.

        Raises, never returns None: no path silently yields "no secret"
        (`secrets.md`), and the exceptions carry which owner is missing so the
        boundary can build the connect affordance (§5)."""
        raise NotImplementedError

    @abstractmethod
    async def available_provider_keys(self, *, scope: AuthScope) -> Set[str]:
        """Provider keys with a resolvable project-owned secret. Names only,
        never a value — an existence test that must not read a secret.

        Same scan as the ProviderKeyRef arm (provider_key + custom_provider),
        returning the provider names found. Unlike resolve() it does NOT raise
        when nothing matches: the empty set is the correct answer for a project
        with no keys, whereas a caller reaching resolve() has already committed
        to needing one."""
        raise NotImplementedError

    @abstractmethod
    async def provider_connection_by_slug(
        self, *, scope: AuthScope, slug: str
    ) -> Optional[NamedProviderConnection]:
        """The project's provider-key connection stored under this slug, or None.

        A project may hold several keys for one provider, so the provider family alone
        does not say which credential a caller chose; the slug does (OR53). The same
        names-only contract as available_provider_keys(): it answers which secret and
        which provider family, and never reads the credential.

        `provider_key` secrets only. A `custom_provider` connection is addressed by the
        endpoint row the vault registers for it, which is a different namespace."""
        raise NotImplementedError


class SpendAdmissionInterface(ABC):
    """Asked before a platform-funded call is dispatched: may this organization spend.

    Not called `authorize`: that name belongs to the permission check, and permissions and
    entitlements answer different questions. Implementations may raise; the policy service
    treats a raise as a refusal."""

    @abstractmethod
    async def admit(
        self,
        *,
        scope: AuthScope,
        target: GatewayTarget,
    ) -> SpendAdmission:
        raise NotImplementedError


class UsageSinkInterface(ABC):
    """Handed the usage of one dispatched, platform-funded call once its body is drained.
    Implementations may raise or stall; the policy service bounds and contains both, so a
    sink can never change a relay's result."""

    @abstractmethod
    async def record(
        self,
        *,
        scope: AuthScope,
        target: GatewayTarget,
        outcome: GatewayOutcome,
        run_id: Optional[str],
    ) -> None:
        raise NotImplementedError
