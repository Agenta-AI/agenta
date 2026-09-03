from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel


class SessionExecutionSettlement(BaseModel):
    project_id: UUID
    session_id: str
    execution_id: str
    terminal_outcome: str
    settled_by: str
    settled_at: datetime
    records_closed_at: Optional[datetime] = None
    redis_reconciled_at: Optional[datetime] = None


class SessionExecutionSettlementResult(BaseModel):
    settlement: SessionExecutionSettlement
    won: bool
