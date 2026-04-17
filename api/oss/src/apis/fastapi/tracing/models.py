from typing import Optional, List

from pydantic import BaseModel, Field

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
    """Ingest or query payload for OpenTelemetry-style spans.

    Exactly one of `spans` or `traces` should be provided. Use `spans`
    for a flat list (parent/child linked via `parent_id`); use `traces`
    for a nested tree (keyed by `trace_id` then by span name, children
    hanging off each node's `spans` field). The two shapes are
    interchangeable and the query endpoint returns the `traces` shape by
    default.
    """

    spans: Optional[OTelFlatSpans] = Field(
        default=None,
        description=(
            "Flat list of spans. Use this when you already have a flat "
            "list and parent/child relationships are expressed via each "
            "span's `parent_id`."
        ),
    )
    traces: Optional[OTelTraceTree] = Field(
        default=None,
        description=(
            "Nested tree of spans keyed by `trace_id` → span name, with "
            "children under each node's `spans` field. This matches the "
            "shape returned by `POST /tracing/spans/query` with "
            '`focus="trace"`.'
        ),
    )


class TracesRequest(BaseModel):
    traces: Optional[Traces] = None


class TraceRequest(BaseModel):
    trace: Optional[Trace] = None


class SpansRequest(BaseModel):
    spans: Optional[Spans] = None


class SpanRequest(BaseModel):
    span: Optional[Span] = None


class OTelLinksResponse(BaseModel):
    """Response from span ingestion.

    `count` reflects how many spans were successfully parsed and published
    to the ingest stream. If you submitted N spans and see `count < N`,
    some spans failed server-side validation and were not persisted (check
    server logs for details).
    """

    count: int = Field(
        default=0,
        description=(
            "Number of spans that were accepted and published to the "
            "ingest stream. Compare against the number of spans you sent "
            "to detect partial failures."
        ),
    )
    links: Optional[OTelLinks] = Field(
        default=None,
        description=(
            "List of `(trace_id, span_id)` pairs for the accepted spans, "
            "in submission order."
        ),
    )


class LinkResponse(BaseModel):
    count: int = 0
    link: Optional[Link] = None


class LinksResponse(BaseModel):
    count: int = 0
    links: Optional[Links] = None


class TraceIdResponse(BaseModel):
    count: int = 0
    trace_id: Optional[str] = None


class TraceIdsResponse(BaseModel):
    count: int = 0
    trace_ids: List[str] = []


class SpanIdResponse(BaseModel):
    count: int = 0
    span_id: Optional[str] = None


class SpanIdsResponse(BaseModel):
    count: int = 0
    span_ids: List[str] = []


class OTelTracingResponse(BaseModel):
    """Response from span/trace queries.

    Exactly one of `spans` or `traces` is populated, controlled by the
    `focus` field in the request (`"span"` for flat lists, `"trace"` for
    nested trees). The shapes here match what the ingest endpoint accepts,
    so you can round-trip data between environments.
    """

    count: int = Field(
        default=0,
        description="Total number of matching traces or spans in the window.",
    )
    spans: Optional[OTelFlatSpans] = Field(
        default=None,
        description=(
            'Flat list of spans, populated when the query was run with `focus="span"`.'
        ),
    )
    traces: Optional[OTelTraceTree] = Field(
        default=None,
        description=(
            "Nested tree of spans keyed by `trace_id` → span name, "
            'populated when the query was run with `focus="trace"` '
            "(default)."
        ),
    )


class TraceResponse(BaseModel):
    count: int = 0
    trace: Optional[Trace] = None


class TracesResponse(BaseModel):
    count: int = 0
    traces: Optional[Traces] = None


class SpanResponse(BaseModel):
    count: int = 0
    span: Optional[Span] = None


class SpansResponse(BaseModel):
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
