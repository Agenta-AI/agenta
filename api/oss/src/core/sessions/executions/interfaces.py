from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence, Tuple
from uuid import UUID

from oss.src.core.sessions.executions.dtos import (
    SessionExecutionSettlement,
    SessionExecutionSettlementResult,
)


class SessionExecutionsDAOInterface(ABC):
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
