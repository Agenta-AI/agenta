from typing import Optional, Dict, Any, Union
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

from oss.src.core.shared.dtos import sync_alias, AliasConfig

from oss.src.core.git.dtos import (
    Artifact,
    ArtifactCreate,
    ArtifactEdit,
    ArtifactQuery,
    ArtifactFork,
    ArtifactLog,
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
    RevisionFork,
)

from oss.src.core.shared.dtos import (
    Identifier,
    Slug,
    Version,
    Header,
    Status,
    Data,
    Metadata,
    Reference,
    Link,
    Mappings,
    Schema,
    # Credentials,
    # Secret,
)

from oss.src.core.tracing.dtos import (
    Trace,
)

from oss.src.apis.fastapi.observability.models import (
    AgentaNodesDTO as Tree,
    AgentaVersionedTreeDTO as VersionedTree,
)


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


class WorkflowFlags(BaseModel):
    is_custom: Optional[bool] = None
    is_evaluator: Optional[bool] = None
    is_human: Optional[bool] = None


class Workflow(Artifact):
    flags: Optional[WorkflowFlags] = None


class WorkflowCreate(ArtifactCreate):
    flags: Optional[WorkflowFlags] = None


class WorkflowEdit(ArtifactEdit):
    flags: Optional[WorkflowFlags] = None


class WorkflowQuery(ArtifactQuery):
    flags: Optional[WorkflowFlags] = None


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


class WorkflowServiceVersion(BaseModel):
    version: Optional[str] = None


class WorkflowServiceInterface(WorkflowServiceVersion):
    uri: Optional[str] = None  # str (Enum) w/ validation
    url: Optional[str] = None  # str w/ validation
    headers: Optional[Dict[str, Reference | str]] = None  # either hardcoded or a secret

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


class WorkflowLog(
    ArtifactLog,
    WorkflowVariantIdAlias,
    WorkflowRevisionIdAlias,
):
    workflow_variant_id: Optional[UUID] = None

    def model_post_init(self, __context) -> None:
        sync_alias("workflow_variant_id", "variant_id", self)
        sync_alias("workflow_revision_id", "revision_id", self)


class WorkflowRevisionFork(RevisionFork):
    flags: Optional[WorkflowFlags] = None

    data: Optional[WorkflowRevisionData] = None


class WorkflowVariantFork(VariantFork):
    flags: Optional[WorkflowFlags] = None


class WorkflowVariantForkAlias(AliasConfig):
    workflow_variant: Optional[WorkflowVariantFork] = None

    variant: Optional[VariantFork] = Field(
        default=None,
        exclude=True,
        alias="workflow_variant",
    )


class WorkflowRevisionForkAlias(AliasConfig):
    workflow_revision: Optional[WorkflowRevisionFork] = None

    revision: Optional[RevisionFork] = Field(
        default=None,
        exclude=True,
        alias="workflow_revision",
    )


class WorkflowFork(
    ArtifactFork,
    WorkflowVariantIdAlias,
    WorkflowRevisionIdAlias,
    WorkflowVariantForkAlias,
    WorkflowRevisionForkAlias,
):
    def model_post_init(self, __context) -> None:
        sync_alias("workflow_variant", "variant", self)
        sync_alias("workflow_revision", "revision", self)
        sync_alias("workflow_variant_id", "variant_id", self)
        sync_alias("workflow_revision_id", "revision_id", self)


# WORKFLOWS --------------------------------------------------------------------


class WorkflowServiceData(BaseModel):
    inputs: Optional[Data] = None
    #
    outputs: Optional[Data | str] = None
    #
    traces: Optional[Dict[str, Trace]] = None
    #
    trace: Optional[Trace] = None
    trace_inputs: Optional[Data] = None
    trace_outputs: Optional[Data | str] = None
    trace_parameters: Optional[Data] = None
    # LEGACY
    tree: Optional[VersionedTree] = None  # used for workflow execution traces


class WorkflowServiceRequest(Version, Metadata):
    data: Optional[WorkflowServiceData] = None

    # path: Optional[str] = "/"
    # method: Optional[str] = "invoke"

    references: Optional[Dict[str, Reference]] = None
    links: Optional[Dict[str, Link]] = None

    credentials: Optional[str] = None
    secrets: Optional[Dict[str, Any]] = None  # Fix typing


class WorkflowServiceResponse(Identifier, Version):
    data: Optional[WorkflowServiceData] = None

    links: Optional[Dict[str, Link]] = None

    status: Status = Status()

    def __init__(self, **data):
        super().__init__(**data)

        self.id = uuid4() if not self.id else self.id
        self.version = "2025.07.14" if not self.version else self.version
