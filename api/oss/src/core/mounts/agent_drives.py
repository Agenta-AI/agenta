"""The pure rules of an agent's own drive: its slug and the keys a configuration gets.

The release 2 data migration carries frozen copies of both; keep them pure.
"""

from re import sub
from typing import Any, Collection, Dict, Optional

from oss.src.core.sharing.dtos import AccessPolicy
from oss.src.core.sharing.service import SharingService

# The slug rule of `uq_mounts_project_id_slug` leaves room for the suffix.
_MAX_BASE_LENGTH = 60
_FALLBACK_BASE = "agent"


def agent_drive_slug(agent_slug: Optional[str], taken_slugs: Collection[str]) -> str:
    """`<agent slug>-files`, one safe path segment, with `-2`, `-3` ... on a collision."""

    base = sub(r"[^a-z0-9]+", "-", (agent_slug or "").lower()).strip("-")
    base = (base[:_MAX_BASE_LENGTH].strip("-") or _FALLBACK_BASE) + "-files"
    if base not in taken_slugs:
        return base
    suffix = 2
    while f"{base}-{suffix}" in taken_slugs:
        suffix += 1
    return f"{base}-{suffix}"


def fill_agent_drive_keys(
    agent_config: Dict[str, Any],
    own_drive_slug: Optional[str],
    own_drive_policy: Optional[AccessPolicy],
    agent_policy: Optional[AccessPolicy],
) -> Dict[str, Any]:
    """The configuration with `drives` stated, for one that lacks the key.

    The agent's own drive is the only entry and the home when the home rule allows it
    for the agent's current visibility; otherwise the agent gets no drive. A stated
    `has_session_drive` or `home_drive` is kept.
    """

    if "drives" in agent_config:
        return agent_config
    filled = dict(agent_config)
    filled.setdefault("has_session_drive", True)
    allowed = (
        own_drive_slug is not None
        and own_drive_policy is not None
        and SharingService.check_home_drive(agent_policy, own_drive_policy) is None
    )
    if allowed:
        filled["drives"] = [{"slug": own_drive_slug}]
        filled.setdefault("home_drive", own_drive_slug)
    else:
        filled["drives"] = []
        filled.setdefault("home_drive", None)
    return filled
