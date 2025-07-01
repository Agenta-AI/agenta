from typing import Optional
from uuid import UUID
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


class WorkflowRevisionData(BaseModel):
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
