from datetime import datetime
from enum import Enum
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel

from oss.src.core.shared.dtos import Identifier, Lifecycle, Reference


class Harness(str, Enum):
    """The runner's harness identity (`services/runner/src/version.ts` HARNESSES).

    A plain string column in the DB — this enum only validates the DTO boundary.
    """

    pi_core = "pi_core"
    pi_agenta = "pi_agenta"
    claude = "claude"


class SessionTurn(Identifier, Lifecycle):
    project_id: UUID
    session_id: str
    stream_id: UUID
    turn_index: int
    harness: Harness
    agent_session_id: Optional[str] = None
    sandbox_id: Optional[str] = None
    references: Optional[List[Reference]] = None
    trace_id: Optional[UUID] = None
    span_id: Optional[UUID] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None


class SessionTurnCreate(BaseModel):
    session_id: str
    stream_id: UUID
    turn_index: int
    harness: Harness
    agent_session_id: Optional[str] = None
    sandbox_id: Optional[str] = None
    references: Optional[List[Reference]] = None
    trace_id: Optional[UUID] = None
    span_id: Optional[UUID] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None


class SessionTurnQuery(BaseModel):
    session_id: Optional[str] = None
    stream_id: Optional[UUID] = None
    harness: Optional[Harness] = None
    references: Optional[List[Reference]] = None
