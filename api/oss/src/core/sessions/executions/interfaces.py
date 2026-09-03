from abc import ABC, abstractmethod
from datetime import datetime
from typing import Dict, List, Optional, Sequence, Tuple
from uuid import UUID

from oss.src.core.sessions.executions.dtos import (
    SessionExecutionSettlement,
    SessionExecutionSettlementResult,
)
from oss.src.core.sessions.commands.dtos import SessionCommand, SessionCommandSettle


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
    async def close_records(
        self,
        *,
        project_id: UUID,
        keys: Sequence[Tuple[str, str]],
        settled_by: str,
    ) -> None:
        """Close the winner's record stream after its terminal batch commits."""

    @abstractmethod
    async def settle_command_execution(
        self,
        *,
        settle: SessionCommandSettle,
        session_id: str,
        execution_id: Optional[str],
        terminal_outcome: Optional[str],
        settled_by: Optional[str],
        mirror_stopped: bool,
        cancel_interactions: bool,
    ) -> Optional[SessionCommand]:
        """Commit the terminal core facts in one transaction."""

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
