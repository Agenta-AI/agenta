from typing import Optional, List, Dict
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


class TestsetLog(
    RevisionsLog,
    TestsetVariantIdAlias,
    TestsetRevisionIdAlias,
):
    testset_variant_id: Optional[UUID] = None

    def model_post_init(self, _context) -> None:
        sync_alias("testset_variant_id", "variant_id", self)
        sync_alias("testset_revision_id", "revision_id", self)


class TestsetFlags(BaseModel):
    has_testcases: Optional[bool] = None
    has_traces: Optional[bool] = None


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


class TestsetRevisionCommit(
    RevisionCommit,
    TestsetIdAlias,
    TestsetVariantIdAlias,
):
    flags: Optional[TestsetFlags] = None

    data: Optional[TestsetRevisionData] = None

    def model_post_init(self, __context) -> None:
        sync_alias("testset_id", "artifact_id", self)
        sync_alias("testset_variant_id", "variant_id", self)


class TestsetColumnRename(BaseModel):
    """Column rename operation"""

    old_name: str
    new_name: str


class TestsetColumnOperations(BaseModel):
    """Column-level operations applied to ALL testcases in the revision"""

    # Rename columns: array of {old_name, new_name}
    rename: Optional[List[TestsetColumnRename]] = None
    # Add columns: array of column names to add (initialized to empty string)
    add: Optional[List[str]] = None
    # Delete columns: array of column names to remove
    delete: Optional[List[str]] = None


class TestsetRevisionPatchOperations(BaseModel):
    """Operations to apply to a testset revision"""

    # Testcases to update (existing testcases with modified data)
    update: Optional[List[Testcase]] = None
    # New testcases to create
    create: Optional[List[Testcase]] = None
    # Testcase IDs to delete
    delete: Optional[List[UUID]] = None
    # Column-level operations (applied to ALL testcases)
    columns: Optional[TestsetColumnOperations] = None


class TestsetRevisionPatch(
    TestsetIdAlias,
    TestsetVariantIdAlias,
):
    """Patch request for updating a testset revision with delta changes"""

    flags: Optional[TestsetFlags] = None

    # Base revision to apply patch to (defaults to latest if not specified)
    base_revision_id: Optional[UUID] = None

    # Commit message
    message: Optional[str] = None

    # Revision description (for the new revision)
    description: Optional[str] = None

    # Patch operations
    operations: Optional[TestsetRevisionPatchOperations] = None

    def model_post_init(self, __context) -> None:
        sync_alias("testset_id", "artifact_id", self)
        sync_alias("testset_variant_id", "variant_id", self)


class SimpleTestset(Identifier, Slug, Lifecycle, Header, Metadata):
    flags: Optional[TestsetFlags] = None  # type: ignore

    data: Optional[TestsetRevisionData] = None

    # Revision ID for navigation after creation
    revision_id: Optional[UUID] = None


class SimpleTestsetCreate(Slug, Header, Metadata):
    flags: Optional[TestsetFlags] = None  # type: ignore

    data: Optional[TestsetRevisionData] = None


class SimpleTestsetEdit(Identifier, Header, Metadata):
    flags: Optional[TestsetFlags] = None  # type: ignore

    data: Optional[TestsetRevisionData] = None


class SimpleTestsetQuery(Metadata):
    flags: Optional[TestsetFlags] = None  # type: ignore
