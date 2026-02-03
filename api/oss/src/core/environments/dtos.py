from typing import Optional, Dict
from uuid import UUID

from pydantic import BaseModel, Field

from oss.src.core.shared.dtos import (
    sync_alias,
    AliasConfig,
    Reference,
)
from oss.src.core.shared.dtos import (
    Identifier,
    Slug,
    Lifecycle,
    Header,
    Metadata,
)
from oss.src.core.git.dtos import (
    Artifact,
    ArtifactCreate,
    ArtifactEdit,
    ArtifactQuery,
    #
    Variant,
    VariantCreate,
    VariantEdit,
    VariantQuery,
    #
    Revision,
    RevisionsLog,
    RevisionCreate,
    RevisionEdit,
    RevisionQuery,
    RevisionCommit,
)


# aliases ----------------------------------------------------------------------


class EnvironmentIdAlias(AliasConfig):
    environment_id: Optional[UUID] = None
    artifact_id: Optional[UUID] = Field(
        default=None,
        exclude=True,
        alias="environment_id",
    )


class EnvironmentVariantIdAlias(AliasConfig):
    environment_variant_id: Optional[UUID] = None
    variant_id: Optional[UUID] = Field(
        default=None,
        exclude=True,
        alias="environment_variant_id",
    )


class EnvironmentRevisionIdAlias(AliasConfig):
    environment_revision_id: Optional[UUID] = None
    revision_id: Optional[UUID] = Field(
        default=None,
        exclude=True,
        alias="environment_revision_id",
    )


class EnvironmentRevisionsLog(
    RevisionsLog,
    EnvironmentIdAlias,
    EnvironmentVariantIdAlias,
    EnvironmentRevisionIdAlias,
):
    environment_id: Optional[UUID] = None
    environment_variant_id: Optional[UUID] = None

    def model_post_init(self, _context) -> None:
        sync_alias("environment_id", "artifact_id", self)
        sync_alias("environment_variant_id", "variant_id", self)
        sync_alias("environment_revision_id", "revision_id", self)


# flags ------------------------------------------------------------------------


class EnvironmentFlags(BaseModel):
    is_guarded: bool = False


class EnvironmentQueryFlags(BaseModel):
    is_guarded: Optional[bool] = None


# revision data ----------------------------------------------------------------


class EnvironmentRevisionData(BaseModel):
    """Dot-notation keyed references for environment revision data.

    Keys use dot-notation paths (e.g., "my-app.variant", "my-app.revision").
    Values are Reference objects containing id, slug, and/or version.
    """

    references: Optional[Dict[str, Reference]] = None


# environments -----------------------------------------------------------------


class Environment(Artifact):
    flags: Optional[EnvironmentFlags] = None


class EnvironmentCreate(ArtifactCreate):
    flags: Optional[EnvironmentFlags] = None


class EnvironmentEdit(ArtifactEdit):
    flags: Optional[EnvironmentFlags] = None


class EnvironmentQuery(ArtifactQuery):
    flags: Optional[EnvironmentQueryFlags] = None


# environment variants ---------------------------------------------------------


class EnvironmentVariant(
    Variant,
    EnvironmentIdAlias,
):
    def model_post_init(self, __context) -> None:
        sync_alias("environment_id", "artifact_id", self)


class EnvironmentVariantCreate(
    VariantCreate,
    EnvironmentIdAlias,
):
    def model_post_init(self, __context) -> None:
        sync_alias("environment_id", "artifact_id", self)


class EnvironmentVariantEdit(VariantEdit):
    pass


class EnvironmentVariantQuery(VariantQuery):
    pass


# environment revisions --------------------------------------------------------


class EnvironmentRevision(
    Revision,
    EnvironmentIdAlias,
    EnvironmentVariantIdAlias,
):
    data: Optional[EnvironmentRevisionData] = None

    def model_post_init(self, __context) -> None:
        sync_alias("environment_id", "artifact_id", self)
        sync_alias("environment_variant_id", "variant_id", self)


class EnvironmentRevisionCreate(
    RevisionCreate,
    EnvironmentIdAlias,
    EnvironmentVariantIdAlias,
):
    def model_post_init(self, __context) -> None:
        sync_alias("environment_id", "artifact_id", self)
        sync_alias("environment_variant_id", "variant_id", self)


class EnvironmentRevisionEdit(RevisionEdit):
    pass


class EnvironmentRevisionQuery(RevisionQuery):
    pass


class EnvironmentRevisionCommit(
    RevisionCommit,
    EnvironmentIdAlias,
    EnvironmentVariantIdAlias,
    EnvironmentRevisionIdAlias,
):
    data: Optional[EnvironmentRevisionData] = None

    def model_post_init(self, __context) -> None:
        sync_alias("environment_id", "artifact_id", self)
        sync_alias("environment_variant_id", "variant_id", self)
        sync_alias("environment_revision_id", "revision_id", self)


# simple environments ----------------------------------------------------------


class SimpleEnvironment(Identifier, Slug, Lifecycle, Header, Metadata):
    flags: Optional[EnvironmentFlags] = None

    data: Optional[EnvironmentRevisionData] = None

    variant_id: Optional[UUID] = None
    revision_id: Optional[UUID] = None


class SimpleEnvironmentCreate(Slug, Header, Metadata):
    flags: Optional[EnvironmentFlags] = None

    data: Optional[EnvironmentRevisionData] = None


class SimpleEnvironmentEdit(Identifier, Header, Metadata):
    flags: Optional[EnvironmentFlags] = None

    data: Optional[EnvironmentRevisionData] = None


class SimpleEnvironmentQuery(Header, Metadata):
    flags: Optional[EnvironmentQueryFlags] = None


# ------------------------------------------------------------------------------
