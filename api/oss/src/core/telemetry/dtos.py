from typing import Dict, Literal, Optional

from pydantic import BaseModel


class TelemetryStatus(BaseModel):
    enabled: bool
    reason: Literal["cloud", "default", "switch"]


class InstanceTelemetry(BaseModel):
    enabled: bool
    distinct_id: Optional[str] = None
    groups: Optional[Dict[str, str]] = None
    # Properties the browser adds to every event. Cloud: the region and deployment.
    # Self-hosted: the instance kind.
    properties: Optional[Dict[str, str]] = None
