from abc import ABC, abstractmethod
from typing import List, Optional
from uuid import UUID

from oss.src.core.sessions.streams.dtos import (
    SessionStream,
    SessionStreamCreate,
    SessionStreamEdit,
    SessionStreamHeaderEdit,
    SessionStreamQuery,
    SessionStreamQueryResult,
    SessionStreamReadOptions,
)
from oss.src.core.sessions.types import SessionReference, SessionTriggerAttribution
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
        exclude_session_ids: Optional[List[str]] = None,
        read_options: Optional[SessionStreamReadOptions] = None,
    ) -> List[SessionStreamQueryResult]: ...

    @abstractmethod
    async def count(
        self,
        *,
        project_id: UUID,
        filter: SessionStreamQuery,
        session_ids: Optional[List[str]] = None,
        exclude_session_ids: Optional[List[str]] = None,
    ) -> int: ...

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
    async def query_session_ids_by_references(
        self,
        *,
        project_id: UUID,
        references: List[SessionReference],
        limit: int,
    ) -> List[str]:
        """Session ids whose stream-row references satisfy the same containment the
        turns query applies."""
        ...

    @abstractmethod
    async def fill_missing(
        self,
        *,
        project_id: UUID,
        session_id: str,
        name: Optional[str] = None,
        references: Optional[List[SessionReference]] = None,
    ) -> bool:
        """Write each field onto the row only where it is still NULL; never overwrite."""
        ...

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


class TriggerSessionClaimsDAOInterface(ABC):
    @abstractmethod
    async def claim_trigger_delivery(
        self,
        *,
        project_id: UUID,
        user_id: Optional[UUID],
        event_id: str,
        session_id: str,
        attribution: SessionTriggerAttribution,
    ) -> bool:
        """Atomically claim one trigger delivery and attribute its session."""
        ...

    @abstractmethod
    async def abandon_claimed_session(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> bool:
        """Soft-delete a session_streams row claimed via `claim_trigger_delivery`.

        Called when dispatch fails before a turn ever starts, so the row never
        lingers as a permanent, un-sweepable phantom session (it has `flags=NULL`
        at claim time, which the orphan sweep can never match).
        """
        ...
