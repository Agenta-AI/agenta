from typing import Optional, List
from uuid import UUID

from pydantic import BaseModel

from oss.src.core.shared.dtos import (
    Windowing,
)
from oss.src.core.testcases.dtos import (
    Testcase,
)


# TESTCASES --------------------------------------------------------------------


class TestcasesQueryRequest(BaseModel):
    testcase_ids: Optional[List[UUID]] = None
    #
    testset_id: Optional[UUID] = None
    testset_revision_id: Optional[UUID] = None
    #
    windowing: Optional[Windowing] = None


class TestcaseResponse(BaseModel):
    count: int = 0
    testcase: Optional[Testcase] = None


class TestcasesResponse(BaseModel):
    count: int = 0
    testcases: List[Testcase] = []
    windowing: Optional[Windowing] = None
