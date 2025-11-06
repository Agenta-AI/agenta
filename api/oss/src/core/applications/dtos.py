from typing import Optional
from uuid import UUID

from pydantic import Field

from oss.src.core.shared.dtos import sync_alias, AliasConfig
from oss.src.core.shared.dtos import (
    Identifier,
    Slug,
    Lifecycle,
    Header,
    Metadata,
)
from oss.src.core.workflows.dtos import (
    WorkflowFlags,
    WorkflowQueryFlags,
    #
    Workflow,
    WorkflowCreate,
    WorkflowEdit,
    WorkflowQuery,
    #
    WorkflowVariant,
    WorkflowVariantCreate,
    WorkflowVariantEdit,
    WorkflowVariantQuery,
    #
    WorkflowRevisionData,
    #
    WorkflowRevision,
    WorkflowRevisionCreate,
    WorkflowRevisionEdit,
    WorkflowRevisionQuery,
    WorkflowRevisionCommit,
    WorkflowRevisionsLog,
)


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


class ApplicationQuery(WorkflowQuery):
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


class ApplicationVariantQuery(WorkflowVariantQuery):
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


class ApplicationRevisionQuery(WorkflowRevisionQuery):
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


class ApplicationRevisionsLog(
    WorkflowRevisionsLog,
    ApplicationIdAlias,
    ApplicationVariantIdAlias,
    ApplicationRevisionIdAlias,
):
    def model_post_init(self, __context) -> None:
        sync_alias("application_id", "workflow_id", self)
        sync_alias("application_variant_id", "workflow_variant_id", self)
        sync_alias("application_revision_id", "workflow_revision_id", self)


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


class LegacyApplicationQuery(
    Identifier,
    Slug,
    Lifecycle,
    ApplicationQuery,
):
    data: Optional[LegacyApplicationData] = None


# ------------------------------------------------------------------------------
