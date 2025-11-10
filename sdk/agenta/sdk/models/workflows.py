# /agenta/sdk/models/running.py

from typing import Any, Dict, Optional, Union, List
from uuid import UUID
from urllib.parse import urlparse

from jsonschema.exceptions import SchemaError
from jsonschema import (
    Draft202012Validator,
    Draft201909Validator,
    Draft7Validator,
    Draft4Validator,
    Draft6Validator,
)
from pydantic import (
    BaseModel,
    ConfigDict,
    model_validator,
    ValidationError,
    Field,
)

from agenta.sdk.models.shared import (
    TraceID,
    SpanID,
    Link,
    Identifier,
    Slug,
    Reference,
    Lifecycle,
    Header,
    Metadata,
    Data,
    Schema,
    Status,
    Commit,
    AliasConfig,
    sync_alias,
)

from agenta.sdk.models.git import (
    Artifact,
    ArtifactCreate,
    ArtifactEdit,
    ArtifactQuery,
    ArtifactFork,
    Variant,
    VariantCreate,
    VariantEdit,
    VariantQuery,
    VariantFork,
    Revision,
    RevisionCreate,
    RevisionEdit,
    RevisionQuery,
    RevisionCommit,
    RevisionsLog,
    RevisionFork,
)


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


class JsonSchemas(BaseModel):
    parameters: Optional[Schema] = None
    inputs: Optional[Schema] = None
    outputs: Optional[Schema] = None


class WorkflowFlags(BaseModel):
    is_custom: bool = False
    is_evaluator: bool = False
    is_human: bool = False


class WorkflowServiceInterface(BaseModel):
    version: str = "2025.07.14"

    uri: Optional[str] = None
    url: Optional[str] = None
    headers: Optional[Dict[str, Union[str, Reference]]] = None
    schemas: Optional[JsonSchemas] = None

    @model_validator(mode="after")
    def validate_jsonschemas_and_url(self) -> "WorkflowServiceInterface":
        errors = []

        if self.schemas:
            for key, schema in self.schemas.model_dump().items():
                try:
                    if not schema:
                        continue

                    validator_class = self._get_validator_class_from_schema(schema)
                    validator_class.check_schema(schema)
                except SchemaError as e:
                    errors.append(
                        {
                            "loc": ("schemas", key),
                            "msg": f"Invalid JSON Schema: {e.message}",
                            "type": "value_error.jsonschema",
                            "ctx": {"error": str(e)},
                            "input": schema,
                        }
                    )

        if self.url:
            if not self._is_valid_http_url(self.url):
                errors.append(
                    {
                        "loc": ("url",),
                        "msg": "Invalid HTTP(S) URL",
                        "type": "value_error.url",
                        "ctx": {"error": "Invalid URL format"},
                        "input": self.url,
                    }
                )

        if errors:
            raise ValidationError.from_exception_data(
                self.__class__.__name__,
                errors,  # type: ignore
            )

        return self

    @staticmethod
    def _get_validator_class_from_schema(schema: Dict[str, Any]):
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
            return Draft202012Validator

    @staticmethod
    def _is_valid_http_url(url: str) -> bool:
        parsed = urlparse(url)
        return parsed.scheme in ("http", "https") and bool(parsed.netloc)


class WorkflowServiceConfiguration(BaseModel):
    script: Optional[Data] = None
    parameters: Optional[Data] = None


class WorkflowRevisionData(
    WorkflowServiceInterface,
    WorkflowServiceConfiguration,
):
    pass


class WorkflowServiceStatus(Status):
    type: Optional[str] = None
    stacktrace: Optional[Union[list[str], str]] = None


class WorkflowServiceRequestData(BaseModel):
    revision: Optional[dict] = None
    parameters: Optional[dict] = None
    #
    testcase: Optional[dict] = None
    inputs: Optional[dict] = None
    #
    trace: Optional[dict] = None
    outputs: Optional[Any] = None


class WorkflowServiceResponseData(BaseModel):
    outputs: Optional[Any] = None


class WorkflowServiceBaseRequest(Metadata):
    version: str = "2025.07.14"

    interface: Optional[Union[WorkflowServiceInterface, Dict[str, Any]]] = None
    configuration: Optional[Union[WorkflowServiceConfiguration, Dict[str, Any]]] = None

    references: Optional[Dict[str, Union[Reference, Dict[str, Any]]]] = None
    links: Optional[Dict[str, Union[Link, Dict[str, Any]]]] = None

    secrets: Optional[Dict[str, Any]] = None
    credentials: Optional[str] = None

    @model_validator(mode="before")
    def _coerce_nested_models(cls, values: Dict[str, Any]) -> Dict[str, Any]:
        """Convert dicts into their respective Pydantic models."""
        if "interface" in values and isinstance(values["interface"], dict):
            values["interface"] = WorkflowServiceInterface(**values["interface"])

        if "configuration" in values and isinstance(values["configuration"], dict):
            values["configuration"] = WorkflowServiceConfiguration(
                **values["configuration"]
            )

        if "references" in values and isinstance(values["references"], dict):
            values["references"] = {
                k: (Reference(**v) if isinstance(v, dict) else v)
                for k, v in values["references"].items()
            }

        if "links" in values and isinstance(values["links"], dict):
            values["links"] = {
                k: (Link(**v) if isinstance(v, dict) else v)
                for k, v in values["links"].items()
            }

        return values


class WorkflowServiceRequest(WorkflowServiceBaseRequest):
    data: Optional[WorkflowServiceRequestData] = None


class WorkflowServiceBaseResponse(TraceID, SpanID):
    version: str = "2025.07.14"

    status: Optional[WorkflowServiceStatus] = WorkflowServiceStatus()


class WorkflowServiceBatchResponse(WorkflowServiceBaseResponse):
    data: Optional[WorkflowServiceResponseData] = None


class WorkflowServiceStreamResponse(WorkflowServiceBaseResponse):
    generator: Any  # Callable[[], AsyncGenerator[Any, None]]

    model_config = ConfigDict(arbitrary_types_allowed=True)

    async def iterator(self):
        async for item in self.generator():
            yield item


WorkflowServiceResponse = Union[
    WorkflowServiceBatchResponse,
    WorkflowServiceStreamResponse,
]


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

from agenta.sdk.models.workflows import WorkflowRevisionData


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


# ------------------------------------------------------------------------------


class EvaluatorRevision(BaseModel):
    id: Optional[UUID] = None
    slug: Optional[str] = None
    version: Optional[str] = None

    data: Optional[WorkflowRevisionData] = None

    evaluator_id: Optional[UUID] = None
    evaluator_variant_id: Optional[UUID] = None


class ApplicationServiceRequest(WorkflowServiceRequest):
    pass


class ApplicationServiceBatchResponse(WorkflowServiceBatchResponse):
    pass


class EvaluatorServiceRequest(WorkflowServiceRequest):
    pass


class EvaluatorServiceBatchResponse(WorkflowServiceBatchResponse):
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
        data["is_evaluator"] = False

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
