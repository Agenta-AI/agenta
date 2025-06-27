from typing import Optional, List

from pydantic import BaseModel

from oss.src.core.shared.dtos import (
    Identifier,
    Slug,
    Lifecycle,
    Meta,
    Header,
    Data as Testcase,
)


class Testset(Identifier, Slug, Lifecycle, Header):
    testcases: Optional[List[Testcase]] = None
    meta: Optional[Meta] = None


class TestsetRequest(BaseModel):
    testset: Testset


class MetaRequest(BaseModel):
    meta: Meta


class TestsetResponse(BaseModel):
    count: int = 0
    testset: Optional[Testset] = None


class TestsetsResponse(BaseModel):
    count: int = 0
    testsets: List[Testset] = []


class TestcaseResponse(BaseModel):
    count: int = 0
    testcase: Optional[Testcase] = None
