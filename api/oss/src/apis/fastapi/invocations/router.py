from typing import Optional, Union
from uuid import UUID

from fastapi import APIRouter, Request, status, Response, HTTPException

from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions, suppress_exceptions

from oss.src.core.invocations.service import (
    InvocationsService,
)
from oss.src.core.shared.dtos import (
    Link,
)

from oss.src.apis.fastapi.invocations.models import (
    InvocationCreateRequest,
    InvocationEditRequest,
    InvocationResponse,
    InvocationsResponse,
    InvocationQueryRequest,
    InvocationLinkResponse,
)

if is_ee():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access, FORBIDDEN_EXCEPTION


log = get_module_logger(__name__)


class InvocationsRouter:
    def __init__(
        self,
        *,
        invocations_service: InvocationsService,
    ):
        self.invocations_service = invocations_service

        self.router = APIRouter()

        # INVOCATIONS ----------------------------------------------------------

        # POST /api/invocations/
        self.router.add_api_route(
            "/",
            self.create_invocation,
            methods=["POST"],
            operation_id="create_invocation",
            status_code=status.HTTP_200_OK,
            response_model=InvocationResponse,
            response_model_exclude_none=True,
        )

        # GET /api/invocations/{trace_id}
        self.router.add_api_route(
            "/{trace_id}",
            self.fetch_invocation,
            methods=["GET"],
            operation_id="fetch_invocation_by_trace_id",
            status_code=status.HTTP_200_OK,
            response_model=InvocationResponse,
            response_model_exclude_none=True,
        )

        # GET /api/invocations/{trace_id}/{span_id}
        self.router.add_api_route(
            "/{trace_id}/{span_id}",
            self.fetch_invocation,
            methods=["GET"],
            operation_id="fetch_invocation",
            status_code=status.HTTP_200_OK,
            response_model=InvocationResponse,
            response_model_exclude_none=True,
        )

        # PUT /api/invocations/{trace_id}
        self.router.add_api_route(
            "/{trace_id}",
            self.edit_invocation,
            methods=["PATCH"],
            operation_id="edit_invocation_by_trace_id",
            status_code=status.HTTP_200_OK,
            response_model=InvocationResponse,
            response_model_exclude_none=True,
        )

        # PUT /api/invocations/{trace_id}/{span_id}
        self.router.add_api_route(
            "/{trace_id}/{span_id}",
            self.edit_invocation,
            methods=["PATCH"],
            operation_id="edit_invocation",
            status_code=status.HTTP_200_OK,
            response_model=InvocationResponse,
            response_model_exclude_none=True,
        )

        # DELETE /api/invocations/{trace_id}
        self.router.add_api_route(
            "/{trace_id}",
            self.delete_invocation,
            methods=["DELETE"],
            operation_id="delete_invocation_by_trace_id",
            status_code=status.HTTP_200_OK,
            response_model=InvocationLinkResponse,
            response_model_exclude_none=True,
        )

        # DELETE /api/invocations/{trace_id}/{span_id}
        self.router.add_api_route(
            "/{trace_id}/{span_id}",
            self.delete_invocation,
            methods=["DELETE"],
            operation_id="delete_invocation",
            status_code=status.HTTP_200_OK,
            response_model=InvocationLinkResponse,
            response_model_exclude_none=True,
        )

        # POST /api/invocations/query
        self.router.add_api_route(
            "/query",
            self.query_invocations,
            methods=["POST"],
            operation_id="query_invocations",
            status_code=status.HTTP_200_OK,
            response_model=InvocationsResponse,
            response_model_exclude_none=True,
        )

    # INVOCATIONS --------------------------------------------------------------

    @intercept_exceptions()
    async def create_invocation(
        self,
        request: Request,
        *,
        invocation_create_request: InvocationCreateRequest,
    ) -> InvocationResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_INVOCATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        invocation = await self.invocations_service.create(
            organization_id=UUID(request.state.organization_id),
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            invocation_create=invocation_create_request.invocation,
        )

        invocation_response = InvocationResponse(
            count=1 if invocation else 0,
            invocation=invocation,
        )

        return invocation_response

    @intercept_exceptions()
    @suppress_exceptions(default=InvocationResponse(), exclude=[HTTPException])
    async def fetch_invocation(
        self,
        request: Request,
        *,
        trace_id: str,
        span_id: Optional[str] = None,
    ) -> Union[Response, InvocationResponse]:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_INVOCATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        invocation = await self.invocations_service.fetch(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id) if request.state.user_id else None,
            #
            trace_id=trace_id,
            span_id=span_id,
        )

        invocation_response = InvocationResponse(
            count=1 if invocation else 0,
            invocation=invocation,
        )

        return invocation_response

    @intercept_exceptions()
    async def edit_invocation(
        self,
        request: Request,
        *,
        trace_id: str,
        span_id: Optional[str] = None,
        #
        invocation_edit_request: InvocationEditRequest,
    ) -> InvocationResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_INVOCATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        invocation = await self.invocations_service.edit(
            organization_id=UUID(request.state.organization_id),
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            trace_id=trace_id,
            span_id=span_id,
            #
            invocation_edit=invocation_edit_request.invocation,
        )

        invocation_response = InvocationResponse(
            count=1 if invocation else 0,
            invocation=invocation,
        )

        return invocation_response

    @intercept_exceptions()
    async def delete_invocation(
        self,
        request: Request,
        *,
        trace_id: str,
        span_id: Optional[str] = None,
    ) -> InvocationLinkResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_INVOCATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        invocation_link: Optional[Link] = await self.invocations_service.delete(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            trace_id=trace_id,
            span_id=span_id,
        )

        invocation_link_response = InvocationLinkResponse(
            count=1 if invocation_link else 0,
            invocation_link=invocation_link,
        )

        return invocation_link_response

    @intercept_exceptions()
    @suppress_exceptions(default=InvocationsResponse(), exclude=[HTTPException])
    async def query_invocations(
        self,
        request: Request,
        *,
        invocation_query_request: InvocationQueryRequest,
    ) -> InvocationsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_INVOCATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        invocations = await self.invocations_service.query(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id) if request.state.user_id else None,
            #
            invocation_query=invocation_query_request.invocation,
            #
            invocation_links=invocation_query_request.invocation_links,
            #
            windowing=invocation_query_request.windowing,
        )

        invocations_response = InvocationsResponse(
            count=len(invocations),
            invocations=invocations,
        )

        return invocations_response
