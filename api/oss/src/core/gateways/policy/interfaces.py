"""The secret resolver port (entities.md §7.2).

Implemented by `policy/resolution.py` over `VaultService` and the grants DAO (WP2). This
is the signature the seed must get right (D10): the owner is in it from the first commit,
while the only answer today is the project.
"""

from abc import ABC, abstractmethod
from typing import Set

from oss.src.core.gateways.policy.dtos import (
    SecretMode,
    SecretRef,
    ResolvedSecret,
)
from oss.src.utils.context import AuthScope


class SecretsResolverInterface(ABC):
    """One lookup, called by both planes (`secrets.md`). Mockable (D23): the
    mock resolver answers from a dict and never touches the vault."""

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

        Until user-owned secrets ship, the user arm of every mode finds nothing
        and the modes degrade to project lookup or failure — behaviourally
        today's world, with the signature already right.

        By ref arm:
          ProviderKeyRef -> scan the project's provider_key / custom_provider
                            secrets for the provider, as the SDK's settings
                            builder does today (`models.md`).
          BoundSecretRef -> VaultService.get_secret_by_id, scoped to the project.
          GrantRef       -> the grants DAO's owner-keyed fetch (§7), then
                            get_secret_by_id; SecretInvalidError when the
                            grant's is_valid is False (D18).

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
