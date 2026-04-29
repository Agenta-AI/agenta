from datetime import datetime, timezone
from enum import Enum
from typing import List, Dict, Any, Union, Optional
from uuid import uuid4

from pydantic import BaseModel, model_validator, Field

from agenta.sdk.models.shared import (
    Json,
    Data,
    Flags,
    Tags,
    Meta,
    Metrics,
    Lifecycle,
    Identifier,
    Reference,
    TraceID,
    SpanID,
)


class TraceType(Enum):
    INVOCATION = "invocation"
    ANNOTATION = "annotation"
    UNKNOWN = "unknown"


class SpanType(Enum):
    AGENT = "agent"
    CHAIN = "chain"
    WORKFLOW = "workflow"
    TASK = "task"
    TOOL = "tool"
    EMBEDDING = "embedding"
    QUERY = "query"
    LLM = "llm"
    COMPLETION = "completion"
    CHAT = "chat"
    RERANK = "rerank"
    UNKNOWN = "unknown"


class AgVectorMetricEntryAttributes(BaseModel):
    cumulative: Optional[Metrics] = None
    incremental: Optional[Metrics] = None

    model_config = {"ser_json_exclude_none": True}


class AgScalarMetricEntryAttributes(BaseModel):
    cumulative: Optional[Union[int, float]] = None
    incremental: Optional[Union[int, float]] = None

    model_config = {"ser_json_exclude_none": True}


AgMetricEntryAttributes = AgVectorMetricEntryAttributes


class AgMetricsAttributes(BaseModel):
    duration: Optional[AgScalarMetricEntryAttributes] = None
    errors: Optional[AgScalarMetricEntryAttributes] = None
    tokens: Optional[AgVectorMetricEntryAttributes] = None
    costs: Optional[AgVectorMetricEntryAttributes] = None

    model_config = {"ser_json_exclude_none": True}


class AgTypeAttributes(BaseModel):
    trace: Optional[TraceType] = TraceType.UNKNOWN
    span: Optional[SpanType] = SpanType.TASK


class AgDataAttributes(BaseModel):
    parameters: Optional[Dict[str, Any]] = None
    inputs: Optional[Dict[str, Any]] = None
    outputs: Optional[Any] = None
    internals: Optional[Dict[str, Any]] = None

    model_config = {"ser_json_exclude_none": True}


class AgSessionAttributes(BaseModel):
    id: Optional[str] = None

    model_config = {"ser_json_exclude_none": True}


class AgUserAttributes(BaseModel):
    id: Optional[str] = None

    model_config = {"ser_json_exclude_none": True}


class AgAttributes(BaseModel):
    type: AgTypeAttributes = Field(default_factory=AgTypeAttributes)
    data: AgDataAttributes = Field(default_factory=AgDataAttributes)

    session: Optional[AgSessionAttributes] = None
    user: Optional[AgUserAttributes] = None

    metrics: Optional[AgMetricsAttributes] = None
    flags: Optional[Flags] = None
    tags: Optional[Tags] = None
    meta: Optional[Meta] = None
    exception: Optional[Data] = None
    references: Optional[Dict[str, "OTelReference"]] = None
    unsupported: Optional[Data] = None

    model_config = {"ser_json_exclude_none": True}


class OTelStatusCode(Enum):
    STATUS_CODE_UNSET = "STATUS_CODE_UNSET"
    STATUS_CODE_OK = "STATUS_CODE_OK"
    STATUS_CODE_ERROR = "STATUS_CODE_ERROR"


class OTelSpanKind(Enum):
    SPAN_KIND_UNSPECIFIED = "SPAN_KIND_UNSPECIFIED"
    SPAN_KIND_INTERNAL = "SPAN_KIND_INTERNAL"
    SPAN_KIND_SERVER = "SPAN_KIND_SERVER"
    SPAN_KIND_CLIENT = "SPAN_KIND_CLIENT"
    SPAN_KIND_PRODUCER = "SPAN_KIND_PRODUCER"
    SPAN_KIND_CONSUMER = "SPAN_KIND_CONSUMER"


OTelAttributes = Json
OTelMetrics = Metrics
OTelTags = Tags
Attributes = OTelAttributes


class OTelEvent(BaseModel):
    name: str
    timestamp: Union[datetime, int]

    attributes: Optional[OTelAttributes] = None


OTelEvents = List[OTelEvent]


class OTelHash(Identifier):
    attributes: Optional[OTelAttributes] = None


OTelHashes = List[OTelHash]


class OTelLink(TraceID, SpanID):
    attributes: Optional[OTelAttributes] = None


OTelLinks = List[OTelLink]
Link = OTelLink
Links = OTelLinks


class OTelReference(Reference):
    attributes: Optional[OTelAttributes] = None


OTelReferences = List[OTelReference]


class SpansTree(BaseModel):
    spans: Optional[Dict[str, Union["SpansNode", List["SpansNode"]]]] = None


# Backward-compatible aliases for legacy names.
OTelSpansTree = SpansTree

SpansTrees = List[SpansTree]
OTelSpansTrees = SpansTrees


class Trace(TraceID, SpansTree):
    # Canonical single-trace model (trace_id + spans tree).
    pass


Traces = List[Trace]


class Span(Lifecycle):
    trace_id: str
    span_id: str
    parent_id: Optional[str] = None

    trace_type: Optional[TraceType] = None
    span_type: Optional[SpanType] = None

    span_kind: Optional[OTelSpanKind] = None
    span_name: Optional[str] = None

    start_time: Optional[Union[datetime, int]] = None
    end_time: Optional[Union[datetime, int]] = None

    status_code: Optional[OTelStatusCode] = None
    status_message: Optional[str] = None

    attributes: Optional[OTelAttributes] = None
    references: Optional[OTelReferences] = None
    links: Optional[OTelLinks] = None
    hashes: Optional[OTelHashes] = None

    exception: Optional[Data] = None

    events: Optional[OTelEvents] = None

    @model_validator(mode="after")
    def set_defaults(self):
        if self.trace_type is None:
            self.trace_type = TraceType.UNKNOWN
        if self.span_type is None:
            self.span_type = SpanType.TASK
        if self.span_kind is None:
            self.span_kind = OTelSpanKind.SPAN_KIND_UNSPECIFIED
        if self.status_code is None:
            self.status_code = OTelStatusCode.STATUS_CODE_UNSET
        if self.end_time is None and self.start_time is not None:
            self.end_time = self.start_time
        if self.start_time is None and self.end_time is not None:
            self.start_time = self.end_time
        if self.start_time is None and self.end_time is None:
            now = datetime.now(timezone.utc)
            self.start_time = now
            self.end_time = now
        if self.span_name is None:
            self.span_name = uuid4().hex[-12:]
        return self


class SpansNode(Span, SpansTree):
    pass


Spans = List[Span]
NestedSpans = Dict[str, Union[SpansNode, List[SpansNode]]]
TraceTree = Dict[str, SpansTree]
TraceTrees = List[TraceTree]

# Backward-compatible aliases for legacy names.
OTelFlatSpan = Span
OTelFlatSpans = Spans
OTelSpan = SpansNode
OTelNestedSpans = NestedSpans
OTelTraceTree = TraceTree
OTelTraceTrees = TraceTrees
OTelSpans = List[SpansNode]
