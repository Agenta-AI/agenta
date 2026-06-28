from abc import ABC, abstractmethod
from typing import Optional
from uuid import UUID

from oss.src.core.sessions.dtos import SessionState, SessionStateUpsert


class SessionStatesDAOInterface(ABC):
    @abstractmethod
    async def get_session_state(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> Optional[SessionState]: ...

    @abstractmethod
    async def set_session_state(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        session_id: str,
        upsert: SessionStateUpsert,
    ) -> Optional[SessionState]: ...

    @abstractmethod
    async def set_sandbox_id(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        session_id: str,
        sandbox_id: Optional[str],
    ) -> Optional[SessionState]: ...
