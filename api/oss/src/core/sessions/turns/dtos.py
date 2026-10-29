from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel

from agenta.sdk.agents.dtos import HarnessKind

from oss.src.core.access.dtos import (
    PrincipalRef,
    RunApproval,
    RunContext,
    RunEnvelope,
    RunSender,
)
from oss.src.core.sessions.types import SessionReference
from oss.src.core.shared.dtos import Identifier, Lifecycle, OTelSpanId


class SessionTurn(Identifier, Lifecycle):
    project_id: UUID
    session_id: str
    turn_id: Optional[UUID] = None
    stream_id: UUID
    turn_index: int
    harness_kind: HarnessKind
    agent_session_id: Optional[str] = None
    sandbox_id: Optional[str] = None
    references: Optional[List[SessionReference]] = None
    trace_id: Optional[UUID] = None
    span_id: Optional[OTelSpanId] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    # Run attribution, read-only; null for turns written before M2.
    principal: Optional[PrincipalRef] = None
    sender: Optional[RunSender] = None
    context: Optional[RunContext] = None
    approved_by: Optional[RunApproval] = None


class SessionTurnCreate(BaseModel):
    session_id: str
    turn_id: Optional[UUID] = None
    stream_id: UUID
    turn_index: int
    harness_kind: HarnessKind
    agent_session_id: Optional[str] = None
    sandbox_id: Optional[str] = None
    references: Optional[List[SessionReference]] = None
    trace_id: Optional[UUID] = None
    span_id: Optional[OTelSpanId] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    # Server-set from the request's run envelope; never read from a request body.
    envelope: Optional[RunEnvelope] = None


class SessionTurnComplete(BaseModel):
    session_id: str
    turn_index: int
    agent_session_id: Optional[str] = None
    end_time: datetime
    # Server-set. Fills the attribution only on a row that has none.
    envelope: Optional[RunEnvelope] = None


class SessionTurnQuery(BaseModel):
    session_id: Optional[str] = None
    stream_id: Optional[UUID] = None
    harness_kind: Optional[HarnessKind] = None
    references: Optional[List[SessionReference]] = None
