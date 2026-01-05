from typing import Optional, List

from pydantic import BaseModel

from oss.src.core.shared.dtos import (
    Windowing,
    Reference,
)
from oss.src.core.testsets.dtos import (
    Testset,
    TestsetCreate,
    TestsetEdit,
    TestsetQuery,
    TestsetRevisionsLog,
    #
    TestsetVariant,
    TestsetVariantCreate,
    TestsetVariantEdit,
    TestsetVariantQuery,
    #
    TestsetRevision,
    TestsetRevisionQuery,
    TestsetRevisionCreate,
    TestsetRevisionEdit,
    TestsetRevisionCommit,
    TestsetRevisionPatch,
    #
    SimpleTestset,
    SimpleTestsetCreate,
    SimpleTestsetEdit,
    SimpleTestsetQuery,
)


# TESTSETS ---------------------------------------------------------------------


class TestsetCreateRequest(BaseModel):
    testset: TestsetCreate


class TestsetEditRequest(BaseModel):
    testset: TestsetEdit


class TestsetQueryRequest(BaseModel):
    testset: Optional[TestsetQuery] = None
    #
    testset_refs: Optional[List[Reference]] = None
    #
    include_archived: Optional[bool] = None
    #
    windowing: Optional[Windowing] = None


class TestsetResponse(BaseModel):
    count: int = 0
    testset: Optional[Testset] = None


class TestsetsResponse(BaseModel):
    count: int = 0
    testsets: List[Testset] = []
    windowing: Optional[Windowing] = None


# TESTSET VARIANTS -------------------------------------------------------------


class TestsetVariantCreateRequest(BaseModel):
    testset_variant: TestsetVariantCreate


class TestsetVariantEditRequest(BaseModel):
    testset_variant: TestsetVariantEdit


class TestsetVariantQueryRequest(BaseModel):
    testset_variant: Optional[TestsetVariantQuery] = None
    #
    testset_refs: Optional[List[Reference]] = None
    testset_variant_refs: Optional[List[Reference]] = None
    #
    include_archived: Optional[bool] = None
    #
    windowing: Optional[Windowing] = None


class TestsetVariantResponse(BaseModel):
    count: int = 0
    testset_variant: Optional[TestsetVariant] = None


class TestsetVariantsResponse(BaseModel):
    count: int = 0
    testset_variants: List[TestsetVariant] = []


# TESTSET REVISIONS ------------------------------------------------------------


class TestsetRevisionCreateRequest(BaseModel):
    testset_revision: TestsetRevisionCreate
    include_testcases: Optional[bool] = None


class TestsetRevisionEditRequest(BaseModel):
    testset_revision: TestsetRevisionEdit
    include_testcases: Optional[bool] = None


class TestsetRevisionQueryRequest(BaseModel):
    testset_revision: Optional[TestsetRevisionQuery] = None
    #
    testset_refs: Optional[List[Reference]] = None
    testset_variant_refs: Optional[List[Reference]] = None
    testset_revision_refs: Optional[List[Reference]] = None
    #
    include_archived: Optional[bool] = None
    include_testcases: Optional[bool] = None
    #
    windowing: Optional[Windowing] = None


class TestsetRevisionCommitRequest(BaseModel):
    testset_revision_commit: TestsetRevisionCommit
    include_testcases: Optional[bool] = None


class TestsetRevisionPatchRequest(BaseModel):
    testset_revision_patch: TestsetRevisionPatch


class TestsetRevisionRetrieveRequest(BaseModel):
    testset_ref: Optional[Reference] = None
    testset_variant_ref: Optional[Reference] = None
    testset_revision_ref: Optional[Reference] = None
    include_testcases: Optional[bool] = None


class TestsetRevisionsLogRequest(BaseModel):
    testset_revision: TestsetRevisionsLog
    include_testcases: Optional[bool] = None


class TestsetRevisionResponse(BaseModel):
    count: int = 0
    testset_revision: Optional[TestsetRevision] = None


class TestsetRevisionsResponse(BaseModel):
    count: int = 0
    testset_revisions: List[TestsetRevision] = []


# SIMPLE TESTSETS --------------------------------------------------------------


class SimpleTestsetCreateRequest(BaseModel):
    testset: SimpleTestsetCreate


class SimpleTestsetEditRequest(BaseModel):
    testset: SimpleTestsetEdit


class SimpleTestsetQueryRequest(BaseModel):
    testset: Optional[SimpleTestsetQuery] = None
    #
    testset_refs: Optional[List[Reference]] = None
    #
    include_archived: Optional[bool] = None
    #
    windowing: Optional[Windowing] = None


class SimpleTestsetResponse(BaseModel):
    count: int = 0
    testset: Optional[SimpleTestset] = None


class SimpleTestsetsResponse(BaseModel):
    count: int = 0
    testsets: List[SimpleTestset] = []
