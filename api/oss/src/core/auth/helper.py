from dataclasses import dataclass
from typing import Any, Optional, Set

import posthog

from oss.src.services.exceptions import UnauthorizedException
from oss.src.utils.caching import get_cache, set_cache
from oss.src.utils.common import is_ee
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger


log = get_module_logger(__name__)


@dataclass(frozen=True)
class AuthInfo:
    email: str
    domain: Optional[str]


def parse_auth_info(email: Optional[str]) -> Optional[AuthInfo]:
    if not isinstance(email, str):
        return None

    normalized_email = email.strip().lower()
    if not normalized_email:
        return None

    domain = (
        normalized_email.split("@", 1)[1] if normalized_email.count("@") == 1 else None
    )
    return AuthInfo(email=normalized_email, domain=domain)


def _normalize_string_set(values: Any) -> Set[str]:
    if isinstance(values, str):
        normalized_value = values.strip().lower()
        return {normalized_value} if normalized_value else set()

    if not isinstance(values, (list, set, tuple)):
        return set()

    return {
        value.strip().lower()
        for value in values
        if isinstance(value, str) and value.strip()
    }


async def _get_posthog_string_entries(feature_flag: str) -> Set[str]:
    cache_key = {
        "ff": feature_flag,
    }

    cached_entries = await get_cache(
        namespace="posthog:flags",
        key=cache_key,
        retry=False,
    )
    cached_entries = None

    if cached_entries is not None:
        return _normalize_string_set(cached_entries)

    flag_entries = posthog.get_feature_flag_payload(
        feature_flag,
        "user distinct id",
    )

    normalized_entries = _normalize_string_set(flag_entries)

    log.debug(
        "[AUTH] PostHog entries resolved",
        feature_flag=feature_flag,
        entries=sorted(normalized_entries),
    )

    await set_cache(
        namespace="posthog:flags",
        key=cache_key,
        value=sorted(normalized_entries),
    )

    return normalized_entries


async def get_blocked_domains() -> Set[str]:
    if env.agenta.blocked_domains:
        return _normalize_string_set(env.agenta.blocked_domains)

    if env.posthog.enabled:
        return await _get_posthog_string_entries("blocked-domains")

    return set()


async def get_blocked_emails() -> Set[str]:
    if env.agenta.blocked_emails:
        return _normalize_string_set(env.agenta.blocked_emails)

    if env.posthog.enabled:
        return await _get_posthog_string_entries("blocked-emails")

    return set()


async def get_allowed_domains() -> Set[str]:
    return _normalize_string_set(env.agenta.allowed_domains)


def matches_exact_or_subdomain(
    candidate_domain: str, configured_domains: Set[str]
) -> bool:
    return any(
        candidate_domain == configured_domain
        or candidate_domain.endswith(f".{configured_domain}")
        for configured_domain in configured_domains
    )


async def is_auth_info_blocked(auth_info: AuthInfo) -> bool:
    if not is_ee():
        return False

    if auth_info.email in await get_blocked_emails():
        return True

    domain = auth_info.domain or ""

    allowed_domains = await get_allowed_domains()
    is_domain_allowed = bool(domain and allowed_domains) and matches_exact_or_subdomain(
        domain, allowed_domains
    )
    if allowed_domains:
        return not is_domain_allowed

    blocked_domains = await get_blocked_domains()
    is_domain_blocked = bool(domain and blocked_domains) and matches_exact_or_subdomain(
        domain, blocked_domains
    )
    if blocked_domains:
        return is_domain_blocked

    return False


async def ensure_auth_info_not_blocked(
    auth_info: Optional[AuthInfo],
) -> Optional[AuthInfo]:
    if auth_info and await is_auth_info_blocked(auth_info):
        raise UnauthorizedException(detail="Access Denied.")

    return auth_info
