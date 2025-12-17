from typing import Optional, List
from uuid import UUID

from pydantic import BaseModel

from oss.src.core.shared.dtos import (
    Windowing,
)

from oss.src.core.tracing.dtos import (
    OTelLink,  # needed for annotations at the moment
    OTelLinks,
    OTelFlatSpan,  # needed for annotations at the moment
    OTelFlatSpans,
    OTelTraceTree,
    Bucket,
    MetricsBucket,
    TracingQuery,
    MetricSpec,
    #
    SessionsQuery,
    ActorsQuery,
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
    session: Optional[SessionsQuery] = None
    #
    windowing: Optional[Windowing] = None


class SessionIdsResponse(BaseModel):
    count: int = 0
    session_ids: List[str] = []


class ActorsQueryRequest(BaseModel):
    actor: Optional[ActorsQuery] = None
    #
    windowing: Optional[Windowing] = None


class ActorIdsResponse(BaseModel):
    count: int = 0
    actor_ids: List[str] = []
