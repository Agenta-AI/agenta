from typing import Optional, List

from pydantic import BaseModel

from oss.src.core.shared.dtos import (
    Reference,
    Windowing,
)
from oss.src.core.queries.dtos import (
    Query,
    QueryCreate,
    QueryEdit,
    QueryQuery,
    #
    QueryVariant,
    QueryVariantCreate,
    QueryVariantEdit,
    QueryVariantQuery,
    #
    QueryRevision,
    QueryRevisionCreate,
    QueryRevisionEdit,
    QueryRevisionQuery,
    QueryRevisionCommit,
    QueryRevisionsLog,
    #
    SimpleQuery,
    SimpleQueryCreate,
    SimpleQueryEdit,
    SimpleQueryQuery,
)


# QUERIES ----------------------------------------------------------------------


class QueryCreateRequest(BaseModel):
    query: QueryCreate


class QueryEditRequest(BaseModel):
    query: QueryEdit


class QueryQueryRequest(BaseModel):
    query: Optional[QueryQuery] = None
    #
    query_refs: Optional[List[Reference]] = None
    #
    include_archived: Optional[bool] = None
    #
    windowing: Optional[Windowing] = None


class QueryResponse(BaseModel):
    count: int = 0
    query: Optional[Query] = None


class QueriesResponse(BaseModel):
    count: int = 0
    queries: List[Query] = []


# QUERY VARIANTS ---------------------------------------------------------------


class QueryVariantCreateRequest(BaseModel):
    query_variant: QueryVariantCreate


class QueryVariantEditRequest(BaseModel):
    query_variant: QueryVariantEdit


class QueryVariantQueryRequest(BaseModel):
    query_variant: Optional[QueryVariantQuery] = None
    #
    query_refs: Optional[List[Reference]] = None
    query_variant_refs: Optional[List[Reference]] = None
    #
    include_archived: Optional[bool] = None
    #
    windowing: Optional[Windowing] = None


class QueryVariantForkRequest(BaseModel):
    source_query_variant_ref: Reference
    target_query_ref: Reference
    #
    slug: Optional[str] = None
    #
    name: Optional[str] = None
    description: Optional[str] = None


class QueryVariantResponse(BaseModel):
    count: int = 0
    query_variant: Optional[QueryVariant] = None


class QueryVariantsResponse(BaseModel):
    count: int = 0
    query_variants: List[QueryVariant] = []


# QUERY REVISIONS --------------------------------------------------------------


class QueryRevisionCreateRequest(BaseModel):
    query_revision: QueryRevisionCreate


class QueryRevisionEditRequest(BaseModel):
    query_revision: QueryRevisionEdit


class QueryRevisionQueryRequest(BaseModel):
    query_revision: Optional[QueryRevisionQuery] = None
    #
    query_refs: Optional[List[Reference]] = None
    query_variant_refs: Optional[List[Reference]] = None
    query_revision_refs: Optional[List[Reference]] = None
    #
    include_archived: Optional[bool] = None
    #
    windowing: Optional[Windowing] = None


class QueryRevisionCommitRequest(BaseModel):
    query_revision_commit: QueryRevisionCommit


class QueryRevisionsLogRequest(BaseModel):
    query_revisions: QueryRevisionsLog


class QueryRevisionRetrieveRequest(BaseModel):
    query_ref: Optional[Reference] = None
    query_variant_ref: Optional[Reference] = None
    query_revision_ref: Optional[Reference] = None


class QueryRevisionResponse(BaseModel):
    count: int = 0
    query_revision: Optional[QueryRevision] = None


class QueryRevisionsResponse(BaseModel):
    count: int = 0
    query_revisions: List[QueryRevision] = []


# SIMPLE QUERIES ---------------------------------------------------------------


class SimpleQueryCreateRequest(BaseModel):
    query: SimpleQueryCreate


class SimpleQueryEditRequest(BaseModel):
    query: SimpleQueryEdit


class SimpleQueryQueryRequest(BaseModel):
    query: Optional[SimpleQueryQuery] = None
    #
    query_refs: Optional[List[Reference]] = None
    #
    include_archived: Optional[bool] = False
    #
    windowing: Optional[Windowing] = None


class SimpleQueryResponse(BaseModel):
    count: int = 0
    query: Optional[SimpleQuery] = None


class SimpleQueriesResponse(BaseModel):
    count: int = 0
    queries: List[SimpleQuery] = []
