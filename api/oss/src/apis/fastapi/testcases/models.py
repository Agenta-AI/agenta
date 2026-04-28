from typing import Optional, List
from uuid import UUID

from pydantic import BaseModel, Field

from oss.src.core.shared.dtos import (
    Windowing,
    Reference,
)
from oss.src.core.testcases.dtos import (
    Testcase,
)


# TESTCASES --------------------------------------------------------------------


class TestcasesQueryRequest(BaseModel):
    testcase_ids: Optional[List[UUID]] = Field(
        default=None,
        description="Explicit list of testcase IDs to fetch. Combine with `testset_id` or testset references to scope the lookup.",
    )
    #
    testset_id: Optional[UUID] = Field(
        default=None,
        description="Return all testcases stored in this testset. The testset owns its testcases as a content-addressed bag; a revision references a subset of these.",
    )
    #
    testset_ref: Optional[Reference] = Field(
        default=None,
        description="Testset reference used to resolve the latest revision on the default variant. The revision's ordered testcase IDs are used for the lookup and pagination.",
    )
    testset_variant_ref: Optional[Reference] = Field(
        default=None,
        description="Testset variant reference used to resolve the latest revision on that variant.",
    )
    testset_revision_ref: Optional[Reference] = Field(
        default=None,
        description="Specific testset revision reference. The revision's ordered testcase IDs drive the lookup and cursor pagination.",
    )
    #
    windowing: Optional[Windowing] = Field(
        default=None,
        description="Cursor-based pagination. When a revision reference is used, the cursor walks the revision's deterministic testcase ID list.",
    )


class TestcaseResponse(BaseModel):
    count: int = Field(
        default=0,
        description="1 if a testcase was returned, 0 otherwise.",
    )
    testcase: Optional[Testcase] = Field(
        default=None,
        description="The testcase blob. `data` carries the user-defined columns; `testcase_dedup_id` (inside `data`) is the caller-supplied dedup key when present.",
    )


class TestcasesResponse(BaseModel):
    count: int = Field(
        default=0,
        description="Number of testcases returned on this page.",
    )
    testcases: List[Testcase] = Field(
        default_factory=list,
        description="Testcase blobs matching the query, in revision-order when scoped by a revision reference.",
    )
    windowing: Optional[Windowing] = Field(
        default=None,
        description="Cursor for the next page, if more results exist.",
    )
