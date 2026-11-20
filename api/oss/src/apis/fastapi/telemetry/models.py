from typing import Dict, Optional

from pydantic import BaseModel

from oss.src.core.telemetry.heartbeat import HeartbeatReason


class InstanceTelemetryResponse(BaseModel):
    enabled: bool
    distinct_id: Optional[str] = None
    groups: Optional[Dict[str, str]] = None


class TelemetryHeartbeatResponse(BaseModel):
    sent: bool
    reason: HeartbeatReason
