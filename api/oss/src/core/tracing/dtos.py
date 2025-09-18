import random
import string
from enum import Enum
from datetime import datetime, timezone
from typing import List, Dict, Any, Union, Optional

from pydantic import BaseModel, model_validator, Field

from oss.src.core.shared.dtos import (
    Identifier,
    Lifecycle,
    Metrics,
    Json,
    Flags,
    Tags,
    Meta,
    Data,
    Reference,
    Hashes,
)


# 'ag.' attributes -------------------------------------------------------------


class TraceType(Enum):
    INVOCATION = "invocation"
    ANNOTATION = "annotation"
    #
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
    #
    UNKNOWN = "unknown"


class AgMetricEntryAttributes(BaseModel):
    # cumulative: 'cum' can't be used though
    cumulative: Optional[Metrics] = None
    # incremental 'inc' could be used, since 'unit' may be confusing
    incremental: Optional[Metrics] = None

    model_config = {"ser_json_exclude_none": True}


class AgMetricsAttributes(BaseModel):
    duration: Optional[AgMetricEntryAttributes] = None
    errors: Optional[AgMetricEntryAttributes] = None
    tokens: Optional[AgMetricEntryAttributes] = None
    costs: Optional[AgMetricEntryAttributes] = None

    model_config = {"ser_json_exclude_none": True}


class AgTypeAttributes(BaseModel):
    trace: Optional[TraceType] = TraceType.INVOCATION
    span: Optional[SpanType] = SpanType.TASK


class AgDataAttributes(BaseModel):
    parameters: Optional[Dict[str, Any]] = None
    inputs: Optional[Dict[str, Any]] = None
    outputs: Optional[Any] = None
    internals: Optional[Dict[str, Any]] = None

    model_config = {"ser_json_exclude_none": True}


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

    model_config = {"ser_json_exclude_none": True}


## --- SUB-ENTITIES --- ##


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


class TraceID(BaseModel):
    trace_id: str


class SpanID(BaseModel):
    span_id: str


class OTelHash(Identifier):
    attributes: Optional[OTelAttributes] = None


OTelHashes = List[OTelHash]


class OTelLink(TraceID, SpanID):
    attributes: Optional[OTelAttributes] = None


OTelLinks = List[OTelLink]


class OTelReference(Reference):
    attributes: Optional[OTelAttributes] = None


OTelReferences = List[OTelReference]


## --- ENTITIES --- ##


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

## --- QUERY --- ##


class Fields(str, Enum):
    TRACE_ID = "trace_id"
    TRACE_TYPE = "trace_type"
    SPAN_ID = "span_id"
    SPAN_TYPE = "span_type"
    PARENT_ID = "parent_id"
    SPAN_NAME = "span_name"
    SPAN_KIND = "span_kind"
    START_TIME = "start_time"
    END_TIME = "end_time"
    STATUS_CODE = "status_code"
    STATUS_MESSAGE = "status_message"
    ATTRIBUTES = "attributes"
    EVENTS = "events"
    LINKS = "links"
    REFERENCES = "references"
    CREATED_AT = "created_at"
    UPDATED_AT = "updated_at"
    DELETED_AT = "deleted_at"
    CREATED_BY_ID = "created_by_id"
    UPDATED_BY_ID = "updated_by_id"
    DELETED_BY_ID = "deleted_by_id"
    CONTENT = "content"


class LogicalOperator(str, Enum):
    AND = "and"
    OR = "or"
    NOT = "not"
    NAND = "nand"
    NOR = "nor"


class ComparisonOperator(str, Enum):
    IS = "is"
    IS_NOT = "is_not"


class NumericOperator(str, Enum):
    EQ = "eq"
    NEQ = "neq"
    GT = "gt"
    LT = "lt"
    GTE = "gte"
    LTE = "lte"
    BETWEEN = "btwn"


class StringOperator(str, Enum):
    STARTSWITH = "startswith"
    ENDSWITH = "endswith"
    CONTAINS = "contains"
    MATCHES = "matches"
    LIKE = "like"


class DictOperator(str, Enum):
    HAS = "has"
    HAS_NOT = "has_not"


class ListOperator(str, Enum):
    IN = "in"
    NOT_IN = "not_in"


class ExistenceOperator(str, Enum):
    EXISTS = "exists"
    NOT_EXISTS = "not_exists"


class TextOptions(BaseModel):
    case_sensitive: Optional[bool] = False
    exact_match: Optional[bool] = False


class ListOptions(BaseModel):
    all: Optional[bool] = False


class Condition(BaseModel):
    field: str
    key: Optional[str] = None
    value: Optional[Union[str, int, float, bool, list, dict]] = None
    operator: Optional[
        Union[
            ComparisonOperator,
            NumericOperator,
            StringOperator,
            ListOperator,
            DictOperator,
            ExistenceOperator,
        ]
    ] = ComparisonOperator.IS
    options: Optional[Union[TextOptions, ListOptions]] = None


class Filtering(BaseModel):
    operator: Optional[LogicalOperator] = LogicalOperator.AND
    conditions: List[Union[Condition, "Filtering"]] = list()


class Focus(str, Enum):
    TRACE = "trace"
    SPAN = "span"


class Format(str, Enum):
    AGENTA = "agenta"
    OPENTELEMETRY = "opentelemetry"


class Windowing(BaseModel):
    oldest: Optional[datetime] = None
    newest: Optional[datetime] = None
    limit: Optional[int] = None
    window: Optional[int] = None


class Formatting(BaseModel):
    focus: Optional[Focus] = Focus.SPAN
    format: Optional[Format] = Format.AGENTA


class Query(BaseModel):
    formatting: Optional[Formatting] = None
    windowing: Optional[Windowing] = None
    filtering: Optional[Filtering] = None


_C_OPS = list(ComparisonOperator)
_N_OPS = list(NumericOperator)
_S_OPS = list(StringOperator)
_L_OPS = list(ListOperator)
_D_OPS = list(DictOperator)
_E_OPS = list(ExistenceOperator)


class FilteringException(Exception):
    pass


class Analytics(BaseModel):
    count: Optional[int] = 0
    duration: Optional[float] = 0.0
    costs: Optional[float] = 0.0
    tokens: Optional[float] = 0.0

    def plus(self, other: "Analytics") -> "Analytics":
        self.count += other.count
        self.duration += other.duration
        self.costs += other.costs
        self.tokens += other.tokens

        return self


class Bucket(BaseModel):
    timestamp: datetime
    window: int
    total: Analytics
    errors: Analytics


# WORKFLOWS --------------------------------------------------------------------


Trace = OTelTraceTree
