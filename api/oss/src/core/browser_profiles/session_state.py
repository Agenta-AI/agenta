"""One session browser holds every login of a run: merge their states on setup, split on save."""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse
from uuid import UUID

from oss.src.core.browser_profiles.dtos import BrowserProfile
from oss.src.core.browser_profiles.policy import site_of

_OLDEST = datetime.min.replace(tzinfo=timezone.utc)


def session_label(user_id: UUID) -> str:
    """The runner label of a user's session browsers: one browser per session, all logins."""
    return f"user-{user_id}"


def _newest_first(profiles: List[BrowserProfile]) -> List[BrowserProfile]:
    return sorted(
        profiles,
        key=lambda p: p.signed_in_at or p.created_at or _OLDEST,
        reverse=True,
    )


def sites(profile: BrowserProfile) -> List[str]:
    return [site_of(host) for host in profile.allowed_hosts]


def host_owner(
    host: str, profiles: List[BrowserProfile], *, cookie: bool = False
) -> Optional[UUID]:
    """The newest login owning the host; a cookie domain also matches a parent of a site."""
    host = host.lower().lstrip(".")
    for profile in _newest_first(profiles):
        for site in sites(profile):
            if host == site or host.endswith(f".{site}"):
                return profile.id
            if cookie and site.endswith(f".{host}"):
                return profile.id
    return None


def _origin_host(origin: Dict[str, Any]) -> str:
    return urlparse(str(origin.get("origin") or "")).hostname or ""


def split_storage_state(
    storage_state: Optional[Dict[str, Any]], profiles: List[BrowserProfile]
) -> Dict[UUID, Dict[str, Any]]:
    """Each login's share of a storage state; cookies and origins no login owns are dropped."""
    shares: Dict[UUID, Dict[str, Any]] = {
        p.id: {"cookies": [], "origins": []} for p in profiles
    }
    state = storage_state or {}
    for cookie in state.get("cookies") or []:
        owner = host_owner(str(cookie.get("domain") or ""), profiles, cookie=True)
        if owner is not None:
            shares[owner]["cookies"].append(cookie)
    for origin in state.get("origins") or []:
        owner = host_owner(_origin_host(origin), profiles)
        if owner is not None:
            shares[owner]["origins"].append(origin)
    return shares


def merge_storage_states(
    states: Dict[UUID, Optional[Dict[str, Any]]], profiles: List[BrowserProfile]
) -> Dict[str, Any]:
    """Every login contributes only what it owns, so on a shared host the newest login wins."""
    merged: Dict[str, Any] = {"cookies": [], "origins": []}
    for profile in profiles:
        own = split_storage_state(states.get(profile.id), profiles)[profile.id]
        merged["cookies"].extend(own["cookies"])
        merged["origins"].extend(own["origins"])
    return merged


def rebase_share(
    stored: Optional[Dict[str, Any]],
    share: Dict[str, Any],
    profile_id: UUID,
    profiles: List[BrowserProfile],
) -> Dict[str, Any]:
    """A login's share plus its stored hosts a newer login won, so a save never drops those."""
    state = stored or {}
    kept_cookies = [
        c
        for c in state.get("cookies") or []
        if host_owner(str(c.get("domain") or ""), profiles, cookie=True) != profile_id
    ]
    kept_origins = [
        o
        for o in state.get("origins") or []
        if host_owner(_origin_host(o), profiles) != profile_id
    ]
    return {
        "cookies": kept_cookies + share["cookies"],
        "origins": kept_origins + share["origins"],
    }


def union_hosts(profiles: List[BrowserProfile]) -> List[str]:
    return sorted({site for profile in profiles for site in sites(profile)})
