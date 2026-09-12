from abc import ABC, abstractmethod
from typing import Optional
from uuid import UUID

from pydantic import BaseModel

from oss.src.core.channels.dtos import ChannelCapabilities
from oss.src.core.channels.types import (
    ChannelAgentNotFound,
    ChannelAgentNotGranted,
    ChannelsError,
)
from oss.src.core.channels.utils import canonical_json
from oss.src.core.shared.dtos import Identifier, Lifecycle


# ---------------------------------------------------------------------------
# DTOs
# ---------------------------------------------------------------------------


class ChannelIdentityLink(Identifier, Lifecycle):
    project_id: UUID
    connection_id: UUID
    user_id: UUID
    external_user_key: str


class ChannelIdentityLinkCreate(BaseModel):
    connection_id: UUID
    user_id: UUID
    external_user_key: str


# ---------------------------------------------------------------------------
# Key composition — the single function; no other call site may build this key
# ---------------------------------------------------------------------------


def compose_external_user_key(
    capabilities: ChannelCapabilities,
    platform_user_id: str,
    *,
    scope_id: Optional[str] = None,
) -> str:
    """One canonical `external_user_key` per the adapter's `identity` block.

    `scope` names a boundary the platform user id is only unique within (e.g.
    Slack's `workspace`); the key then embeds `scope_id` so two connections
    cannot collide on the same raw platform id. `scope` absent, or a
    global-uniqueness value, means the raw id alone is the key — embedding a
    scope id there would be noise.
    """

    scope = capabilities.identity.scope

    if scope and scope != "global":
        return canonical_json({"scope_id": scope_id, "user": platform_user_id})

    return canonical_json({"user": platform_user_id})


# ---------------------------------------------------------------------------
# DAO interface — separate from the frozen ChannelsDAOInterface
# ---------------------------------------------------------------------------


class ChannelIdentityDAOInterface(ABC):
    """Persistence contract for identity links."""

    @abstractmethod
    async def create_link(
        self,
        *,
        project_id: UUID,
        #
        link: ChannelIdentityLinkCreate,
    ) -> ChannelIdentityLink: ...

    @abstractmethod
    async def fetch_link(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
        #
        external_user_key: str,
    ) -> Optional[ChannelIdentityLink]: ...

    @abstractmethod
    async def rebind_link(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
        old_external_user_key: str,
        new_external_user_key: str,
    ) -> Optional[ChannelIdentityLink]: ...


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class ChannelIdentityService:
    """Maps a platform user to an Agenta account. The caller calls
    resolve_link to decide who a turn runs as; the decision of
    linked-vs-unlinked is ours, not a guess the caller makes."""

    def __init__(self, *, identity_dao: ChannelIdentityDAOInterface) -> None:
        self.identity_dao = identity_dao

    async def resolve_link(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
        external_user_key: str,
    ) -> Optional[ChannelIdentityLink]:
        """None means unlinked — the caller decides what an unlinked user may
        still do (fill without a turn needs no identity; a trigger does)."""

        return await self.identity_dao.fetch_link(
            project_id=project_id,
            connection_id=connection_id,
            #
            external_user_key=external_user_key,
        )

    async def create_link(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        connection_id: UUID,
        external_user_key: str,
    ) -> ChannelIdentityLink:
        return await self.identity_dao.create_link(
            project_id=project_id,
            #
            link=ChannelIdentityLinkCreate(
                connection_id=connection_id,
                user_id=user_id,
                external_user_key=external_user_key,
            ),
        )

    async def rebind_link(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
        old_external_user_key: str,
        new_external_user_key: str,
        capabilities: ChannelCapabilities,
    ) -> Optional[ChannelIdentityLink]:
        """Reachable only when the adapter declares identity.stable == false —
        a stable identity has nothing to rebind (there is no rekey path for it,
        by construction: the caller cannot reach this without the flag)."""

        if capabilities.identity.stable:
            return None

        return await self.identity_dao.rebind_link(
            project_id=project_id,
            connection_id=connection_id,
            old_external_user_key=old_external_user_key,
            new_external_user_key=new_external_user_key,
        )


# ---------------------------------------------------------------------------
# Refusal — one sentence, three causes, no differentiation
# ---------------------------------------------------------------------------


def render_agent_refusal(*, slug: str) -> str:
    """The one refusal sentence. Every caller — not-found, granted-nowhere,
    granted-elsewhere-not-here — routes through this and gets identical text."""

    return f"No agent named `{slug}` is available in this space"


class ChannelAgentRefused(ChannelsError):
    """One message, three causes, no differentiation.

    Raised identically whether the slug does not exist, exists outside this
    connection's roster, or is in the roster but not granted in this space.
    """

    def __init__(self, *, slug: str):
        self.slug = slug
        super().__init__(render_agent_refusal(slug=slug))


def refuse_agent(cause: Optional[ChannelsError], *, slug: str) -> ChannelAgentRefused:
    """Route any of the three refusal causes through the one rendered sentence.

    `cause` (ChannelAgentNotFound / ChannelAgentNotGranted, or a bare "zero
    grants anywhere" case with neither) stays distinct for logging — only the
    text handed to the user collapses to one sentence, keyed on the slug the
    user actually typed, never on which internal exception fired.
    """

    assert isinstance(cause, (ChannelAgentNotFound, ChannelAgentNotGranted)) or (
        cause is None
    )

    return ChannelAgentRefused(slug=slug)
