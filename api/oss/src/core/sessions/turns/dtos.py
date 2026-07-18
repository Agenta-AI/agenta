from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel

from agenta.sdk.agents.dtos import HarnessKind

from oss.src.core.shared.dtos import Identifier, Lifecycle, OTelSpanId, Reference


class SessionTurn(Identifier, Lifecycle):
    project_id: UUID
    session_id: str
    stream_id: UUID
    turn_index: int
    harness_kind: HarnessKind
    agent_session_id: Optional[str] = None
    sandbox_id: Optional[str] = None
    references: Optional[List[Reference]] = None
    trace_id: Optional[UUID] = None
    span_id: Optional[OTelSpanId] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None


class SessionTurnCreate(BaseModel):
    session_id: str
    stream_id: UUID
    turn_index: int
    harness_kind: HarnessKind
    agent_session_id: Optional[str] = None
    sandbox_id: Optional[str] = None
    references: Optional[List[Reference]] = None
    trace_id: Optional[UUID] = None
    span_id: Optional[OTelSpanId] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None


class SessionTurnQuery(BaseModel):
    session_id: Optional[str] = None
    stream_id: Optional[UUID] = None
    harness_kind: Optional[HarnessKind] = None
    references: Optional[List[Reference]] = None
