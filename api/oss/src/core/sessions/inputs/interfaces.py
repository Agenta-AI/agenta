from abc import ABC, abstractmethod
from typing import Any, AsyncContextManager, List, Optional
from uuid import UUID

from oss.src.core.sessions.inputs.dtos import PendingInput, PendingInputCreate


class SessionInputsDAOInterface(ABC):
    @abstractmethod
    def transaction(self) -> AsyncContextManager[Any]:
        pass

    @abstractmethod
    async def create_input(
        self,
        *,
        user_id: Optional[UUID],
        pending_input: PendingInputCreate,
        prioritize: bool = False,
        transaction: Optional[Any] = None,
    ) -> PendingInput:
        pass

    @abstractmethod
    async def fetch_by_idempotency_key(
        self,
        *,
        project_id: UUID,
        session_id: str,
        idempotency_key: str,
        transaction: Optional[Any] = None,
    ) -> Optional[PendingInput]:
        pass

    @abstractmethod
    async def list_pending(
        self,
        *,
        project_id: UUID,
        session_id: str,
        transaction: Optional[Any] = None,
    ) -> List[PendingInput]:
        pass

    @abstractmethod
    async def fetch_active_successor(
        self,
        *,
        project_id: UUID,
        session_id: str,
        transaction: Any,
    ) -> Optional[PendingInput]:
        pass

    @abstractmethod
    async def fetch_input(
        self, *, project_id: UUID, session_id: str, input_id: UUID
    ) -> Optional[PendingInput]:
        pass

    @abstractmethod
    async def remove_pending(
        self,
        *,
        project_id: UUID,
        session_id: str,
        input_id: UUID,
        user_id: Optional[UUID],
    ) -> Optional[PendingInput]:
        pass

    @abstractmethod
    async def promote_next(
        self,
        *,
        project_id: UUID,
        session_id: str,
        execution_id: str,
        input_id: Optional[UUID] = None,
        only_policy: Optional[str] = None,
        transaction: Optional[Any] = None,
    ) -> Optional[PendingInput]:
        pass
