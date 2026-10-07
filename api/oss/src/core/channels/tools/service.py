"""The channel agent tools: list, send, read, and search, on behalf of a
running agent.

The model never names a bot. Every call matches the run's workflow artifact
against the project's bot bindings, re-reads the connection and the bot's
settings, and only then touches a destination.
"""

import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Tuple
from uuid import UUID, uuid4, uuid5

from oss.src.core.channels.dtos import (
    ChannelAgent,
    ChannelHistoryMessage,
    ChannelInboxEvent,
    ChannelCapabilities,
    ChannelConnection,
    ChannelDeliveryState,
    ChannelKeyGrain,
    ChannelOutboxEvent,
    ChannelOutboxEventCreate,
    ChannelOutboxEventData,
    ChannelSpace,
    ChannelSpaceCandidate,
    ChannelSpaceCreate,
    ChannelSpaceData,
    ChannelSpaceKind,
    ChannelSpaceQuery,
)
from oss.src.core.channels.adapters.slack.mapping import slack_time, slack_ts
from oss.src.core.channels.tools.dtos import (
    ChannelDestination,
    ChannelDestinationsPage,
    ChannelMessage,
    ChannelMessagesPage,
    ChannelSearchedChannel,
    ChannelSearchResult,
    ChannelSearchResultItem,
    ChannelSendResult,
)
from oss.src.core.channels.tools.ids import (
    decode_destination_id,
    decode_space_ref,
    encode_destination_id,
    encode_space_ref,
)
from oss.src.core.channels.tools.types import (
    ChannelToolsNotFound,
    ChannelToolsRefused,
)
from oss.src.core.channels.adapters.slack.adapter import ChannelBackfillRefused
from oss.src.core.channels.types import (
    ChannelCredentialRevoked,
    ChannelNotSupported,
    ChannelRateLimited,
)
from oss.src.core.channels.utils import (
    compose_external_key,
    delivery_outcome_unknown,
)
from oss.src.core.shared.dtos import Reference, Status
from oss.src.utils.logging import get_module_logger

if TYPE_CHECKING:
    from oss.src.core.channels.service import ChannelsService

log = get_module_logger(__name__)

_ARTIFACT_KEYS = ("application", "workflow")
_VARIANT_KEYS = ("application_variant", "workflow_variant")
_REVISION_KEYS = ("application_revision", "workflow_revision")

_CHANNEL_KINDS = (ChannelSpaceKind.GROUP, ChannelSpaceKind.TOPIC)

LIST_TOOL = "list_channel_destinations"
SEND_TOOL = "send_channel_message"
READ_TOOL = "read_channel_messages"
SEARCH_TOOL = "search_channel_messages"

LIST_DEFAULT_LIMIT = 50
LIST_MAX_LIMIT = 100

# The bot's member channels, per connection, for this long. Per process and
# lost on restart: it only spares Slack a listing call on every tool call.
_MEMBER_TTL_SECONDS = 120.0
_MEMBER_CACHE: Dict[UUID, Tuple[float, List[ChannelSpaceCandidate]]] = {}

_SEND_KEYS = uuid5(UUID("5f7b5d52-3f1f-4f4e-9d38-6f8f4c1c7a10"), "channel-tool-send")

NO_BOT_MESSAGE = (
    "No bot is connected to this agent. Connect Slack or Telegram to it in the "
    "agent's Channels settings first."
)
POSTING_OFF_MESSAGE = (
    "Posting outside the conversation is turned off for this bot in its "
    "Channels settings."
)

READ_DEFAULT_LIMIT = 50
READ_MAX_LIMIT = 200

READ_OFF_MESSAGE = (
    "Reading this channel is turned off for this bot in its Channels settings."
)
STORED_NOTE = (
    "Messages Agenta stored are shown as first received and may not reflect "
    "later edits or deletions."
)
LIVE_CHANNEL_NOTE = (
    "Older messages come live from Slack's channel history, which lists thread "
    "replies only inside their thread; read a thread with its thread_id."
)
THREAD_PARTIAL_NOTE = (
    "Only the part of this thread Agenta stored is shown; read it again later "
    "for the whole thread."
)
TELEGRAM_READ_NOTE = (
    "Telegram does not let bots read chat history, so this shows only messages "
    "the bot received. In groups where the bot's privacy mode is on, that is "
    "only messages addressed to the bot."
)

SEARCH_DEFAULT_LIMIT = 20
SEARCH_MAX_LIMIT = 50
_EXCERPT_CHARS = 300

SEARCH_OFF_MESSAGE = (
    "Reading and search are turned off for every channel of this agent's bots "
    "in their Channels settings, so there is nothing to search."
)
UNKNOWN_SEARCH_DESTINATION_MESSAGE = (
    "Destination not found, or not one you can search. Pass destination_id "
    "values from list_channel_destinations, not channel names, or omit "
    "destination_ids to search every channel you can read."
)
SLACK_SEARCH_COVERAGE = "Searched messages since the bot joined this channel."
TELEGRAM_SEARCH_COVERAGE = (
    "Searched only the messages the bot received or sent in this group."
)

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

        members = await self._members(bot)
        if members is None:
            spaces = await self.channels_dao.query_spaces(
                project_id=project_id,
                space=ChannelSpaceQuery(connection_id=bot.connection.id),
            )
            spaces = [space for space in spaces if _is_channel(space)]
            spaces = await self._bound_to_project(
                project_id=project_id, connection=bot.connection, spaces=spaces
            )
            return [
                _Destination(bot=bot, space=space, name=_stored_name(space))
                for space in spaces
            ]

        capabilities = await self._capabilities(bot)
        destinations = []
        for candidate in members:
            space = await self.channels_dao.get_or_create_space(
                project_id=project_id,
                user_id=None,
                space=ChannelSpaceCreate(
                    connection_id=bot.connection.id,
                    kind=candidate.kind,
                    external_key=compose_external_key(
                        capabilities,
                        ChannelKeyGrain.SPACE,
                        candidate.external_locator,
                    ),
                    name=candidate.display_name,
                    data=ChannelSpaceData(external_locator=candidate.external_locator),
                ),
            )
            if _is_channel(space):
                destinations.append(
                    _Destination(bot=bot, space=space, name=candidate.display_name)
                )
        return destinations

    async def _members(self, bot: ChannelBot) -> Optional[List[ChannelSpaceCandidate]]:
        """The bot's member channels, or None where the platform cannot list
        them."""

        adapter = self.channels_service.adapter_registry.get(bot.connection.channel)
        try:
            return await _member_spaces(adapter, bot.connection)
        except ChannelNotSupported:
            return None

    async def _capabilities(self, bot: ChannelBot) -> ChannelCapabilities:
        return await self.channels_service.fetch_capabilities(
            channel=bot.connection.channel, connection=bot.connection
        )

    async def _resolve_destination(
        self, *, project_id: UUID, artifact_id: UUID, destination_id: str
    ) -> _Destination:
        """Look a destination id up again, inside this project and this run's
        bots, and check the bot can still reach it. Anything else is not
        found, and says nothing about where it might exist."""

        space_id = decode_destination_id(destination_id)
        if space_id is None:
            raise ChannelToolsNotFound()
        bots = await self.resolve_bots(project_id=project_id, artifact_id=artifact_id)
        if not bots:
            raise ChannelToolsRefused(NO_BOT_MESSAGE)
        space = await self.channels_dao.fetch_space(
            project_id=project_id, space_id=space_id
        )
        bot = next(
            (b for b in bots if space and b.connection.id == space.connection_id),
            None,
        )
        if space is None or bot is None:
            raise ChannelToolsNotFound()
        if space.kind is ChannelSpaceKind.PRIVATE:
            raise ChannelToolsRefused(
                "Direct messages are not reachable with the channel tools."
            )
        if not _is_channel(space):
            raise ChannelToolsNotFound()

        members = await self._members(bot)
        if members is None:
            reachable = await self._bound_to_project(
                project_id=project_id, connection=bot.connection, spaces=[space]
            )
        else:
            capabilities = await self._capabilities(bot)
            keys = {
                compose_external_key(
                    capabilities, ChannelKeyGrain.SPACE, candidate.external_locator
                )
                for candidate in members
            }
            reachable = [space] if space.external_key in keys else []
        if not reachable:
            raise ChannelToolsNotFound(
                "Destination not found. The bot may have left it; list the "
                "destinations again."
            )
        return _Destination(bot=bot, space=space, name=_stored_name(space))

    # --- send ------------------------------------------------------------- #

    async def send_message(
        self,
        *,
        project_id: UUID,
        artifact_id: UUID,
        session_id: str,
        tool_call_id: str,
        destination_id: str,
        text: str,
        thread_id: Optional[str] = None,
    ) -> ChannelSendResult:
        """Post now, through the bot that owns the destination. The delivery
        row is written before the provider call and keyed on the session and
        the tool call, so a retried call answers with the first attempt's
        state instead of posting twice."""

        destination = await self._resolve_destination(
            project_id=project_id,
            artifact_id=artifact_id,
            destination_id=destination_id,
        )
        bot, space = destination.bot, destination.space
        if not bot.agent.data.tools.can_post_outside_conversation:
            raise ChannelToolsRefused(POSTING_OFF_MESSAGE)

        capabilities = await self._capabilities(bot)
        locator = _space_locator(capabilities, space)
        if thread_id is not None:
            if not bot.is_slack:
                raise ChannelToolsRefused(
                    "Telegram groups have no threads; send without a thread_id."
                )
            thread = decode_space_ref("thr", thread_id)
            if thread is None or thread[0] != space.id:
                raise ChannelToolsNotFound("Thread not found in this destination.")
            locator["thread_ts"] = thread[1]

        key = send_key(
            session_id=session_id,
            tool_call_id=tool_call_id,
            destination_id=destination_id,
            thread_id=thread_id,
            text=text,
        )
        existing = await self.channels_dao.fetch_outbox_event_by_key(
            project_id=project_id, key=key
        )
        if existing is not None:
            return _send_result(existing)

        # One attempt per tool call, by construction: only the request whose
        # insert created the row posts. The nonce tells it apart from a
        # concurrent retry that got the same row back; the retry reports the
        # row's state (unknown while the first request is still posting).
        nonce = str(uuid4())
        row = await self.channels_dao.record_outbox_event(
            project_id=project_id,
            event=ChannelOutboxEventCreate(
                connection_id=bot.connection.id,
                space_id=space.id,
                turn_id=tool_call_id,
                key=key,
                data=ChannelOutboxEventData(processed={"attempt": nonce}),
            ),
        )
        if (row.data.processed or {}).get("attempt") != nonce:
            return _send_result(row)

        return await self._post(
            project_id=project_id,
            bot=bot,
            row=row,
            locator=locator,
            content=[{"type": "text", "text": text}],
        )

    async def _post(
        self,
        *,
        project_id: UUID,
        bot: ChannelBot,
        row: ChannelOutboxEvent,
        locator: Dict[str, Any],
        content: List[Dict[str, Any]],
    ) -> ChannelSendResult:
        adapter = self.channels_service.adapter_registry.get(bot.connection.channel)

        async def settle(state, status, data=None) -> ChannelSendResult:
            settled = await self.channels_dao.transition_outbox_event(
                project_id=project_id,
                event_id=row.id,
                state=state,
                status=status,
                data=data,
            )
            return _send_result(
                settled
                or row.model_copy(
                    update={"state": state, "status": status, "data": data or row.data}
                )
            )

        try:
            receipt = await adapter.post_message(
                connection=bot.connection,
                locator=locator,
                content=content,
                idempotency_key=row.key,
            )
        except ChannelCredentialRevoked:
            await self.channels_service.deactivate_connection(
                project_id=project_id, connection_id=bot.connection.id
            )
            return await settle(
                ChannelDeliveryState.FAILED,
                Status(code="credential_revoked", message="credential_revoked"),
            )
        except Exception as exc:  # noqa: BLE001 - every outcome is recorded
            reason = _reason(exc)
            log.warning("channel tools: send failed row=%s reason=%s", row.id, reason)
            if delivery_outcome_unknown(exc):
                return await settle(
                    ChannelDeliveryState.FAILED,
                    Status(
                        code="delivery_uncertain", type=str(row.key), message=reason
                    ),
                )
            return await settle(
                ChannelDeliveryState.FAILED,
                Status(code="delivery_failed", message=reason),
            )

        return await settle(
            ChannelDeliveryState.SENT,
            Status(code="sent"),
            ChannelOutboxEventData(
                external_locator=receipt,
                processed={
                    "content": content,
                    "final": True,
                    "thread_ts": locator.get("thread_ts"),
                },
            ),
        )

    # --- read ------------------------------------------------------------- #

    async def read_messages(
        self,
        *,
        project_id: UUID,
        artifact_id: UUID,
        destination_id: str,
        thread_id: Optional[str] = None,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
    ) -> ChannelMessagesPage:
        """A channel's most recent messages, or one Slack thread, oldest
        first. See `_read_channel` and `_read_thread`."""

        destination = await self._resolve_destination(
            project_id=project_id,
            artifact_id=artifact_id,
            destination_id=destination_id,
        )
        bot, space = destination.bot, destination.space
        if not bot.can_read(space):
            raise ChannelToolsRefused(READ_OFF_MESSAGE)
        size = min(max(limit or READ_DEFAULT_LIMIT, 1), READ_MAX_LIMIT)

        if thread_id is None:
            return await self._read_channel(
                project_id=project_id, bot=bot, space=space, size=size, cursor=cursor
            )
        thread = decode_space_ref("thr", thread_id)
        if thread is None or thread[0] != space.id:
            raise ChannelToolsNotFound("Thread not found in this destination.")
        if not bot.is_slack:
            raise ChannelToolsRefused("Telegram groups have no threads.")
        return await self._read_thread(
            project_id=project_id,
            bot=bot,
            space=space,
            thread_ts=thread[1],
            size=size,
            cursor=cursor,
        )

    async def _read_channel(
        self,
        *,
        project_id: UUID,
        bot: ChannelBot,
        space: ChannelSpace,
        size: int,
        cursor: Optional[str],
    ) -> ChannelMessagesPage:
        """Stored messages first, newest page first; on Slack, when they run
        short, one live history page before the oldest of them. Live messages
        are not stored. Every source is read in one (time, id) order and the
        cursor carries both, so pages neither repeat nor skip."""

        before = _decode_cursor(cursor, space.id, "at")
        stored = await self._stored_items(
            project_id=project_id, space=space, before=before, limit=size
        )
        notes = [STORED_NOTE] if stored else []
        more = len(stored) == size
        live: List[_Item] = []

        if not bot.is_slack:
            notes.append(TELEGRAM_READ_NOTE)
        elif len(stored) < size:
            oldest = stored[-1].at if stored else (before[0] if before else None)
            try:
                page = await self._adapter(bot).read_history(
                    connection=bot.connection,
                    locator=_space_locator(await self._capabilities(bot), space),
                    latest=slack_ts(oldest) if oldest else None,
                    limit=size - len(stored),
                )
            except ChannelRateLimited as e:
                notes.append(_rate_limit_note(e))
                more = True
            except ChannelBackfillRefused as e:
                notes.append(f"Slack refused to read older history here ({e.reason}).")
            else:
                seen = {item.identity for item in stored}
                live = [
                    _live_item(space.id, m)
                    for m in page.messages
                    if ("ref", m.message_ref) not in seen
                ]
                more = page.has_more
                if live:
                    notes.append(LIVE_CHANNEL_NOTE)

        items = sorted(stored + live, key=_item_order)
        next_cursor = None
        if more:
            last = items[0] if items else None
            at = (
                last.at
                if last
                else (before[0] if before else datetime.now(timezone.utc))
            )
            next_cursor = _encode_cursor(
                space.id, "at", at, last.row_id if last else None
            )
        return ChannelMessagesPage(
            messages=[item.message for item in items],
            cursor=next_cursor,
            notes=notes,
        )

    async def _read_thread(
        self,
        *,
        project_id: UUID,
        bot: ChannelBot,
        space: ChannelSpace,
        thread_ts: str,
        size: int,
        cursor: Optional[str],
    ) -> ChannelMessagesPage:
        """A Slack thread from its root forward, read live (Slack pages a
        thread from the start), with the bot's posts and current text. When
        Slack will not answer, the stored part of the thread instead."""

        slack_cursor = _decode_cursor(cursor, space.id, "slack")
        try:
            page = await self._adapter(bot).read_history(
                connection=bot.connection,
                locator=_space_locator(await self._capabilities(bot), space),
                thread_ts=thread_ts,
                cursor=slack_cursor,
                limit=size,
            )
        except (ChannelRateLimited, ChannelBackfillRefused) as e:
            note = (
                _rate_limit_note(e)
                if isinstance(e, ChannelRateLimited)
                else f"Slack refused to read this thread ({e.reason})."
            )
            if slack_cursor:
                # a later page: hand the same cursor back, so a retry resumes
                return ChannelMessagesPage(cursor=cursor, notes=[note])
            stored = await self._stored_items(
                project_id=project_id,
                space=space,
                thread_ts=thread_ts,
                before=None,
                limit=size,
            )
            notes = [STORED_NOTE, THREAD_PARTIAL_NOTE] if stored else []
            return ChannelMessagesPage(
                messages=[item.message for item in sorted(stored, key=_item_order)],
                notes=notes + [note],
            )
        return ChannelMessagesPage(
            messages=[_live_item(space.id, m).message for m in page.messages],
            cursor=(
                _encode_cursor(space.id, "slack", page.next_cursor)
                if page.has_more and page.next_cursor
                else None
            ),
        )

    async def _stored_items(
        self,
        *,
        project_id: UUID,
        space: ChannelSpace,
        before: Optional[Tuple[datetime, Optional[UUID]]],
        limit: int,
        thread_ts: Optional[str] = None,
    ) -> List["_Item"]:
        """People's messages from the inbox and the bot's posts from the
        outbox, newest first by (time, id). The inbox query leaves out copies
        of the bot's own posts, so the two sources never overlap and each
        pages on its own order."""

        inbox = await self.channels_dao.query_space_inbox_messages(
            project_id=project_id,
            space_id=space.id,
            thread_ts=thread_ts,
            before=before,
            limit=limit,
        )
        outbox = await self.channels_dao.query_space_outbox_messages(
            project_id=project_id,
            space_id=space.id,
            thread_ts=thread_ts,
            before=before,
            limit=limit,
        )
        items = [_person_item(space.id, event) for event in inbox] + [
            _bot_item(space.id, row, thread) for row, thread in outbox
        ]
        return sorted(items, key=_item_order, reverse=True)[:limit]

    def _adapter(self, bot: ChannelBot):
        return self.channels_service.adapter_registry.get(bot.connection.channel)

    # --- search ----------------------------------------------------------- #

    async def search_messages(
        self,
        *,
        project_id: UUID,
        artifact_id: UUID,
        query: str,
        destination_ids: Optional[List[str]] = None,
        after: Optional[datetime] = None,
        before: Optional[datetime] = None,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
    ) -> ChannelSearchResult:
        """Stored messages of the channels this agent may read now. Access is
        decided when the query runs, not when a message was stored; direct
        messages and other projects' spaces are never in the set."""

        bots = await self.resolve_bots(project_id=project_id, artifact_id=artifact_id)
        if not bots:
            raise ChannelToolsRefused(NO_BOT_MESSAGE)

        readable: List[_Destination] = []
        for bot in bots:
            readable.extend(
                destination
                for destination in await self._destinations(
                    project_id=project_id, bot=bot
                )
                if bot.can_read(destination.space)
            )
        if not readable and all(
            bot.agent.data.tools.readable_space_keys == [] for bot in bots
        ):
            raise ChannelToolsRefused(SEARCH_OFF_MESSAGE)
        if destination_ids is not None:
            wanted = {decode_destination_id(value) for value in destination_ids}
            readable = [d for d in readable if d.space.id in wanted]
            # an empty result would read as "no match" when nothing was searched
            if len(readable) < len(wanted):
                raise ChannelToolsNotFound(UNKNOWN_SEARCH_DESTINATION_MESSAGE)

        searched = [
            ChannelSearchedChannel(
                destination_id=encode_destination_id(d.space.id),
                name=d.name,
                coverage=(
                    SLACK_SEARCH_COVERAGE
                    if d.bot.is_slack
                    else TELEGRAM_SEARCH_COVERAGE
                ),
            )
            for d in readable
        ]
        if not readable:
            return ChannelSearchResult(searched=searched)

        size = min(max(limit or SEARCH_DEFAULT_LIMIT, 1), SEARCH_MAX_LIMIT)
        offset = _offset(cursor)
        rows = await self.channels_dao.search_space_messages(
            project_id=project_id,
            space_ids=[d.space.id for d in readable],
            query=query,
            after=after,
            before=before,
            limit=size + 1,
            offset=offset,
        )

        by_space = {d.space.id: d for d in readable}
        results = []
        for row in rows[:size]:
            if isinstance(row, ChannelInboxEvent):
                space_id = row.space_id
                message = _person_item(space_id, row).message
            else:
                post, thread_ref = row
                space_id = post.space_id
                message = _bot_item(space_id, post, thread_ref).message
            destination = by_space[space_id]
            results.append(
                ChannelSearchResultItem(
                    message_id=message.message_id,
                    destination_id=encode_destination_id(space_id),
                    channel_name=destination.name,
                    thread_id=message.thread_id,
                    sender_name=message.sender_name,
                    excerpt=message.text[:_EXCERPT_CHARS],
                    sent_at=message.sent_at,
                )
            )
        return ChannelSearchResult(
            results=results,
            cursor=str(offset + size) if len(rows) > size else None,
            searched=searched,
        )

    async def _bound_to_project(
        self,
        *,
        project_id: UUID,
        connection: ChannelConnection,
        spaces: List[ChannelSpace],
    ) -> List[ChannelSpace]:
        """The shared Telegram bot serves every project, so a chat that was
        rebound elsewhere must stop being a destination here."""

        if connection.channel != "telegram_hosted":
            return spaces
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

    async def available_tools(
        self, *, project_id: UUID, artifact_id: UUID
    ) -> List[str]:
        """The channel tools this agent's runs get, following its bots'
        settings: the list while any bot is connected, send while any bot may
        post, read and search while any bot may read at least one channel. An
        ambiguous binding still offers the list, so the calls surface the
        configuration error instead of hiding it."""

        try:
            bots = await self.resolve_bots(
                project_id=project_id, artifact_id=artifact_id
            )
        except ChannelToolsRefused:
            return [LIST_TOOL]
        if not bots:
            return []
        tools = [LIST_TOOL]
        if any(b.agent.data.tools.can_post_outside_conversation for b in bots):
            tools.append(SEND_TOOL)
        if any(b.agent.data.tools.readable_space_keys != [] for b in bots):
            tools.extend([READ_TOOL, SEARCH_TOOL])
        return tools

    async def is_available(self, *, project_id: UUID, artifact_id: UUID) -> bool:
        """Whether this agent is connected to an active, verified bot."""

        return bool(
            await self.available_tools(project_id=project_id, artifact_id=artifact_id)
        )

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


def send_key(
    *,
    session_id: str,
    tool_call_id: str,
    destination_id: str,
    thread_id: Optional[str],
    text: str,
) -> UUID:
    """The delivery row's key. The call's own arguments are part of it: a retry
    of one call finds its row, while a harness that reuses a call id in a later
    turn still gets a new post for a new message."""

    return uuid5(
        _SEND_KEYS,
        f"{session_id}:{tool_call_id}:{destination_id}:{thread_id or ''}:{text}",
    )


def _is_channel(space: ChannelSpace) -> bool:
    return (
        space.kind in _CHANNEL_KINDS
        and space.deleted_at is None
        and space.flags.is_active
    )


def _space_locator(
    capabilities: ChannelCapabilities, space: ChannelSpace
) -> Dict[str, Any]:
    """Where a top-level post to this space goes: only the space grain's own
    fields. A space first met through a threaded message stores that
    message's thread, which a channel post must not inherit."""

    fields = capabilities.identity.keys.get(ChannelKeyGrain.SPACE) or []
    locator = space.data.external_locator or {}
    return {field: locator[field] for field in fields if field in locator}


def _reason(exc: BaseException) -> str:
    """A short, credential-free reason: the platform's own error code or
    description, else the exception's type. Never the exception text, which
    for a transport error can carry a URL with the bot token in it."""

    for attribute in ("error", "description"):
        value = getattr(exc, attribute, None)
        if isinstance(value, str) and value:
            return value[:200]
    return type(exc).__name__


def _send_result(row: ChannelOutboxEvent) -> ChannelSendResult:
    status = row.status
    if row.state is ChannelDeliveryState.SENT:
        receipt = (row.data.external_locator if row.data else None) or {}
        processed = (row.data.processed if row.data else None) or {}
        ref = receipt.get("ts") or receipt.get("message_id")
        message_id = (
            encode_space_ref("msg", row.space_id, str(ref))
            if ref is not None and row.space_id
            else None
        )
        thread_ts = processed.get("thread_ts") or receipt.get("ts")
        thread_id = (
            encode_space_ref("thr", row.space_id, str(thread_ts))
            if "ts" in receipt and thread_ts and row.space_id
            else None
        )
        return ChannelSendResult(
            delivery_id=str(row.id),
            state="sent",
            message_id=message_id,
            thread_id=thread_id,
        )
    if row.state is ChannelDeliveryState.FAILED and not (
        status and status.code == "delivery_uncertain"
    ):
        return ChannelSendResult(
            delivery_id=str(row.id),
            state="failed",
            reason=(status.message if status else None) or "failed",
        )
    # uncertain, or still claimed by a request that may have died mid-post
    return ChannelSendResult(
        delivery_id=str(row.id),
        state="unknown",
        reason="The post may have reached the chat; it is not sent again.",
    )


@dataclass(frozen=True)
class _Item:
    """One message on its way into a read: where it sorts (time, then the
    stored row id; live messages have none), and what identifies it across
    sources (the provider reference when there is one)."""

    at: datetime
    row_id: Optional[UUID]
    identity: Tuple[str, str]
    message: ChannelMessage


def _item_order(item: "_Item"):
    return (item.at, str(item.row_id) if item.row_id else "")


def _encode_cursor(space_id: UUID, kind: str, *parts: Any) -> str:
    values = [p.isoformat() if isinstance(p, datetime) else str(p or "") for p in parts]
    return encode_space_ref("cur", space_id, "|".join([kind, *values]))


def _decode_cursor(cursor: Optional[str], space_id: UUID, kind: str):
    """The cursor's position when it belongs to this space and this kind of
    read; anything else starts from the newest messages."""

    decoded = decode_space_ref("cur", cursor) if cursor else None
    if decoded is None or decoded[0] != space_id:
        return None
    parts = decoded[1].split("|")
    if parts[0] != kind:
        return None
    if kind == "slack":
        return parts[1] or None if len(parts) == 2 else None
    try:
        at = datetime.fromisoformat(parts[1])
        row_id = UUID(parts[2]) if len(parts) > 2 and parts[2] else None
    except (IndexError, ValueError):
        return None
    return at, row_id


def _rate_limit_note(error: ChannelRateLimited) -> str:
    wait = f"{error.retry_after} seconds" if error.retry_after else "about a minute"
    return (
        "Slack limits this app to about one history request per minute. "
        f"Try again in {wait}."
    )


def _sender_name(sender: Dict[str, Any]) -> Optional[str]:
    return sender.get("name") or sender.get("username") or None


def _content_text(content: List[Dict[str, Any]]) -> str:
    parts = []
    for part in content or []:
        if part.get("type") == "text" and part.get("text"):
            parts.append(part["text"])
        elif part.get("type") == "card":
            parts.extend(p for p in (part.get("title"), part.get("text")) if p)
    return "\n".join(parts)


def _person_item(space_id: UUID, event: ChannelInboxEvent) -> _Item:
    processed = event.data.processed
    ref = processed.message_ref
    at = event.sent_at or event.created_at or datetime.now(timezone.utc)
    thread_ref = (event.data.external_locator or {}).get("thread_ts")
    return _Item(
        at=at,
        row_id=event.id,
        identity=("ref", ref) if ref else ("row", str(event.id)),
        message=ChannelMessage(
            message_id=encode_space_ref("msg", space_id, ref or str(event.id)),
            thread_id=(
                encode_space_ref("thr", space_id, thread_ref) if thread_ref else None
            ),
            sender_name=_sender_name(processed.sender or {}),
            text=_content_text(processed.content),
            sent_at=at,
        ),
    )


def _bot_item(
    space_id: UUID, row: ChannelOutboxEvent, thread_ref: Optional[str]
) -> _Item:
    """The bot's post sorts by its row's creation time, the order the outbox
    query reads in; it shows Slack's own time when the receipt has one."""

    receipt = (row.data.external_locator if row.data else None) or {}
    processed = (row.data.processed if row.data else None) or {}
    ref = receipt.get("ts") or (
        str(receipt["message_id"]) if receipt.get("message_id") is not None else None
    )
    at = row.created_at or datetime.now(timezone.utc)
    slack = "ts" in receipt
    return _Item(
        at=at,
        row_id=row.id,
        identity=("ref", ref) if ref else ("row", str(row.id)),
        message=ChannelMessage(
            message_id=encode_space_ref("msg", space_id, ref or str(row.id)),
            thread_id=(
                encode_space_ref("thr", space_id, thread_ref)
                if slack and thread_ref
                else None
            ),
            from_bot=True,
            text=_content_text(processed.get("content") or []),
            sent_at=slack_time(receipt.get("ts")) or at,
        ),
    )


def _live_item(space_id: UUID, message: ChannelHistoryMessage) -> _Item:
    at = message.sent_at or datetime.now(timezone.utc)
    return _Item(
        at=at,
        row_id=None,
        identity=("ref", message.message_ref),
        message=ChannelMessage(
            message_id=encode_space_ref("msg", space_id, message.message_ref),
            thread_id=(
                encode_space_ref("thr", space_id, message.thread_ref)
                if message.thread_ref
                else None
            ),
            sender_name=_sender_name(message.sender),
            from_bot=message.from_bot,
            text=message.text,
            sent_at=at,
        ),
    )


def _stored_name(space: ChannelSpace) -> Optional[str]:
    locator = space.data.external_locator or {}
    return space.name or locator.get("title")


def _offset(cursor: Optional[str]) -> int:
    try:
        return max(int(cursor or 0), 0)
    except ValueError:
        return 0
