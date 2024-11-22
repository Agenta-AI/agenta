from typing import List, Dict, Any, Union, Optional
from enum import Enum
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from agenta_backend.core.shared.dtos import LifecycleDTO


## --- SUB-ENTITIES --- ##


class RootDTO(BaseModel):
    id: UUID


class TreeType(Enum):
    # --- VARIANTS --- #
    INVOCATION = "invocation"
    # --- VARIANTS --- #


class TreeDTO(BaseModel):
    id: UUID
    type: Optional[TreeType] = None


class NodeType(Enum):
    # --- VARIANTS --- #
    ## SPAN_KIND_SERVER
    AGENT = "agent"
    WORKFLOW = "workflow"
    CHAIN = "chain"
    ## SPAN_KIND_INTERNAL
    TASK = "task"
    ## SPAN_KIND_CLIENT
    TOOL = "tool"
    EMBEDDING = "embedding"
    QUERY = "query"
    COMPLETION = "completion"  # LEGACY
    CHAT = "chat"
    RERANK = "rerank"
    # --- VARIANTS --- #


class NodeDTO(BaseModel):
    id: UUID
    name: str
    type: Optional[NodeType] = None


class ParentDTO(BaseModel):
    id: UUID


class TimeDTO(BaseModel):
    start: datetime
    end: datetime


class StatusCode(Enum):
    UNSET = "UNSET"
    OK = "OK"
    ERROR = "ERROR"


class StatusDTO(BaseModel):
    code: StatusCode
    message: Optional[str] = None

    class Config:
        use_enum_values = True


Attributes = Dict[str, Any]


class ExceptionDTO(BaseModel):
    timestamp: datetime
    type: str
    message: Optional[str] = None
    stacktrace: Optional[str] = None
    attributes: Optional[Attributes] = None

    class Config:
        json_encoders = {
            UUID: lambda v: str(v),  # pylint: disable=unnecessary-lambda
            datetime: lambda dt: dt.isoformat(),
        }


Data = Dict[str, Any]
Metrics = Dict[str, Any]
Metadata = Dict[str, Any]
Refs = Dict[str, Any]


class LinkDTO(BaseModel):
    type: TreeType  # Yes, this is correct
    id: UUID  # node_id, this is correct
    tree_id: Optional[UUID] = None

    class Config:
        use_enum_values = True
        json_encoders = {
            UUID: lambda v: str(v),  # pylint: disable=unnecessary-lambda
        }


class OTelSpanKind(Enum):
    SPAN_KIND_UNSPECIFIED = "SPAN_KIND_UNSPECIFIED"
    # INTERNAL
    SPAN_KIND_INTERNAL = "SPAN_KIND_INTERNAL"
    # SYNCHRONOUS
    SPAN_KIND_SERVER = "SPAN_KIND_SERVER"
    SPAN_KIND_CLIENT = "SPAN_KIND_CLIENT"
    # ASYNCHRONOUS
    SPAN_KIND_PRODUCER = "SPAN_KIND_PRODUCER"
    SPAN_KIND_CONSUMER = "SPAN_KIND_CONSUMER"


class OTelStatusCode(Enum):
    STATUS_CODE_OK = "STATUS_CODE_OK"
    STATUS_CODE_ERROR = "STATUS_CODE_ERROR"
    STATUS_CODE_UNSET = "STATUS_CODE_UNSET"


class OTelContextDTO(BaseModel):
    trace_id: str
    span_id: str


class OTelEventDTO(BaseModel):
    name: str
    timestamp: str

    attributes: Optional[Attributes] = None


class OTelLinkDTO(BaseModel):
    context: OTelContextDTO

    attributes: Optional[Attributes] = None


class OTelExtraDTO(BaseModel):
    kind: Optional[str] = None

    attributes: Optional[Attributes] = None
    events: Optional[List[OTelEventDTO]] = None
    links: Optional[List[OTelLinkDTO]] = None


## --- ENTITIES --- ##


class SpanDTO(BaseModel):
    lifecycle: Optional[LifecycleDTO] = None

    root: RootDTO
    tree: TreeDTO
    node: NodeDTO

    parent: Optional[ParentDTO] = None

    time: TimeDTO
    status: StatusDTO

    exception: Optional[ExceptionDTO] = None

    data: Optional[Data] = None
    metrics: Optional[Metrics] = None
    meta: Optional[Metadata] = None
    refs: Optional[Refs] = None

    links: Optional[List[LinkDTO]] = None

    otel: Optional[OTelExtraDTO] = None

    nodes: Optional[Dict[str, Union["SpanDTO", List["SpanDTO"]]]] = None

    class Config:
        json_encoders = {
            UUID: lambda v: str(v),  # pylint: disable=unnecessary-lambda
            datetime: lambda dt: dt.isoformat(),
        }

    def encode(self, data: Any) -> Any:
        if isinstance(data, dict):
            return {k: self.encode(v) for k, v in data.items()}
        elif isinstance(data, list):
            return [self.encode(item) for item in data]
        for type_, encoder in self.Config.json_encoders.items():
            if isinstance(data, type_):
                return encoder(data)
        return data

    def model_dump(self, *args, **kwargs) -> dict:
        return self.encode(
            super().model_dump(
                *args,
                **kwargs,
                exclude_none=True,
            )
        )


class OTelSpanDTO(BaseModel):
    context: OTelContextDTO

    name: str
    kind: OTelSpanKind = OTelSpanKind.SPAN_KIND_UNSPECIFIED

    start_time: datetime
    end_time: datetime

    status_code: OTelStatusCode = OTelStatusCode.STATUS_CODE_UNSET
    status_message: Optional[str] = None

    attributes: Optional[Attributes] = None
    events: Optional[List[OTelEventDTO]] = None

    parent: Optional[OTelContextDTO] = None
    links: Optional[List[OTelLinkDTO]] = None


## --- QUERY --- ##


class WindowingDTO(BaseModel):
    oldest: Optional[datetime] = None
    newest: Optional[datetime] = None
    window: Optional[int] = None


class LogicalOperator(Enum):
    AND = "and"
    OR = "or"
    NOT = "not"


class ComparisonOperator(Enum):
    IS = "is"
    IS_NOT = "is_not"


class NumericOperator(Enum):
    EQ = "eq"
    NEQ = "neq"
    GT = "gt"
    LT = "lt"
    GTE = "gte"
    LTE = "lte"
    BETWEEN = "btwn"


class StringOperator(Enum):
    STARTSWITH = "startswith"
    ENDSWITH = "endswith"
    CONTAINS = "contains"
    MATCHES = "matches"
    LIKE = "like"


class ListOperator(Enum):
    IN = "in"


class ExistenceOperator(Enum):
    EXISTS = "exists"
    NOT_EXISTS = "not_exists"


class TextOptionsDTO(BaseModel):
    case_sensitive: Optional[bool] = False
    exact_match: Optional[bool] = False


class ConditionDTO(BaseModel):
    # column/field in a[.b[.c]] format
    # where a is the column name, and
    # b[.c] is the optional, and optionally nested, field name
    key: str

    value: Optional[Union[str, int, float, bool]] = None

    operator: Optional[
        Union[
            ComparisonOperator,
            NumericOperator,
            StringOperator,
            ListOperator,
            ExistenceOperator,
        ]
    ] = ComparisonOperator.IS

    options: Optional[TextOptionsDTO] = None


class FilteringDTO(BaseModel):
    operator: Optional[LogicalOperator] = LogicalOperator.AND

    conditions: List[Union[ConditionDTO, "FilteringDTO"]]

    class Config:
        arbitrary_types_allowed = True


class Focus(Enum):
    ROOT = "root"  # SCENARIO
    TREE = "tree"  # TRACE
    NODE = "node"  # SPAN


class GroupingDTO(BaseModel):
    focus: Focus = "node"


class PaginationDTO(BaseModel):
    page: Optional[int] = None
    size: Optional[int] = None

    next: Optional[datetime] = None
    stop: Optional[datetime] = None


class QueryDTO(BaseModel):
    grouping: Optional[GroupingDTO] = None
    windowing: Optional[WindowingDTO] = None
    filtering: Optional[FilteringDTO] = None
    pagination: Optional[PaginationDTO] = None


class AnalyticsDTO(BaseModel):
    grouping: Optional[GroupingDTO] = None
    windowing: Optional[WindowingDTO] = None
    filtering: Optional[FilteringDTO] = None


class MetricsDTO(BaseModel):
    count: Optional[int] = 0
    duration: Optional[float] = 0.0
    cost: Optional[float] = 0.0
    tokens: Optional[int] = 0

    def plus(self, other: "MetricsDTO") -> "MetricsDTO":
        self.count += other.count
        self.duration += other.duration
        self.cost += other.cost
        self.tokens += other.tokens

        return self


class BucketDTO(BaseModel):
    timestamp: datetime
    window: int
    total: MetricsDTO
    error: MetricsDTO
