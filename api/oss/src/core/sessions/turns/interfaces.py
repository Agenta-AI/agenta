from abc import ABC, abstractmethod
from typing import List, Optional
from uuid import UUID

from oss.src.core.shared.dtos import Windowing
from oss.src.core.sessions.turns.dtos import (
    HarnessKind,
    SessionTurn,
    SessionTurnCreate,
    SessionTurnQuery,
)


class SessionTurnsDAOInterface(ABC):
    @abstractmethod
    async def append(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        #
        turn: SessionTurnCreate,
    ) -> SessionTurn: ...

    @abstractmethod
    async def fetch_turn(
        self,
        *,
        project_id: UUID,
        #
        turn_id: UUID,
    ) -> Optional[SessionTurn]: ...

    @abstractmethod
    async def query_turns(
        self,
        *,
        project_id: UUID,
        #
        query: Optional[SessionTurnQuery] = None,
        windowing: Optional[Windowing] = None,
    ) -> List[SessionTurn]: ...

    @abstractmethod
    async def latest_turn(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> Optional[SessionTurn]: ...

    @abstractmethod
    async def latest_turn_per_harness_kind(
        self,
        *,
        project_id: UUID,
        session_id: str,
        harness_kind: HarnessKind,
    ) -> Optional[SessionTurn]: ...

    @abstractmethod
    async def delete_by_session_id(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> int: ...
