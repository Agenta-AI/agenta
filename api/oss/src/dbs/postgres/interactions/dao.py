from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID

from sqlalchemy import select, update as sa_update

from oss.src.core.interactions.dtos import (
    Interaction,
    InteractionCreate,
    InteractionQuery,
    InteractionTransition,
)
from oss.src.core.interactions.interfaces import InteractionsDAOInterface
from oss.src.core.shared.dtos import Windowing
from oss.src.dbs.postgres.interactions.dbes import InteractionDBE
from oss.src.dbs.postgres.interactions.mappings import (
    map_interaction_dbe_to_dto,
    map_interaction_dto_to_dbe_create,
)
from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    get_transactions_engine,
)
from oss.src.dbs.postgres.shared.utils import apply_windowing


PENDING_INTERACTION_TTL = "7 days"


class InteractionsDAO(InteractionsDAOInterface):
    def __init__(self, engine: TransactionsEngine = None):
        if engine is None:
            engine = get_transactions_engine()
        self.engine = engine

    async def create_interaction(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        #
        interaction: InteractionCreate,
    ) -> Interaction:
        dbe = map_interaction_dto_to_dbe_create(
            project_id=project_id,
            user_id=user_id,
            interaction=interaction,
        )

        async with self.engine.session() as session:
            session.add(dbe)
            await session.commit()
            await session.refresh(dbe)

        return map_interaction_dbe_to_dto(dbe)

    async def fetch_interaction(
        self,
        *,
        project_id: UUID,
        #
        interaction_id: UUID,
    ) -> Optional[Interaction]:
        async with self.engine.session() as session:
            stmt = select(InteractionDBE).where(
                InteractionDBE.project_id == project_id,
                InteractionDBE.id == interaction_id,
            )
            result = await session.execute(stmt)
            dbe = result.scalar_one_or_none()
            if dbe is None:
                return None
            return map_interaction_dbe_to_dto(dbe)

    async def transition_interaction(
        self,
        *,
        transition: InteractionTransition,
    ) -> Optional[Interaction]:
        async with self.engine.session() as session:
            stmt = (
                sa_update(InteractionDBE)
                .where(
                    InteractionDBE.project_id == transition.project_id,
                    InteractionDBE.session_id == transition.session_id,
                    InteractionDBE.token == transition.token,
                    InteractionDBE.status["code"].astext == "pending",
                )
                .values(
                    status={"code": transition.status.value},
                    updated_at=datetime.now(timezone.utc),
                )
                .returning(InteractionDBE)
            )
            result = await session.execute(stmt)
            dbe = result.scalar_one_or_none()
            await session.commit()
            if dbe is None:
                return None
            return map_interaction_dbe_to_dto(dbe)

    async def query_interactions(
        self,
        *,
        project_id: UUID,
        #
        query: Optional[InteractionQuery] = None,
        windowing: Optional[Windowing] = None,
    ) -> List[Interaction]:
        async with self.engine.session() as session:
            stmt = select(InteractionDBE).where(
                InteractionDBE.project_id == project_id,
            )

            if query:
                if query.session_id is not None:
                    stmt = stmt.where(
                        InteractionDBE.session_id == query.session_id,
                    )
                if query.run_id is not None:
                    stmt = stmt.where(
                        InteractionDBE.run_id == query.run_id,
                    )
                if query.kind is not None:
                    stmt = stmt.where(
                        InteractionDBE.kind == query.kind.value,
                    )
                if query.status is not None:
                    stmt = stmt.where(
                        InteractionDBE.status["code"].astext == query.status.value,
                    )
                if query.actionable_only:
                    from sqlalchemy import text  # noqa: PLC0415

                    stmt = stmt.where(
                        text(
                            f"created_at > NOW() - INTERVAL '{PENDING_INTERACTION_TTL}'"
                        ),
                    )

            if windowing:
                stmt = apply_windowing(
                    stmt=stmt,
                    DBE=InteractionDBE,
                    attribute="id",
                    order="descending",
                    windowing=windowing,
                )

            result = await session.execute(stmt)
            return [map_interaction_dbe_to_dto(dbe) for dbe in result.scalars().all()]
