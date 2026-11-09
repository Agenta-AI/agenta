from typing import Dict, Literal, Optional

from pydantic import BaseModel


class InstanceTelemetryResponse(BaseModel):
    enabled: bool
    distinct_id: Optional[str] = None
    groups: Optional[Dict[str, str]] = None


class TelemetryHeartbeatResponse(BaseModel):
    sent: bool
    reason: Literal["sent", "not_due", "disabled", "cloud", "failed"]
