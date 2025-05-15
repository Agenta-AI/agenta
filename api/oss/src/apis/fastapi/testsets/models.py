from typing import Optional, List

from pydantic import BaseModel

from oss.src.core.shared.dtos import (
    Identifier,
    Slug,
    Lifecycle,
    Metadata,
    Header,
    Data as Testcase,
)


class Testset(Identifier, Slug, Lifecycle, Header):
    testcases: Optional[List[Testcase]] = None
    metadata: Optional[Metadata] = None


class TestsetRequest(BaseModel):
    testset: Testset


class TagsRequest(BaseModel):
    metadata: Metadata


class TestsetResponse(BaseModel):
    count: int
    testset: Optional[Testset] = None


class TestsetsResponse(BaseModel):
    count: int
    testsets: List[Testset] = []


class TestcaseResponse(BaseModel):
    count: int
    testcase: Optional[Testcase] = None
