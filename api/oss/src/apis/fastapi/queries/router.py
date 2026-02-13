from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Request, status, Depends, HTTPException

from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions, suppress_exceptions

from oss.src.core.shared.dtos import (
    Reference,
)
from oss.src.core.queries.service import (
    QueriesService,
    SimpleQueriesService,
)

from oss.src.apis.fastapi.queries.models import (
    QueryCreateRequest,
    QueryEditRequest,
    QueryQueryRequest,
    QueryResponse,
    QueriesResponse,
    #
    QueryRevisionCreateRequest,
    QueryRevisionEditRequest,
    QueryRevisionQueryRequest,
    QueryRevisionCommitRequest,
    QueryRevisionRetrieveRequest,
    QueryRevisionsLogRequest,
    QueryRevisionResponse,
    QueryRevisionsResponse,
    #
    SimpleQueryCreateRequest,
    SimpleQueryEditRequest,
    SimpleQueryQueryRequest,
    SimpleQueryResponse,
    SimpleQueriesResponse,
)

from oss.src.apis.fastapi.queries.utils import (
    parse_query_query_request_from_params,
    parse_query_query_request_from_body,
)

if is_ee():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access, FORBIDDEN_EXCEPTION


log = get_module_logger(__name__)


class QueriesRouter:
    def __init__(self, *, queries_service: QueriesService):
        self.queries_service = queries_service
        self.router = APIRouter()

        # QUERIES --------------------------------------------------------------

        self.router.add_api_route(
            "/",
            self.create_query,
            methods=["POST"],
            operation_id="create_query",
            status_code=status.HTTP_200_OK,
            response_model=QueryResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{query_id}",
            self.fetch_query,
            methods=["GET"],
            operation_id="fetch_query",
            status_code=status.HTTP_200_OK,
            response_model=QueryResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{query_id}",
            self.edit_query,
            methods=["PUT"],
            operation_id="edit_query",
            status_code=status.HTTP_200_OK,
            response_model=QueryResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{query_id}/archive",
            self.archive_query,
            methods=["POST"],
            operation_id="archive_query",
            status_code=status.HTTP_200_OK,
            response_model=QueryResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{query_id}/unarchive",
            self.unarchive_query,
            methods=["POST"],
            operation_id="unarchive_query",
            status_code=status.HTTP_200_OK,
            response_model=QueryResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/query",
            self.query_queries,
            methods=["POST"],
            operation_id="query_queries",
            status_code=status.HTTP_200_OK,
            response_model=QueriesResponse,
            response_model_exclude_none=True,
        )

        # QUERY VARIANTS -------------------------------------------------------

        # TODO: IMPLEMENT ME

        # QUERY REVISIONS ------------------------------------------------------

        self.router.add_api_route(
            "/revisions/retrieve",
            self.retrieve_query_revision,
            methods=["POST"],
            operation_id="retrieve_query_revision",
            status_code=status.HTTP_200_OK,
            response_model=QueryRevisionResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/",
            self.create_query_revision,
            methods=["POST"],
            operation_id="create_query_revision",
            status_code=status.HTTP_200_OK,
            response_model=QueryRevisionResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/{query_revision_id}",
            self.fetch_query_revision,
            methods=["GET"],
            operation_id="fetch_query_revision",
            status_code=status.HTTP_200_OK,
            response_model=QueryRevisionResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/{query_revision_id}",
            self.edit_query_revision,
            methods=["PUT"],
            operation_id="edit_query_revision",
            status_code=status.HTTP_200_OK,
            response_model=QueryRevisionResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/{query_revision_id}/archive",
            self.archive_query_revision,
            methods=["POST"],
            operation_id="archive_query_revision",
            status_code=status.HTTP_200_OK,
            response_model=QueryRevisionResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/{query_revision_id}/unarchive",
            self.unarchive_query_revision,
            methods=["POST"],
            operation_id="unarchive_query_revision",
            status_code=status.HTTP_200_OK,
            response_model=QueryRevisionResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/query",
            self.query_query_revisions,
            methods=["POST"],
            operation_id="query_query_revisions",
            status_code=status.HTTP_200_OK,
            response_model=QueryRevisionsResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/commit",
            self.commit_query_revision,
            methods=["POST"],
            operation_id="commit_query_revision",
            status_code=status.HTTP_200_OK,
            response_model=QueryRevisionResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/log",
            self.log_query_revisions,
            methods=["POST"],
            operation_id="log_query_revisions",
            status_code=status.HTTP_200_OK,
            response_model=QueryRevisionsResponse,
            response_model_exclude_none=True,
        )

    # QUERIES ------------------------------------------------------------------

    @intercept_exceptions()
    async def create_query(
        self,
        request: Request,
        *,
        query_id: Optional[UUID] = None,
        #
        query_create_request: QueryCreateRequest,
    ) -> QueryResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_QUERIES,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        query = await self.queries_service.create_query(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            query_id=query_id,
            #
            query_create=query_create_request.query,
        )

        query_response = QueryResponse(
            count=1 if query else 0,
            query=query,
        )

        return query_response

    @intercept_exceptions()
    @suppress_exceptions(default=QueryResponse(), exclude=[HTTPException])
    async def fetch_query(
        self,
        request: Request,
        *,
        query_id: UUID,
    ) -> QueryResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_QUERIES,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        query = await self.queries_service.fetch_query(
            project_id=UUID(request.state.project_id),
            #
            query_ref=Reference(id=query_id),
        )

        query_response = QueryResponse(
            count=1 if query else 0,
            query=query,
        )

        return query_response

    @intercept_exceptions()
    async def edit_query(
        self,
        request: Request,
        *,
        query_edit_request: QueryEditRequest,
        #
        query_id: UUID,
    ) -> QueryResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_QUERIES,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        if str(query_id) != str(query_edit_request.query.id):
            return QueryResponse()

        query = await self.queries_service.edit_query(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            query_edit=query_edit_request.query,
        )

        query_response = QueryResponse(
            count=1 if query else 0,
            query=query,
        )

        return query_response

    @intercept_exceptions()
    async def archive_query(
        self,
        request: Request,
        *,
        query_id: UUID,
    ) -> QueryResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_QUERIES,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        query = await self.queries_service.archive_query(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            query_id=query_id,
        )

        return QueryResponse(
            count=1 if query else 0,
            query=query,
        )

    @intercept_exceptions()
    async def unarchive_query(
        self,
        request: Request,
        *,
        query_id: UUID,
    ) -> QueryResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_QUERIES,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        query = await self.queries_service.unarchive_query(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            query_id=query_id,
        )

        query_response = QueryResponse(
            count=1 if query else 0,
            query=query,
        )

        return query_response

    @intercept_exceptions()
    @suppress_exceptions(default=QueriesResponse(), exclude=[HTTPException])
    async def query_queries(
        self,
        request: Request,
        *,
        query_request_params: QueryQueryRequest = Depends(
            parse_query_query_request_from_params
        ),
    ) -> QueriesResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_QUERIES,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        body_json = None
        query_request_body = None

        try:
            body_json = await request.json()

            if body_json:
                query_request_body = parse_query_query_request_from_body(**body_json)

        except Exception:  # pylint: disable=bare-except
            pass

        query_query_request = query_request_params or query_request_body

        queries = await self.queries_service.query_queries(
            project_id=UUID(request.state.project_id),
            #
            query=query_query_request.query if query_query_request else None,
            #
            query_refs=query_query_request.query_refs if query_query_request else None,
            #
            include_archived=(
                query_query_request.include_archived if query_query_request else None
            ),
            #
            windowing=query_query_request.windowing if query_query_request else None,
        )

        queries_response = QueriesResponse(
            count=len(queries),
            queries=queries,
        )

        return queries_response

    # QUERY REVISIONS ----------------------------------------------------------

    @intercept_exceptions()
    async def create_query_revision(
        self,
        request: Request,
        *,
        query_revision_create_request: QueryRevisionCreateRequest,
    ) -> QueryRevisionResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_QUERIES,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        query_revision = await self.queries_service.create_query_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            query_revision_create=query_revision_create_request.query_revision,
        )

        query_revision_response = QueryRevisionResponse(
            count=1 if query_revision else 0,
            query_revision=query_revision,
        )

        return query_revision_response

    @intercept_exceptions()
    @suppress_exceptions(default=QueryRevisionResponse(), exclude=[HTTPException])
    async def fetch_query_revision(
        self,
        request: Request,
        *,
        query_revision_id: UUID,
    ) -> QueryRevisionResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_QUERIES,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        query_revision = await self.queries_service.fetch_query_revision(
            project_id=UUID(request.state.project_id),
            #
            query_revision_ref=Reference(id=query_revision_id),
        )

        query_revision_response = QueryRevisionResponse(
            count=1 if query_revision else 0,
            query_revision=query_revision,
        )

        return query_revision_response

    @intercept_exceptions()
    async def edit_query_revision(
        self,
        request: Request,
        *,
        query_revision_edit_request: QueryRevisionEditRequest,
        #
        query_revision_id: UUID,
    ) -> QueryRevisionResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_QUERIES,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        if str(query_revision_id) != str(query_revision_edit_request.query_revision.id):
            return QueryRevisionResponse()

        query_revision = await self.queries_service.edit_query_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            query_revision_edit=query_revision_edit_request.query_revision,
        )

        query_revision_response = QueryRevisionResponse(
            count=1 if query_revision else 0,
            query_revision=query_revision,
        )

        return query_revision_response

    @intercept_exceptions()
    async def archive_query_revision(
        self,
        request: Request,
        *,
        query_revision_id: UUID,
    ) -> QueryRevisionResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_QUERIES,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        query_revision = await self.queries_service.archive_query_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            query_revision_id=query_revision_id,
        )

        query_revision_response = QueryRevisionResponse(
            count=1 if query_revision else 0,
            query_revision=query_revision,
        )

        return query_revision_response

    @intercept_exceptions()
    async def unarchive_query_revision(
        self,
        request: Request,
        *,
        query_revision_id: UUID,
    ) -> QueryRevisionResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_QUERIES,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        query_revision = await self.queries_service.unarchive_query_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            query_revision_id=query_revision_id,
        )

        query_revision_response = QueryRevisionResponse(
            count=1 if query_revision else 0,
            query_revision=query_revision,
        )

        return query_revision_response

    @intercept_exceptions()
    @suppress_exceptions(default=QueryRevisionsResponse(), exclude=[HTTPException])
    async def query_query_revisions(
        self,
        request: Request,
        *,
        query_revision_query_request: QueryRevisionQueryRequest,
    ) -> QueryRevisionsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_QUERIES,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        query_revisions = await self.queries_service.query_query_revisions(
            project_id=UUID(request.state.project_id),
            #
            query_revision=query_revision_query_request.query_revision,
            #
            query_refs=query_revision_query_request.query_refs,
            query_variant_refs=query_revision_query_request.query_variant_refs,
            query_revision_refs=query_revision_query_request.query_revision_refs,
            #
            include_archived=query_revision_query_request.include_archived,
            #
            windowing=query_revision_query_request.windowing,
        )

        query_revisions_response = QueryRevisionsResponse(
            count=len(query_revisions),
            query_revisions=query_revisions,
        )

        return query_revisions_response

    @intercept_exceptions()
    async def commit_query_revision(
        self,
        request: Request,
        *,
        query_revision_commit_request: QueryRevisionCommitRequest,
    ) -> QueryRevisionResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_QUERIES,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        query_revision = await self.queries_service.commit_query_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            query_revision_commit=query_revision_commit_request.query_revision_commit,
        )

        query_revision_response = QueryRevisionResponse(
            count=1 if query_revision else 0,
            query_revision=query_revision,
        )

        return query_revision_response

    @intercept_exceptions()
    @suppress_exceptions(default=QueryRevisionsResponse(), exclude=[HTTPException])
    async def log_query_revisions(
        self,
        request: Request,
        *,
        query_revisions_log_request: QueryRevisionsLogRequest,
    ) -> QueryRevisionsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_QUERIES,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        query_revisions = await self.queries_service.log_query_revisions(
            project_id=UUID(request.state.project_id),
            #
            query_revisions_log=query_revisions_log_request.query_revisions,
        )

        revisions_response = QueryRevisionsResponse(
            count=len(query_revisions),
            query_revisions=query_revisions,
        )

        return revisions_response

    @intercept_exceptions()
    @suppress_exceptions(default=QueryRevisionResponse(), exclude=[HTTPException])
    async def retrieve_query_revision(
        self,
        request: Request,
        *,
        query_revision_retrieve_request: QueryRevisionRetrieveRequest,
    ) -> QueryRevisionResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_QUERIES,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        query_revision = await self.queries_service.fetch_query_revision(
            project_id=UUID(request.state.project_id),
            #
            query_ref=query_revision_retrieve_request.query_ref,
            query_variant_ref=query_revision_retrieve_request.query_variant_ref,
            query_revision_ref=query_revision_retrieve_request.query_revision_ref,
        )

        query_revision_response = QueryRevisionResponse(
            count=1 if query_revision else 0,
            query_revision=query_revision,
        )

        return query_revision_response


class SimpleQueriesRouter:
    def __init__(
        self,
        *,
        simple_queries_service: SimpleQueriesService,
    ):
        self.simple_queries_service = simple_queries_service

        self.router = APIRouter()

        # SIMPLE QUERIES -------------------------------------------------------

        self.router.add_api_route(
            "/",
            self.create_simple_query,
            methods=["POST"],
            operation_id="create_simple_query",
            status_code=status.HTTP_200_OK,
            response_model=SimpleQueryResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{query_id}",
            self.fetch_simple_query,
            methods=["GET"],
            operation_id="fetch_simple_query",
            status_code=status.HTTP_200_OK,
            response_model=SimpleQueryResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{query_id}",
            self.edit_simple_query,
            methods=["PUT"],
            operation_id="edit_simple_query",
            status_code=status.HTTP_200_OK,
            response_model=SimpleQueryResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{query_id}/archive",
            self.archive_simple_query,
            methods=["POST"],
            operation_id="archive_simple_query",
            status_code=status.HTTP_200_OK,
            response_model=SimpleQueryResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{query_id}/unarchive",
            self.unarchive_simple_query,
            methods=["POST"],
            operation_id="unarchive_simple_query",
            status_code=status.HTTP_200_OK,
            response_model=SimpleQueryResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/query",
            self.query_simple_queries,
            methods=["POST"],
            operation_id="query_simple_queries",
            status_code=status.HTTP_200_OK,
            response_model=SimpleQueriesResponse,
            response_model_exclude_none=True,
        )

    # SIMPLE QUERIES -----------------------------------------------------------

    @intercept_exceptions()
    async def create_simple_query(
        self,
        request: Request,
        *,
        query_id: Optional[UUID] = None,
        #
        simple_query_create_request: SimpleQueryCreateRequest,
    ) -> SimpleQueryResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_QUERIES,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        simple_query = await self.simple_queries_service.create(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            query_id=query_id,
            #
            simple_query_create=simple_query_create_request.query,
        )

        simple_query_response = SimpleQueryResponse(
            count=1 if simple_query else 0,
            query=simple_query,
        )

        return simple_query_response

    @intercept_exceptions()
    @suppress_exceptions(default=SimpleQueryResponse(), exclude=[HTTPException])
    async def fetch_simple_query(
        self,
        request: Request,
        *,
        query_id: UUID,
    ) -> SimpleQueryResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_QUERIES,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        simple_query = await self.simple_queries_service.fetch(
            project_id=UUID(request.state.project_id),
            #
            query_id=query_id,
        )

        simple_query_response = SimpleQueryResponse(
            count=1 if simple_query else 0,
            query=simple_query,
        )

        return simple_query_response

    @intercept_exceptions()
    async def edit_simple_query(
        self,
        request: Request,
        *,
        query_id: UUID,
        #
        simple_query_edit_request: SimpleQueryEditRequest,
    ) -> SimpleQueryResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_QUERIES,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        simple_query = await self.simple_queries_service.edit(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            query_id=query_id,
            #
            simple_query_edit=simple_query_edit_request.query,
        )

        simple_query_response = SimpleQueryResponse(
            count=1 if simple_query else 0,
            query=simple_query,
        )

        return simple_query_response

    @intercept_exceptions()
    async def archive_simple_query(
        self,
        request: Request,
        *,
        query_id: UUID,
    ) -> SimpleQueryResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_QUERIES,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        simple_query = await self.simple_queries_service.archive(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            query_id=query_id,
        )

        simple_query_response = SimpleQueryResponse(
            count=1 if simple_query else 0,
            query=simple_query,
        )

        return simple_query_response

    @intercept_exceptions()
    async def unarchive_simple_query(
        self,
        request: Request,
        *,
        query_id: UUID,
    ) -> SimpleQueryResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_QUERIES,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        simple_query = await self.simple_queries_service.unarchive(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            query_id=query_id,
        )

        simple_query_response = SimpleQueryResponse(
            count=1 if simple_query else 0,
            query=simple_query,
        )

        return simple_query_response

    @intercept_exceptions()
    @suppress_exceptions(default=SimpleQueriesResponse(), exclude=[HTTPException])
    async def query_simple_queries(
        self,
        *,
        request: Request,
        #
        simple_query_query_request: SimpleQueryQueryRequest,
    ) -> SimpleQueriesResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_QUERIES,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        simple_queries = await self.simple_queries_service.query(
            project_id=UUID(request.state.project_id),
            #
            query=simple_query_query_request.query,
            #
            query_refs=simple_query_query_request.query_refs,
            #
            include_archived=simple_query_query_request.include_archived,
            #
            windowing=simple_query_query_request.windowing,
        )

        simple_queries_response = SimpleQueriesResponse(
            count=len(simple_queries),
            queries=simple_queries,
        )

        return simple_queries_response
