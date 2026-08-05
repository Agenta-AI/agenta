from abc import ABC, abstractmethod
from typing import List, Optional
from uuid import UUID

from oss.src.core.sessions.streams.dtos import (
    SessionStream,
    SessionStreamCreate,
    SessionStreamEdit,
    SessionStreamHeaderEdit,
    SessionStreamQuery,
)
from oss.src.core.shared.dtos import Windowing


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
    async def get_by_session_id_including_archived(
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
        windowing: Optional[Windowing] = None,
        session_ids: Optional[List[str]] = None,
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
    async def update_header(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        session_id: str,
        header: SessionStreamHeaderEdit,
    ) -> Optional[SessionStream]: ...

    @abstractmethod
    async def delete_by_session_id(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> bool: ...

    @abstractmethod
    async def unarchive_by_session_id(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        session_id: str,
    ) -> Optional[SessionStream]: ...

    @abstractmethod
    async def set_archived_by_session_id(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        session_id: str,
    ) -> Optional[SessionStream]: ...

    @abstractmethod
    async def clear_archived_by_session_id(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        session_id: str,
    ) -> Optional[SessionStream]: ...

    @abstractmethod
    async def hard_delete_by_session_id(
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
