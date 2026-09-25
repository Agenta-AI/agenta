"""An in-memory stand-in for the parts of the channels DAO the tool service
reaches, and a builder for the service over it.

Plain duck typing, not the DAO interface: a call this fake does not answer
fails with AttributeError, which points at the tool service overreaching."""

from datetime import datetime, timezone
from typing import Dict, List, Optional
from uuid import UUID, uuid4

from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.adapters.slack.mapping import slack_time
from oss.src.core.channels.dtos import (
    ChannelAgent,
    ChannelEventKind,
    ChannelEventOrigin,
    ChannelInboxEvent,
    ChannelInboxEventData,
    ChannelInboxEventProcessed,
    ChannelOutboxEventData,
    ChannelAgentData,
    ChannelAgentFlags,
    ChannelConnection,
    ChannelConnectionFlags,
    ChannelDeliveryState,
    ChannelOutboxEvent,
    ChannelOutboxEventCreate,
    ChannelSpace,
    ChannelSpaceCreate,
    ChannelSpaceData,
    ChannelSpaceKind,
)
from oss.src.core.channels.service import ChannelsService
from oss.src.core.channels.tools.service import ChannelToolsService

PROJECT_ID = uuid4()


class FakeToolsDAO:
    def __init__(self) -> None:
        self.connections: Dict[UUID, ChannelConnection] = {}
        self.agents: Dict[UUID, ChannelAgent] = {}
        self.spaces: Dict[UUID, ChannelSpace] = {}
        self.outbox: Dict[UUID, ChannelOutboxEvent] = {}
        self.inbox: List[ChannelInboxEvent] = []
        self.sent: List[tuple] = []  # (ChannelOutboxEvent, thread_ts)
        self.searches: List[dict] = []

    # --- seeding --- #

    def seed_connection(
        self, *, channel: str = "slack", data: Optional[dict] = None, **flags
    ) -> ChannelConnection:
        connection = ChannelConnection(
            id=uuid4(),
            slug=f"{channel}-{uuid4().hex[:6]}",
            channel=channel,
            external_key=uuid4(),
            data=data
            if data is not None
            else {"bot_token": "xoxb-fake", "connection_locator": {"team_id": "T1"}},
            flags=ChannelConnectionFlags(
                **{"is_active": True, "is_verified": True, **flags}
            ),
        )
        self.connections[connection.id] = connection
        return connection

    def seed_agent(
        self,
        *,
        connection_id: UUID,
        references: dict,
        tools: Optional[dict] = None,
        **flags,
    ) -> ChannelAgent:
        data = {"references": references}
        if tools is not None:
            data["tools"] = tools
        agent = ChannelAgent(
            id=uuid4(),
            slug=f"agent-{uuid4().hex[:6]}",
            connection_id=connection_id,
            data=ChannelAgentData.model_validate(data),
            flags=ChannelAgentFlags(**flags),
        )
        self.agents[agent.id] = agent
        return agent

    def seed_space(
        self,
        *,
        connection_id: UUID,
        locator: dict,
        kind: ChannelSpaceKind = ChannelSpaceKind.GROUP,
        name: Optional[str] = None,
        external_key: Optional[UUID] = None,
    ) -> ChannelSpace:
        space = ChannelSpace(
            id=uuid4(),
            connection_id=connection_id,
            kind=kind,
            external_key=external_key or uuid4(),
            name=name,
            data=ChannelSpaceData(external_locator=locator),
        )
        self.spaces[space.id] = space
        return space

    def seed_inbox(
        self,
        *,
        space: ChannelSpace,
        text: str,
        ts: str,
        thread_ts: Optional[str] = None,
        sender: Optional[dict] = None,
        kind: ChannelEventKind = ChannelEventKind.MESSAGE,
        origin: ChannelEventOrigin = ChannelEventOrigin.PUSHED,
    ) -> ChannelInboxEvent:
        event = ChannelInboxEvent(
            id=uuid4(),
            connection_id=space.connection_id,
            external_id=f"{ts}:{text}",
            kind=kind,
            origin=origin,
            space_id=space.id,
            sent_at=slack_time(ts),
            data=ChannelInboxEventData(
                # Slack locators carry the thread; Telegram's never do
                external_locator={
                    **space.data.external_locator,
                    **(
                        {"thread_ts": thread_ts or ts}
                        if "channel" in space.data.external_locator
                        else {}
                    ),
                },
                processed=ChannelInboxEventProcessed(
                    content=[{"type": "text", "text": text}],
                    sender=sender or {"id": "U1"},
                    sent_at=slack_time(ts),
                    message_ref=ts,
                ),
            ),
        )
        self.inbox.append(event)
        return event

    def seed_sent(
        self,
        *,
        space: ChannelSpace,
        text: str,
        ts: str,
        thread_ts: Optional[str] = None,
        created_at=None,
    ) -> ChannelOutboxEvent:
        row = ChannelOutboxEvent(
            id=uuid4(),
            created_at=created_at or slack_time(ts),
            connection_id=space.connection_id,
            space_id=space.id,
            turn_id="turn",
            key=uuid4(),
            state=ChannelDeliveryState.SENT,
            data=ChannelOutboxEventData(
                external_locator={"channel": "C", "ts": ts},
                processed={"content": [{"type": "text", "text": text}], "final": True},
            ),
        )
        self.sent.append((row, thread_ts or ts))
        return row

    def archive_connection(self, connection_id: UUID) -> None:
        connection = self.connections[connection_id]
        self.connections[connection_id] = connection.model_copy(
            update={"deleted_at": datetime.now(timezone.utc)}
        )

    # --- connections and agents --- #

    async def fetch_connection(self, *, project_id, connection_id):
        return self.connections.get(connection_id)

    async def edit_connection(self, *, project_id, user_id, connection):
        existing = self.connections[connection.id]
        updated = existing.model_copy(update={"flags": connection.flags})
        self.connections[connection.id] = updated
        return updated

    async def query_agents(self, *, project_id, agent=None, windowing=None):
        return [
            a
            for a in self.agents.values()
            if a.deleted_at is None
            and self.connections[a.connection_id].deleted_at is None
        ]

    # --- spaces --- #

    async def fetch_space(self, *, project_id, space_id):
        return self.spaces.get(space_id)

    async def query_spaces(self, *, project_id, space=None, windowing=None):
        rows = list(self.spaces.values())
        if space is not None and space.connection_id is not None:
            rows = [r for r in rows if r.connection_id == space.connection_id]
        return rows

    async def get_or_create_space(self, *, project_id, user_id, space):
        assert isinstance(space, ChannelSpaceCreate)
        for existing in self.spaces.values():
            if (
                existing.connection_id == space.connection_id
                and existing.external_key == space.external_key
            ):
                return existing
        row = ChannelSpace(
            id=uuid4(),
            connection_id=space.connection_id,
            kind=space.kind,
            external_key=space.external_key,
            name=space.name,
            data=space.data,
        )
        self.spaces[row.id] = row
        return row

    # --- a space's messages --- #

    async def query_space_inbox_messages(
        self, *, project_id, space_id, thread_ts=None, before=None, limit
    ):
        posted = {
            (row.data.external_locator or {}).get("ts")
            for row, _ in self.sent
            if row.space_id == space_id
        }
        rows = [
            e
            for e in self.inbox
            if e.space_id == space_id
            and e.kind is ChannelEventKind.MESSAGE
            and (
                e.origin is ChannelEventOrigin.PUSHED
                or e.data.processed.message_ref not in posted
            )
            and (
                thread_ts is None
                or e.data.external_locator.get("thread_ts") == thread_ts
            )
            and _older(e.sent_at, e.id, before)
        ]
        rows.sort(key=lambda e: (e.sent_at, str(e.id)), reverse=True)
        return rows[:limit]

    async def query_space_outbox_messages(
        self, *, project_id, space_id, thread_ts=None, before=None, limit
    ):
        rows = [
            (row, thread)
            for row, thread in self.sent
            if row.space_id == space_id
            and (thread_ts is None or thread == thread_ts)
            and _older(row.created_at, row.id, before)
        ]
        rows.sort(key=lambda pair: (pair[0].created_at, str(pair[0].id)), reverse=True)
        return rows[:limit]

    async def search_space_inbox_messages(
        self,
        *,
        project_id,
        space_ids,
        query,
        after=None,
        before=None,
        limit,
        offset=0,
    ):
        self.searches.append({"space_ids": list(space_ids), "query": query})
        words = query.lower().split()
        rows = [
            e
            for e in self.inbox
            if e.space_id in set(space_ids)
            and e.kind is ChannelEventKind.MESSAGE
            and all(w in e.data.processed.content[0]["text"].lower() for w in words)
            and (after is None or e.sent_at >= after)
            and (before is None or e.sent_at <= before)
        ]
        rows.sort(key=lambda e: (e.sent_at, str(e.id)), reverse=True)
        return rows[offset : offset + limit]

    # --- outbox --- #

    async def fetch_outbox_event_by_key(self, *, project_id, key):
        return self.outbox.get(key)

    async def record_outbox_event(self, *, project_id, event: ChannelOutboxEventCreate):
        existing = self.outbox.get(event.key)
        if existing is not None:
            return existing
        now = datetime.now(timezone.utc)
        row = ChannelOutboxEvent(
            id=uuid4(),
            created_at=now,
            updated_at=now,
            **event.model_dump(),
        )
        self.outbox[event.key] = row
        return row

    def _by_id(self, event_id: UUID) -> Optional[ChannelOutboxEvent]:
        return next((r for r in self.outbox.values() if r.id == event_id), None)

    async def fetch_outbox_event(self, *, project_id, event_id):
        return self._by_id(event_id)

    async def transition_outbox_event(
        self, *, project_id, event_id, state, status=None, data=None, claim_token=None
    ):
        row = self._by_id(event_id)
        if row is None:
            return None
        if claim_token is not None and (
            row.status is None
            or row.status.code != "sending"
            or row.status.message != claim_token
        ):
            return None
        update = {"state": state, "updated_at": datetime.now(timezone.utc)}
        if status is not None:
            update["status"] = status
        if data is not None:
            update["data"] = data
        updated = row.model_copy(update=update)
        self.outbox[row.key] = updated
        return updated


def _older(at, row_id, before) -> bool:
    """The DAO's keyset bound: strictly older in (time, id) order."""
    if before is None:
        return True
    bound_at, bound_id = before
    if bound_id is None:
        return at < bound_at
    return (at, str(row_id)) < (bound_at, str(bound_id))


def build_tools_service(dao: FakeToolsDAO, adapters: dict, **kwargs):
    channels_service = ChannelsService(
        channels_dao=dao,
        adapter_registry=ChannelAdapterRegistry(adapters=adapters),
    )
    return ChannelToolsService(channels_service=channels_service, **kwargs)
