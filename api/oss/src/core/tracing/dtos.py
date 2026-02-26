from typing import List, Dict, Union, Optional

from datetime import datetime
from enum import Enum

from pydantic import BaseModel

from oss.src.core.shared.dtos import (
    Lifecycle,
    Tags,
    Meta,
    Data,
    Reference,
    Windowing,
    FullJson,
    Link,
    Trace,  # noqa: F401
)


# Re-export canonical tracing models from SDK at the API core boundary.
from agenta.sdk.models.tracing import (  # noqa: F401
    TraceType,
    SpanType,
    AgMetricEntryAttributes,
    AgMetricsAttributes,
    AgTypeAttributes,
    AgDataAttributes,
    AgSessionAttributes,
    AgUserAttributes,
    AgAttributes,
    OTelStatusCode,
    OTelSpanKind,
    OTelAttributes,
    OTelMetrics,
    OTelTags,
    Attributes,
    OTelEvent,
    OTelEvents,
    TraceID,
    SpanID,
    OTelHash,
    OTelHashes,
    OTelLink,
    OTelLinks,
    OTelReference,
    OTelReferences,
    SpansTree,
    SpansTrees,
    Span,
    Spans,
    SpansNode,
    NestedSpans,
    TraceTree,
    TraceTrees,
    OTelSpansTree,
    OTelSpansTrees,
    OTelFlatSpan,
    OTelSpan,
    OTelFlatSpans,
    OTelNestedSpans,
    OTelTraceTree,
    OTelTraceTrees,
    OTelSpans,
)

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
    operator: LogicalOperator = LogicalOperator.AND
    conditions: List[Union[Condition, "Filtering"]] = list()


class Focus(str, Enum):
    TRACE = "trace"
    SPAN = "span"


class Format(str, Enum):
    AGENTA = "agenta"
    OPENTELEMETRY = "opentelemetry"


class Formatting(BaseModel):
    focus: Optional[Focus] = None
    format: Optional[Format] = None


class TracingQuery(BaseModel):
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


class QueryFocusConflictError(Exception):
    def __init__(self, detail: str):
        self.detail = detail
        super().__init__(detail)


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
    interval: int
    total: Analytics
    errors: Analytics


class MetricType(str, Enum):
    NUMERIC_CONTINUOUS = "numeric/continuous"
    NUMERIC_DISCRETE = "numeric/discrete"
    BINARY = "binary"
    CATEGORICAL_SINGLE = "categorical/single"
    CATEGORICAL_MULTIPLE = "categorical/multiple"
    STRING = "string"
    JSON = "json"
    NONE = "none"
    WILDCARD = "*"


class MetricSpec(BaseModel):
    type: MetricType = MetricType.NONE
    path: str = "*"
    # OPTS
    bins: Optional[int] = None
    vmin: Optional[float] = None
    vmax: Optional[float] = None
    edge: Optional[bool] = None


class MetricsBucket(BaseModel):
    timestamp: datetime
    interval: int
    metrics: Optional[Dict[str, FullJson]] = None


# SIMPLE TRACE: INVOCATIONS & ANNOTATIONS --------------------------------------


class SimpleTraceOrigin(str, Enum):
    CUSTOM = "custom"  # custom
    HUMAN = "human"  # human
    AUTO = "auto"  # automatic


class SimpleTraceKind(str, Enum):
    ADHOC = "adhoc"  # adhoc
    EVAL = "eval"  # evaluation
    PLAY = "play"  # playground


class SimpleTraceChannel(str, Enum):
    OTLP = "otlp"  # otlp
    WEB = "web"  # react
    SDK = "sdk"  # python vs typescript ?
    API = "api"  # http


class SimpleTraceReferences(BaseModel):
    query: Optional[Reference] = None
    query_variant: Optional[Reference] = None
    query_revision: Optional[Reference] = None
    testset: Optional[Reference] = None
    testset_variant: Optional[Reference] = None
    testset_revision: Optional[Reference] = None
    application: Optional[Reference] = None
    application_variant: Optional[Reference] = None
    application_revision: Optional[Reference] = None
    evaluator: Optional[Reference] = None
    evaluator_variant: Optional[Reference] = None
    evaluator_revision: Optional[Reference] = None
    testcase: Optional[Reference] = None


SimpleTraceLinks = Union[Dict[str, Link], List[Link]]


class SimpleTrace(Link, Lifecycle):
    origin: SimpleTraceOrigin = SimpleTraceOrigin.CUSTOM
    kind: SimpleTraceKind = SimpleTraceKind.ADHOC
    channel: SimpleTraceChannel = SimpleTraceChannel.API

    tags: Optional[Tags] = None
    meta: Optional[Meta] = None

    data: Data

    references: SimpleTraceReferences
    links: SimpleTraceLinks


class SimpleTraceCreate(BaseModel):
    origin: SimpleTraceOrigin = SimpleTraceOrigin.CUSTOM
    kind: SimpleTraceKind = SimpleTraceKind.ADHOC
    channel: SimpleTraceChannel = SimpleTraceChannel.API

    tags: Optional[Tags] = None
    meta: Optional[Meta] = None

    data: Data

    references: SimpleTraceReferences
    links: SimpleTraceLinks


class SimpleTraceEdit(BaseModel):
    tags: Optional[Tags] = None
    meta: Optional[Meta] = None

    data: Data


class SimpleTraceQuery(BaseModel):
    origin: Optional[SimpleTraceOrigin] = None
    kind: Optional[SimpleTraceKind] = None
    channel: Optional[SimpleTraceChannel] = None

    tags: Optional[Tags] = None
    meta: Optional[Meta] = None

    references: Optional[SimpleTraceReferences] = None
    links: Optional[SimpleTraceLinks] = None
