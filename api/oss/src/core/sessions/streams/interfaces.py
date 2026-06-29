from abc import ABC, abstractmethod
from typing import List, Optional
from uuid import UUID

from oss.src.core.sessions.streams.dtos import (
    SessionStream,
    SessionStreamCreate,
    SessionStreamEdit,
    SessionStreamQuery,
)


class SessionStreamsDAOInterface(ABC):
    @abstractmethod
    async def create(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        stream: SessionStreamCreate,
    ) -> SessionStream: ...

    @abstractmethod
    async def get_by_session_id(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> Optional[SessionStream]: ...

    @abstractmethod
    async def get_by_id(
        self,
        *,
        project_id: UUID,
        stream_id: UUID,
    ) -> Optional[SessionStream]: ...

    @abstractmethod
    async def query(
        self,
        *,
        project_id: UUID,
        filter: SessionStreamQuery,
    ) -> List[SessionStream]: ...

    @abstractmethod
    async def update(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        session_id: str,
        stream: SessionStreamEdit,
    ) -> Optional[SessionStream]: ...

    @abstractmethod
    async def delete_by_session_id(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> bool: ...

    @abstractmethod
    async def count_active(
        self,
        *,
        project_id: Optional[UUID] = None,
    ) -> int: ...
