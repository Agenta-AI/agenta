from typing import Dict, Literal, Optional

from pydantic import BaseModel


class TelemetryStatus(BaseModel):
    enabled: bool
    reason: Literal["cloud", "default", "switch"]


class InstanceTelemetry(BaseModel):
    enabled: bool
    distinct_id: Optional[str] = None
    groups: Optional[Dict[str, str]] = None
