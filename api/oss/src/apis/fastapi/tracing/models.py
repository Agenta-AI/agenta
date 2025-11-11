from typing import Optional, List

from pydantic import BaseModel

from oss.src.apis.fastapi.shared.models import VersionedModel
from oss.src.core.tracing.dtos import (
    OTelLink,  # needed for annotations at the moment
    OTelLinks,
    OTelFlatSpan,  # needed for annotations at the moment
    OTelFlatSpans,
    OTelTraceTree,
    Bucket,
)


class OTelTracingRequest(BaseModel):
    spans: Optional[OTelFlatSpans] = None
    traces: Optional[OTelTraceTree] = None


class OTelLinksResponse(VersionedModel):
    count: int = 0
    links: Optional[OTelLinks] = None


class OTelTracingResponse(VersionedModel):
    count: int = 0
    spans: Optional[OTelFlatSpans] = None
    traces: Optional[OTelTraceTree] = None


class AnalyticsResponse(VersionedModel):
    count: Optional[int] = None
    buckets: List[Bucket] = []
