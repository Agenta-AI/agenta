from typing import List, Dict, Any, Union, Optional, Sequence

from enum import Enum
from datetime import datetime, time
from uuid import UUID

from agenta_backend.core.shared.dtos import DisplayBase
from agenta_backend.core.shared.dtos import LifecycleDTO


## --- SUB-ENTITIES --- ##


class RootDTO(DisplayBase):
    id: UUID


class TreeType(Enum):
    # --- VARIANTS --- #
    INVOCATION = "invocation"
    # --- VARIANTS --- #


class TreeDTO(DisplayBase):
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
    COMPLETION = "completion"
    CHAT = "chat"
    RERANK = "rerank"
    # --- VARIANTS --- #


class NodeDTO(DisplayBase):
    id: UUID
    name: str
    type: Optional[NodeType] = None


class ParentDTO(DisplayBase):
    id: UUID


class TimeDTO(DisplayBase):
    start: datetime
    end: datetime


class StatusCode(Enum):
    UNSET = "UNSET"
    OK = "OK"
    ERROR = "ERROR"


class StatusDTO(DisplayBase):
    code: StatusCode
    message: Optional[str] = None

    class Config:
        use_enum_values = True


Attributes = Dict[str, Any]


class ExceptionDTO(DisplayBase):
    timestamp: datetime
    type: str
    message: Optional[str] = None
    stacktrace: Optional[str] = None
    attributes: Optional[Attributes] = None

    class Config:
        json_encoders = {datetime: lambda dt: dt.isoformat()}


Data = Dict[str, Any]
Metrics = Dict[str, Any]
Metadata = Dict[str, Any]
Refs = Dict[str, Any]


class LinkDTO(DisplayBase):
    type: TreeType  # Yes, this is correct
    id: UUID
    tree_id: Optional[UUID] = None

    class Config:
        use_enum_values = True


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


class OTelContextDTO(DisplayBase):
    trace_id: str
    span_id: str


class OTelEventDTO(DisplayBase):
    name: str
    timestamp: str

    attributes: Optional[Attributes] = None


class OTelLinkDTO(DisplayBase):
    context: OTelContextDTO

    attributes: Optional[Attributes] = None


class OTelExtraDTO(DisplayBase):
    kind: Optional[str] = None

    attributes: Optional[Attributes] = None
    events: Optional[List[OTelEventDTO]] = None
    links: Optional[List[OTelLinkDTO]] = None


## --- ENTITIES --- ##


class SpanDTO(DisplayBase):
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


class OTelSpanDTO(DisplayBase):
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


class WindowingDTO(DisplayBase):
    earliest: Optional[datetime] = None
    latest: Optional[datetime] = None


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


class TextOptionsDTO(DisplayBase):
    case_sensitive: Optional[bool] = False
    exact_match: Optional[bool] = False


class ConditionDTO(DisplayBase):
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


class FilteringDTO(DisplayBase):
    operator: Optional[LogicalOperator] = LogicalOperator.AND

    conditions: List[Union[ConditionDTO, "FilteringDTO"]]

    class Config:
        arbitrary_types_allowed = True


class Focus(Enum):
    ROOT = "root"  # SCENARIO
    TREE = "tree"  # TRACE
    NODE = "node"  # SPAN


class GroupingDTO(DisplayBase):
    focus: Focus = "node"
    # SET TO ROOT ? TO TREE ? TO NODE ?


class PaginationDTO(DisplayBase):
    page: int
    size: int


class QueryDTO(DisplayBase):
    grouping: Optional[GroupingDTO] = None
    windowing: Optional[WindowingDTO] = None
    filtering: Optional[FilteringDTO] = None
    pagination: Optional[PaginationDTO] = None
