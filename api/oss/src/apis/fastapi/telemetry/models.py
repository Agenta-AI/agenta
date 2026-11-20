from typing import Dict, Optional

from pydantic import BaseModel


class InstanceTelemetryResponse(BaseModel):
    enabled: bool
    distinct_id: Optional[str] = None
    groups: Optional[Dict[str, str]] = None
