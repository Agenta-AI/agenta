from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

import uuid_utils.compat as uuid_utils

from sqlalchemy import Integer, case, cast, func, select
from sqlalchemy.dialects.postgresql import insert

from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import suppress_exceptions

from oss.src.core.sessions.states.interfaces import SessionStatesDAOInterface
from oss.src.core.sessions.states.dtos import (
    SessionState,
    SessionStateFlags,
    SessionStateUpsert,
)

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

        data_json = (
            upsert.data.model_dump(
                mode="json",
            )
            if upsert.data is not None
            else None
        )

        values = {
            "id": uuid_utils.uuid7(),
            "project_id": project_id,
            "session_id": session_id,
            "data": data_json,
            "sandbox_id": upsert.sandbox_id,
            "flags": SessionStateFlags().model_dump(mode="json"),
            "created_at": now,
            "updated_at": None,
            "created_by_id": user_id,
            "updated_by_id": None,
            "deleted_at": None,
            "deleted_by_id": None,
        }

        stmt = insert(SessionStateDBE).values(**values)
        update_values = {
            "updated_at": now,
            "updated_by_id": user_id,
        }
        if "data" in upsert.model_fields_set:
            update_values["data"] = stmt.excluded.data
        guarded_pointer_write = (
            "sandbox_id" in upsert.model_fields_set
            and upsert.sandbox_turn_index is not None
        )
        if guarded_pointer_write:
            pointer_write_allowed = (
                func.coalesce(
                    cast(SessionStateDBE.data["latest_turn_index"].astext, Integer),
                    -1,
                )
                <= upsert.sandbox_turn_index
            )
            update_values["sandbox_id"] = case(
                (pointer_write_allowed, stmt.excluded.sandbox_id),
                else_=SessionStateDBE.sandbox_id,
            )
        elif "sandbox_id" in upsert.model_fields_set:
            update_values["sandbox_id"] = stmt.excluded.sandbox_id

        stmt = stmt.on_conflict_do_update(
            constraint="uq_session_states_project_session_id",
            set_=update_values,
        )
        stmt = stmt.returning(SessionStateDBE)

        async with self.engine.session() as db_session:
            result = await db_session.execute(stmt)
            await db_session.commit()
            dbe = result.scalars().first()
            if dbe is None:
                return None
            return dbe_to_dto(dbe)
