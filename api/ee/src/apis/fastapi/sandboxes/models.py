from typing import Optional
from uuid import UUID

from pydantic import BaseModel


class E2BEventPayload(BaseModel):
    """Shape of an E2B webhook event payload (subset of documented fields).

    E2B issue #1103: header/signature mismatch — keep this loose and log
    raw payloads on first delivery for verification.
    """

    event: Optional[str] = None
    sandbox_id: Optional[str] = None
    team_id: Optional[str] = None
    # Resource allocation at time of event
    vcpu: Optional[int] = None
    memory_mb: Optional[int] = None
    # Duration of the billing window (ms)
    duration_ms: Optional[int] = None
    start_timestamp: Optional[str] = None


class DaytonaPollRequest(BaseModel):
    organization_id: UUID
    period_start: str  # RFC3339
    period_end: str  # RFC3339
