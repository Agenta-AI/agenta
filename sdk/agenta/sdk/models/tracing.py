import random
import string
from enum import Enum
from datetime import datetime, timezone
from typing import List, Dict, Any, Union, Optional

from pydantic import BaseModel, model_validator, Field


from agenta.sdk.models.shared import (
    Json,
    Data,
    Flags,
    Tags,
    Meta,
    Metrics,
    Lifecycle,
    TraceID,
    SpanID,
    Identifier,
    Reference,
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


class AgMetricEntryAttributes(BaseModel):
    cumulative: Optional[Metrics] = None
    incremental: Optional[Metrics] = None


class AgMetricsAttributes(BaseModel):
    duration: Optional[AgMetricEntryAttributes] = None
    errors: Optional[AgMetricEntryAttributes] = None
    tokens: Optional[AgMetricEntryAttributes] = None
    costs: Optional[AgMetricEntryAttributes] = None


class AgTypeAttributes(BaseModel):
    trace: Optional[TraceType] = TraceType.INVOCATION
    span: Optional[SpanType] = SpanType.TASK


class AgDataAttributes(BaseModel):
    inputs: Optional[Dict[str, Any]] = None
    outputs: Optional[Any] = None
    internals: Optional[Dict[str, Any]] = None


class AgAttributes(BaseModel):
    type: AgTypeAttributes = Field(default_factory=AgTypeAttributes)
    data: AgDataAttributes = Field(default_factory=AgDataAttributes)

    metrics: Optional[AgMetricsAttributes] = None
    flags: Optional[Flags] = None
    tags: Optional[Tags] = None
    meta: Optional[Meta] = None
    exception: Optional[Data] = None
    references: Optional[Dict[str, "OTelReference"]] = None
    unsupported: Optional[Data] = None


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


class OTelReference(Reference):
    attributes: Optional[OTelAttributes] = None


OTelReferences = List[OTelReference]


class OTelSpansTree(BaseModel):
    spans: Optional["OTelNestedSpans"] = None


OTelSpansTrees = List[OTelSpansTree]


class OTelFlatSpan(Lifecycle):
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
            self.trace_type = TraceType.INVOCATION
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
            self.span_name = "".join(
                random.choices(string.ascii_letters + string.digits, k=8)
            )
        return self


class OTelSpan(OTelFlatSpan, OTelSpansTree):
    pass


OTelFlatSpans = List[OTelFlatSpan]
OTelNestedSpans = Dict[str, Union[OTelSpan, List[OTelSpan]]]
OTelTraceTree = Dict[str, OTelSpansTree]
OTelTraceTrees = List[OTelTraceTree]
OTelSpans = List[OTelSpan]

Attributes = OTelAttributes
Trace = OTelTraceTree
