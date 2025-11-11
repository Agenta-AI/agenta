from enum import Enum
from uuid import UUID, uuid4
from re import match
from datetime import datetime
from typing import Dict, List, Optional, Union, Literal, Callable, Any, TypeAliasType

from pydantic import BaseModel, field_validator, Field

# oss.src.core.shared.dtos -----------------------------------------------------

from typing import Optional, Dict, List, Union, Literal
from uuid import UUID
from datetime import datetime
from re import match

from pydantic import BaseModel, field_validator

from typing_extensions import TypeAliasType


BoolJson: TypeAliasType = TypeAliasType(  # type: ignore
    "BoolJson",
    Union[bool, Dict[str, "BoolJson"]],  # type: ignore
)

StringJson: TypeAliasType = TypeAliasType(  # type: ignore
    "StringJson",
    Union[str, Dict[str, "StringJson"]],  # type: ignore
)

FullJson: TypeAliasType = TypeAliasType(  # type: ignore
    "FullJson",
    Union[str, int, float, bool, None, Dict[str, "FullJson"], List["FullJson"]],  # type: ignore
)

NumericJson: TypeAliasType = TypeAliasType(  # type: ignore
    "NumericJson",
    Union[int, float, Dict[str, "NumericJson"]],  # type: ignore
)

NoListJson: TypeAliasType = TypeAliasType(  # type: ignore
    "NoListJson",
    Union[str, int, float, bool, None, Dict[str, "NoListJson"]],  # type: ignore
)

Json = Dict[str, FullJson]  # type: ignore

Data = Dict[str, FullJson]  # type: ignore

Flags = Dict[str, bool | str]

Tags = Dict[str, NoListJson]  # type: ignore

Meta = Dict[str, FullJson]  # type: ignore

Hashes = Dict[str, StringJson]  # type: ignore


class Metadata(BaseModel):
    flags: Optional[Flags] = None  # type: ignore
    meta: Optional[Meta] = None  # type: ignore
    tags: Optional[Tags] = None  # type: ignore


class Windowing(BaseModel):
    # RANGE
    newest: Optional[datetime] = None
    oldest: Optional[datetime] = None
    # TOKEN
    next: Optional[UUID] = None
    # LIMIT
    limit: Optional[int] = None
    # ORDER
    order: Optional[Literal["ascending", "descending"]] = None
    # SAMPLES
    rate: Optional[float] = None
    # BUCKETS
    interval: Optional[int] = None

    @field_validator("rate")
    def check_rate(cls, v):
        if v is not None and (v < 0.0 or v > 1.0):
            raise ValueError("Sampling rate must be between 0.0 and 1.0.")
        return v

    @field_validator("interval")
    def check_interval(cls, v):
        if v is not None and v <= 0:
            raise ValueError("Bucket interval must be a positive integer.")
        return v


class Lifecycle(BaseModel):
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    deleted_at: Optional[datetime] = None

    created_by_id: Optional[UUID] = None
    updated_by_id: Optional[UUID] = None
    deleted_by_id: Optional[UUID] = None


class TraceID(BaseModel):
    trace_id: Optional[str] = None


class SpanID(BaseModel):
    span_id: Optional[str] = None


class Identifier(BaseModel):
    id: Optional[UUID] = None


class Slug(BaseModel):
    slug: Optional[str] = None

    @field_validator("slug")
    def check_url_safety(cls, v):
        if v is not None:
            if not match(r"^[a-zA-Z0-9_-]+$", v):
                raise ValueError("slug must be URL-safe.")
        return v


class Version(BaseModel):
    version: Optional[str] = None


class Reference(Identifier, Slug, Version):
    pass


class Link(TraceID, SpanID):
    pass


class Header(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class Commit(BaseModel):
    author: Optional[UUID] = None
    date: Optional[datetime] = None
    message: Optional[str] = None


def sync_alias(primary: str, alias: str, instance: BaseModel) -> None:
    primary_val = getattr(instance, primary)
    alias_val = getattr(instance, alias)
    if primary_val and alias_val is None:
        object.__setattr__(instance, alias, primary_val)
    elif alias_val and primary_val is None:
        object.__setattr__(instance, primary, alias_val)


class AliasConfig(BaseModel):
    model_config = {
        "populate_by_name": True,
        "from_attributes": True,
    }


Metrics = Dict[str, NumericJson]  # type: ignore


class LegacyLifecycleDTO(BaseModel):
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    updated_by_id: Optional[str] = None
    # DEPRECATING
    updated_by: Optional[str] = None  # email


class Status(BaseModel):
    code: Optional[int] = 500
    type: Optional[str] = None
    message: Optional[str] = "An unexpected error occurred. Please try again later."
    stacktrace: Optional[str] = None


Mappings = Dict[str, str]

Schema = Dict[str, FullJson]  # type: ignore

# ------------------------------------------------------------------------------

# oss.src.core.git.dtos --------------------------------------------------------

from typing import Optional, List
from uuid import UUID

from pydantic import BaseModel


# artifacts --------------------------------------------------------------------


class Artifact(Identifier, Slug, Lifecycle, Header, Metadata):
    pass


class ArtifactCreate(Slug, Header, Metadata):
    pass


class ArtifactEdit(Identifier, Header, Metadata):
    pass


class ArtifactQuery(Metadata):
    pass


# variants ---------------------------------------------------------------------


class Variant(Identifier, Slug, Lifecycle, Header, Metadata):
    artifact_id: Optional[UUID] = None


class VariantCreate(Slug, Header, Metadata):
    artifact_id: Optional[UUID] = None


class VariantEdit(Identifier, Header, Metadata):
    pass


class VariantQuery(Metadata):
    pass


# revisions --------------------------------------------------------------------


class Revision(Identifier, Slug, Version, Lifecycle, Header, Metadata, Commit):
    data: Optional[Data] = None

    artifact_id: Optional[UUID] = None
    variant_id: Optional[UUID] = None


class RevisionCreate(Slug, Header, Metadata):
    artifact_id: Optional[UUID] = None
    variant_id: Optional[UUID] = None


class RevisionEdit(Identifier, Header, Metadata):
    pass


class RevisionQuery(Metadata):
    authors: Optional[List[UUID]] = None


class RevisionCommit(Slug, Header, Metadata):
    data: Optional[Data] = None

    message: Optional[str] = None

    artifact_id: Optional[UUID] = None
    variant_id: Optional[UUID] = None


class RevisionsLog(BaseModel):
    artifact_id: Optional[UUID] = None
    variant_id: Optional[UUID] = None
    revision_id: Optional[UUID] = None

    depth: Optional[int] = None


# forks ------------------------------------------------------------------------


class RevisionFork(Slug, Header, Metadata):
    data: Optional[Data] = None

    message: Optional[str] = None


class VariantFork(Slug, Header, Metadata):
    pass


class ArtifactFork(RevisionsLog):
    variant: Optional[VariantFork] = None
    revision: Optional[RevisionFork] = None


# ------------------------------------------------------------------------------


Origin = Literal["custom", "human", "auto"]
# Target = Union[List[UUID], Dict[UUID, Origin], List[Callable]]
Target = Union[
    List[List[Dict[str, Any]]],  # testcases_data
    List[Callable],  # workflow_handlers
    List[UUID],  # entity_ids
    Dict[UUID, Origin],  # entity_ids with origins
]


# oss.src.core.evaluations.types


class EvaluationStatus(str, Enum):
    PENDING = "pending"
    QUEUED = "queued"
    RUNNING = "running"
    SUCCESS = "success"
    FAILURE = "failure"
    ERRORS = "errors"
    CANCELLED = "cancelled"


class EvaluationRunFlags(BaseModel):
    is_closed: Optional[bool] = None  # Indicates if the run is modifiable
    is_live: Optional[bool] = None  # Indicates if the run has live queries
    is_active: Optional[bool] = None  # Indicates if the run is currently active


class SimpleEvaluationFlags(EvaluationRunFlags):
    pass


SimpleEvaluationStatus = EvaluationStatus


class SimpleEvaluationData(BaseModel):
    status: Optional[SimpleEvaluationStatus] = None

    query_steps: Optional[Target] = None
    testset_steps: Optional[Target] = None
    application_steps: Optional[Target] = None
    evaluator_steps: Optional[Target] = None

    repeats: Optional[int] = None


class EvaluationRun(BaseModel):
    id: UUID


class EvaluationScenario(BaseModel):
    id: UUID

    run_id: UUID


class EvaluationResult(BaseModel):
    id: UUID

    run_id: UUID
    scenario_id: UUID
    step_key: str

    testcase_id: Optional[UUID] = None
    trace_id: Optional[UUID] = None
    error: Optional[dict] = None

    flags: Optional[Dict[str, Any]] = None
    tags: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None


class EvaluationMetrics(Identifier, Lifecycle):
    flags: Optional[Dict[str, Any]] = None
    tags: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None

    status: Optional[EvaluationStatus] = None

    timestamp: Optional[datetime] = None
    interval: Optional[int] = None

    data: Optional[Data] = None

    scenario_id: Optional[UUID] = None

    run_id: UUID


# oss.src.core.tracing.dtos

import random
import string
from enum import Enum
from datetime import datetime, timezone
from typing import List, Dict, Any, Union, Optional, Literal
from uuid import UUID

from pydantic import BaseModel, model_validator, Field


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
    flags: Optional[Flags] = None  # type: ignore
    tags: Optional[Tags] = None  # type: ignore
    meta: Optional[Meta] = None  # type: ignore
    exception: Optional[Data] = None  # type: ignore
    references: Optional[Dict[str, "OTelReference"]] = None
    unsupported: Optional[Data] = None  # type: ignore

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


OTelAttributes = Json  # type: ignore
OTelMetrics = Metrics  # type: ignore
OTelTags = Tags  # type: ignore

Attributes = OTelAttributes  # type: ignore


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

    exception: Optional[Data] = None  # type: ignore

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


class Formatting(BaseModel):
    focus: Optional[Focus] = Focus.SPAN
    format: Optional[Format] = Format.AGENTA


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


Trace = OTelSpansTree

# oss.src.core.observability.dtos

from enum import Enum
from uuid import UUID
from datetime import datetime
from typing import List, Dict, Any, Union, Optional

from pydantic import BaseModel


## --- SUB-ENTITIES --- ##


class RootDTO(BaseModel):
    id: UUID


class TreeType(Enum):
    INVOCATION = "invocation"
    ANNOTATION = "annotation"
    #
    UNKNOWN = "unknown"


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
Meta = Dict[str, Any]
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
    trace_id: str
    span_id: str

    lifecycle: Optional[LegacyLifecycleDTO] = None

    root: RootDTO
    tree: TreeDTO
    node: NodeDTO

    parent: Optional[ParentDTO] = None

    time: TimeDTO
    status: StatusDTO

    exception: Optional[ExceptionDTO] = None

    data: Optional[Data] = None
    metrics: Optional[Metrics] = None
    meta: Optional[Meta] = None
    refs: Optional[Refs] = None

    links: Optional[List[LinkDTO]] = None

    otel: Optional[OTelExtraDTO] = None

    nodes: Optional[Dict[str, Union["SpanDTO", List["SpanDTO"]]]] = None

    model_config = {
        "json_encoders": {
            UUID: lambda v: str(v),
            datetime: lambda dt: dt.isoformat(),
        },
    }

    def encode(self, data: Any) -> Any:
        if isinstance(data, dict):
            return {k: self.encode(v) for k, v in data.items()}
        elif isinstance(data, list):
            return [self.encode(item) for item in data]
        for type_, encoder in self.model_config["json_encoders"].items():  # type: ignore
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


# oss.src.apis.fastapi.observability.models

from typing import List, Optional
from datetime import datetime


class AgentaNodeDTO(SpanDTO):
    pass


class Tree(BaseModel):
    version: str
    nodes: List[AgentaNodeDTO]


# oss.src.core.blobs.dtos


class Blob(Identifier, Lifecycle):
    flags: Optional[Flags] = None  # type: ignore
    tags: Optional[Tags] = None  # type: ignore
    meta: Optional[Meta] = None  # type: ignore

    data: Optional[Data] = None  # type: ignore

    set_id: Optional[UUID] = None


# oss.src.core.testcases.dtos
# oss.src.core.testsets.dtos


class TestsetIdAlias(AliasConfig):
    testset_id: Optional[UUID] = None
    set_id: Optional[UUID] = Field(
        default=None,
        exclude=True,
        alias="testset_id",
    )


class TestsetVariantIdAlias(AliasConfig):
    testset_variant_id: Optional[UUID] = None
    variant_id: Optional[UUID] = Field(
        default=None,
        exclude=True,
        alias="testset_variant_id",
    )


class Testcase(Blob, TestsetIdAlias):
    def model_post_init(self, __context) -> None:
        sync_alias("testset_id", "set_id", self)


class TestsetFlags(BaseModel):
    has_testcases: Optional[bool] = None
    has_traces: Optional[bool] = None


class TestsetRevisionData(BaseModel):
    testcase_ids: Optional[List[UUID]] = None
    testcases: Optional[List[Testcase]] = None


class SimpleTestset(
    Identifier,
    Slug,
    Lifecycle,
    Header,
):
    flags: Optional[TestsetFlags] = None
    tags: Optional[Tags] = None  # type: ignore
    meta: Optional[Meta] = None  # type: ignore

    data: Optional[TestsetRevisionData] = None


class Testset(Artifact):
    flags: Optional[TestsetFlags] = None  # type: ignore


class TestsetRevision(
    Revision,
    TestsetIdAlias,
    TestsetVariantIdAlias,
):
    flags: Optional[TestsetFlags] = None  # type: ignore

    data: Optional[TestsetRevisionData] = None  # type: ignore

    def model_post_init(self, __context) -> None:
        sync_alias("testset_id", "artifact_id", self)
        sync_alias("testset_variant_id", "variant_id", self)


class SimpleTestsetCreate(Slug, Header):
    tags: Optional[Tags] = None  # type: ignore
    meta: Optional[Meta] = None  # type: ignore
    data: Optional[TestsetRevisionData] = None


class SimpleTestsetEdit(
    Identifier,
    Header,
):
    # flags: Optional[TestsetFlags] = None
    tags: Optional[Tags] = None  # type: ignore
    meta: Optional[Meta] = None  # type: ignore

    data: Optional[TestsetRevisionData] = None


class TestsetResponse(BaseModel):
    count: int = 0
    testset: Optional[Testset] = None


class TestsetRevisionResponse(BaseModel):
    count: int = 0
    testset_revision: Optional[TestsetRevision] = None


class SimpleTestsetResponse(BaseModel):
    count: int = 0
    testset: Optional[SimpleTestset] = None


# oss.src.core.workflows.dtos
from typing import Optional, Dict, Any
from uuid import UUID, uuid4
from urllib.parse import urlparse

from pydantic import (
    BaseModel,
    Field,
    model_validator,
    ValidationError,
)

from jsonschema import (
    Draft202012Validator,
    Draft201909Validator,
    Draft7Validator,
    Draft4Validator,
    Draft6Validator,
)
from jsonschema.exceptions import SchemaError

# aliases ----------------------------------------------------------------------


class WorkflowIdAlias(AliasConfig):
    workflow_id: Optional[UUID] = None
    artifact_id: Optional[UUID] = Field(
        default=None,
        exclude=True,
        alias="workflow_id",
    )


class WorkflowVariantIdAlias(AliasConfig):
    workflow_variant_id: Optional[UUID] = None
    variant_id: Optional[UUID] = Field(
        default=None,
        exclude=True,
        alias="workflow_variant_id",
    )


class WorkflowRevisionIdAlias(AliasConfig):
    workflow_revision_id: Optional[UUID] = None
    revision_id: Optional[UUID] = Field(
        default=None,
        exclude=True,
        alias="workflow_revision_id",
    )


# globals ----------------------------------------------------------------------


class WorkflowFlags(BaseModel):
    is_custom: Optional[bool] = None
    is_evaluator: Optional[bool] = None
    is_human: Optional[bool] = None


# workflows --------------------------------------------------------------------


class Workflow(Artifact):
    flags: Optional[WorkflowFlags] = None


class WorkflowCreate(ArtifactCreate):
    flags: Optional[WorkflowFlags] = None


class WorkflowEdit(ArtifactEdit):
    flags: Optional[WorkflowFlags] = None


# workflow variants ------------------------------------------------------------


class WorkflowVariant(
    Variant,
    WorkflowIdAlias,
):
    flags: Optional[WorkflowFlags] = None

    def model_post_init(self, __context) -> None:
        sync_alias("workflow_id", "artifact_id", self)


class WorkflowVariantCreate(
    VariantCreate,
    WorkflowIdAlias,
):
    flags: Optional[WorkflowFlags] = None

    def model_post_init(self, __context) -> None:
        sync_alias("workflow_id", "artifact_id", self)


class WorkflowVariantEdit(VariantEdit):
    flags: Optional[WorkflowFlags] = None


class WorkflowVariantQuery(VariantQuery):
    flags: Optional[WorkflowFlags] = None


# workflow revisions -----------------------------------------------------------


class WorkflowServiceVersion(BaseModel):
    version: Optional[str] = None


class WorkflowServiceInterface(WorkflowServiceVersion):
    uri: Optional[str] = None  # str (Enum) w/ validation
    url: Optional[str] = None  # str w/ validation
    headers: Optional[Dict[str, Reference | str]] = None  # either hardcoded or a secret
    handler: Optional[Callable] = None

    schemas: Optional[Dict[str, Schema]] = None  # json-schema instead of pydantic
    mappings: Optional[Mappings] = None  # used in the workflow interface


class WorkflowServiceConfiguration(WorkflowServiceInterface):
    script: Optional[str] = None  # str w/ validation
    parameters: Optional[Data] = None  # configuration values


class WorkflowRevisionData(WorkflowServiceConfiguration):
    # LEGACY FIELDS
    service: Optional[dict] = None  # url, schema, kind, etc
    configuration: Optional[dict] = None  # parameters, variables, etc

    @model_validator(mode="after")
    def validate_all(self) -> "WorkflowRevisionData":
        errors = []

        if self.service and self.service.get("agenta") and self.service.get("format"):
            _format = self.service.get("format")  # pylint: disable=redefined-builtin

            try:
                validator_class = self._get_validator_class_from_schema(_format)  # type: ignore
                validator_class.check_schema(_format)  # type: ignore
            except SchemaError as e:
                errors.append(
                    {
                        "loc": ("format",),
                        "msg": f"Invalid JSON Schema: {e.message}",
                        "type": "value_error",
                        "ctx": {"error": str(e)},
                        "input": _format,
                    }
                )

        if self.service and self.service.get("agenta") and self.service.get("url"):
            url = self.service.get("url")

            if not self._is_valid_http_url(url):
                errors.append(
                    {
                        "loc": ("url",),
                        "msg": "Invalid HTTP(S) URL",
                        "type": "value_error.url",
                        "ctx": {"error": "Invalid URL format"},
                        "input": url,
                    }
                )

        if errors:
            raise ValidationError.from_exception_data(
                self.__class__.__name__,
                errors,
            )

        return self

    @staticmethod
    def _get_validator_class_from_schema(schema: dict):
        """Detect JSON Schema draft from $schema or fallback to 2020-12."""
        schema_uri = schema.get(
            "$schema", "https://json-schema.org/draft/2020-12/schema"
        )

        if "2020-12" in schema_uri:
            return Draft202012Validator
        elif "2019-09" in schema_uri:
            return Draft201909Validator
        elif "draft-07" in schema_uri:
            return Draft7Validator
        elif "draft-06" in schema_uri:
            return Draft6Validator
        elif "draft-04" in schema_uri:
            return Draft4Validator
        else:
            # fallback default if unknown $schema
            return Draft202012Validator

    @staticmethod
    def _is_valid_http_url(url: str) -> bool:
        parsed = urlparse(url)
        return parsed.scheme in ("http", "https") and bool(parsed.netloc)


class WorkflowRevision(
    Revision,
    WorkflowIdAlias,
    WorkflowVariantIdAlias,
):
    flags: Optional[WorkflowFlags] = None

    data: Optional[WorkflowRevisionData] = None

    def model_post_init(self, __context) -> None:
        sync_alias("workflow_id", "artifact_id", self)
        sync_alias("workflow_variant_id", "variant_id", self)


class WorkflowRevisionCreate(
    RevisionCreate,
    WorkflowIdAlias,
    WorkflowVariantIdAlias,
):
    flags: Optional[WorkflowFlags] = None

    def model_post_init(self, __context) -> None:
        sync_alias("workflow_id", "artifact_id", self)
        sync_alias("workflow_variant_id", "variant_id", self)


class WorkflowRevisionEdit(RevisionEdit):
    flags: Optional[WorkflowFlags] = None


class WorkflowRevisionQuery(RevisionQuery):
    flags: Optional[WorkflowFlags] = None


class WorkflowRevisionCommit(
    RevisionCommit,
    WorkflowIdAlias,
    WorkflowVariantIdAlias,
):
    flags: Optional[WorkflowFlags] = None

    data: Optional[WorkflowRevisionData] = None

    def model_post_init(self, __context) -> None:
        sync_alias("workflow_id", "artifact_id", self)
        sync_alias("workflow_variant_id", "variant_id", self)


class WorkflowRevisionsLog(
    RevisionsLog,
    WorkflowIdAlias,
    WorkflowVariantIdAlias,
    WorkflowRevisionIdAlias,
):
    def model_post_init(self, __context) -> None:
        sync_alias("workflow_id", "artifact_id", self)
        sync_alias("workflow_variant_id", "variant_id", self)
        sync_alias("workflow_revision_id", "revision_id", self)


# forks ------------------------------------------------------------------------


class WorkflowRevisionFork(RevisionFork):
    flags: Optional[WorkflowFlags] = None

    data: Optional[WorkflowRevisionData] = None


class WorkflowRevisionForkAlias(AliasConfig):
    workflow_revision: Optional[WorkflowRevisionFork] = None

    revision: Optional[RevisionFork] = Field(
        default=None,
        exclude=True,
        alias="workflow_revision",
    )


class WorkflowVariantFork(VariantFork):
    flags: Optional[WorkflowFlags] = None


class WorkflowVariantForkAlias(AliasConfig):
    workflow_variant: Optional[WorkflowVariantFork] = None

    variant: Optional[VariantFork] = Field(
        default=None,
        exclude=True,
        alias="workflow_variant",
    )


class WorkflowFork(
    ArtifactFork,
    WorkflowIdAlias,
    WorkflowVariantIdAlias,
    WorkflowVariantForkAlias,
    WorkflowRevisionIdAlias,
    WorkflowRevisionForkAlias,
):
    def model_post_init(self, __context) -> None:
        sync_alias("workflow_id", "artifact_id", self)
        sync_alias("workflow_variant_id", "variant_id", self)
        sync_alias("workflow_variant", "variant", self)
        sync_alias("workflow_revision_id", "revision_id", self)
        sync_alias("workflow_revision", "revision", self)


# workflow services ------------------------------------------------------------


class WorkflowServiceData(BaseModel):
    parameters: Optional[Data] = None
    inputs: Optional[Data] = None
    outputs: Optional[Data | str] = None
    #
    trace_parameters: Optional[Data] = None
    trace_inputs: Optional[Data] = None
    trace_outputs: Optional[Data | str] = None
    #
    trace: Optional[Trace] = None
    # LEGACY -- used for workflow execution traces
    tree: Optional[Tree] = None


class WorkflowServiceRequest(Version, Metadata):
    tags: Optional[Tags] = None
    meta: Optional[Meta] = None

    data: Optional[WorkflowServiceData] = None

    references: Optional[Dict[str, Reference]] = None
    links: Optional[Dict[str, Link]] = None

    credentials: Optional[str] = None  # Fix typing
    secrets: Optional[Dict[str, Any]] = None  # Fix typing


class WorkflowServiceResponse(Identifier, Version):
    data: Optional[WorkflowServiceData] = None

    links: Optional[Dict[str, Link]] = None

    trace_id: Optional[str] = None

    status: Status = Status()

    def __init__(self, **data):
        super().__init__(**data)

        self.id = uuid4() if not self.id else self.id
        self.version = "2025.07.14" if not self.version else self.version


class SuccessStatus(Status):
    code: int = 200


class HandlerNotFoundStatus(Status):
    code: int = 501
    type: str = "https://docs.agenta.ai/errors#v1:uri:handler-not-found"

    def __init__(self, uri: Optional[str] = None):
        super().__init__()
        self.message = f"The handler at '{uri}' is not implemented or not available."


class RevisionDataNotFoundStatus(Status):
    code: int = 404
    type: str = "https://docs.agenta.ai/errors#v1:uri:revision-data-not-found"

    def __init__(self, uri: Optional[str] = None):
        super().__init__()
        self.message = f"The revision data at '{uri}' could not be found."


class RequestDataNotFoundStatus(Status):
    code: int = 404
    type: str = "https://docs.agenta.ai/errors#v1:uri:request-data-not-found"

    def __init__(self, uri: Optional[str] = None):
        super().__init__()
        self.message = f"The request data at '{uri}' could not be found."


ERRORS_BASE_URL = "https://docs.agenta.ai/errors"


class ErrorStatus(Exception):
    code: int
    type: str
    message: str
    stacktrace: Optional[str] = None

    def __init__(
        self,
        code: int,
        type: str,
        message: str,
        stacktrace: Optional[str] = None,
    ):
        super().__init__()
        self.code = code
        self.type = type
        self.message = message
        self.stacktrace = stacktrace

    def __str__(self):
        return f"[EVAL]       {self.code} - {self.message} ({self.type})" + (
            f"\nStacktrace: {self.stacktrace}" if self.stacktrace else ""
        )

    def __repr__(self):
        return f"ErrorStatus(code={self.code}, type='{self.type}', message='{self.message}')"


# ------------------------------------------------------------------------------


class EvaluatorRevision(BaseModel):
    id: Optional[UUID] = None
    slug: Optional[str] = None
    version: Optional[str] = None

    data: Optional[WorkflowRevisionData] = None


class ApplicationServiceRequest(WorkflowServiceRequest):
    pass


class ApplicationServiceResponse(WorkflowServiceResponse):
    pass


class EvaluatorServiceRequest(WorkflowServiceRequest):
    pass


class EvaluatorServiceResponse(WorkflowServiceResponse):
    pass


# oss.src.core.evaluators.dtos


class EvaluatorIdAlias(AliasConfig):
    evaluator_id: Optional[UUID] = None
    workflow_id: Optional[UUID] = Field(
        default=None,
        exclude=True,
        alias="evaluator_id",
    )


class EvaluatorVariantIdAlias(AliasConfig):
    evaluator_variant_id: Optional[UUID] = None
    workflow_variant_id: Optional[UUID] = Field(
        default=None,
        exclude=True,
        alias="evaluator_variant_id",
    )


class EvaluatorRevisionData(WorkflowRevisionData):
    pass


class EvaluatorFlags(WorkflowFlags):
    def __init__(self, **data):
        data["is_evaluator"] = True

        super().__init__(**data)


class SimpleEvaluatorFlags(EvaluatorFlags):
    pass


class SimpleEvaluatorData(EvaluatorRevisionData):
    pass


class Evaluator(Workflow):
    flags: Optional[EvaluatorFlags] = None


class SimpleEvaluatorRevision(
    WorkflowRevision,
    EvaluatorIdAlias,
    EvaluatorVariantIdAlias,
):
    flags: Optional[EvaluatorFlags] = None

    data: Optional[EvaluatorRevisionData] = None


class SimpleEvaluator(Identifier, Slug, Lifecycle, Header, Metadata):
    flags: Optional[SimpleEvaluatorFlags] = None

    data: Optional[SimpleEvaluatorData] = None


class SimpleEvaluatorCreate(Slug, Header, Metadata):
    flags: Optional[SimpleEvaluatorFlags] = None

    data: Optional[SimpleEvaluatorData] = None


class SimpleEvaluatorEdit(Identifier, Header, Metadata):
    flags: Optional[SimpleEvaluatorFlags] = None

    data: Optional[SimpleEvaluatorData] = None


class SimpleEvaluatorResponse(BaseModel):
    count: int = 0
    evaluator: Optional[SimpleEvaluator] = None


class EvaluatorRevisionResponse(BaseModel):
    count: int = 0
    evaluator_revision: Optional[EvaluatorRevision] = None


# oss.src.core.applications.dtos

# aliases ----------------------------------------------------------------------


class ApplicationIdAlias(AliasConfig):
    application_id: Optional[UUID] = None
    workflow_id: Optional[UUID] = Field(
        default=None,
        exclude=True,
        alias="application_id",
    )


class ApplicationVariantIdAlias(AliasConfig):
    application_variant_id: Optional[UUID] = None
    workflow_variant_id: Optional[UUID] = Field(
        default=None,
        exclude=True,
        alias="application_variant_id",
    )


class ApplicationRevisionIdAlias(AliasConfig):
    application_revision_id: Optional[UUID] = None
    workflow_revision_id: Optional[UUID] = Field(
        default=None,
        exclude=True,
        alias="application_revision_id",
    )


# globals ----------------------------------------------------------------------


class ApplicationFlags(WorkflowFlags):
    def __init__(self, **data):
        data["is_evaluator"] = True

        super().__init__(**data)


# applications -------------------------------------------------------------------


class Application(Workflow):
    flags: Optional[ApplicationFlags] = None


class ApplicationCreate(WorkflowCreate):
    flags: Optional[ApplicationFlags] = None


class ApplicationEdit(WorkflowEdit):
    flags: Optional[ApplicationFlags] = None


# application variants -----------------------------------------------------------


class ApplicationVariant(
    WorkflowVariant,
    ApplicationIdAlias,
):
    flags: Optional[ApplicationFlags] = None

    def model_post_init(self, __context) -> None:
        sync_alias("application_id", "workflow_id", self)


class ApplicationVariantCreate(
    WorkflowVariantCreate,
    ApplicationIdAlias,
):
    flags: Optional[ApplicationFlags] = None

    def model_post_init(self, __context) -> None:
        sync_alias("application_id", "workflow_id", self)


class ApplicationVariantEdit(WorkflowVariantEdit):
    flags: Optional[ApplicationFlags] = None


# application revisions -----------------------------------------------------


class ApplicationRevisionData(WorkflowRevisionData):
    pass


class ApplicationRevision(
    WorkflowRevision,
    ApplicationIdAlias,
    ApplicationVariantIdAlias,
):
    flags: Optional[ApplicationFlags] = None

    data: Optional[ApplicationRevisionData] = None

    def model_post_init(self, __context) -> None:
        sync_alias("application_id", "workflow_id", self)
        sync_alias("application_variant_id", "workflow_variant_id", self)


class ApplicationRevisionCreate(
    WorkflowRevisionCreate,
    ApplicationIdAlias,
    ApplicationVariantIdAlias,
):
    flags: Optional[ApplicationFlags] = None

    def model_post_init(self, __context) -> None:
        sync_alias("application_id", "workflow_id", self)
        sync_alias("application_variant_id", "workflow_variant_id", self)


class ApplicationRevisionEdit(WorkflowRevisionEdit):
    flags: Optional[ApplicationFlags] = None


class ApplicationRevisionCommit(
    WorkflowRevisionCommit,
    ApplicationIdAlias,
    ApplicationVariantIdAlias,
):
    flags: Optional[ApplicationFlags] = None

    data: Optional[ApplicationRevisionData] = None

    def model_post_init(self, __context) -> None:
        sync_alias("application_id", "workflow_id", self)
        sync_alias("application_variant_id", "workflow_variant_id", self)


class ApplicationRevisionResponse(BaseModel):
    count: int = 0
    application_revision: Optional[ApplicationRevision] = None


class ApplicationRevisionsResponse(BaseModel):
    count: int = 0
    application_revisions: List[ApplicationRevision] = []


# simple applications ------------------------------------------------------------


class LegacyApplicationFlags(WorkflowFlags):
    pass


class LegacyApplicationData(WorkflowRevisionData):
    pass


class LegacyApplication(Identifier, Slug, Lifecycle, Header, Metadata):
    flags: Optional[LegacyApplicationFlags] = None

    data: Optional[LegacyApplicationData] = None


class LegacyApplicationCreate(Slug, Header, Metadata):
    flags: Optional[LegacyApplicationFlags] = None

    data: Optional[LegacyApplicationData] = None


class LegacyApplicationEdit(Identifier, Header, Metadata):
    flags: Optional[LegacyApplicationFlags] = None

    data: Optional[LegacyApplicationData] = None


class LegacyApplicationResponse(BaseModel):
    count: int = 0
    application: Optional[LegacyApplication] = None


# end of oss.src.core.applications.dtos
