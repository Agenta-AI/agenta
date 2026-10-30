from abc import ABC, abstractmethod
from typing import Dict, List, Optional
from uuid import UUID

from oss.src.core.shared.dtos import Reference, Windowing
from oss.src.core.shared.dtos import RunUsage
from oss.src.core.sessions.turns.dtos import (
    HarnessKind,
    SessionTurn,
    SessionTurnComplete,
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
    async def complete(
        self,
        *,
        project_id: UUID,
        #
        turn: SessionTurnComplete,
    ) -> Optional[SessionTurn]: ...

    @abstractmethod
    async def set_turn_usage_from_trace(
        self,
        *,
        project_id: UUID,
        trace_id: UUID,
        usage: RunUsage,
    ) -> int:
        """Ingest's write-back, and the one statement of the two writers' rule.

        The trace's priced root usage goes to the one turn with that trace id, with
        source `trace`. Each figure the trace reports replaces the runner's. A figure
        it does not report keeps the turn's value. The runner, on completion, fills
        only fields that have no value, so the order of the two writes does not
        matter. A trace that several turns share writes nothing: its total is no one
        turn's usage. Returns the number of turns written."""
        ...

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
    async def query_session_ids_by_references(
        self,
        *,
        project_id: UUID,
        references: List[Reference],
        limit: int,
    ) -> List[str]:
        """Distinct session ids whose turns match `references`, capped at `limit`.

        Narrower than `query_turns` (which loads full turn rows, unbounded) — the
        session list's turn_references filter only ever needs the id set (P2-12).
        """
        ...

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
    async def latest_turn_per_session(
        self,
        *,
        project_id: UUID,
        session_ids: List[str],
    ) -> Dict[str, SessionTurn]: ...

    @abstractmethod
    async def delete_by_session_id(
        self,
        *,
        project_id: UUID,
        session_id: str,
    ) -> int: ...
