from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import select, update

from oss.src.core.channels.identity import (
    ChannelIdentityDAOInterface,
    ChannelIdentityLink,
    ChannelIdentityLinkCreate,
)
from oss.src.dbs.postgres.channels.identity_dbes import ChannelIdentityLinkDBE
from oss.src.dbs.postgres.channels.identity_mappings import (
    map_identity_link_dbe_to_dto,
    map_identity_link_dto_to_dbe_create,
)
from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    get_transactions_engine,
)


class ChannelIdentityDAO(ChannelIdentityDAOInterface):
    def __init__(self, engine: TransactionsEngine = None):
        if engine is None:
            engine = get_transactions_engine()
        self.engine = engine

    async def create_link(
        self,
        *,
        project_id: UUID,
        #
        link: ChannelIdentityLinkCreate,
    ) -> ChannelIdentityLink:
        link_dbe = map_identity_link_dto_to_dbe_create(
            project_id=project_id,
            #
            link=link,
        )

        async with self.engine.session() as session:
            session.add(link_dbe)

            await session.commit()

            await session.refresh(link_dbe)

        return map_identity_link_dbe_to_dto(link_dbe=link_dbe)

    async def fetch_link(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
        #
        external_user_key: str,
    ) -> Optional[ChannelIdentityLink]:
        async with self.engine.session() as session:
            stmt = select(ChannelIdentityLinkDBE).where(
                ChannelIdentityLinkDBE.project_id == project_id,
                ChannelIdentityLinkDBE.connection_id == connection_id,
                ChannelIdentityLinkDBE.external_user_key == external_user_key,
            )

            result = await session.execute(stmt)

            link_dbe = result.scalar_one_or_none()

            if not link_dbe:
                return None

            return map_identity_link_dbe_to_dto(link_dbe=link_dbe)

    async def rebind_link(
        self,
        *,
        project_id: UUID,
        connection_id: UUID,
        old_external_user_key: str,
        new_external_user_key: str,
    ) -> Optional[ChannelIdentityLink]:
        async with self.engine.session() as session:
            # updates the existing row in place — user_id and id are untouched,
            # so attribution history does not fork (WP7 spec).
            stmt = (
                update(ChannelIdentityLinkDBE)
                .where(
                    ChannelIdentityLinkDBE.project_id == project_id,
                    ChannelIdentityLinkDBE.connection_id == connection_id,
                    ChannelIdentityLinkDBE.external_user_key == old_external_user_key,
                )
                .values(
                    external_user_key=new_external_user_key,
                    updated_at=datetime.now(timezone.utc),
                )
                .returning(ChannelIdentityLinkDBE)
            )

            result = await session.execute(stmt)
            link_dbe = result.scalar_one_or_none()

            await session.commit()

            if link_dbe is None:
                return None

            return map_identity_link_dbe_to_dto(link_dbe=link_dbe)
