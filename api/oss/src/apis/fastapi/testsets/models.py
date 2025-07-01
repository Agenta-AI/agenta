from typing import Optional, List
from uuid import UUID

from pydantic import BaseModel

from oss.src.core.shared.dtos import (
    Identifier,
    Slug,
    Lifecycle,
    Header,
    Tags,
    Meta,
    Windowing,
    Reference,
    Data,
)

from oss.src.core.testsets.dtos import (
    TestsetRevisionData,
    TestsetFlags,
)


class SimpleTestset(
    Identifier,
    Slug,
    Lifecycle,
    Header,
):
    flags: Optional[TestsetFlags] = None
    tags: Optional[Tags] = None
    meta: Optional[Meta] = None

    data: Optional[TestsetRevisionData] = None


class SimpleTestsetCreate(
    Slug,
    Header,
):
    # flags: Optional[TestsetFlags] = None
    tags: Optional[Tags] = None
    meta: Optional[Meta] = None

    data: Optional[TestsetRevisionData] = None


class SimpleTestsetEdit(
    Identifier,
    Header,
):
    # flags: Optional[TestsetFlags] = None
    tags: Optional[Tags] = None
    meta: Optional[Meta] = None

    data: Optional[TestsetRevisionData] = None


class SimpleTestsetQuery(BaseModel):
    # flags: Optional[TestsetFlags] = None
    tags: Optional[Tags] = None
    meta: Optional[Meta] = None


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


class TestcasesQueryRequest(BaseModel):
    testcase_ids: Optional[List[UUID]] = None
    #
    testset_id: Optional[UUID] = None
    #
    windowing: Optional[Windowing] = None


class TestcaseResponse(BaseModel):
    count: int = 0
    testcase: Optional[Data] = None


class TestcasesResponse(BaseModel):
    count: int = 0
    testcases: List[Data] = []
