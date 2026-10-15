from ipaddress import ip_address
from re import fullmatch
from typing import List, Optional
from urllib.parse import urlsplit
from uuid import UUID

from oss.src.core.browser_profiles.dtos import BrowserProfile, BrowserProfileState
from oss.src.core.browser_profiles.types import (
    BrowserProfileHostInvalid,
    profile_needs_login,
    profile_not_available,
)

_LABEL = r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"


def normalize_host(raw: str) -> str:
    """One allowlist entry as a bare lowercase host name. A host allows its subdomains."""
    value = (raw or "").strip().lower()
    if value.startswith("*."):
        value = value[2:]
    if not value:
        raise BrowserProfileHostInvalid(raw, "it is empty")

    try:
        host = urlsplit(value if "://" in value else f"http://{value}").hostname
    except ValueError as e:
        raise BrowserProfileHostInvalid(raw, "it is not a host name") from e
    host = (host or "").rstrip(".")

    try:
        ip_address(host)
    except ValueError:
        pass
    else:
        raise BrowserProfileHostInvalid(raw, "IP addresses are not allowed")

    try:
        host = host.encode("idna").decode("ascii")
    except UnicodeError as e:
        raise BrowserProfileHostInvalid(raw, "it is not a host name") from e

    labels = host.split(".")
    if host == "localhost" or labels[-1] == "localhost":
        raise BrowserProfileHostInvalid(raw, "localhost is not allowed")
    if len(labels) < 2 or not all(fullmatch(_LABEL, label) for label in labels):
        raise BrowserProfileHostInvalid(raw, "it is not a public host name")
    # A numeric last label is an IP in a form ip_address() rejects, such as 127.1.
    if labels[-1].isdigit():
        raise BrowserProfileHostInvalid(raw, "IP addresses are not allowed")
    return site_of(host)


def site_of(host: str) -> str:
    """`www.` names the site itself: `www.instagram.com` allows `instagram.com` too."""
    return host[4:] if host.startswith("www.") and host.count(".") >= 2 else host


def normalize_allowed_hosts(hosts: List[str]) -> List[str]:
    normalized: List[str] = []
    for raw in hosts:
        host = normalize_host(raw)
        if host not in normalized:
            normalized.append(host)
    if not normalized:
        raise BrowserProfileHostInvalid("", "add at least one site")
    return normalized


def check_tool_access(
    *,
    profile: Optional[BrowserProfile],
    user_id: UUID,
    is_draft: bool,
    revision_author_id: Optional[UUID],
) -> None:
    """The run user and a committed revision's author must both own the profile."""
    if profile is None or profile.created_by_id != user_id:
        raise profile_not_available()
    if not is_draft and revision_author_id != profile.created_by_id:
        raise profile_not_available()
    if profile.state != BrowserProfileState.READY:
        raise profile_needs_login()
