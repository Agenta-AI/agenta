from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field


from oss.src.core.tracing.dtos import Filtering
from oss.src.core.shared.dtos import (
    Identifier,
    Slug,
    Lifecycle,
    Header,
    Tags,
    Meta,
    Windowing,
)
from oss.src.core.shared.dtos import sync_alias, AliasConfig
from oss.src.core.git.dtos import (
    Artifact,
    ArtifactCreate,
    ArtifactEdit,
    ArtifactQuery,
    ArtifactFork,
    RevisionsLog,
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


class QueryIdAlias(AliasConfig):
    query_id: Optional[UUID] = None
    artifact_id: Optional[UUID] = Field(
        default=None,
        exclude=True,
        alias="query_id",
    )


class QueryVariantIdAlias(AliasConfig):
    query_variant_id: Optional[UUID] = None
    variant_id: Optional[UUID] = Field(
        default=None,
        exclude=True,
        alias="query_variant_id",
    )


class QueryRevisionIdAlias(AliasConfig):
    query_revision_id: Optional[UUID] = None
    revision_id: Optional[UUID] = Field(
        default=None,
        exclude=True,
        alias="query_revision_id",
    )


# flags ------------------------------------------------------------------------


class QueryFlags(BaseModel):
    pass


class QueryQueryFlags(BaseModel):
    pass


# queries ----------------------------------------------------------------------


class Query(Artifact):
    flags: Optional[QueryFlags] = None


class QueryCreate(ArtifactCreate):
    flags: Optional[QueryFlags] = None


class QueryEdit(ArtifactEdit):
    flags: Optional[QueryFlags] = None


class QueryQuery(ArtifactQuery):
    flags: Optional[QueryQueryFlags] = None


class QueryVariant(
    Variant,
    QueryIdAlias,
):
    def model_post_init(self, __context) -> None:
        sync_alias("query_id", "artifact_id", self)


class QueryVariantCreate(
    VariantCreate,
    QueryIdAlias,
):
    def model_post_init(self, __context) -> None:
        sync_alias("query_id", "artifact_id", self)


class QueryVariantEdit(VariantEdit):
    pass


class QueryVariantQuery(VariantQuery):
    pass


class QueryRevisionData(BaseModel):
    windowing: Optional[Windowing] = None
    filtering: Optional[Filtering] = None


class QueryRevision(
    Revision,
    QueryIdAlias,
    QueryVariantIdAlias,
):
    data: Optional[QueryRevisionData] = None

    def model_post_init(self, __context) -> None:
        sync_alias("query_id", "artifact_id", self)
        sync_alias("query_variant_id", "variant_id", self)


class QueryRevisionCreate(
    RevisionCreate,
    QueryIdAlias,
    QueryVariantIdAlias,
):
    def model_post_init(self, __context) -> None:
        sync_alias("query_id", "artifact_id", self)
        sync_alias("query_variant_id", "variant_id", self)


class QueryRevisionEdit(RevisionEdit):
    pass


class QueryRevisionQuery(RevisionQuery):
    pass


class QueryRevisionCommit(
    RevisionCommit,
    QueryIdAlias,
    QueryVariantIdAlias,
):
    data: Optional[QueryRevisionData] = None

    def model_post_init(self, __context) -> None:
        sync_alias("query_id", "artifact_id", self)
        sync_alias("query_variant_id", "variant_id", self)


class QueryRevisionsLog(
    RevisionsLog,
    QueryIdAlias,
    QueryVariantIdAlias,
    QueryRevisionIdAlias,
):
    def model_post_init(self, __context) -> None:
        sync_alias("query_id", "artifact_id", self)
        sync_alias("query_variant_id", "variant_id", self)
        sync_alias("query_revision_id", "revision_id", self)


class QueryRevisionFork(RevisionFork):
    data: Optional[QueryRevisionData] = None


class QueryVariantFork(VariantFork):
    pass


class QueryVariantForkAlias(AliasConfig):
    query_variant: Optional[QueryVariantFork] = None

    variant: Optional[VariantFork] = Field(
        default=None,
        exclude=True,
        alias="query_variant",
    )


class QueryRevisionForkAlias(AliasConfig):
    query_revision: Optional[QueryRevisionFork] = None

    revision: Optional[RevisionFork] = Field(
        default=None,
        exclude=True,
        alias="query_revision",
    )


class QueryFork(
    ArtifactFork,
    QueryVariantIdAlias,
    QueryRevisionIdAlias,
    QueryVariantForkAlias,
    QueryRevisionForkAlias,
):
    def model_post_init(self, __context) -> None:
        sync_alias("query_variant", "variant", self)
        sync_alias("query_revision", "revision", self)
        sync_alias("query_variant_id", "variant_id", self)
        sync_alias("query_revision_id", "revision_id", self)


class SimpleQuery(
    Identifier,
    Slug,
    Lifecycle,
    Header,
):
    flags: Optional[QueryFlags] = None
    tags: Optional[Tags] = None
    meta: Optional[Meta] = None

    data: Optional[QueryRevisionData] = None

    variant_id: Optional[UUID] = None
    revision_id: Optional[UUID] = None


class SimpleQueryCreate(
    Slug,
    Header,
):
    flags: Optional[QueryFlags] = None
    tags: Optional[Tags] = None
    meta: Optional[Meta] = None

    data: Optional[QueryRevisionData] = None


class SimpleQueryEdit(
    Identifier,
    Header,
):
    flags: Optional[QueryFlags] = None
    tags: Optional[Tags] = None
    meta: Optional[Meta] = None

    data: Optional[QueryRevisionData] = None


class SimpleQueryQuery(BaseModel):
    flags: Optional[QueryQueryFlags] = None
    tags: Optional[Tags] = None
    meta: Optional[Meta] = None
