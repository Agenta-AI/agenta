from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

import uuid_utils.compat as uuid_utils

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import suppress_exceptions

from oss.src.core.sessions.states.interfaces import SessionStatesDAOInterface
from oss.src.core.sessions.states.dtos import SessionState, SessionStateUpsert

from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    get_transactions_engine,
)
from oss.src.dbs.postgres.sessions.states.dbes import SessionStateDBE
from oss.src.dbs.postgres.sessions.states.mappings import dbe_to_dto

log = get_module_logger(__name__)


class SessionStatesDAO(SessionStatesDAOInterface):
    def __init__(self, engine: TransactionsEngine = None):
        if engine is None:
            engine = get_transactions_engine()
        self.engine = engine

    @suppress_exceptions()
    async def get_session_state(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> Optional[SessionState]:
        async with self.engine.session() as session:
            stmt = (
                select(SessionStateDBE)
                .filter(SessionStateDBE.project_id == project_id)
                .filter(SessionStateDBE.session_id == session_id)
                .limit(1)
            )
            result = await session.execute(stmt)
            dbe = result.scalars().first()
            if dbe is None:
                return None
            return dbe_to_dto(dbe)

    @suppress_exceptions()
    async def set_session_state(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        session_id: str,
        upsert: SessionStateUpsert,
    ) -> Optional[SessionState]:
        now = datetime.now(timezone.utc)

        values = {
            "id": uuid_utils.uuid7(),
            "project_id": project_id,
            "session_id": session_id,
            "data": upsert.data,
            "sandbox_id": upsert.sandbox_id,
            "created_at": now,
            "updated_at": None,
            "created_by_id": user_id,
            "updated_by_id": None,
            "deleted_at": None,
            "deleted_by_id": None,
        }

        stmt = insert(SessionStateDBE).values(**values)
        stmt = stmt.on_conflict_do_update(
            index_elements=["project_id", "session_id"],
            set_={
                "data": stmt.excluded.data,
                "sandbox_id": stmt.excluded.sandbox_id,
                "updated_at": now,
                "updated_by_id": user_id,
            },
        )
        stmt = stmt.returning(SessionStateDBE)

        async with self.engine.session() as db_session:
            result = await db_session.execute(stmt)
            await db_session.commit()
            dbe = result.scalars().first()
            if dbe is None:
                return None
            return dbe_to_dto(dbe)

    @suppress_exceptions()
    async def set_sandbox_id(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        session_id: str,
        sandbox_id: Optional[str],
    ) -> Optional[SessionState]:
        now = datetime.now(timezone.utc)

        async with self.engine.session() as db_session:
            stmt = (
                select(SessionStateDBE)
                .filter(SessionStateDBE.project_id == project_id)
                .filter(SessionStateDBE.session_id == session_id)
                .limit(1)
            )
            result = await db_session.execute(stmt)
            dbe = result.scalars().first()
            if dbe is None:
                return None

            dbe.sandbox_id = sandbox_id
            dbe.updated_at = now
            dbe.updated_by_id = user_id

            await db_session.commit()
            await db_session.refresh(dbe)
            return dbe_to_dto(dbe)
