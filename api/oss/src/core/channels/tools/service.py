"""The channel agent tools: list, send, read, and search, on behalf of a
running agent.

The model never names a bot. Every call matches the run's workflow artifact
against the project's bot bindings, re-reads the connection and the bot's
settings, and only then touches a destination.
"""

import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Tuple
from uuid import UUID

from oss.src.core.channels.dtos import (
    ChannelAgent,
    ChannelConnection,
    ChannelKeyGrain,
    ChannelSpace,
    ChannelSpaceCandidate,
    ChannelSpaceCreate,
    ChannelSpaceData,
    ChannelSpaceKind,
    ChannelSpaceQuery,
)
from oss.src.core.channels.tools.dtos import (
    ChannelDestination,
    ChannelDestinationsPage,
)
from oss.src.core.channels.tools.ids import encode_destination_id
from oss.src.core.channels.tools.types import ChannelToolsRefused
from oss.src.core.channels.types import ChannelNotSupported
from oss.src.core.channels.utils import compose_external_key
from oss.src.core.shared.dtos import Reference
from oss.src.utils.logging import get_module_logger

if TYPE_CHECKING:
    from oss.src.core.channels.service import ChannelsService

log = get_module_logger(__name__)

_ARTIFACT_KEYS = ("application", "workflow")
_VARIANT_KEYS = ("application_variant", "workflow_variant")
_REVISION_KEYS = ("application_revision", "workflow_revision")

_CHANNEL_KINDS = (ChannelSpaceKind.GROUP, ChannelSpaceKind.TOPIC)

LIST_DEFAULT_LIMIT = 50
LIST_MAX_LIMIT = 100

# The bot's member channels, per connection, for this long. Per process and
# lost on restart: it only spares Slack a listing call on every tool call.
_MEMBER_TTL_SECONDS = 120.0
_MEMBER_CACHE: Dict[UUID, Tuple[float, List[ChannelSpaceCandidate]]] = {}

TELEGRAM_LIST_NOTE = (
    "Telegram bots cannot list the chats they are in, so this shows only groups "
    "that sent the bot a message or were bound to it."
)


@dataclass(frozen=True)
class ChannelBot:
    """One bot the run speaks for: its binding and its live connection, with
    credentials resolved for the adapter. Never serialised."""

    agent: ChannelAgent
    connection: ChannelConnection

    @property
    def platform(self) -> str:
        channel = self.connection.channel
        return "telegram" if channel.startswith("telegram") else channel

    @property
    def is_slack(self) -> bool:
        return self.platform == "slack"

    def can_read(self, space: ChannelSpace) -> bool:
        keys = self.agent.data.tools.readable_space_keys
        return keys is None or space.external_key in set(keys)


@dataclass(frozen=True)
class _Destination:
    bot: ChannelBot
    space: ChannelSpace
    name: Optional[str]


class ChannelToolsService:
    def __init__(
        self,
        *,
        channels_service: "ChannelsService",
        workflows_service: Optional[Any] = None,
        telegram_binding_service: Optional[Any] = None,
    ) -> None:
        self.channels_service = channels_service
        self.channels_dao = channels_service.channels_dao
        self.workflows_service = workflows_service
        self.telegram_binding_service = telegram_binding_service

    # --- which bots the run speaks for ------------------------------------ #

    async def resolve_bots(
        self, *, project_id: UUID, artifact_id: UUID
    ) -> List[ChannelBot]:
        """The run's bots: active bindings whose workflow is this artifact,
        on active, verified, unarchived connections. Two bindings on one
        connection would make the settings ambiguous, so that refuses."""

        agents = await self.channels_dao.query_agents(project_id=project_id)

        matched: Dict[UUID, List[ChannelAgent]] = {}
        for agent in agents:
            if agent.deleted_at is not None or not agent.flags.is_active:
                continue
            if await self._references_artifact(
                project_id=project_id,
                references=agent.data.references,
                artifact_id=artifact_id,
            ):
                matched.setdefault(agent.connection_id, []).append(agent)

        bots: List[ChannelBot] = []
        for connection_id, bound in matched.items():
            connection = await self.channels_service.fetch_connection(
                project_id=project_id, connection_id=connection_id
            )
            if (
                connection is None
                or connection.deleted_at is not None
                or not connection.flags.is_active
                or not connection.flags.is_verified
            ):
                continue
            if len(bound) > 1:
                raise ChannelToolsRefused(
                    "This agent is bound more than once to the same connected bot, "
                    "so its channel settings are ambiguous. Ask an admin to keep "
                    "one binding."
                )
            bots.append(ChannelBot(agent=bound[0], connection=connection))
        return bots

    # --- list ------------------------------------------------------------- #

    async def list_destinations(
        self,
        *,
        project_id: UUID,
        artifact_id: UUID,
        query: Optional[str] = None,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
    ) -> ChannelDestinationsPage:
        bots = await self.resolve_bots(project_id=project_id, artifact_id=artifact_id)

        destinations: List[_Destination] = []
        for bot in bots:
            destinations.extend(
                await self._destinations(project_id=project_id, bot=bot)
            )

        if query:
            needle = query.strip().lower()
            destinations = [d for d in destinations if needle in (d.name or "").lower()]
        destinations.sort(key=lambda d: (d.bot.platform, (d.name or "").lower()))

        size = min(max(limit or LIST_DEFAULT_LIMIT, 1), LIST_MAX_LIMIT)
        start = _offset(cursor)
        page = destinations[start : start + size]
        more = start + size < len(destinations)

        notes = []
        if any(not d.bot.is_slack for d in destinations):
            notes.append(TELEGRAM_LIST_NOTE)

        return ChannelDestinationsPage(
            destinations=[
                ChannelDestination(
                    destination_id=encode_destination_id(d.space.id),
                    platform=d.bot.platform,
                    name=d.name,
                    can_post=d.bot.agent.data.tools.can_post_outside_conversation,
                    can_read=d.bot.can_read(d.space),
                    can_search=d.bot.can_read(d.space),
                    supports_threads=d.bot.is_slack,
                )
                for d in page
            ],
            cursor=str(start + size) if more else None,
            notes=notes,
        )

    async def _destinations(
        self, *, project_id: UUID, bot: ChannelBot
    ) -> List[_Destination]:
        """The channels this bot can reach now. On Slack, the channels the bot
        is a member of, each backed by a space row (created here on first
        sight, without joining anything). Elsewhere, the stored group spaces,
        since the platform cannot list them. Direct messages never count."""

        connection = bot.connection
        adapter = self.channels_service.adapter_registry.get(connection.channel)
        try:
            members = await _member_spaces(adapter, connection)
        except ChannelNotSupported:
            members = None

        if members is None:
            spaces = await self.channels_dao.query_spaces(
                project_id=project_id,
                space=ChannelSpaceQuery(connection_id=connection.id),
            )
            spaces = [
                space
                for space in spaces
                if space.kind in _CHANNEL_KINDS
                and space.deleted_at is None
                and space.flags.is_active
            ]
            if connection.channel == "telegram_hosted":
                spaces = await self._bound_to_project(
                    project_id=project_id, connection=connection, spaces=spaces
                )
            return [
                _Destination(bot=bot, space=space, name=_stored_name(space))
                for space in spaces
            ]

        capabilities = await self.channels_service.fetch_capabilities(
            channel=connection.channel, connection=connection
        )
        destinations = []
        for candidate in members:
            key = compose_external_key(
                capabilities, ChannelKeyGrain.SPACE, candidate.external_locator
            )
            space = await self.channels_dao.get_or_create_space(
                project_id=project_id,
                user_id=None,
                space=ChannelSpaceCreate(
                    connection_id=connection.id,
                    kind=candidate.kind,
                    external_key=key,
                    name=candidate.display_name,
                    data=ChannelSpaceData(external_locator=candidate.external_locator),
                ),
            )
            if space.deleted_at is not None or not space.flags.is_active:
                continue
            destinations.append(
                _Destination(bot=bot, space=space, name=candidate.display_name)
            )
        return destinations

    async def _bound_to_project(
        self,
        *,
        project_id: UUID,
        connection: ChannelConnection,
        spaces: List[ChannelSpace],
    ) -> List[ChannelSpace]:
        """The shared Telegram bot serves every project, so a chat that was
        rebound elsewhere must stop being a destination here."""

        if self.telegram_binding_service is None:
            return []
        bindings = await self.telegram_binding_service.list_connection_bindings(
            project_id=project_id, connection_id=connection.id
        )
        bound = {str(binding.chat_id) for binding in bindings}
        return [
            space
            for space in spaces
            if str(space.data.external_locator.get("chat_id")) in bound
        ]

    async def is_available(self, *, project_id: UUID, artifact_id: UUID) -> bool:
        """The condition the Agenta tools kit reads: is this agent connected
        to an active, verified bot? An ambiguous binding still counts, so
        the calls surface the configuration error instead of hiding it."""

        try:
            return bool(
                await self.resolve_bots(project_id=project_id, artifact_id=artifact_id)
            )
        except ChannelToolsRefused:
            return True

    async def _references_artifact(
        self,
        *,
        project_id: UUID,
        references: Dict[str, Reference],
        artifact_id: UUID,
    ) -> bool:
        for key, reference in references.items():
            if (
                await self._artifact_of(
                    project_id=project_id, key=key, reference=reference
                )
                == artifact_id
            ):
                return True
        return False

    async def _artifact_of(
        self, *, project_id: UUID, key: str, reference: Reference
    ) -> Optional[UUID]:
        if key in _ARTIFACT_KEYS and reference.id is not None:
            return reference.id
        if self.workflows_service is None:
            return None
        try:
            if key in _ARTIFACT_KEYS:
                workflow = await self.workflows_service.fetch_workflow(
                    project_id=project_id, workflow_ref=reference
                )
                return workflow.id if workflow else None
            if key in _VARIANT_KEYS:
                variant = await self.workflows_service.fetch_workflow_variant(
                    project_id=project_id, workflow_variant_ref=reference
                )
                return variant.workflow_id if variant else None
            if key in _REVISION_KEYS:
                revision = await self.workflows_service.fetch_workflow_revision(
                    project_id=project_id, workflow_revision_ref=reference
                )
                return revision.workflow_id if revision else None
        except Exception:  # noqa: BLE001 - a stale reference matches nothing
            log.warning(
                "channel tools: could not resolve a %s reference", key, exc_info=True
            )
        return None


async def _member_spaces(adapter, connection: ChannelConnection):
    now = time.monotonic()
    cached = _MEMBER_CACHE.get(connection.id)
    if cached and cached[0] > now:
        return cached[1]
    members = await adapter.list_member_spaces(connection=connection)
    _MEMBER_CACHE[connection.id] = (now + _MEMBER_TTL_SECONDS, members)
    return members


def _stored_name(space: ChannelSpace) -> Optional[str]:
    locator = space.data.external_locator or {}
    return space.name or locator.get("title")


def _offset(cursor: Optional[str]) -> int:
    try:
        return max(int(cursor or 0), 0)
    except ValueError:
        return 0
