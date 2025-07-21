from typing import Optional, List, Dict
from uuid import UUID

from pydantic import BaseModel, Field

# from oss.src.core.shared.dtos import Link
from oss.src.core.shared.dtos import sync_alias, AliasConfig
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
    RevisionCreate,
    RevisionEdit,
    RevisionQuery,
    RevisionCommit,
)

from oss.src.core.testcases.dtos import Testcase


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
