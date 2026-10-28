"""Whether a person's own credential may be stored or used (M7).

Two switches, both checked before any personal credential is written or selected:

- the deployment gate `AGENTA_ACCESS_PERSONAL_CREDENTIALS_ENABLED` (off by default), which
  opens once every API pod and runner of the deployment runs the release that added
  personal credentials;
- in EE, the organization policy `allow_personal_credentials` (on by default). OSS
  ignores it.

A refusal never falls back to another account.
"""

from typing import Optional
from uuid import UUID

from oss.src.utils.caching import get_cache, set_cache
from oss.src.utils.common import is_ee
from oss.src.utils.env import env

ORGANIZATION_POLICY_FLAG = "allow_personal_credentials"
_POLICY_CACHE_NAMESPACE = "personal_credentials_policy"
_POLICY_CACHE_TTL = 60


class PersonalCredentialRefused(Exception):
    """A personal credential cannot be stored or used. `message` is for the person;
    `code` is stable for clients."""

    def __init__(self, *, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


def personal_credentials_disabled() -> PersonalCredentialRefused:
    return PersonalCredentialRefused(
        code="personal_credentials_disabled",
        message="Personal accounts are not available yet.",
    )


def personal_credentials_forbidden() -> PersonalCredentialRefused:
    return PersonalCredentialRefused(
        code="personal_credentials_forbidden",
        message="Your organization does not allow personal accounts.",
    )


async def _organization_allows(organization_id: UUID) -> bool:
    cached = await get_cache(
        namespace=_POLICY_CACHE_NAMESPACE, key=str(organization_id)
    )
    if isinstance(cached, bool):
        return cached
    from oss.src.services.db_manager import get_organization_by_id  # noqa: PLC0415

    organization = await get_organization_by_id(str(organization_id))
    flags = (getattr(organization, "flags", None) or {}) if organization else {}
    allowed = flags.get(ORGANIZATION_POLICY_FLAG, True) is not False
    await set_cache(
        namespace=_POLICY_CACHE_NAMESPACE,
        key=str(organization_id),
        value=allowed,
        ttl=_POLICY_CACHE_TTL,
    )
    return allowed


async def check_personal_credentials_allowed(
    *, organization_id: Optional[UUID]
) -> None:
    """Raise `PersonalCredentialRefused` when personal credentials are off for this
    deployment or, in EE, forbidden by the organization's policy."""

    if not env.agenta.access.personal_credentials_enabled:
        raise personal_credentials_disabled()
    if organization_id is None:
        raise personal_credentials_forbidden()
    if is_ee() and not await _organization_allows(organization_id):
        raise personal_credentials_forbidden()


async def forget_personal_credentials_policy(*, organization_id: UUID) -> None:
    """Called after an organization's flags change, so the policy applies at once."""
    from oss.src.utils.caching import invalidate_cache  # noqa: PLC0415

    await invalidate_cache(namespace=_POLICY_CACHE_NAMESPACE, key=str(organization_id))
