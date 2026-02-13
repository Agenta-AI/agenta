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
    ArtifactFork,  # noqa: F401
    VariantFork,
    RevisionFork,
    #
    WorkflowFlags,
    WorkflowQueryFlags,
    #
    Workflow,
    WorkflowCreate,
    WorkflowEdit,
    WorkflowQuery,
    WorkflowFork,
    #
    WorkflowVariant,
    WorkflowVariantCreate,
    WorkflowVariantEdit,
    WorkflowVariantQuery,
    WorkflowVariantFork,
    #
    WorkflowRevisionData,
    #
    WorkflowRevision,
    WorkflowRevisionCreate,
    WorkflowRevisionEdit,
    WorkflowRevisionQuery,
    WorkflowRevisionFork,
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
    """Application flags - is_evaluator=False means it's an application."""

    def __init__(self, **data):
        # Applications have is_evaluator=False (forced)
        data["is_evaluator"] = False

        super().__init__(**data)


class ApplicationQueryFlags(WorkflowQueryFlags):
    """Application query flags - filter for is_evaluator=False."""

    def __init__(self, **data):
        # Query for non-evaluators (applications) (forced)
        data["is_evaluator"] = False

        super().__init__(**data)


# applications -----------------------------------------------------------------


class Application(Workflow):
    flags: Optional[ApplicationFlags] = None


class ApplicationCreate(WorkflowCreate):
    flags: Optional[ApplicationFlags] = None


class ApplicationEdit(WorkflowEdit):
    flags: Optional[ApplicationFlags] = None


class ApplicationQuery(WorkflowQuery):
    flags: Optional[ApplicationQueryFlags] = None


# application variants ---------------------------------------------------------


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
    flags: Optional[ApplicationQueryFlags] = None


# application revisions --------------------------------------------------------


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
    flags: Optional[ApplicationQueryFlags] = None


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


# forks ------------------------------------------------------------------------


class ApplicationRevisionFork(WorkflowRevisionFork):
    flags: Optional[ApplicationFlags] = None

    data: Optional[ApplicationRevisionData] = None


class ApplicationVariantFork(WorkflowVariantFork):
    flags: Optional[ApplicationFlags] = None


class ApplicationRevisionForkAlias(AliasConfig):
    application_revision: Optional[ApplicationRevisionFork] = None

    revision: Optional[RevisionFork] = Field(
        default=None,
        exclude=True,
        alias="application_revision",
    )


class ApplicationVariantForkAlias(AliasConfig):
    application_variant: Optional[ApplicationVariantFork] = None

    variant: Optional[VariantFork] = Field(
        default=None,
        exclude=True,
        alias="application_variant",
    )


class ApplicationFork(
    WorkflowFork,
    ApplicationIdAlias,
    ApplicationVariantIdAlias,
    ApplicationVariantForkAlias,
    ApplicationRevisionIdAlias,
    ApplicationRevisionForkAlias,
):
    def model_post_init(self, __context) -> None:
        sync_alias("application_id", "artifact_id", self)
        sync_alias("application_variant_id", "variant_id", self)
        sync_alias("application_variant", "variant", self)
        sync_alias("application_revision_id", "revision_id", self)
        sync_alias("application_revision", "revision", self)


# simple applications ----------------------------------------------------------


class SimpleApplicationFlags(ApplicationFlags):
    pass


class SimpleApplicationQueryFlags(ApplicationQueryFlags):
    pass


class SimpleApplicationData(ApplicationRevisionData):
    pass


class SimpleApplication(Identifier, Slug, Lifecycle, Header, Metadata):
    flags: Optional[SimpleApplicationFlags] = None

    data: Optional[SimpleApplicationData] = None

    variant_id: Optional[UUID] = None
    revision_id: Optional[UUID] = None


class SimpleApplicationCreate(Slug, Header, Metadata):
    flags: Optional[SimpleApplicationFlags] = None

    data: Optional[SimpleApplicationData] = None


class SimpleApplicationEdit(Identifier, Header, Metadata):
    flags: Optional[SimpleApplicationFlags] = None

    data: Optional[SimpleApplicationData] = None


class SimpleApplicationQuery(Metadata):
    flags: Optional[SimpleApplicationQueryFlags] = None


# ------------------------------------------------------------------------------
