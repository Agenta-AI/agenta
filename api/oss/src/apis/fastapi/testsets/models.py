from typing import Optional, List

from pydantic import BaseModel, Field

from oss.src.utils.exceptions import Support

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
    #
    SimpleTestset,
    SimpleTestsetCreate,
    SimpleTestsetEdit,
    SimpleTestsetQuery,
)


# TESTSETS ---------------------------------------------------------------------


class TestsetCreateRequest(BaseModel):
    testset: TestsetCreate = Field(
        description="Testset artifact to create. The call only creates the artifact row; testcases are added by committing a revision (see /testsets/revisions/commit) or by using the /simple/testsets/ surface.",
    )


class TestsetEditRequest(BaseModel):
    testset: TestsetEdit = Field(
        description="Testset artifact fields to update. The `id` in the body must match the `testset_id` in the path.",
    )


class TestsetQueryRequest(BaseModel):
    testset: Optional[TestsetQuery] = Field(
        default=None,
        description="Attribute filter (name, description, slug, flags, tags, meta, folder).",
    )
    #
    testset_refs: Optional[List[Reference]] = Field(
        default=None,
        description="Restrict the query to specific testsets by reference (id or slug).",
    )
    #
    include_archived: Optional[bool] = Field(
        default=None,
        description="Include soft-deleted testsets.",
    )
    #
    windowing: Optional[Windowing] = Field(
        default=None,
        description="Cursor-based pagination. See the Query Pattern guide.",
    )


class TestsetResponse(Support):
    count: int = Field(
        default=0,
        description="1 if a testset was returned, 0 otherwise.",
    )
    testset: Optional[Testset] = Field(
        default=None,
        description="The testset artifact. Does not include testcases.",
    )


class TestsetsResponse(Support):
    count: int = Field(
        default=0,
        description="Number of testsets returned on this page.",
    )
    testsets: List[Testset] = Field(
        default_factory=list,
        description="Testset artifacts matching the query, without testcases.",
    )
    windowing: Optional[Windowing] = Field(
        default=None,
        description="Cursor for the next page, if more results exist.",
    )


# TESTSET VARIANTS -------------------------------------------------------------


class TestsetVariantCreateRequest(BaseModel):
    testset_variant: TestsetVariantCreate = Field(
        description="Variant to create on an existing testset. Pass `testset_id` to identify the parent artifact.",
    )


class TestsetVariantEditRequest(BaseModel):
    testset_variant: TestsetVariantEdit = Field(
        description="Variant fields to update. The `id` in the body must match the `testset_variant_id` in the path.",
    )


class TestsetVariantQueryRequest(BaseModel):
    testset_variant: Optional[TestsetVariantQuery] = Field(
        default=None,
        description="Attribute filter on the variant (name, description, slug, flags, tags, meta).",
    )
    #
    testset_refs: Optional[List[Reference]] = Field(
        default=None,
        description="Scope to variants whose parent testset matches one of these references.",
    )
    testset_variant_refs: Optional[List[Reference]] = Field(
        default=None,
        description="Restrict the query to specific variants by reference (id or slug).",
    )
    #
    include_archived: Optional[bool] = Field(
        default=None,
        description="Include soft-deleted variants.",
    )
    #
    windowing: Optional[Windowing] = Field(
        default=None,
        description="Cursor-based pagination. See the Query Pattern guide.",
    )


class TestsetVariantResponse(Support):
    count: int = Field(
        default=0,
        description="1 if a variant was returned, 0 otherwise.",
    )
    testset_variant: Optional[TestsetVariant] = Field(
        default=None,
        description="The testset variant (branch).",
    )


class TestsetVariantsResponse(Support):
    count: int = Field(
        default=0,
        description="Number of variants returned.",
    )
    testset_variants: List[TestsetVariant] = Field(
        default_factory=list,
        description="Testset variants matching the query.",
    )


# TESTSET REVISIONS ------------------------------------------------------------


class TestsetRevisionCreateRequest(BaseModel):
    testset_revision: TestsetRevisionCreate = Field(
        description="Revision to create on an existing variant. Typically used to seed an empty revision; use /testsets/revisions/commit to set testcases.",
    )
    include_testcases: Optional[bool] = Field(
        default=None,
        description="Include full testcase objects in the response. Defaults to true when the response would carry revision data.",
    )


class TestsetRevisionEditRequest(BaseModel):
    testset_revision: TestsetRevisionEdit = Field(
        description="Revision fields to update. The `id` in the body must match the `testset_revision_id` in the path. Only metadata fields are editable; content is committed as a new revision.",
    )
    include_testcases: Optional[bool] = Field(
        default=None,
        description="Include full testcase objects in the response.",
    )


class TestsetRevisionQueryRequest(BaseModel):
    testset_revision: Optional[TestsetRevisionQuery] = Field(
        default=None,
        description="Attribute filter on the revision (name, description, slug, author, date, message).",
    )
    #
    testset_refs: Optional[List[Reference]] = Field(
        default=None,
        description="Scope revisions to these testsets.",
    )
    testset_variant_refs: Optional[List[Reference]] = Field(
        default=None,
        description="Scope revisions to these variants.",
    )
    testset_revision_refs: Optional[List[Reference]] = Field(
        default=None,
        description="Restrict to specific revisions by reference (id, slug, or version).",
    )
    #
    include_archived: Optional[bool] = Field(
        default=None,
        description="Include soft-deleted revisions.",
    )
    include_testcases: Optional[bool] = Field(
        default=None,
        description="Include full testcase objects for each returned revision. Defaults to true.",
    )
    #
    windowing: Optional[Windowing] = Field(
        default=None,
        description="Cursor-based pagination. See the Query Pattern guide.",
    )


class TestsetRevisionCommitRequest(BaseModel):
    testset_revision_commit: TestsetRevisionCommit = Field(
        description="New revision to commit. Pass either `data` (full replacement of the testcase list) or `delta` (add/remove/replace operations against the base revision) — not both.",
    )
    include_testcases: Optional[bool] = Field(
        default=None,
        description="Include full testcase objects in the response.",
    )


class TestsetRevisionRetrieveRequest(BaseModel):
    testset_ref: Optional[Reference] = Field(
        default=None,
        description="Testset reference. If only the testset is provided, the latest revision on its default variant is returned.",
    )
    testset_variant_ref: Optional[Reference] = Field(
        default=None,
        description="Variant reference. Returns the latest revision on that variant.",
    )
    testset_revision_ref: Optional[Reference] = Field(
        default=None,
        description="Revision reference. Returns that specific revision.",
    )
    #
    include_testcase_ids: Optional[bool] = Field(
        default=None,
        description="Include the ordered list of testcase IDs. Defaults to true (opt-out).",
    )
    include_testcases: Optional[bool] = Field(
        default=None,
        description="Include full testcase objects. Defaults to true (opt-out). Note: this opt-out default is the opposite of `/queries/revisions/retrieve`, where trace materialization is opt-in.",
    )
    #
    windowing: Optional[Windowing] = Field(
        default=None,
        description="Windowing applied to the testcases list when materialized.",
    )


class TestsetRevisionsLogRequest(BaseModel):
    testset_revision: TestsetRevisionsLog = Field(
        description="Scope for the log: one of `testset_id`, `testset_variant_id`, or `testset_revision_id`. Optional `depth` limits how far back to walk.",
    )
    include_testcases: Optional[bool] = Field(
        default=None,
        description="Include full testcase objects for each returned revision.",
    )


class TestsetRevisionResponse(Support):
    count: int = Field(
        default=0,
        description="1 if a revision was returned, 0 otherwise.",
    )
    testset_revision: Optional[TestsetRevision] = Field(
        default=None,
        description="The testset revision. `data.testcase_ids` is the ordered list of testcase IDs; `data.testcases` is populated when `include_testcases` is true.",
    )


class TestsetRevisionsResponse(Support):
    count: int = Field(
        default=0,
        description="Number of revisions returned.",
    )
    testset_revisions: List[TestsetRevision] = Field(
        default_factory=list,
        description="Testset revisions matching the query, in the requested order.",
    )


# SIMPLE TESTSETS --------------------------------------------------------------


class SimpleTestsetCreateRequest(BaseModel):
    testset: SimpleTestsetCreate = Field(
        description="Simple testset to create. `data.testcases` is committed as the first revision on a single variant in one call.",
    )


class SimpleTestsetEditRequest(BaseModel):
    testset: SimpleTestsetEdit = Field(
        description="Simple testset fields to update. If `data.testcases` is provided, a new revision is committed with those testcases.",
    )


class SimpleTestsetQueryRequest(BaseModel):
    testset: Optional[SimpleTestsetQuery] = Field(
        default=None,
        description="Attribute filter on the testset (flags, tags, meta).",
    )
    #
    testset_refs: Optional[List[Reference]] = Field(
        default=None,
        description="Restrict the query to specific testsets.",
    )
    #
    include_archived: Optional[bool] = Field(
        default=None,
        description="Include soft-deleted testsets.",
    )
    #
    windowing: Optional[Windowing] = Field(
        default=None,
        description="Cursor-based pagination. See the Query Pattern guide.",
    )


class SimpleTestsetResponse(Support):
    count: int = Field(
        default=0,
        description="1 if a testset was returned, 0 otherwise.",
    )
    testset: Optional[SimpleTestset] = Field(
        default=None,
        description="The testset with its latest revision testcases merged into `data.testcases`, and the revision ID on `revision_id`.",
    )


class SimpleTestsetsResponse(Support):
    count: int = Field(
        default=0,
        description="Number of simple testsets returned.",
    )
    testsets: List[SimpleTestset] = Field(
        default_factory=list,
        description="Simple testsets, each with its latest revision testcases merged in.",
    )
