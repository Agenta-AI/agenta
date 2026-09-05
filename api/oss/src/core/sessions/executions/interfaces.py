from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence, Tuple
from uuid import UUID

from oss.src.core.sessions.executions.dtos import (
    SessionExecutionState,
    SessionExecutionSettlement,
    SessionExecutionSettlementResult,
)


class SessionExecutionsDAOInterface(ABC):
    async def fetch_execution(
        self,
        *,
        project_id: UUID,
        session_id: str,
        execution_id: str,
        transaction: Optional[Any] = None,
    ) -> Optional[SessionExecutionSettlement]:
        """Fetch one execution without creating or locking it."""
        raise NotImplementedError

    async def lock_for_control(
        self,
        *,
        project_id: UUID,
        session_id: str,
        execution_id: str,
        transaction: Any,
    ) -> SessionExecutionSettlement:
        """Ensure and row-lock the source execution for Stop/answer arbitration."""
        raise NotImplementedError

    async def create_continuation(
        self,
        *,
        project_id: UUID,
        session_id: str,
        execution_id: str,
        parent_execution_id: str,
        source_interaction_id: Optional[UUID],
        transaction: Any,
    ) -> SessionExecutionSettlement:
        raise NotImplementedError

    async def set_state(
        self,
        *,
        project_id: UUID,
        session_id: str,
        execution_id: str,
        state: SessionExecutionState,
        error: Optional[dict] = None,
        expected_states: Optional[Sequence[SessionExecutionState]] = None,
        transaction: Optional[Any] = None,
    ) -> Optional[SessionExecutionSettlement]:
        raise NotImplementedError

    @abstractmethod
    async def settle(
        self,
        *,
        project_id: UUID,
        session_id: str,
        execution_id: str,
        terminal_outcome: str,
        settled_by: str,
        settled_at: Optional[datetime] = None,
        transaction: Optional[Any] = None,
    ) -> SessionExecutionSettlementResult:
        """Compare-and-set one terminal outcome and return the stored winner."""

    @abstractmethod
    async def query_settled(
        self,
        *,
        project_id: UUID,
        keys: Sequence[Tuple[str, str]],
    ) -> Dict[Tuple[str, str], SessionExecutionSettlement]:
        """Fetch terminal state for `(session_id, execution_id)` keys."""

    @abstractmethod
    async def mark_endings_written(
        self,
        *,
        project_id: UUID,
        keys: Sequence[Tuple[str, str]],
        written_at: Optional[datetime] = None,
    ) -> None:
        """Mark terminal executions whose transcript ending has been written."""

    @abstractmethod
    async def list_redis_unreconciled(
        self,
        *,
        limit: int,
    ) -> List[SessionExecutionSettlement]:
        """Runner settlements whose post-commit Redis projection is incomplete."""

    @abstractmethod
    async def mark_redis_reconciled(
        self,
        *,
        project_id: UUID,
        session_id: str,
        execution_id: str,
    ) -> None:
        """Record completion of the idempotent post-commit Redis projection."""
