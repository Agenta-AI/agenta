from typing import Optional, List
from uuid import UUID

from pydantic import BaseModel

from oss.src.utils.exceptions import Support

from oss.src.core.shared.dtos import (
    Windowing,
    Reference,
)
from oss.src.core.testcases.dtos import (
    Testcase,
)


# TESTCASES --------------------------------------------------------------------


class TestcasesQueryRequest(BaseModel):
    testcase_ids: Optional[List[UUID]] = None
    #
    testset_id: Optional[UUID] = None
    #
    testset_ref: Optional[Reference] = None
    testset_variant_ref: Optional[Reference] = None
    testset_revision_ref: Optional[Reference] = None
    #
    windowing: Optional[Windowing] = None


class TestcaseResponse(Support):
    count: int = 0
    testcase: Optional[Testcase] = None


class TestcasesResponse(Support):
    count: int = 0
    testcases: List[Testcase] = []
    windowing: Optional[Windowing] = None
