"""An in-memory stand-in for the parts of the channels DAO the tool service
reaches, and a builder for the service over it.

Plain duck typing, not the DAO interface: a call this fake does not answer
fails with AttributeError, which points at the tool service overreaching."""

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional
from uuid import UUID, uuid4

from oss.src.core.channels.adapters.registry import ChannelAdapterRegistry
from oss.src.core.channels.dtos import (
    ChannelAgent,
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
from oss.src.core.shared.dtos import Status

PROJECT_ID = uuid4()


class FakeToolsDAO:
    def __init__(self) -> None:
        self.connections: Dict[UUID, ChannelConnection] = {}
        self.agents: Dict[UUID, ChannelAgent] = {}
        self.spaces: Dict[UUID, ChannelSpace] = {}
        self.outbox: Dict[UUID, ChannelOutboxEvent] = {}
        self.stored_messages: Dict[UUID, List[dict]] = {}
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

    async def claim_outbox_delivery(
        self,
        *,
        project_id,
        event_id,
        content,
        claim_ttl_seconds,
        overwrite_final=True,
        delivery_key=None,
    ):
        row = self._by_id(event_id)
        if row is None or row.state is ChannelDeliveryState.SENT:
            return None
        if (
            row.status is not None
            and row.status.code == "sending"
            and row.updated_at
            > datetime.now(timezone.utc) - timedelta(seconds=claim_ttl_seconds)
        ):
            return None
        claimed = row.model_copy(
            update={
                "status": Status(code="sending", message=str(uuid4())),
                "updated_at": datetime.now(timezone.utc),
            }
        )
        self.outbox[row.key] = claimed
        return deepcopy(claimed)

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


def build_tools_service(dao: FakeToolsDAO, adapters: dict, **kwargs):
    channels_service = ChannelsService(
        channels_dao=dao,
        adapter_registry=ChannelAdapterRegistry(adapters=adapters),
    )
    return ChannelToolsService(channels_service=channels_service, **kwargs)
