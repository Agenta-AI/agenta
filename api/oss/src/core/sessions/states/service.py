from typing import Optional
from uuid import UUID

from oss.src.core.sessions.states.dtos import SessionState, SessionStateUpsert
from oss.src.core.sessions.states.interfaces import SessionStatesDAOInterface


class SessionStatesService:
    def __init__(self, *, session_states_dao: SessionStatesDAOInterface):
        self.session_states_dao = session_states_dao

    async def get_session_state(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> Optional[SessionState]:
        return await self.session_states_dao.get_session_state(
            project_id=project_id,
            session_id=session_id,
        )

    async def set_session_state(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        session_id: str,
        upsert: SessionStateUpsert,
    ) -> Optional[SessionState]:
        return await self.session_states_dao.set_session_state(
            project_id=project_id,
            user_id=user_id,
            session_id=session_id,
            upsert=upsert,
        )
