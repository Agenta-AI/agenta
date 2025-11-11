from typing import Optional
from datetime import datetime

from pydantic import BaseModel

from oss.src.apis.fastapi.shared.models import VersionedModel
from oss.src.core.tracing.dtos import (
    OTelLink,  # needed for annotations at the moment
    OTelLinks,
    OTelFlatSpan,  # needed for annotations at the moment
    OTelFlatSpans,
    OTelTraceTree,
)


class OTelTracingRequest(BaseModel):
    spans: Optional[OTelFlatSpans] = None
    traces: Optional[OTelTraceTree] = None


class OTelLinksResponse(VersionedModel):
    count: int
    links: Optional[OTelLinks] = None


class OTelTracingResponse(VersionedModel):
    count: int
    oldest: Optional[datetime] = None
    newest: Optional[datetime] = None
    spans: Optional[OTelFlatSpans] = None
    traces: Optional[OTelTraceTree] = None
