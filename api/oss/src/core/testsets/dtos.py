from typing import Optional, List, Tuple
from uuid import UUID

from pydantic import BaseModel, Field

from oss.src.core.shared.dtos import (
    sync_alias,
    AliasConfig,
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
from oss.src.core.testcases.dtos import (
    Testcase,
)


class TestsetIdAlias(AliasConfig):
    testset_id: Optional[UUID] = None
    artifact_id: Optional[UUID] = Field(
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


class TestsetRevisionIdAlias(AliasConfig):
    testset_revision_id: Optional[UUID] = None
    revision_id: Optional[UUID] = Field(
        default=None,
        exclude=True,
        alias="testset_revision_id",
    )


class TestsetRevisionsLog(
    RevisionsLog,
    TestsetIdAlias,
    TestsetVariantIdAlias,
    TestsetRevisionIdAlias,
):
    testset_id: Optional[UUID] = None
    testset_variant_id: Optional[UUID] = None

    def model_post_init(self, _context) -> None:
        sync_alias("testset_id", "artifact_id", self)
        sync_alias("testset_variant_id", "variant_id", self)
        sync_alias("testset_revision_id", "revision_id", self)


class TestsetFlags(BaseModel):
    """Placeholder for testset-level flags.

    This model is intentionally empty but kept as a dedicated type so that:
    - existing references to `flags: Optional[TestsetFlags]` remain valid, and
    - structured flags can be added here in the future without breaking the
      surrounding DTOs.
    """


class Testset(Artifact):
    flags: Optional[TestsetFlags] = None


class TestsetCreate(ArtifactCreate):
    flags: Optional[TestsetFlags] = None


class TestsetEdit(ArtifactEdit):
    flags: Optional[TestsetFlags] = None


class TestsetQuery(ArtifactQuery):
    flags: Optional[TestsetFlags] = None


class TestsetVariant(
    Variant,
    TestsetIdAlias,
):
    flags: Optional[TestsetFlags] = None

    def model_post_init(self, __context) -> None:
        sync_alias("testset_id", "artifact_id", self)


class TestsetVariantCreate(
    VariantCreate,
    TestsetIdAlias,
):
    flags: Optional[TestsetFlags] = None

    def model_post_init(self, __context) -> None:
        sync_alias("testset_id", "artifact_id", self)


class TestsetVariantEdit(VariantEdit):
    flags: Optional[TestsetFlags] = None


class TestsetVariantQuery(VariantQuery):
    flags: Optional[TestsetFlags] = None


class TestsetRevisionData(BaseModel):
    testcase_ids: Optional[List[UUID]] = None
    testcases: Optional[List[Testcase]] = None

    # trace_ids: Optional[List[str]] = None
    # traces: Optional[List[Link]] = None
    # mappings: Optional[Dict[str, str]] = None


class TestsetRevision(
    Revision,
    TestsetIdAlias,
    TestsetVariantIdAlias,
):
    flags: Optional[TestsetFlags] = None

    data: Optional[TestsetRevisionData] = None

    def model_post_init(self, __context) -> None:
        sync_alias("testset_id", "artifact_id", self)
        sync_alias("testset_variant_id", "variant_id", self)


class TestsetRevisionCreate(
    RevisionCreate,
    TestsetIdAlias,
    TestsetVariantIdAlias,
):
    flags: Optional[TestsetFlags] = None

    def model_post_init(self, __context) -> None:
        sync_alias("testset_id", "artifact_id", self)
        sync_alias("testset_variant_id", "variant_id", self)


class TestsetRevisionEdit(RevisionEdit):
    flags: Optional[TestsetFlags] = None


class TestsetRevisionQuery(RevisionQuery):
    flags: Optional[TestsetFlags] = None


class TestsetRevisionDeltaColumns(BaseModel):
    """Column-level operations applied to ALL testcases in the revision."""

    # Add columns: array of column names to add
    add: Optional[List[str]] = None
    # Remove columns: array of column names to remove
    remove: Optional[List[str]] = None
    # Replace columns: array of (old column name, new column name) to replace
    replace: Optional[List[Tuple[str, str]]] = None


class TestsetRevisionDeltaRows(BaseModel):
    """Row-level operations applied to testcases in the revision."""

    # Add rows: array of testcases to add
    add: Optional[List[Testcase]] = None
    # Remove rows: array of testcase IDs to remove
    remove: Optional[List[UUID]] = None
    # Replace rows: array of testcases to replace
    replace: Optional[List[Testcase]] = None


class TestsetRevisionDelta(BaseModel):
    """Operations to apply to a testset revision."""

    # Row-level operations
    rows: Optional[TestsetRevisionDeltaRows] = None
    # Column-level operations
    columns: Optional[TestsetRevisionDeltaColumns] = None


class TestsetRevisionCommit(
    RevisionCommit,
    TestsetIdAlias,
    TestsetVariantIdAlias,
    TestsetRevisionIdAlias,
):
    flags: Optional[TestsetFlags] = None

    data: Optional[TestsetRevisionData] = None
    delta: Optional[TestsetRevisionDelta] = None

    def model_post_init(self, __context) -> None:
        sync_alias("testset_id", "artifact_id", self)
        sync_alias("testset_variant_id", "variant_id", self)
        sync_alias("testset_revision_id", "revision_id", self)


class SimpleTestset(Identifier, Slug, Lifecycle, Header, Metadata):
    flags: Optional[TestsetFlags] = None  # type: ignore

    data: Optional[TestsetRevisionData] = None

    # Revision ID for navigation after creation
    revision_id: Optional[UUID] = None
    variant_id: Optional[UUID] = None


class SimpleTestsetCreate(Slug, Header, Metadata):
    flags: Optional[TestsetFlags] = None  # type: ignore

    data: Optional[TestsetRevisionData] = None


class SimpleTestsetEdit(Identifier, Header, Metadata):
    flags: Optional[TestsetFlags] = None  # type: ignore

    data: Optional[TestsetRevisionData] = None


class SimpleTestsetQuery(Header, Metadata):
    flags: Optional[TestsetFlags] = None  # type: ignore
