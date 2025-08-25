# - oss.src.core.shared.dtos ---------------------------------------------------


from typing import Optional, Dict, List, Union
from uuid import UUID
from datetime import datetime

from typing_extensions import TypeAliasType
from pydantic import BaseModel


BoolJson: TypeAliasType = TypeAliasType(
    "BoolJson",
    Union[bool, Dict[str, "BoolJson"]],
)

StringJson: TypeAliasType = TypeAliasType(
    "StringJson",
    Union[str, Dict[str, "StringJson"]],
)

FullJson: TypeAliasType = TypeAliasType(
    "FullJson",
    Union[str, int, float, bool, None, Dict[str, "FullJson"], List["FullJson"]],
)

NumericJson: TypeAliasType = TypeAliasType(
    "NumericJson",
    Union[int, float, Dict[str, "NumericJson"]],
)

NoListJson: TypeAliasType = TypeAliasType(
    "NoListJson",
    Union[str, int, float, bool, None, Dict[str, "NoListJson"]],
)

LabelJson: TypeAliasType = TypeAliasType(
    "LabelJson",
    Union[bool, str, Dict[str, "LabelJson"]],
)

Json = Dict[str, FullJson]

Data = Dict[str, FullJson]

Meta = Dict[str, FullJson]

Tags = Dict[str, LabelJson]

Flags = Dict[str, LabelJson]

Hashes = Dict[str, StringJson]

Metrics = Dict[str, NumericJson]


class Metadata(BaseModel):
    flags: Optional[Flags] = None
    meta: Optional[Meta] = None
    tags: Optional[Tags] = None


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


class Version(BaseModel):
    version: Optional[str] = None


class Header(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class Reference(Identifier, Slug, Version):
    pass


class Link(TraceID, SpanID):
    pass


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


class Status(BaseModel):
    code: Optional[int] = 500
    message: Optional[str] = "Please try again later."


Mappings = Dict[str, str]

Schema = Dict[str, FullJson]


# ------------------------------------------------------------------------------

# - oss.src.core.git.dtos ------------------------------------------------------


from typing import Optional, List
from uuid import UUID
from datetime import datetime

from pydantic import BaseModel


class Commit(BaseModel):
    author: Optional[UUID] = None
    date: Optional[datetime] = None
    message: Optional[str] = None


class Revision(Identifier, Slug, Version, Lifecycle, Header, Metadata, Commit):
    data: Optional[Data] = None

    artifact_id: Optional[UUID] = None
    variant_id: Optional[UUID] = None


# ------------------------------------------------------------------------------

# - oss.src.core.tracing.dtos --------------------------------------------------

import random
import string
from enum import Enum
from datetime import datetime, timezone
from typing import List, Dict, Any, Union, Optional

from pydantic import BaseModel, model_validator, Field


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

    model_config = {"ser_json_exclude_none": True}


class AgDataAttributes(BaseModel):
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


# ------------------------------------------------------------------------------

# - oss.src.core.workflows.dtos ------------------------------------------------


from typing import Optional, Dict
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


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


class WorkflowFlags(BaseModel):
    is_custom: Optional[bool] = None
    is_evaluator: Optional[bool] = None
    is_human: Optional[bool] = None


class WorkflowServiceVersion(BaseModel):
    version: Optional[str] = None


class WorkflowServiceInterface(WorkflowServiceVersion):
    uri: Optional[str] = None  # str (Enum) w/ validation
    url: Optional[str] = None  # str w/ validation
    headers: Optional[Dict[str, Reference | str]] = None  # either hardcoded or a secret

    schemas: Optional[Schema] = None  # json-schema instead of pydantic
    mappings: Optional[Mappings] = None  # used in the workflow interface


class WorkflowServiceConfiguration(WorkflowServiceInterface):
    script: Optional[str] = None  # str w/ validation
    parameters: Optional[Data] = None  # configuration values


class WorkflowRevisionData(WorkflowServiceConfiguration):
    pass


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


class WorkflowServiceData(BaseModel):
    inputs: Optional[Data] = None
    outputs: Optional[str | Data] = None
    trace: Optional[Trace] = None
    trace_outputs: Optional[str | Data] = None
    traces: Optional[Dict[str, Trace]] = None
    traces_outputs: Optional[Dict[str, str | Data]] = None


class WorkflowServiceRequest(Version, Metadata):
    data: Optional[WorkflowServiceData] = None

    path: Optional[str] = "/"
    method: Optional[str] = "invoke"

    references: Optional[Dict[str, Reference]] = None
    links: Optional[Dict[str, Link]] = None

    # secrets: Optional[Dict[str, Secret]] = None
    credentials: Optional[str] = None


class WorkflowServiceResponse(Identifier, Version):
    data: Optional[WorkflowServiceData] = None

    links: Optional[Dict[str, Link]] = None

    status: Optional[Status] = None  # = Status()


# ------------------------------------------------------------------------------

from typing import Callable, Awaitable

WorkflowServiceHandler = Callable[
    [WorkflowServiceRequest, WorkflowRevision],
    Awaitable[WorkflowServiceResponse],
]
