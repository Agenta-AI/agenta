from typing import Optional
from uuid import UUID

from oss.src.utils.logging import get_module_logger

from oss.src.core.sessions.interface import SessionStatesDAOInterface
from oss.src.core.sessions.dtos import SessionState, SessionStateUpsert

log = get_module_logger(__name__)


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

    async def set_sandbox_id(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        session_id: str,
        sandbox_id: Optional[str],
    ) -> Optional[SessionState]:
        return await self.session_states_dao.set_sandbox_id(
            project_id=project_id,
            user_id=user_id,
            session_id=session_id,
            sandbox_id=sandbox_id,
        )
