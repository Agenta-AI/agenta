from typing import Optional, List

from pydantic import BaseModel

from oss.src.utils.exceptions import Support

from oss.src.core.shared.dtos import (
    Windowing,
    Reference,
    Link,
    Links,
    Trace,
    Traces,
)

from oss.src.core.tracing.dtos import (
    OTelLink,  # noqa: F401 - needed for annotations
    OTelLinks,
    OTelFlatSpan,  # noqa: F401 - needed for annotations
    OTelFlatSpans,
    Span,
    Spans,
    OTelTraceTree,
    OTelSpansTree,  # noqa: F401
    Bucket,
    MetricsBucket,
    TracingQuery,
    Filtering,
    MetricSpec,
)


class OTelTracingRequest(BaseModel):
    spans: Optional[OTelFlatSpans] = None
    traces: Optional[OTelTraceTree] = None


class TracesRequest(BaseModel):
    traces: Optional[Traces] = None


class TraceRequest(BaseModel):
    trace: Optional[Trace] = None


class SpansRequest(BaseModel):
    spans: Optional[Spans] = None


class SpanRequest(BaseModel):
    span: Optional[Span] = None


class OTelLinksResponse(Support):
    count: int = 0
    links: Optional[OTelLinks] = None
    dropped: Optional[OTelLinks] = None


class LinkResponse(Support):
    count: int = 0
    link: Optional[Link] = None


class LinksResponse(Support):
    count: int = 0
    links: Optional[Links] = None


class TraceIdResponse(Support):
    count: int = 0
    trace_id: Optional[str] = None


class TraceIdsResponse(Support):
    count: int = 0
    trace_ids: List[str] = []


class SpanIdResponse(Support):
    count: int = 0
    span_id: Optional[str] = None


class SpanIdsResponse(Support):
    count: int = 0
    span_ids: List[str] = []


class OTelTracingResponse(Support):
    count: int = 0
    spans: Optional[OTelFlatSpans] = None
    traces: Optional[OTelTraceTree] = None


class TraceResponse(Support):
    count: int = 0
    trace: Optional[Trace] = None


class TracesResponse(Support):
    count: int = 0
    traces: Optional[Traces] = None


class SpanResponse(Support):
    count: int = 0
    span: Optional[Span] = None


class SpansResponse(Support):
    count: int = 0
    spans: Optional[Spans] = None


class TracesQueryRequest(BaseModel):
    filtering: Optional[Filtering] = None
    windowing: Optional[Windowing] = None
    #
    query_ref: Optional[Reference] = None
    query_variant_ref: Optional[Reference] = None
    query_revision_ref: Optional[Reference] = None


class SpansQueryRequest(BaseModel):
    filtering: Optional[Filtering] = None
    windowing: Optional[Windowing] = None
    #
    query_ref: Optional[Reference] = None
    query_variant_ref: Optional[Reference] = None
    query_revision_ref: Optional[Reference] = None


class OldAnalyticsResponse(Support):
    count: int = 0
    buckets: List[Bucket] = []


class AnalyticsResponse(Support):
    count: int = 0
    buckets: List[MetricsBucket] = []
    #
    query: TracingQuery = TracingQuery()
    specs: List[MetricSpec] = []


class SessionsQueryRequest(BaseModel):
    # True: use last_active (unstable), False/None: use first_active (stable)
    realtime: Optional[bool] = None
    windowing: Optional[Windowing] = None


class SessionIdsResponse(Support):
    count: int = 0
    session_ids: List[str] = []
    windowing: Optional[Windowing] = None


class UsersQueryRequest(BaseModel):
    # True: use last_active (unstable), False/None: use first_active (stable)
    realtime: Optional[bool] = None
    windowing: Optional[Windowing] = None


class UserIdsResponse(Support):
    count: int = 0
    user_ids: List[str] = []
    windowing: Optional[Windowing] = None
