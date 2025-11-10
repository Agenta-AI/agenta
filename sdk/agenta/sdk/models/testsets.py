from typing import List, Optional, Dict, Any
from uuid import UUID

from pydantic import BaseModel, Field

from agenta.sdk.models.shared import (
    TraceID,
    SpanID,
    Link,
    Identifier,
    Slug,
    Version,
    Reference,
    Lifecycle,
    Header,
    Flags,
    Tags,
    Meta,
    Metadata,
    Data,
    Commit,
    AliasConfig,
    sync_alias,
)

from agenta.sdk.models.git import (
    Artifact,
    ArtifactCreate,
    ArtifactEdit,
    ArtifactQuery,
    ArtifactFork,
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
    RevisionsLog,
    RevisionFork,
)

from agenta.sdk.models.blobs import (
    Blob,
)


class TestsetIdAlias(AliasConfig):
    testset_id: Optional[UUID] = None
    set_id: Optional[UUID] = Field(
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


class Testcase(Blob, TestsetIdAlias):
    def model_post_init(self, __context) -> None:
        sync_alias("testset_id", "set_id", self)


class TestsetFlags(BaseModel):
    has_testcases: Optional[bool] = None
    has_traces: Optional[bool] = None


class TestsetRevisionData(BaseModel):
    testcase_ids: Optional[List[UUID]] = None
    testcases: Optional[List[Testcase]] = None


class SimpleTestset(
    Identifier,
    Slug,
    Lifecycle,
    Header,
):
    flags: Optional[TestsetFlags] = None
    tags: Optional[Tags] = None  # type: ignore
    meta: Optional[Meta] = None  # type: ignore

    data: Optional[TestsetRevisionData] = None


class Testset(Artifact):
    flags: Optional[TestsetFlags] = None  # type: ignore


class TestsetRevision(
    Revision,
    TestsetIdAlias,
    TestsetVariantIdAlias,
):
    flags: Optional[TestsetFlags] = None  # type: ignore

    data: Optional[TestsetRevisionData] = None  # type: ignore

    def model_post_init(self, __context) -> None:
        sync_alias("testset_id", "artifact_id", self)
        sync_alias("testset_variant_id", "variant_id", self)


class SimpleTestsetCreate(Slug, Header):
    tags: Optional[Tags] = None  # type: ignore
    meta: Optional[Meta] = None  # type: ignore
    data: Optional[TestsetRevisionData] = None


class SimpleTestsetEdit(
    Identifier,
    Header,
):
    # flags: Optional[TestsetFlags] = None
    tags: Optional[Tags] = None  # type: ignore
    meta: Optional[Meta] = None  # type: ignore

    data: Optional[TestsetRevisionData] = None


class TestsetResponse(BaseModel):
    count: int = 0
    testset: Optional[Testset] = None


class TestsetRevisionResponse(BaseModel):
    count: int = 0
    testset_revision: Optional[TestsetRevision] = None


class SimpleTestsetResponse(BaseModel):
    count: int = 0
    testset: Optional[SimpleTestset] = None


class TestsetsResponse(BaseModel):
    count: int = 0
    testsets: List[Testset] = []


class SimpleTestsetsResponse(BaseModel):
    count: int = 0
    testsets: List[SimpleTestset] = []


# LEGACY TESTSETS --------------------------------------------------------------


class LegacyTestset(BaseModel):
    id: str
    name: Optional[str] = None
    csvdata: Optional[List[Dict[str, Any]]] = None
