import random
import string
from enum import Enum
from uuid import UUID
from datetime import datetime, timezone
from typing import List, Dict, Any, Union, Optional

from pydantic import BaseModel, model_validator

from oss.src.core.shared.dtos import Tags, Metrics, Json, Lifecycle


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

    class Config:
        json_encoders = {datetime: lambda dt: dt.isoformat()}

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


OTelEvents = List[OTelEvent]


class TraceID(BaseModel):
    trace_id: str


class SpanID(BaseModel):
    span_id: str


class OTelLink(TraceID, SpanID):
    attributes: Optional[OTelAttributes] = None

    model_config = {
        "json_encoders": {
            UUID: lambda u: str(u),
        }
    }

    def encode(self, data: Any) -> Any:
        if isinstance(data, dict):
            return {k: self.encode(v) for k, v in data.items()}
        elif isinstance(data, list):
            return [self.encode(item) for item in data]
        for type_, encoder in self.model_config["json_encoders"].items():
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


OTelLinks = List[OTelLink]

Link = OTelLink
Links = OTelLinks

## --- ENTITIES --- ##


class OTelSpansTree(BaseModel):
    spans: Optional["OTelNestedSpans"] = None


OTelSpansTrees = List[OTelSpansTree]


class OTelFlatSpan(Lifecycle):
    trace_id: str
    span_id: str
    parent_id: Optional[str] = None

    span_kind: Optional[OTelSpanKind] = None
    span_name: Optional[str] = None

    start_time: Optional[Union[datetime, int]] = None
    end_time: Optional[Union[datetime, int]] = None

    status_code: Optional[OTelStatusCode] = None
    status_message: Optional[str] = None

    attributes: Optional[OTelAttributes] = None
    events: Optional[OTelEvents] = None
    links: Optional[OTelLinks] = None

    class Config:
        json_encoders = {
            datetime: lambda dt: dt.isoformat(),
            Enum: lambda e: e.value,
            UUID: lambda u: str(u),
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

    @model_validator(mode="after")
    def set_defaults(self):
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
    SPAN_ID = "span_id"
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
