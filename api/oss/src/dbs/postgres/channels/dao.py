from datetime import datetime, timezone
from typing import List, Optional, Tuple
from uuid import UUID

from sqlalchemy import or_, select, tuple_, update
from sqlalchemy.dialects.postgresql import insert

from oss.src.core.channels.dtos import (
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

            connection_dbe.deleted_at = None
            connection_dbe.deleted_by_id = None
            connection_dbe.updated_by_id = user_id

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
        #
        limit: Optional[int] = None,
    ) -> List[ChannelInboxEvent]:
        async with self.engine.session() as session:
            stmt = select(ChannelInboxEventDBE).where(
                ChannelInboxEventDBE.project_id == project_id,
                ChannelInboxEventDBE.space_id == space_id,
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
    ) -> Optional[ChannelInboxTrigger]:
        async with self.engine.session() as session:
            stmt = (
                select(ChannelInboxTriggerDBE)
                .where(
                    ChannelInboxTriggerDBE.project_id == project_id,
                    ChannelInboxTriggerDBE.thread_id == thread_id,
                )
                .order_by(ChannelInboxTriggerDBE.id.desc())
                .limit(1)
            )

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

    async def transition_outbox_event(
        self,
        *,
        project_id: UUID,
        #
        event_id: UUID,
        state: ChannelDeliveryState,
        status: Optional[Status] = None,
        data: Optional[ChannelOutboxEventData] = None,
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
                ChannelConnectionDBE.deleted_at.is_(None),
            )

            row = (await session.execute(stmt)).one_or_none()

            if row is None:
                return None

            return (row[0], row[1])
