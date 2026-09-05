from datetime import datetime
from enum import Enum
from typing import Any, Dict, Optional
from uuid import UUID

from pydantic import BaseModel


class SessionExecutionState(str, Enum):
    active = "active"
    stopping = "stopping"
    pending_delivery = "pending_delivery"
    recoverable = "recoverable"
    running = "running"
    terminal = "terminal"


class SessionExecutionSettlement(BaseModel):
    project_id: UUID
    session_id: str
    execution_id: str
    state: SessionExecutionState = SessionExecutionState.terminal
    parent_execution_id: Optional[str] = None
    source_interaction_id: Optional[UUID] = None
    error: Optional[Dict[str, Any]] = None
    terminal_outcome: Optional[str] = None
    settled_by: Optional[str] = None
    settled_at: Optional[datetime] = None
    ending_written_at: Optional[datetime] = None
    redis_reconciled_at: Optional[datetime] = None


class SessionExecutionSettlementResult(BaseModel):
    settlement: SessionExecutionSettlement
    won: bool
