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

    See [Tracing](/reference/api-guide/tracing) for the full attribute
    namespace and the async ingest contract.
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
    """Ingest payload in the canonical `Traces` list shape.

    Used by `POST /traces/ingest`. Each entry is one trace with its
    `trace_id` and a nested `spans` tree.
    """

    traces: Optional[Traces] = Field(
        default=None,
        description=(
            "List of trace records. Each record is a `trace_id` plus the "
            "nested `spans` tree. Equivalent to the map-shaped payload "
            "accepted by `POST /tracing/spans/ingest`."
        ),
    )


class TraceRequest(BaseModel):
    """Ingest or edit payload for a single canonical `Trace`."""

    trace: Optional[Trace] = Field(
        default=None,
        description=(
            "A single trace record (trace_id plus nested spans). "
            "The `trace_id` must match the path parameter on edit endpoints."
        ),
    )


class SpansRequest(BaseModel):
    spans: Optional[Spans] = Field(
        default=None,
        description="Flat list of spans. Reserved for span-shaped write helpers.",
    )


class SpanRequest(BaseModel):
    span: Optional[Span] = Field(
        default=None,
        description="A single span. Reserved for span-shaped write helpers.",
    )


class OTelLinksResponse(BaseModel):
    """Response from span ingestion.

    `count` reflects how many spans were successfully parsed and published
    to the ingest stream. If you submitted N spans and see `count < N`,
    some spans failed server-side validation and were not persisted (check
    server logs for details). See [Tracing — Async write
    contract](/reference/api-guide/tracing#async-write-contract-202) for
    the full semantics of the `202 Accepted` response.
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
    count: int = Field(
        default=0,
        description="`1` if a link was returned, `0` otherwise.",
    )
    link: Optional[Link] = Field(
        default=None,
        description="The `(trace_id, span_id)` pair identifying the returned span.",
    )


class LinksResponse(BaseModel):
    count: int = Field(default=0, description="Number of links returned.")
    links: Optional[Links] = Field(
        default=None,
        description="List of `(trace_id, span_id)` pairs.",
    )


class TraceIdResponse(BaseModel):
    count: int = Field(
        default=0,
        description="`1` if a `trace_id` was returned, `0` otherwise.",
    )
    trace_id: Optional[str] = Field(
        default=None,
        description="32-char hex UUID identifying the trace that was created or edited.",
    )


class TraceIdsResponse(BaseModel):
    count: int = Field(
        default=0,
        description="Number of distinct trace IDs in this response.",
    )
    trace_ids: List[str] = Field(
        default=[],
        description=(
            "32-char hex UUIDs of the traces that were ingested. Compare "
            "against the number you submitted to detect partial failures."
        ),
    )


class SpanIdResponse(BaseModel):
    count: int = Field(
        default=0,
        description="`1` if a `span_id` was returned, `0` otherwise.",
    )
    span_id: Optional[str] = Field(
        default=None,
        description="16-char hex ID identifying the span.",
    )


class SpanIdsResponse(BaseModel):
    count: int = Field(default=0, description="Number of distinct span IDs returned.")
    span_ids: List[str] = Field(
        default=[],
        description="16-char hex IDs of the matching spans.",
    )


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
    count: int = Field(
        default=0,
        description="`1` if a trace was returned, `0` otherwise.",
    )
    trace: Optional[Trace] = Field(
        default=None,
        description=(
            "The trace in the canonical `Trace` shape (`trace_id` + nested "
            "`spans` tree)."
        ),
    )


class TracesResponse(BaseModel):
    count: int = Field(
        default=0,
        description="Total number of matching traces in the window.",
    )
    traces: Optional[Traces] = Field(
        default=None,
        description=(
            "List of traces in the canonical `Traces` shape. For the "
            "map-shaped payload keyed by `trace_id`, call "
            '`POST /tracing/spans/query` with `focus="trace"`.'
        ),
    )


class SpanResponse(BaseModel):
    count: int = Field(
        default=0,
        description="`1` if a span was returned, `0` otherwise.",
    )
    span: Optional[Span] = Field(
        default=None,
        description="The matching span, or `null` if not found.",
    )


class SpansResponse(BaseModel):
    count: int = Field(
        default=0,
        description="Total number of matching spans in the window.",
    )
    spans: Optional[Spans] = Field(
        default=None,
        description="Flat list of matching spans.",
    )


class TracesQueryRequest(BaseModel):
    """Request body for `POST /traces/query`."""

    filtering: Optional[Filtering] = Field(
        default=None,
        description=(
            "Span-level conditions. A trace matches when any of its spans matches."
        ),
    )
    windowing: Optional[Windowing] = Field(
        default=None,
        description=(
            "Cursor pagination and time range (see [Query "
            "Pattern](/reference/api-guide/query-pattern#windowing))."
        ),
    )
    #
    query_ref: Optional[Reference] = Field(
        default=None,
        description=(
            "Resolve filtering/windowing from a saved query by "
            "`id`/`slug`. Only one of the three `query_*_ref` fields is needed."
        ),
    )
    query_variant_ref: Optional[Reference] = Field(
        default=None,
        description="Resolve from the latest revision of a specific query variant.",
    )
    query_revision_ref: Optional[Reference] = Field(
        default=None,
        description=(
            "Resolve from a specific query revision. Returns `409` when "
            "the revision's stored `formatting.focus` is `span`."
        ),
    )


class SpansQueryRequest(BaseModel):
    """Request body for `POST /spans/query`."""

    filtering: Optional[Filtering] = Field(
        default=None,
        description="Span-level conditions.",
    )
    windowing: Optional[Windowing] = Field(
        default=None,
        description="Cursor pagination and time range.",
    )
    #
    query_ref: Optional[Reference] = Field(
        default=None,
        description="Resolve filtering/windowing from a saved query.",
    )
    query_variant_ref: Optional[Reference] = Field(
        default=None,
        description="Resolve from the latest revision of a specific query variant.",
    )
    query_revision_ref: Optional[Reference] = Field(
        default=None,
        description=(
            "Resolve from a specific query revision. Returns `409` when "
            "the revision's stored `formatting.focus` is `trace`."
        ),
    )


class OldAnalyticsResponse(BaseModel):
    """Legacy analytics response with a fixed metric schema."""

    count: int = Field(
        default=0,
        description="Number of time buckets returned.",
    )
    buckets: List[Bucket] = Field(
        default=[],
        description=(
            "Time-bucketed aggregates with fixed fields (`total`, `errors`) "
            "holding `count`, `duration`, `costs`, and `tokens`."
        ),
    )


class AnalyticsResponse(BaseModel):
    """Analytics response with user-specified metric specs."""

    count: int = Field(
        default=0,
        description="Number of time buckets returned.",
    )
    buckets: List[MetricsBucket] = Field(
        default=[],
        description=(
            "Time-bucketed aggregates. Each bucket's `metrics` dict is "
            "keyed by the dotted `path` of the corresponding `MetricSpec`."
        ),
    )
    #
    query: TracingQuery = Field(
        default_factory=TracingQuery,
        description="The resolved query used to compute the buckets.",
    )
    specs: List[MetricSpec] = Field(
        default=[],
        description="The resolved metric specs applied in each bucket.",
    )


class SessionsQueryRequest(BaseModel):
    """Request body for `POST /tracing/sessions/query`."""

    # True: use last_active (unstable), False/None: use first_active (stable)
    realtime: Optional[bool] = Field(
        default=None,
        description=(
            "When `true`, paginate by `last_active` (reflects ongoing "
            "activity but can shift between pages). When `false` or unset, "
            "paginate by the stable `first_active` cursor."
        ),
    )
    windowing: Optional[Windowing] = Field(
        default=None,
        description=(
            "Cursor pagination and time range. Pass the returned "
            "`windowing.next` on subsequent calls to continue iteration."
        ),
    )


class SessionIdsResponse(BaseModel):
    count: int = Field(default=0, description="Number of session IDs in this page.")
    session_ids: List[str] = Field(
        default=[],
        description="Distinct values of `ag.session.id` in this page.",
    )
    windowing: Optional[Windowing] = Field(
        default=None,
        description="Cursor for the next page. Pass verbatim as `windowing.next`.",
    )


class UsersQueryRequest(BaseModel):
    """Request body for `POST /tracing/users/query`."""

    # True: use last_active (unstable), False/None: use first_active (stable)
    realtime: Optional[bool] = Field(
        default=None,
        description=(
            "When `true`, paginate by `last_active`. When `false` or "
            "unset, paginate by the stable `first_active` cursor."
        ),
    )
    windowing: Optional[Windowing] = Field(
        default=None,
        description="Cursor pagination and time range.",
    )


class UserIdsResponse(BaseModel):
    count: int = Field(default=0, description="Number of user IDs in this page.")
    user_ids: List[str] = Field(
        default=[],
        description="Distinct values of `ag.user.id` in this page.",
    )
    windowing: Optional[Windowing] = Field(
        default=None,
        description="Cursor for the next page. Pass verbatim as `windowing.next`.",
    )
