from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID, uuid4

from sqlalchemy import (
    and_,
    cast,
    false,
    func,
    literal,
    not_,
    literal_column,
    or_,
    select,
    text,
    tuple_,
    update,
)
from sqlalchemy.dialects.postgresql import JSONB, insert

from oss.src.core.channels.dtos import (
    CHANNEL_TRIGGER_NEVER_SENT,
    ChannelEventKind,
    ChannelEventOrigin,
    ChannelAgent,
    ChannelAgentCreate,
    ChannelAgentEdit,
    ChannelAgentQuery,
    ChannelConnection,
    ChannelConnectionCreate,
    ChannelConnectionEdit,
    ChannelConnectionQuery,
    ChannelDeliveryState,
    ChannelGrant,
    ChannelGrantCreate,
    ChannelGrantEdit,
    ChannelGrantQuery,
    ChannelInboxEvent,
    ChannelInboxEventCreate,
    ChannelInboxEventQuery,
    ChannelInboxTrigger,
    ChannelInboxTriggerCreate,
    ChannelInboxTriggerQuery,
    ChannelOutboxEvent,
    ChannelOutboxEventCreate,
    ChannelOutboxEventData,
    ChannelOutboxEventQuery,
    ChannelPendingChoice,
    ChannelSpace,
    ChannelSpaceCreate,
    ChannelSpaceEdit,
    ChannelSpaceKind,
    ChannelSpaceQuery,
    ChannelThread,
    ChannelThreadCreate,
    ChannelThreadQuery,
    ChannelTriggerState,
)
from oss.src.core.channels.interfaces import ChannelsDAOInterface
from oss.src.core.shared.dtos import Status, Windowing
from oss.src.dbs.postgres.channels.dbes import (
    ChannelAgentDBE,
    ChannelConnectionDBE,
    ChannelGrantDBE,
    ChannelInboxEventDBE,
    ChannelInboxTriggerDBE,
    ChannelOutboxEventDBE,
    ChannelSpaceDBE,
    ChannelThreadDBE,
)
from oss.src.dbs.postgres.channels.mappings import (
    map_agent_dbe_to_dto,
    map_agent_dto_to_dbe_create,
    map_agent_dto_to_dbe_edit,
    map_connection_dbe_to_dto,
    map_connection_dto_to_dbe_create,
    map_connection_dto_to_dbe_edit,
    map_grant_dbe_to_dto,
    map_grant_dto_to_dbe_create,
    map_grant_dto_to_dbe_edit,
    map_inbox_event_dbe_to_dto,
    map_inbox_event_dto_to_dbe_create,
    map_inbox_trigger_dbe_to_dto,
    map_inbox_trigger_dto_to_dbe_create,
    map_outbox_event_dbe_to_dto,
    map_outbox_event_dto_to_dbe_create,
    map_space_dbe_to_dto,
    map_space_dto_to_dbe_create,
    map_space_dto_to_dbe_edit,
    map_thread_dbe_to_dto,
    map_thread_dto_to_dbe_create,
)
from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    get_transactions_engine,
)
from oss.src.dbs.postgres.shared.utils import apply_windowing


class ChannelsDAO(ChannelsDAOInterface):
    def __init__(self, engine: TransactionsEngine = None):
        if engine is None:
            engine = get_transactions_engine()
        self.engine = engine

    # --- connections ------------------------------------------------------ #

    async def create_connection(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        connection: ChannelConnectionCreate,
    ) -> ChannelConnection:
        connection_dbe = map_connection_dto_to_dbe_create(
            project_id=project_id,
            user_id=user_id,
            #
            connection=connection,
        )

        async with self.engine.session() as session:
            session.add(connection_dbe)

            await session.commit()

            await session.refresh(connection_dbe)

        return map_connection_dbe_to_dto(connection_dbe=connection_dbe)

    async def fetch_connection(
        self,
        *,
        project_id: UUID,
        #
        connection_id: UUID,
    ) -> Optional[ChannelConnection]:
        async with self.engine.session() as session:
            stmt = select(ChannelConnectionDBE).where(
                ChannelConnectionDBE.project_id == project_id,
                ChannelConnectionDBE.id == connection_id,
            )

            result = await session.execute(stmt)

            connection_dbe = result.scalar_one_or_none()

            if not connection_dbe:
                return None

            return map_connection_dbe_to_dto(connection_dbe=connection_dbe)

    async def edit_connection(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        connection: ChannelConnectionEdit,
    ) -> Optional[ChannelConnection]:
        async with self.engine.session() as session:
            stmt = select(ChannelConnectionDBE).where(
                ChannelConnectionDBE.project_id == project_id,
                ChannelConnectionDBE.id == connection.id,
            )

            result = await session.execute(stmt)

            connection_dbe = result.scalar_one_or_none()

            if not connection_dbe:
                return None

            map_connection_dto_to_dbe_edit(
                connection_dbe=connection_dbe,
                #
                user_id=user_id,
                #
                connection=connection,
            )

            await session.commit()

            await session.refresh(connection_dbe)

            return map_connection_dbe_to_dto(connection_dbe=connection_dbe)

    async def archive_connection(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        connection_id: UUID,
    ) -> Optional[ChannelConnection]:
        async with self.engine.session() as session:
            stmt = select(ChannelConnectionDBE).where(
                ChannelConnectionDBE.project_id == project_id,
                ChannelConnectionDBE.id == connection_id,
            )

            result = await session.execute(stmt)
            connection_dbe = result.scalar_one_or_none()

            if not connection_dbe:
                return None

            if connection_dbe.deleted_at is not None:
                # Already archived: keep the original instant so the agents archived
                # with it (same timestamp) still come back on unarchive.
                return map_connection_dbe_to_dto(connection_dbe=connection_dbe)

            now = datetime.now(timezone.utc)

            connection_dbe.deleted_at = now
            connection_dbe.deleted_by_id = user_id

            await session.execute(
                update(ChannelAgentDBE)
                .where(
                    ChannelAgentDBE.project_id == project_id,
                    ChannelAgentDBE.connection_id == connection_id,
                    ChannelAgentDBE.deleted_at.is_(None),
                )
                .values(deleted_at=now, deleted_by_id=user_id)
            )

            await session.commit()
            await session.refresh(connection_dbe)

            return map_connection_dbe_to_dto(connection_dbe=connection_dbe)

    async def unarchive_connection(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        connection_id: UUID,
    ) -> Optional[ChannelConnection]:
        async with self.engine.session() as session:
            stmt = select(ChannelConnectionDBE).where(
                ChannelConnectionDBE.project_id == project_id,
                ChannelConnectionDBE.id == connection_id,
            )

            result = await session.execute(stmt)
            connection_dbe = result.scalar_one_or_none()

            if not connection_dbe:
                return None

            archived_at = connection_dbe.deleted_at

            connection_dbe.deleted_at = None
            connection_dbe.deleted_by_id = None
            connection_dbe.updated_by_id = user_id

            # The mirror of archive's cascade: the agents archived together with
            # the connection (same instant) come back with it. An agent deleted
            # on its own, earlier, stays deleted. Without this, a reconnect
            # after a disconnect recreates the "default" agent and trips the
            # (connection, slug) unique key on the archived row.
            if archived_at is not None:
                await session.execute(
                    update(ChannelAgentDBE)
                    .where(
                        ChannelAgentDBE.project_id == project_id,
                        ChannelAgentDBE.connection_id == connection_id,
                        ChannelAgentDBE.deleted_at == archived_at,
                    )
                    .values(deleted_at=None, deleted_by_id=None, updated_by_id=user_id)
                )

            await session.commit()
            await session.refresh(connection_dbe)

            return map_connection_dbe_to_dto(connection_dbe=connection_dbe)

    async def delete_connection(
        self,
        *,
        project_id: UUID,
        #
        connection_id: UUID,
    ) -> bool:
        async with self.engine.session() as session:
            stmt = select(ChannelConnectionDBE).where(
                ChannelConnectionDBE.project_id == project_id,
                ChannelConnectionDBE.id == connection_id,
            )

            result = await session.execute(stmt)

            connection_dbe = result.scalar_one_or_none()

            if not connection_dbe:
                return False

            await session.delete(connection_dbe)

            await session.commit()

            return True

    async def query_connections(
        self,
        *,
        project_id: UUID,
        #
        connection: Optional[ChannelConnectionQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[ChannelConnection]:
        async with self.engine.session() as session:
            stmt = select(ChannelConnectionDBE).filter(
                ChannelConnectionDBE.project_id == project_id,
            )

            if connection:
                if connection.channel is not None:
                    stmt = stmt.filter(
                        ChannelConnectionDBE.channel == connection.channel
                    )

                if connection.slug is not None:
                    stmt = stmt.filter(ChannelConnectionDBE.slug == connection.slug)

            if windowing:
                stmt = apply_windowing(
                    stmt=stmt,
                    DBE=ChannelConnectionDBE,
                    attribute="id",
                    order="descending",
                    windowing=windowing,
                )

            result = await session.execute(stmt)

            return [
                map_connection_dbe_to_dto(connection_dbe=dbe)
                for dbe in result.scalars().all()
            ]

    # --- agents --------------------------------------------------------- #

    async def create_agent(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        agent: ChannelAgentCreate,
    ) -> ChannelAgent:
        agent_dbe = map_agent_dto_to_dbe_create(
            project_id=project_id,
            user_id=user_id,
            #
            agent=agent,
        )

        async with self.engine.session() as session:
            session.add(agent_dbe)

            await session.commit()

            await session.refresh(agent_dbe)

        return map_agent_dbe_to_dto(agent_dbe=agent_dbe)

    async def fetch_agent(
        self,
        *,
        project_id: UUID,
        #
        agent_id: UUID,
    ) -> Optional[ChannelAgent]:
        async with self.engine.session() as session:
            stmt = select(ChannelAgentDBE).where(
                ChannelAgentDBE.project_id == project_id,
                ChannelAgentDBE.id == agent_id,
            )

            result = await session.execute(stmt)

            agent_dbe = result.scalar_one_or_none()

            if not agent_dbe:
                return None

            return map_agent_dbe_to_dto(agent_dbe=agent_dbe)

    async def fetch_agent_by_slug(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
        #
        slug: str,
    ) -> Optional[ChannelAgent]:
        async with self.engine.session() as session:
            stmt = select(ChannelAgentDBE).where(
                ChannelAgentDBE.project_id == project_id,
                ChannelAgentDBE.connection_id == connection_id,
                ChannelAgentDBE.slug == slug,
            )

            result = await session.execute(stmt)

            agent_dbe = result.scalar_one_or_none()

            if not agent_dbe:
                return None

            return map_agent_dbe_to_dto(agent_dbe=agent_dbe)

    async def fetch_default_agent(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
    ) -> Optional[ChannelAgent]:
        async with self.engine.session() as session:
            stmt = (
                select(ChannelAgentDBE)
                .where(
                    ChannelAgentDBE.project_id == project_id,
                    ChannelAgentDBE.connection_id == connection_id,
                    ChannelAgentDBE.flags["is_default"].as_boolean().is_(True),
                )
                .limit(1)
            )

            result = await session.execute(stmt)

            agent_dbe = result.scalar_one_or_none()

            if not agent_dbe:
                return None

            return map_agent_dbe_to_dto(agent_dbe=agent_dbe)

    async def edit_agent(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        agent: ChannelAgentEdit,
    ) -> Optional[ChannelAgent]:
        async with self.engine.session() as session:
            stmt = select(ChannelAgentDBE).where(
                ChannelAgentDBE.project_id == project_id,
                ChannelAgentDBE.id == agent.id,
            )

            result = await session.execute(stmt)

            agent_dbe = result.scalar_one_or_none()

            if not agent_dbe:
                return None

            map_agent_dto_to_dbe_edit(
                agent_dbe=agent_dbe,
                #
                user_id=user_id,
                #
                agent=agent,
            )

            await session.commit()

            await session.refresh(agent_dbe)

            return map_agent_dbe_to_dto(agent_dbe=agent_dbe)

    async def delete_agent(
        self,
        *,
        project_id: UUID,
        #
        agent_id: UUID,
    ) -> bool:
        async with self.engine.session() as session:
            stmt = select(ChannelAgentDBE).where(
                ChannelAgentDBE.project_id == project_id,
                ChannelAgentDBE.id == agent_id,
            )

            result = await session.execute(stmt)

            agent_dbe = result.scalar_one_or_none()

            if not agent_dbe:
                return False

            await session.delete(agent_dbe)

            await session.commit()

            return True

    async def query_agents(
        self,
        *,
        project_id: UUID,
        #
        agent: Optional[ChannelAgentQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[ChannelAgent]:
        async with self.engine.session() as session:
            stmt = select(ChannelAgentDBE).filter(
                ChannelAgentDBE.project_id == project_id,
            )

            include_archived = bool(agent and agent.include_archived)

            if not include_archived:
                # Same soft-delete convention as elsewhere (e.g. the ingress
                # lookup): a binding is live only if neither it nor its
                # connection has been archived. Without the connection half
                # of this, an archived connection's bindings kept showing up
                # here (and thus in the agent picker) after disconnect.
                stmt = stmt.where(ChannelAgentDBE.deleted_at.is_(None)).where(
                    ~select(ChannelConnectionDBE.id)
                    .where(
                        ChannelConnectionDBE.project_id == ChannelAgentDBE.project_id,
                        ChannelConnectionDBE.id == ChannelAgentDBE.connection_id,
                        ChannelConnectionDBE.deleted_at.isnot(None),
                    )
                    .exists()
                )

            if agent:
                if agent.connection_id is not None:
                    stmt = stmt.filter(
                        ChannelAgentDBE.connection_id == agent.connection_id,
                    )

                if agent.slug is not None:
                    stmt = stmt.filter(ChannelAgentDBE.slug == agent.slug)

            if windowing:
                stmt = apply_windowing(
                    stmt=stmt,
                    DBE=ChannelAgentDBE,
                    attribute="id",
                    order="descending",
                    windowing=windowing,
                )

            result = await session.execute(stmt)

            return [
                map_agent_dbe_to_dto(agent_dbe=dbe) for dbe in result.scalars().all()
            ]

    # --- spaces ----------------------------------------------------------- #

    async def create_space(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        space: ChannelSpaceCreate,
    ) -> ChannelSpace:
        space_dbe = map_space_dto_to_dbe_create(
            project_id=project_id,
            user_id=user_id,
            #
            space=space,
        )

        async with self.engine.session() as session:
            session.add(space_dbe)

            await session.commit()

            await session.refresh(space_dbe)

        return map_space_dbe_to_dto(space_dbe=space_dbe)

    async def fetch_space(
        self,
        *,
        project_id: UUID,
        #
        space_id: UUID,
    ) -> Optional[ChannelSpace]:
        async with self.engine.session() as session:
            stmt = select(ChannelSpaceDBE).where(
                ChannelSpaceDBE.project_id == project_id,
                ChannelSpaceDBE.id == space_id,
            )

            result = await session.execute(stmt)

            space_dbe = result.scalar_one_or_none()

            if not space_dbe:
                return None

            return map_space_dbe_to_dto(space_dbe=space_dbe)

    async def fetch_space_by_key(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
        #
        external_key: UUID,
    ) -> Optional[ChannelSpace]:
        async with self.engine.session() as session:
            stmt = select(ChannelSpaceDBE).where(
                ChannelSpaceDBE.project_id == project_id,
                ChannelSpaceDBE.connection_id == connection_id,
                ChannelSpaceDBE.external_key == external_key,
            )

            result = await session.execute(stmt)

            space_dbe = result.scalar_one_or_none()

            if not space_dbe:
                return None

            return map_space_dbe_to_dto(space_dbe=space_dbe)

    async def get_or_create_space(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        #
        space: ChannelSpaceCreate,
    ) -> ChannelSpace:
        space_dbe = map_space_dto_to_dbe_create(
            project_id=project_id,
            user_id=user_id,
            #
            space=space,
        )

        async with self.engine.session() as session:
            values = {
                c.name: getattr(space_dbe, c.name)
                for c in ChannelSpaceDBE.__table__.columns
                if getattr(space_dbe, c.name) is not None
            }

            stmt = (
                insert(ChannelSpaceDBE)
                .values(**values)
                .on_conflict_do_nothing(
                    index_elements=["project_id", "connection_id", "external_key"],
                )
                .returning(ChannelSpaceDBE)
            )

            result = await session.execute(stmt)
            inserted = result.scalar_one_or_none()

            await session.commit()

            if inserted is not None:
                return map_space_dbe_to_dto(space_dbe=inserted)

            # lost the race: the row already exists, fetch it
            fetch_stmt = select(ChannelSpaceDBE).where(
                ChannelSpaceDBE.project_id == project_id,
                ChannelSpaceDBE.connection_id == space.connection_id,
                ChannelSpaceDBE.external_key == space.external_key,
            )
            fetched = await session.execute(fetch_stmt)
            existing = fetched.scalar_one()

            return map_space_dbe_to_dto(space_dbe=existing)

    async def edit_space(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        space: ChannelSpaceEdit,
    ) -> Optional[ChannelSpace]:
        async with self.engine.session() as session:
            stmt = select(ChannelSpaceDBE).where(
                ChannelSpaceDBE.project_id == project_id,
                ChannelSpaceDBE.id == space.id,
            )

            result = await session.execute(stmt)

            space_dbe = result.scalar_one_or_none()

            if not space_dbe:
                return None

            map_space_dto_to_dbe_edit(
                space_dbe=space_dbe,
                #
                user_id=user_id,
                #
                space=space,
            )

            await session.commit()

            await session.refresh(space_dbe)

            return map_space_dbe_to_dto(space_dbe=space_dbe)

    async def delete_space(
        self,
        *,
        project_id: UUID,
        #
        space_id: UUID,
    ) -> bool:
        async with self.engine.session() as session:
            stmt = select(ChannelSpaceDBE).where(
                ChannelSpaceDBE.project_id == project_id,
                ChannelSpaceDBE.id == space_id,
            )

            result = await session.execute(stmt)

            space_dbe = result.scalar_one_or_none()

            if not space_dbe:
                return False

            await session.delete(space_dbe)

            await session.commit()

            return True

    async def query_spaces(
        self,
        *,
        project_id: UUID,
        #
        space: Optional[ChannelSpaceQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[ChannelSpace]:
        async with self.engine.session() as session:
            stmt = select(ChannelSpaceDBE).filter(
                ChannelSpaceDBE.project_id == project_id,
            )

            if space:
                if space.connection_id is not None:
                    stmt = stmt.filter(
                        ChannelSpaceDBE.connection_id == space.connection_id,
                    )

                if space.kind is not None:
                    stmt = stmt.filter(ChannelSpaceDBE.kind == space.kind)

                if space.external_key is not None:
                    stmt = stmt.filter(
                        ChannelSpaceDBE.external_key == space.external_key,
                    )

            if windowing:
                stmt = apply_windowing(
                    stmt=stmt,
                    DBE=ChannelSpaceDBE,
                    attribute="id",
                    order="descending",
                    windowing=windowing,
                )

            result = await session.execute(stmt)

            return [
                map_space_dbe_to_dto(space_dbe=dbe) for dbe in result.scalars().all()
            ]

    async def mark_space_backfilled(
        self,
        *,
        project_id: UUID,
        #
        space_id: UUID,
    ) -> Optional[ChannelSpace]:
        async with self.engine.session() as session:
            stmt = select(ChannelSpaceDBE).where(
                ChannelSpaceDBE.project_id == project_id,
                ChannelSpaceDBE.id == space_id,
            )

            result = await session.execute(stmt)

            space_dbe = result.scalar_one_or_none()

            if not space_dbe:
                return None

            flags = dict(space_dbe.flags or {})
            flags["is_backfilled"] = True
            space_dbe.flags = flags
            space_dbe.updated_at = datetime.now(timezone.utc)

            await session.commit()

            await session.refresh(space_dbe)

            return map_space_dbe_to_dto(space_dbe=space_dbe)

    async def mark_inbox_event_consumed(
        self,
        *,
        project_id: UUID,
        #
        event_id: UUID,
    ) -> Optional[ChannelInboxEvent]:
        async with self.engine.session() as session:
            stmt = select(ChannelInboxEventDBE).where(
                ChannelInboxEventDBE.project_id == project_id,
                ChannelInboxEventDBE.id == event_id,
            )

            result = await session.execute(stmt)

            event_dbe = result.scalar_one_or_none()

            if not event_dbe:
                return None

            flags = dict(event_dbe.flags or {})
            if not flags.get("is_consumed"):
                event_dbe.flags = {**flags, "is_consumed": True}
                event_dbe.updated_at = datetime.now(timezone.utc)

                await session.commit()

                await session.refresh(event_dbe)

            return map_inbox_event_dbe_to_dto(event_dbe=event_dbe)

    async def attach_event_to_space(
        self,
        *,
        project_id: UUID,
        #
        event_id: UUID,
        space_id: UUID,
    ) -> Optional[ChannelInboxEvent]:
        """Set the log coordinate the ingress could not know.

        The ingress writes an event before any space is resolved, so `space_id`
        starts null and `query_events_since` — keyed on it — cannot see the row.
        Idempotent: a redelivery re-resolving the same space is a no-op.
        """
        async with self.engine.session() as session:
            stmt = select(ChannelInboxEventDBE).where(
                ChannelInboxEventDBE.project_id == project_id,
                ChannelInboxEventDBE.id == event_id,
            )

            result = await session.execute(stmt)

            event_dbe = result.scalar_one_or_none()

            if not event_dbe:
                return None

            if event_dbe.space_id == space_id:
                return map_inbox_event_dbe_to_dto(event_dbe=event_dbe)

            event_dbe.space_id = space_id
            event_dbe.updated_at = datetime.now(timezone.utc)

            await session.commit()

            await session.refresh(event_dbe)

            return map_inbox_event_dbe_to_dto(event_dbe=event_dbe)

    # --- grants ------------------------------------------------------------- #

    async def create_grant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        grant: ChannelGrantCreate,
    ) -> ChannelGrant:
        grant_dbe = map_grant_dto_to_dbe_create(
            project_id=project_id,
            user_id=user_id,
            #
            grant=grant,
        )

        async with self.engine.session() as session:
            session.add(grant_dbe)

            await session.commit()

            await session.refresh(grant_dbe)

        return map_grant_dbe_to_dto(grant_dbe=grant_dbe)

    async def fetch_grant(
        self,
        *,
        project_id: UUID,
        #
        agent_id: UUID,
        space_id: UUID,
    ) -> Optional[ChannelGrant]:
        async with self.engine.session() as session:
            stmt = select(ChannelGrantDBE).where(
                ChannelGrantDBE.project_id == project_id,
                ChannelGrantDBE.agent_id == agent_id,
                ChannelGrantDBE.space_id == space_id,
            )

            result = await session.execute(stmt)

            grant_dbe = result.scalar_one_or_none()

            if not grant_dbe:
                return None

            return map_grant_dbe_to_dto(grant_dbe=grant_dbe)

    async def fetch_default_grant(
        self,
        *,
        project_id: UUID,
        #
        space_id: UUID,
    ) -> Optional[ChannelGrant]:
        async with self.engine.session() as session:
            stmt = (
                select(ChannelGrantDBE)
                .where(
                    ChannelGrantDBE.project_id == project_id,
                    ChannelGrantDBE.space_id == space_id,
                    ChannelGrantDBE.flags["is_default"].as_boolean().is_(True),
                )
                .limit(1)
            )

            result = await session.execute(stmt)

            grant_dbe = result.scalar_one_or_none()

            if not grant_dbe:
                return None

            return map_grant_dbe_to_dto(grant_dbe=grant_dbe)

    async def query_matching_grants(
        self,
        *,
        project_id: UUID,
        agent_id: UUID,
        space_id: UUID,
        kind: ChannelSpaceKind,
    ) -> List[ChannelGrant]:
        async with self.engine.session() as session:
            stmt = select(ChannelGrantDBE).where(
                ChannelGrantDBE.project_id == project_id,
                ChannelGrantDBE.agent_id == agent_id,
                or_(
                    ChannelGrantDBE.space_id == space_id,
                    ChannelGrantDBE.kind == kind.value,
                ),
            )

            result = await session.execute(stmt)

            return [
                map_grant_dbe_to_dto(grant_dbe=dbe) for dbe in result.scalars().all()
            ]

    async def edit_grant(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        grant: ChannelGrantEdit,
    ) -> Optional[ChannelGrant]:
        async with self.engine.session() as session:
            stmt = select(ChannelGrantDBE).where(
                ChannelGrantDBE.project_id == project_id,
                ChannelGrantDBE.id == grant.id,
            )

            result = await session.execute(stmt)

            grant_dbe = result.scalar_one_or_none()

            if not grant_dbe:
                return None

            map_grant_dto_to_dbe_edit(
                grant_dbe=grant_dbe,
                #
                user_id=user_id,
                #
                grant=grant,
            )

            await session.commit()

            await session.refresh(grant_dbe)

            return map_grant_dbe_to_dto(grant_dbe=grant_dbe)

    async def delete_grant(
        self,
        *,
        project_id: UUID,
        #
        grant_id: UUID,
    ) -> bool:
        async with self.engine.session() as session:
            stmt = select(ChannelGrantDBE).where(
                ChannelGrantDBE.project_id == project_id,
                ChannelGrantDBE.id == grant_id,
            )

            result = await session.execute(stmt)

            grant_dbe = result.scalar_one_or_none()

            if not grant_dbe:
                return False

            await session.delete(grant_dbe)

            await session.commit()

            return True

    async def query_grants(
        self,
        *,
        project_id: UUID,
        #
        grant: Optional[ChannelGrantQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[ChannelGrant]:
        async with self.engine.session() as session:
            stmt = select(ChannelGrantDBE).filter(
                ChannelGrantDBE.project_id == project_id,
            )

            if grant:
                if grant.agent_id is not None:
                    stmt = stmt.filter(ChannelGrantDBE.agent_id == grant.agent_id)

                if grant.space_id is not None:
                    stmt = stmt.filter(ChannelGrantDBE.space_id == grant.space_id)

            if windowing:
                stmt = apply_windowing(
                    stmt=stmt,
                    DBE=ChannelGrantDBE,
                    attribute="id",
                    order="descending",
                    windowing=windowing,
                )

            result = await session.execute(stmt)

            return [
                map_grant_dbe_to_dto(grant_dbe=dbe) for dbe in result.scalars().all()
            ]

    async def count_grants(
        self,
        *,
        project_id: UUID,
        #
        agent_id: UUID,
    ) -> int:
        async with self.engine.session() as session:
            stmt = select(ChannelGrantDBE.id).where(
                ChannelGrantDBE.project_id == project_id,
                ChannelGrantDBE.agent_id == agent_id,
            )

            result = await session.execute(stmt)

            return len(result.scalars().all())

    # --- threads -------------------------------------------------------- #

    async def create_thread(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        #
        thread: ChannelThreadCreate,
    ) -> ChannelThread:
        thread_dbe = map_thread_dto_to_dbe_create(
            project_id=project_id,
            user_id=user_id,
            #
            thread=thread,
        )

        async with self.engine.session() as session:
            # Serialize first contact for one conversation across worker processes.
            # The latest inactive row remains history; only an active row is reused.
            # Include the null external key explicitly for platforms without threads.
            lock_key = f"channels-thread:{project_id}:{thread.space_id}:{thread.agent_id}:{thread.external_key}"
            await session.execute(
                text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
                {"key": lock_key},
            )
            current = (
                (
                    await session.execute(
                        select(ChannelThreadDBE)
                        .where(
                            ChannelThreadDBE.project_id == project_id,
                            ChannelThreadDBE.space_id == thread.space_id,
                            ChannelThreadDBE.agent_id == thread.agent_id,
                            ChannelThreadDBE.external_key == thread.external_key,
                        )
                        .order_by(ChannelThreadDBE.created_at.desc())
                        .limit(1)
                    )
                )
                .scalars()
                .first()
            )
            if current is not None and (current.flags or {}).get("is_active", True):
                return map_thread_dbe_to_dto(thread_dbe=current)

            # Timestamp creation after acquiring the lock, not transaction start.
            thread_dbe.created_at = func.clock_timestamp()
            session.add(thread_dbe)

            await session.commit()

            await session.refresh(thread_dbe)

        return map_thread_dbe_to_dto(thread_dbe=thread_dbe)

    async def fetch_current_thread(
        self,
        *,
        project_id: UUID,
        #
        space_id: UUID,
        external_key: Optional[UUID],
        agent_id: UUID,
    ) -> Optional[ChannelThread]:
        async with self.engine.session() as session:
            stmt = (
                select(ChannelThreadDBE)
                .where(
                    ChannelThreadDBE.project_id == project_id,
                    ChannelThreadDBE.space_id == space_id,
                    ChannelThreadDBE.external_key == external_key,
                    ChannelThreadDBE.agent_id == agent_id,
                )
                .order_by(ChannelThreadDBE.created_at.desc())
                .limit(1)
            )

            result = await session.execute(stmt)

            thread_dbe = result.scalars().first()

            if not thread_dbe:
                return None

            return map_thread_dbe_to_dto(thread_dbe=thread_dbe)

    async def fetch_active_thread(
        self,
        *,
        project_id: UUID,
        #
        space_id: UUID,
        external_key: Optional[UUID],
    ) -> Optional[ChannelThread]:
        async with self.engine.session() as session:
            stmt = (
                select(ChannelThreadDBE)
                .where(
                    ChannelThreadDBE.project_id == project_id,
                    ChannelThreadDBE.space_id == space_id,
                    ChannelThreadDBE.external_key == external_key,
                    ChannelThreadDBE.flags["is_active"].astext == "true",
                )
                .order_by(ChannelThreadDBE.created_at.desc())
                .limit(1)
            )
            result = await session.execute(stmt)
            thread_dbe = result.scalars().first()
            if not thread_dbe:
                return None
            return map_thread_dbe_to_dto(thread_dbe=thread_dbe)

    async def fetch_thread_awaiting_choice(
        self,
        *,
        project_id: UUID,
        #
        space_id: UUID,
        external_key: Optional[UUID],
    ) -> Optional[ChannelThread]:
        """The active thread under this key, whichever agent holds it, that has
        a pending choice. A typed answer carries no agent, so the agent that
        asked is found through the question it left open."""
        async with self.engine.session() as session:
            stmt = (
                select(ChannelThreadDBE)
                .where(
                    ChannelThreadDBE.project_id == project_id,
                    ChannelThreadDBE.space_id == space_id,
                    ChannelThreadDBE.external_key == external_key,
                    # JSON `null` passes a bare IS NOT NULL, and a cleared choice
                    # is written as JSON null; exclude it, and inactive rows,
                    # BEFORE the limit, or a newer cleared/closed row can hide an
                    # older thread that is genuinely still waiting.
                    # a cleared choice is stored as JSON null, which passes a
                    # bare IS NOT NULL; compare the text form, which `json`
                    # supports where `<>` on the json value itself does not.
                    ChannelThreadDBE.data["pending_choice"].astext.isnot(None),
                    ChannelThreadDBE.data["pending_choice"].astext != "null",
                    ChannelThreadDBE.flags["is_active"].astext == "true",
                )
                .order_by(ChannelThreadDBE.created_at.desc())
                .limit(1)
            )
            result = await session.execute(stmt)
            thread_dbe = result.scalars().first()
            if not thread_dbe:
                return None
            return map_thread_dbe_to_dto(thread_dbe=thread_dbe)

    async def query_threads(
        self,
        *,
        project_id: UUID,
        #
        thread: Optional[ChannelThreadQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[ChannelThread]:
        async with self.engine.session() as session:
            stmt = select(ChannelThreadDBE).filter(
                ChannelThreadDBE.project_id == project_id,
            )

            if thread:
                if thread.space_id is not None:
                    stmt = stmt.filter(ChannelThreadDBE.space_id == thread.space_id)

                if thread.agent_id is not None:
                    stmt = stmt.filter(ChannelThreadDBE.agent_id == thread.agent_id)

                if thread.external_key is not None:
                    stmt = stmt.filter(
                        ChannelThreadDBE.external_key == thread.external_key,
                    )

                if thread.session_id is not None:
                    stmt = stmt.filter(
                        ChannelThreadDBE.session_id == thread.session_id,
                    )

            if windowing:
                stmt = apply_windowing(
                    stmt=stmt,
                    DBE=ChannelThreadDBE,
                    attribute="id",
                    order="descending",
                    windowing=windowing,
                )

            result = await session.execute(stmt)

            return [
                map_thread_dbe_to_dto(thread_dbe=dbe) for dbe in result.scalars().all()
            ]

    async def close_thread(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        #
        thread_id: UUID,
    ) -> Optional[ChannelThread]:
        async with self.engine.session() as session:
            stmt = select(ChannelThreadDBE).where(
                ChannelThreadDBE.project_id == project_id,
                ChannelThreadDBE.id == thread_id,
            )

            result = await session.execute(stmt)
            thread_dbe = result.scalar_one_or_none()

            if not thread_dbe:
                return None

            flags = dict(thread_dbe.flags or {})
            flags["is_active"] = False
            thread_dbe.flags = flags
            thread_dbe.updated_at = datetime.now(timezone.utc)
            thread_dbe.updated_by_id = user_id

            await session.commit()

            await session.refresh(thread_dbe)

            return map_thread_dbe_to_dto(thread_dbe=thread_dbe)

    async def set_pending_choice(
        self,
        *,
        project_id: UUID,
        #
        thread_id: UUID,
        pending_choice: Optional[ChannelPendingChoice],
        expected_interaction_id: Optional[str] = None,
    ) -> Optional[ChannelThread]:
        async with self.engine.session() as session:
            stmt = (
                select(ChannelThreadDBE)
                .where(
                    ChannelThreadDBE.project_id == project_id,
                    ChannelThreadDBE.id == thread_id,
                )
                .with_for_update()
            )

            result = await session.execute(stmt)
            thread_dbe = result.scalar_one_or_none()

            if not thread_dbe:
                return None

            data = dict(thread_dbe.data or {})
            if expected_interaction_id is not None and (
                (data.get("pending_choice") or {}).get("interaction_id")
                != expected_interaction_id
            ):
                return map_thread_dbe_to_dto(thread_dbe=thread_dbe)

            data["pending_choice"] = (
                pending_choice.model_dump(mode="json") if pending_choice else None
            )
            thread_dbe.data = data
            thread_dbe.updated_at = datetime.now(timezone.utc)

            await session.commit()

            await session.refresh(thread_dbe)

            return map_thread_dbe_to_dto(thread_dbe=thread_dbe)

    # --- a space's messages, for the channel read tool ------------------- #

    async def query_space_inbox_messages(
        self,
        *,
        project_id: UUID,
        space_id: UUID,
        thread_ts: Optional[str] = None,
        before: Optional[Tuple[datetime, Optional[UUID]]] = None,
        limit: int,
    ) -> List[ChannelInboxEvent]:
        table = ChannelInboxEventDBE
        stmt = select(table).where(
            table.project_id == project_id,
            table.space_id == space_id,
            table.kind == ChannelEventKind.MESSAGE.value,
            _not_a_copy_of_a_bot_post(),
        )
        if thread_ts is not None:
            stmt = stmt.where(
                func.json_extract_path_text(table.data, "external_locator", "thread_ts")
                == thread_ts
            )
        if before is not None:
            stmt = stmt.where(_before(table.sent_at, table.id, before))
        stmt = stmt.order_by(table.sent_at.desc(), table.id.desc()).limit(limit)

        async with self.engine.session() as session:
            result = await session.execute(stmt)
            return [
                map_inbox_event_dbe_to_dto(event_dbe=dbe)
                for dbe in result.scalars().all()
            ]

    async def query_space_outbox_messages(
        self,
        *,
        project_id: UUID,
        space_id: UUID,
        thread_ts: Optional[str] = None,
        before: Optional[Tuple[datetime, Optional[UUID]]] = None,
        limit: int,
    ) -> List[Tuple[ChannelOutboxEvent, Optional[str]]]:
        """The bot's sent posts in a space, newest first, each with the thread
        it belongs to: a tool send records it, a turn reply takes its channel
        thread's, and a top-level post roots its own."""

        outbox = ChannelOutboxEventDBE
        thread = ChannelThreadDBE
        thread_of = func.coalesce(
            func.json_extract_path_text(outbox.data, "processed", "thread_ts"),
            func.json_extract_path_text(thread.data, "external_locator", "thread_ts"),
            func.json_extract_path_text(outbox.data, "external_locator", "ts"),
        )
        stmt = (
            select(outbox, thread_of)
            .outerjoin(
                thread,
                (thread.project_id == outbox.project_id)
                & (thread.id == outbox.thread_id),
            )
            .where(
                outbox.project_id == project_id,
                outbox.space_id == space_id,
                outbox.state == ChannelDeliveryState.SENT,
                # a final post only: a running turn's "Thinking..." indicator is
                # not something the bot said
                func.json_extract_path_text(outbox.data, "processed", "final")
                == "true",
            )
        )
        if thread_ts is not None:
            stmt = stmt.where(thread_of == thread_ts)
        if before is not None:
            stmt = stmt.where(_before(outbox.created_at, outbox.id, before))
        stmt = stmt.order_by(outbox.created_at.desc(), outbox.id.desc()).limit(limit)

        async with self.engine.session() as session:
            result = await session.execute(stmt)
            return [
                (map_outbox_event_dbe_to_dto(event_dbe=dbe), thread_ts_of)
                for dbe, thread_ts_of in result.all()
            ]

    async def search_space_inbox_messages(
        self,
        *,
        project_id: UUID,
        space_ids: List[UUID],
        query: str,
        after: Optional[datetime] = None,
        before: Optional[datetime] = None,
        limit: int,
        offset: int = 0,
    ) -> List[ChannelInboxEvent]:
        if not space_ids or not query.strip():
            return []
        stmt = search_inbox_statement(
            project_id=project_id,
            space_ids=space_ids,
            query=query,
            after=after,
            before=before,
            limit=limit,
            offset=offset,
        )
        async with self.engine.session() as session:
            result = await session.execute(stmt)
            return [
                map_inbox_event_dbe_to_dto(event_dbe=dbe)
                for dbe in result.scalars().all()
            ]

    # --- inbox: the log --------------------------------------------------- #

    async def record_inbox_event(
        self,
        *,
        project_id: UUID,
        #
        event: ChannelInboxEventCreate,
    ) -> Optional[ChannelInboxEvent]:
        event_dbe = map_inbox_event_dto_to_dbe_create(
            project_id=project_id,
            #
            event=event,
        )

        async with self.engine.session() as session:
            values = {
                c.name: getattr(event_dbe, c.name)
                for c in ChannelInboxEventDBE.__table__.columns
                if getattr(event_dbe, c.name) is not None
            }

            stmt = (
                insert(ChannelInboxEventDBE)
                .values(**values)
                .on_conflict_do_nothing(
                    index_elements=["project_id", "connection_id", "external_id"],
                )
                .returning(ChannelInboxEventDBE)
            )

            result = await session.execute(stmt)
            event_dbe = result.scalar_one_or_none()

            await session.commit()

            if event_dbe is None:
                return None

            return map_inbox_event_dbe_to_dto(event_dbe=event_dbe)

    async def record_inbox_events(
        self,
        *,
        project_id: UUID,
        #
        events: List[ChannelInboxEventCreate],
    ) -> List[ChannelInboxEvent]:
        if not events:
            return []

        dbes = [
            map_inbox_event_dto_to_dbe_create(project_id=project_id, event=event)
            for event in events
        ]

        async with self.engine.session() as session:
            values = [
                {
                    c.name: getattr(dbe, c.name)
                    for c in ChannelInboxEventDBE.__table__.columns
                    if getattr(dbe, c.name) is not None
                }
                for dbe in dbes
            ]

            stmt = (
                insert(ChannelInboxEventDBE)
                .values(values)
                .on_conflict_do_nothing(
                    index_elements=["project_id", "connection_id", "external_id"],
                )
                .returning(ChannelInboxEventDBE)
            )

            result = await session.execute(stmt)
            inserted = result.scalars().all()

            await session.commit()

            return [map_inbox_event_dbe_to_dto(event_dbe=dbe) for dbe in inserted]

    async def attach_space(
        self,
        *,
        project_id: UUID,
        #
        event_id: UUID,
        space_id: UUID,
    ) -> Optional[ChannelInboxEvent]:
        async with self.engine.session() as session:
            stmt = (
                update(ChannelInboxEventDBE)
                .where(
                    ChannelInboxEventDBE.project_id == project_id,
                    ChannelInboxEventDBE.id == event_id,
                )
                .values(space_id=space_id)
                .returning(ChannelInboxEventDBE)
            )

            result = await session.execute(stmt)
            event_dbe = result.scalar_one_or_none()

            await session.commit()

            if event_dbe is None:
                return None

            return map_inbox_event_dbe_to_dto(event_dbe=event_dbe)

    async def query_events_since(
        self,
        *,
        project_id: UUID,
        #
        space_id: UUID,
        after_event_id: Optional[UUID],
        through_event_id: Optional[UUID] = None,
        #
        limit: Optional[int] = None,
    ) -> List[ChannelInboxEvent]:
        async with self.engine.session() as session:
            stmt = select(ChannelInboxEventDBE).where(
                ChannelInboxEventDBE.project_id == project_id,
                ChannelInboxEventDBE.space_id == space_id,
            )

            if through_event_id is not None:
                # the addressing event is PUSHED; anything that arrived after
                # it belongs to the next turn
                stmt = stmt.where(
                    tuple_(
                        ChannelInboxEventDBE.origin,
                        ChannelInboxEventDBE.id,
                    )
                    <= ("pushed", through_event_id)
                )

            if after_event_id is not None:
                # PUSHED is the only origin an addressing offset can hold;
                # row-tuple comparison keeps PULLED sorted before PUSHED.
                stmt = stmt.where(
                    tuple_(
                        ChannelInboxEventDBE.origin,
                        ChannelInboxEventDBE.id,
                    )
                    > ("pushed", after_event_id)
                )

            stmt = stmt.order_by(
                ChannelInboxEventDBE.origin.asc(),
                ChannelInboxEventDBE.id.asc(),
            )

            if limit is not None:
                stmt = stmt.limit(limit)

            result = await session.execute(stmt)

            return [
                map_inbox_event_dbe_to_dto(event_dbe=dbe)
                for dbe in result.scalars().all()
            ]

    async def query_inbox_events(
        self,
        *,
        project_id: UUID,
        #
        event: Optional[ChannelInboxEventQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[ChannelInboxEvent]:
        async with self.engine.session() as session:
            stmt = select(ChannelInboxEventDBE).filter(
                ChannelInboxEventDBE.project_id == project_id,
            )

            if event:
                if event.connection_id is not None:
                    stmt = stmt.filter(
                        ChannelInboxEventDBE.connection_id == event.connection_id,
                    )

                if event.space_id is not None:
                    stmt = stmt.filter(
                        ChannelInboxEventDBE.space_id == event.space_id,
                    )

                if event.kind is not None:
                    stmt = stmt.filter(ChannelInboxEventDBE.kind == event.kind)

                if event.origin is not None:
                    stmt = stmt.filter(ChannelInboxEventDBE.origin == event.origin)

                if event.external_id is not None:
                    stmt = stmt.filter(
                        ChannelInboxEventDBE.external_id == event.external_id,
                    )

            if windowing:
                stmt = apply_windowing(
                    stmt=stmt,
                    DBE=ChannelInboxEventDBE,
                    attribute="id",
                    order="descending",
                    windowing=windowing,
                )

            result = await session.execute(stmt)

            return [
                map_inbox_event_dbe_to_dto(event_dbe=dbe)
                for dbe in result.scalars().all()
            ]

    # --- inbox: the offsets ------------------------------------------------ #

    async def fetch_latest_trigger(
        self,
        *,
        project_id: UUID,
        #
        thread_id: UUID,
        before_event_id: Optional[UUID] = None,
    ) -> Optional[ChannelInboxTrigger]:
        """The offset a turn reads from. Only a turn that provably never
        reached the agent leaves it in place: REFUSED (the runner turned the
        start away), or FAILED with `CHANNEL_TRIGGER_NEVER_SENT` (the start
        never reached the workflow service). Any other FAILED turn may have
        run, so it moves the offset like a settled one. Ordered by event, not
        by trigger id: two turns can record their triggers out of order."""
        never_admitted = or_(
            ChannelInboxTriggerDBE.state == ChannelTriggerState.REFUSED,
            and_(
                ChannelInboxTriggerDBE.state == ChannelTriggerState.FAILED,
                func.coalesce(ChannelInboxTriggerDBE.status["code"].astext, "")
                == CHANNEL_TRIGGER_NEVER_SENT,
            ),
        )
        async with self.engine.session() as session:
            stmt = select(ChannelInboxTriggerDBE).where(
                ChannelInboxTriggerDBE.project_id == project_id,
                ChannelInboxTriggerDBE.thread_id == thread_id,
                not_(never_admitted),
            )
            if before_event_id is not None:
                stmt = stmt.where(ChannelInboxTriggerDBE.event_id < before_event_id)
            stmt = stmt.order_by(ChannelInboxTriggerDBE.event_id.desc()).limit(1)

            result = await session.execute(stmt)

            trigger_dbe = result.scalars().first()

            if not trigger_dbe:
                return None

            return map_inbox_trigger_dbe_to_dto(trigger_dbe=trigger_dbe)

    async def record_inbox_trigger(
        self,
        *,
        project_id: UUID,
        #
        trigger: ChannelInboxTriggerCreate,
    ) -> Optional[ChannelInboxTrigger]:
        trigger_dbe = map_inbox_trigger_dto_to_dbe_create(
            project_id=project_id,
            #
            trigger=trigger,
        )

        async with self.engine.session() as session:
            values = {
                c.name: getattr(trigger_dbe, c.name)
                for c in ChannelInboxTriggerDBE.__table__.columns
                if getattr(trigger_dbe, c.name) is not None
            }

            stmt = (
                insert(ChannelInboxTriggerDBE)
                .values(**values)
                .on_conflict_do_nothing(
                    index_elements=["project_id", "thread_id", "event_id"],
                )
                .returning(ChannelInboxTriggerDBE)
            )

            result = await session.execute(stmt)
            trigger_dbe = result.scalar_one_or_none()

            await session.commit()

            if trigger_dbe is None:
                return None

            return map_inbox_trigger_dbe_to_dto(trigger_dbe=trigger_dbe)

    async def transition_inbox_trigger(
        self,
        *,
        project_id: UUID,
        #
        trigger_id: UUID,
        state: ChannelTriggerState,
        status: Optional[Status] = None,
    ) -> Optional[ChannelInboxTrigger]:
        async with self.engine.session() as session:
            values = {
                "state": state,
                "updated_at": datetime.now(timezone.utc),
            }
            if status is not None:
                values["status"] = status.model_dump(mode="json", exclude_none=True)

            stmt = (
                update(ChannelInboxTriggerDBE)
                .where(
                    ChannelInboxTriggerDBE.project_id == project_id,
                    ChannelInboxTriggerDBE.id == trigger_id,
                )
                .values(**values)
                .returning(ChannelInboxTriggerDBE)
            )

            result = await session.execute(stmt)
            trigger_dbe = result.scalar_one_or_none()

            await session.commit()

            if trigger_dbe is None:
                return None

            return map_inbox_trigger_dbe_to_dto(trigger_dbe=trigger_dbe)

    async def query_inbox_triggers(
        self,
        *,
        project_id: UUID,
        #
        trigger: Optional[ChannelInboxTriggerQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[ChannelInboxTrigger]:
        async with self.engine.session() as session:
            stmt = select(ChannelInboxTriggerDBE).filter(
                ChannelInboxTriggerDBE.project_id == project_id,
            )

            if trigger:
                if trigger.thread_id is not None:
                    stmt = stmt.filter(
                        ChannelInboxTriggerDBE.thread_id == trigger.thread_id,
                    )

                if trigger.event_id is not None:
                    stmt = stmt.filter(
                        ChannelInboxTriggerDBE.event_id == trigger.event_id,
                    )

                if trigger.turn_id is not None:
                    stmt = stmt.filter(
                        ChannelInboxTriggerDBE.turn_id == trigger.turn_id,
                    )

                if trigger.state is not None:
                    stmt = stmt.filter(ChannelInboxTriggerDBE.state == trigger.state)

            if windowing:
                stmt = apply_windowing(
                    stmt=stmt,
                    DBE=ChannelInboxTriggerDBE,
                    attribute="id",
                    order="descending",
                    windowing=windowing,
                )

            result = await session.execute(stmt)

            return [
                map_inbox_trigger_dbe_to_dto(trigger_dbe=dbe)
                for dbe in result.scalars().all()
            ]

    # --- outbox --------------------------------------------------------- #

    async def record_outbox_event(
        self,
        *,
        project_id: UUID,
        #
        event: ChannelOutboxEventCreate,
    ) -> ChannelOutboxEvent:
        event_dbe = map_outbox_event_dto_to_dbe_create(
            project_id=project_id,
            #
            event=event,
        )

        async with self.engine.session() as session:
            values = {
                c.name: getattr(event_dbe, c.name)
                for c in ChannelOutboxEventDBE.__table__.columns
                if getattr(event_dbe, c.name) is not None
            }

            stmt = (
                insert(ChannelOutboxEventDBE)
                .values(**values)
                .on_conflict_do_nothing(
                    index_elements=["project_id", "key"],
                )
                .returning(ChannelOutboxEventDBE)
            )

            result = await session.execute(stmt)
            event_dbe = result.scalar_one_or_none()

            await session.commit()

            if event_dbe is not None:
                return map_outbox_event_dbe_to_dto(event_dbe=event_dbe)

            # Lost the race (or a retried call): unlike the inbox, the caller still
            # has to post/find the row, so fetch the existing one rather than None.
            fetch_stmt = select(ChannelOutboxEventDBE).where(
                ChannelOutboxEventDBE.project_id == project_id,
                ChannelOutboxEventDBE.key == event.key,
            )
            fetched = await session.execute(fetch_stmt)
            event_dbe = fetched.scalar_one()

            return map_outbox_event_dbe_to_dto(event_dbe=event_dbe)

    async def fetch_outbox_event(
        self,
        *,
        project_id: UUID,
        #
        event_id: UUID,
    ) -> Optional[ChannelOutboxEvent]:
        async with self.engine.session() as session:
            stmt = select(ChannelOutboxEventDBE).where(
                ChannelOutboxEventDBE.project_id == project_id,
                ChannelOutboxEventDBE.id == event_id,
            )

            result = await session.execute(stmt)

            event_dbe = result.scalar_one_or_none()

            if not event_dbe:
                return None

            return map_outbox_event_dbe_to_dto(event_dbe=event_dbe)

    async def fetch_outbox_event_by_key(
        self,
        *,
        project_id: UUID,
        #
        key: UUID,
    ) -> Optional[ChannelOutboxEvent]:
        async with self.engine.session() as session:
            stmt = select(ChannelOutboxEventDBE).where(
                ChannelOutboxEventDBE.project_id == project_id,
                ChannelOutboxEventDBE.key == key,
            )

            result = await session.execute(stmt)

            event_dbe = result.scalar_one_or_none()

            if not event_dbe:
                return None

            return map_outbox_event_dbe_to_dto(event_dbe=event_dbe)

    async def claim_outbox_events(
        self,
        *,
        project_id: Optional[UUID] = None,
        #
        limit: int = 100,
    ) -> List[ChannelOutboxEvent]:
        async with self.engine.session() as session:
            stmt = (
                select(ChannelOutboxEventDBE)
                .where(ChannelOutboxEventDBE.state == ChannelDeliveryState.CREATED)
                .order_by(ChannelOutboxEventDBE.created_at.asc())
                .limit(limit)
            )

            if project_id is not None:
                stmt = stmt.where(ChannelOutboxEventDBE.project_id == project_id)

            result = await session.execute(stmt)

            return [
                map_outbox_event_dbe_to_dto(event_dbe=dbe)
                for dbe in result.scalars().all()
            ]

    async def claim_outbox_delivery(
        self,
        *,
        project_id: UUID,
        #
        event_id: UUID,
        content: List[Dict[str, Any]],
        claim_ttl_seconds: float,
        overwrite_final: bool = True,
        delivery_key: Optional[str] = None,
    ) -> Optional[ChannelOutboxEvent]:
        table = ChannelOutboxEventDBE
        # `data` is JSON, not JSONB: cast it so the comparison is by value,
        # independent of key order and whitespace.
        processed = cast(table.data, JSONB)["processed"]
        sent_content = processed["content"]
        claim_code = table.status["code"].astext

        already_sent = (table.state == ChannelDeliveryState.SENT) & func.coalesce(
            sent_content == literal(content, type_=JSONB), false()
        )
        claim_live = func.coalesce(
            (claim_code == "sending")
            & (table.updated_at > func.now() - timedelta(seconds=claim_ttl_seconds)),
            false(),
        )

        conditions = [
            table.project_id == project_id,
            table.id == event_id,
            ~already_sent,
            ~claim_live,
        ]
        if delivery_key is not None:
            conditions.append(
                ~func.coalesce(
                    (claim_code == "delivery_uncertain")
                    & (table.status["type"].astext == delivery_key),
                    false(),
                )
            )
        if not overwrite_final:
            conditions.append(
                ~func.coalesce(processed["final"].astext == "true", false())
            )

        # The token names this claim, so the writes that release it can be
        # fenced to the worker that still holds it.
        claim_status = Status(code="sending", message=str(uuid4())).model_dump(
            mode="json", exclude_none=True
        )

        async with self.engine.session() as session:
            stmt = (
                update(table)
                .where(*conditions)
                .values(status=claim_status, updated_at=func.now())
                .returning(table)
            )

            result = await session.execute(stmt)
            event_dbe = result.scalar_one_or_none()

            await session.commit()

            if event_dbe is None:
                return None

            return map_outbox_event_dbe_to_dto(event_dbe=event_dbe)

    async def transition_outbox_event(
        self,
        *,
        project_id: UUID,
        #
        event_id: UUID,
        state: ChannelDeliveryState,
        status: Optional[Status] = None,
        data: Optional[ChannelOutboxEventData] = None,
        claim_token: Optional[str] = None,
    ) -> Optional[ChannelOutboxEvent]:
        async with self.engine.session() as session:
            values = {
                "state": state,
                "updated_at": datetime.now(timezone.utc),
            }
            if status is not None:
                values["status"] = status.model_dump(mode="json", exclude_none=True)
            if data is not None:
                values["data"] = data.model_dump(mode="json", exclude_none=True)

            stmt = (
                update(ChannelOutboxEventDBE)
                .where(
                    ChannelOutboxEventDBE.project_id == project_id,
                    ChannelOutboxEventDBE.id == event_id,
                )
                .values(**values)
                .returning(ChannelOutboxEventDBE)
            )
            if claim_token is not None:
                stmt = stmt.where(
                    ChannelOutboxEventDBE.status["code"].astext == "sending",
                    ChannelOutboxEventDBE.status["message"].astext == claim_token,
                )

            result = await session.execute(stmt)
            event_dbe = result.scalar_one_or_none()

            await session.commit()

            if event_dbe is None:
                return None

            return map_outbox_event_dbe_to_dto(event_dbe=event_dbe)

    async def query_outbox_events(
        self,
        *,
        project_id: UUID,
        #
        event: Optional[ChannelOutboxEventQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[ChannelOutboxEvent]:
        async with self.engine.session() as session:
            stmt = select(ChannelOutboxEventDBE).filter(
                ChannelOutboxEventDBE.project_id == project_id,
            )

            if event:
                if event.thread_id is not None:
                    stmt = stmt.filter(
                        ChannelOutboxEventDBE.thread_id == event.thread_id,
                    )

                if event.turn_id is not None:
                    stmt = stmt.filter(ChannelOutboxEventDBE.turn_id == event.turn_id)

                if event.key is not None:
                    stmt = stmt.filter(ChannelOutboxEventDBE.key == event.key)

                if event.state is not None:
                    stmt = stmt.filter(ChannelOutboxEventDBE.state == event.state)

            if windowing:
                stmt = apply_windowing(
                    stmt=stmt,
                    DBE=ChannelOutboxEventDBE,
                    attribute="id",
                    order="descending",
                    windowing=windowing,
                )

            result = await session.execute(stmt)

            return [
                map_outbox_event_dbe_to_dto(event_dbe=dbe)
                for dbe in result.scalars().all()
            ]

    # --- ingress: the one unscoped read ------------------------------------ #

    async def get_project_and_connection_by_external_key(
        self,
        *,
        channel: str,
        external_key: UUID,
        include_archived: bool = False,
    ) -> Optional[Tuple[UUID, UUID]]:
        # Deliberately unscoped: an inbound platform event carries no tenant,
        # so this recovers (project_id, connection_id) before anything else
        # can be scoped — mirrors get_project_and_subscription_by_trigger_id
        # in triggers. No LIMIT 1: uq_channel_connections_external_key makes a
        # second match impossible, and a LIMIT here would hide the violation
        # instead of raising it.
        async with self.engine.session() as session:
            stmt = select(
                ChannelConnectionDBE.project_id, ChannelConnectionDBE.id
            ).where(
                ChannelConnectionDBE.channel == channel,
                ChannelConnectionDBE.external_key == external_key,
            )
            # The unique key spans archived rows too, so a write path that
            # must not collide with it has to see them; ingress must not.
            if not include_archived:
                stmt = stmt.where(ChannelConnectionDBE.deleted_at.is_(None))

            row = (await session.execute(stmt)).one_or_none()

            if row is None:
                return None

            return (row[0], row[1])


def _not_a_copy_of_a_bot_post():
    """Rows that are a person's message in the conversation. A fetched history
    page can hold a copy of the bot's own post, which
    the outbox already serves. Read and search leave it out in the query, not
    after paging, so a dropped copy never moves a page boundary. Pushed rows
    never hold the bot's posts: ingress drops bot-authored events."""

    table = ChannelInboxEventDBE
    outbox = ChannelOutboxEventDBE
    posted_by_bot = (
        select(outbox.id)
        .where(
            outbox.project_id == table.project_id,
            outbox.space_id == table.space_id,
            outbox.state == ChannelDeliveryState.SENT,
            func.json_extract_path_text(outbox.data, "external_locator", "ts")
            == func.json_extract_path_text(table.data, "processed", "message_ref"),
        )
        .exists()
    )
    consumed = func.coalesce(table.flags["is_consumed"].as_boolean(), false())
    # an answer an approval consumed went to the parked interaction, not to
    # the conversation
    return ((table.origin == ChannelEventOrigin.PUSHED) | ~posted_by_bot) & ~consumed


def _before(time_column, id_column, before: Tuple[datetime, Optional[UUID]]):
    """Strictly older than a read cursor, in the same (time, id) order the
    query sorts by, so a page boundary never repeats or skips a row that
    shares its time. A cursor with no id bounds by time alone."""

    at, row_id = before
    if row_id is None:
        return time_column < at
    return tuple_(time_column, id_column) < tuple_(at, row_id)


# The indexed expression of `ix_channel_inbox_events_search`
# (oss000000038). A query must repeat it exactly for Postgres to use the
# index, so this is its only spelling.
_SEARCH_VECTOR = literal_column(
    "to_tsvector('simple', "
    "coalesce(channel_inbox_events.data #>> '{processed,content,0,text}', ''))"
)


def search_inbox_statement(
    *,
    project_id: UUID,
    space_ids: List[UUID],
    query: str,
    after: Optional[datetime] = None,
    before: Optional[datetime] = None,
    limit: int,
    offset: int = 0,
):
    """Stored messages of these spaces matching `query` (web-search syntax),
    by relevance, then provider time, then id: a total order, so an offset
    page neither skips nor repeats a row while the set is unchanged."""

    table = ChannelInboxEventDBE
    tsquery = func.websearch_to_tsquery(literal_column("'simple'"), query)
    stmt = (
        select(table)
        .where(
            table.project_id == project_id,
            table.space_id.in_(space_ids),
            table.kind == ChannelEventKind.MESSAGE.value,
            _not_a_copy_of_a_bot_post(),
            _SEARCH_VECTOR.op("@@")(tsquery),
        )
        .order_by(
            func.ts_rank(_SEARCH_VECTOR, tsquery).desc(),
            table.sent_at.desc(),
            table.id.desc(),
        )
        .limit(limit)
        .offset(offset)
    )
    if after is not None:
        stmt = stmt.where(table.sent_at >= after)
    if before is not None:
        stmt = stmt.where(table.sent_at <= before)
    return stmt
