from typing import Optional, Dict, Any, Union  # noqa: F401
from uuid import UUID, uuid4  # noqa: F401

from pydantic import (
    BaseModel,
    Field,
)

from oss.src.core.git.dtos import (
    Artifact,
    ArtifactCreate,
    ArtifactEdit,
    ArtifactQuery,
    ArtifactFork,
    #
    Variant,
    VariantCreate,
    VariantEdit,
    VariantQuery,
    VariantFork,
    #
    Revision,
    RevisionCreate,
    RevisionEdit,
    RevisionQuery,
    RevisionFork,
    RevisionCommit,
    RevisionsLog,
)

from oss.src.core.shared.dtos import sync_alias, AliasConfig
from oss.src.core.shared.dtos import (  # noqa: F401
    Identifier,
    Slug,
    Version,
    Lifecycle,
    Header,
    Data,
    Metadata,
    Reference,
    Link,
    Schema,
    Trace,
    # Credentials,
    # Secret,
)

from agenta.sdk.models.workflows import (
    WorkflowServiceRequestData,  # noqa: F401
    WorkflowServiceResponseData,  # noqa: F401
    WorkflowServiceRequest,  # noqa: F401
    WorkflowServiceResponse,  # noqa: F401
    WorkflowServiceBatchResponse,  # noqa: F401
    WorkflowServiceStreamResponse,  # noqa: F401
    #
    JsonSchemas,  # noqa: F401
    WorkflowRevisionData,
)

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
    # uri-derived
    ## source
    is_managed: bool = False
    ## kind
    is_custom: bool = False
    ## key
    is_llm: bool = False
    is_hook: bool = False
    is_code: bool = False
    is_match: bool = False
    is_human: bool = False
    # interface-derived
    ## schema
    is_chat: bool = False
    ## hook
    has_url: bool = False
    ## code
    has_script: bool = False
    ## function
    has_handler: bool = False
    # user-defined
    is_application: bool = False
    is_evaluator: bool = False
    is_snippet: bool = False


class WorkflowQueryFlags(BaseModel):
    # uri-derived
    ## source
    is_managed: Optional[bool] = None
    ## kind
    is_custom: Optional[bool] = None
    ## key
    is_llm: Optional[bool] = None
    is_hook: Optional[bool] = None
    is_code: Optional[bool] = None
    is_match: Optional[bool] = None
    is_human: Optional[bool] = None
    # interface-derived
    ## schema
    is_chat: Optional[bool] = None
    ## hook
    has_url: Optional[bool] = None
    ## code
    has_script: Optional[bool] = None
    ## function
    has_handler: Optional[bool] = None
    # user-defined
    is_application: Optional[bool] = None
    is_evaluator: Optional[bool] = None
    is_snippet: Optional[bool] = None


class WorkflowCatalogFlags(BaseModel):
    is_archived: bool = False
    is_recommended: bool = False
    #
    is_application: bool = False
    is_evaluator: bool = False
    is_snippet: bool = False


# workflows --------------------------------------------------------------------


class Workflow(Artifact):
    flags: Optional[WorkflowFlags] = None


class WorkflowCreate(ArtifactCreate):
    flags: Optional[WorkflowFlags] = None


class WorkflowEdit(ArtifactEdit):
    flags: Optional[WorkflowFlags] = None


class WorkflowQuery(ArtifactQuery):
    flags: Optional[WorkflowQueryFlags] = None


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
    flags: Optional[WorkflowQueryFlags] = None


# workflow revisions -----------------------------------------------------------


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
    flags: Optional[WorkflowQueryFlags] = None


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


# simple workflows -------------------------------------------------------------


class SimpleWorkflowFlags(WorkflowFlags):
    pass


class SimpleWorkflowQueryFlags(WorkflowQueryFlags):
    pass


class SimpleWorkflowData(WorkflowRevisionData):
    pass


class SimpleWorkflow(Identifier, Slug, Lifecycle, Header, Metadata):
    flags: Optional[SimpleWorkflowFlags] = None

    data: Optional[SimpleWorkflowData] = None

    variant_id: Optional[UUID] = None
    revision_id: Optional[UUID] = None


class SimpleWorkflowCreate(Slug, Header, Metadata):
    flags: Optional[SimpleWorkflowFlags] = None

    data: Optional[SimpleWorkflowData] = None


class SimpleWorkflowEdit(Identifier, Header, Metadata):
    flags: Optional[SimpleWorkflowFlags] = None

    data: Optional[SimpleWorkflowData] = None


class SimpleWorkflowQuery(Metadata):
    flags: Optional[SimpleWorkflowQueryFlags] = None


# WORKFLOW CATALOG -------------------------------------------------------------


class WorkflowCatalogMappingMixin:
    def _as_catalog_mapping(self) -> dict:
        return self.model_dump(mode="json", exclude_none=True)

    def __getitem__(self, item: str):
        return self._as_catalog_mapping()[item]

    def get(self, item: str, default=None):
        return self._as_catalog_mapping().get(item, default)

    def keys(self):
        return self._as_catalog_mapping().keys()

    def values(self):
        return self._as_catalog_mapping().values()

    def items(self):
        return self._as_catalog_mapping().items()

    def __contains__(self, item: str) -> bool:
        return item in self._as_catalog_mapping()


class WorkflowCatalogType(WorkflowCatalogMappingMixin, Header):
    key: str

    json_schema: Schema


class WorkflowCatalogTemplate(WorkflowCatalogMappingMixin, Header):
    key: str

    categories: Optional[list[str]] = None

    flags: Optional[WorkflowCatalogFlags] = None
    data: Optional[WorkflowRevisionData] = None


class WorkflowCatalogPreset(WorkflowCatalogMappingMixin, Header):
    key: str

    categories: Optional[list[str]] = None

    flags: Optional[WorkflowCatalogFlags] = None
    data: Optional[WorkflowRevisionData] = None


# ------------------------------------------------------------------------------
