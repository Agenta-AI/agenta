from typing import Optional, List

from pydantic import BaseModel

from oss.src.core.shared.dtos import (
    Windowing,
)

from oss.src.core.tracing.dtos import (
    OTelLink,  # noqa: F401 - needed for annotations
    OTelLinks,
    OTelFlatSpan,  # noqa: F401 - needed for annotations
    OTelFlatSpans,
    OTelTraceTree,
    Bucket,
    MetricsBucket,
    TracingQuery,
    MetricSpec,
)


class OTelTracingRequest(BaseModel):
    spans: Optional[OTelFlatSpans] = None
    traces: Optional[OTelTraceTree] = None


class OTelLinksResponse(BaseModel):
    count: int = 0
    links: Optional[OTelLinks] = None


class OTelTracingResponse(BaseModel):
    count: int = 0
    spans: Optional[OTelFlatSpans] = None
    traces: Optional[OTelTraceTree] = None


class OldAnalyticsResponse(BaseModel):
    count: int = 0
    buckets: List[Bucket] = []


class AnalyticsResponse(BaseModel):
    count: int = 0
    buckets: List[MetricsBucket] = []
    #
    query: TracingQuery = TracingQuery()
    specs: List[MetricSpec] = []


class SessionsQueryRequest(BaseModel):
    # True: use last_active (unstable), False/None: use first_active (stable)
    realtime: Optional[bool] = None
    windowing: Optional[Windowing] = None


class SessionIdsResponse(BaseModel):
    count: int = 0
    session_ids: List[str] = []
    windowing: Optional[Windowing] = None


class UsersQueryRequest(BaseModel):
    # True: use last_active (unstable), False/None: use first_active (stable)
    realtime: Optional[bool] = None
    windowing: Optional[Windowing] = None


class UserIdsResponse(BaseModel):
    count: int = 0
    user_ids: List[str] = []
    windowing: Optional[Windowing] = None
