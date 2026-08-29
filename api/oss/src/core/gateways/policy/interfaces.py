"""Interface for resolving gateway secrets."""

from abc import ABC, abstractmethod
from typing import Set

from oss.src.core.gateways.policy.dtos import (
    SecretMode,
    SecretRef,
    ResolvedSecret,
)
from oss.src.utils.context import AuthScope


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
