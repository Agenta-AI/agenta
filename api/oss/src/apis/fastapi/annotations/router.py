from typing import Optional, Union
from uuid import UUID

from fastapi import APIRouter, Request, Response, status, HTTPException

from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions, suppress_exceptions

from oss.src.core.shared.dtos import (
    Link,
)
from oss.src.core.annotations.service import (
    AnnotationsService,
)

from oss.src.apis.fastapi.annotations.models import (
    AnnotationCreateRequest,
    AnnotationEditRequest,
    AnnotationQueryRequest,
    AnnotationResponse,
    AnnotationsResponse,
    AnnotationLinkResponse,
)

if is_ee():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access, FORBIDDEN_EXCEPTION


log = get_module_logger(__name__)


class AnnotationsRouter:
    def __init__(
        self,
        *,
        annotations_service: AnnotationsService,
    ):
        self.annotations_service = annotations_service

        self.router = APIRouter()

        # ANNOTATIONS ----------------------------------------------------------

        # POST /api/annotations/
        self.router.add_api_route(
            "/",
            self.create_annotation,
            methods=["POST"],
            operation_id="create_annotation",
            status_code=status.HTTP_200_OK,
            response_model=AnnotationResponse,
            response_model_exclude_none=True,
        )

        # GET /api/annotations/{trace_id}
        self.router.add_api_route(
            "/{trace_id}",
            self.fetch_annotation,
            methods=["GET"],
            operation_id="fetch_annotation_by_trace_id",
            status_code=status.HTTP_200_OK,
            response_model=AnnotationResponse,
            response_model_exclude_none=True,
        )

        # GET /api/annotations/{trace_id}/{span_id}
        self.router.add_api_route(
            "/{trace_id}/{span_id}",
            self.fetch_annotation,
            methods=["GET"],
            operation_id="fetch_annotation",
            status_code=status.HTTP_200_OK,
            response_model=AnnotationResponse,
            response_model_exclude_none=True,
        )

        # PUT /api/annotations/{trace_id}
        self.router.add_api_route(
            "/{trace_id}",
            self.edit_annotation,
            methods=["PATCH"],
            operation_id="edit_annotation_by_trace_id",
            status_code=status.HTTP_200_OK,
            response_model=AnnotationResponse,
            response_model_exclude_none=True,
        )

        # PUT /api/annotations/{trace_id}/{span_id}
        self.router.add_api_route(
            "/{trace_id}/{span_id}",
            self.edit_annotation,
            methods=["PATCH"],
            operation_id="edit_annotation",
            status_code=status.HTTP_200_OK,
            response_model=AnnotationResponse,
            response_model_exclude_none=True,
        )

        # DELETE /api/annotations/{trace_id}
        self.router.add_api_route(
            "/{trace_id}",
            self.delete_annotation,
            methods=["DELETE"],
            operation_id="delete_annotation_by_trace_id",
            status_code=status.HTTP_200_OK,
            response_model=AnnotationLinkResponse,
            response_model_exclude_none=True,
        )

        # DELETE /api/annotations/{trace_id}/{span_id}
        self.router.add_api_route(
            "/{trace_id}/{span_id}",
            self.delete_annotation,
            methods=["DELETE"],
            operation_id="delete_annotation",
            status_code=status.HTTP_200_OK,
            response_model=AnnotationLinkResponse,
            response_model_exclude_none=True,
        )

        # POST /api/annotations/query                  # FIX ME / REMOVE ME #
        self.router.add_api_route(
            "/query",
            self.query_annotations,
            methods=["POST"],
            operation_id="query_annotations",
            status_code=status.HTTP_200_OK,
            response_model=AnnotationsResponse,
            response_model_exclude_none=True,
        )

    # ANNOTATIONS --------------------------------------------------------------

    @intercept_exceptions()
    async def create_annotation(
        self,
        request: Request,
        *,
        annotation_create_request: AnnotationCreateRequest,
    ) -> AnnotationResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_ANNOTATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        annotation = await self.annotations_service.create(
            organization_id=UUID(request.state.organization_id),
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            annotation_create=annotation_create_request.annotation,
        )

        annotation_response = AnnotationResponse(
            count=1 if annotation else 0,
            annotation=annotation,
        )

        return annotation_response

    @intercept_exceptions()
    @suppress_exceptions(default=AnnotationResponse(), exclude=[HTTPException])
    async def fetch_annotation(
        self,
        request: Request,
        *,
        trace_id: str,
        span_id: Optional[str] = None,
    ) -> Union[Response, AnnotationResponse]:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_ANNOTATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        annotation = await self.annotations_service.fetch(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id) if request.state.user_id else None,
            #
            trace_id=trace_id,
            span_id=span_id,
        )

        annotation_response = AnnotationResponse(
            count=1 if annotation else 0,
            annotation=annotation,
        )

        return annotation_response

    @intercept_exceptions()
    async def edit_annotation(
        self,
        request: Request,
        *,
        trace_id: str,
        span_id: Optional[str] = None,
        #
        annotation_edit_request: AnnotationEditRequest,
    ) -> AnnotationResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_ANNOTATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        annotation = await self.annotations_service.edit(
            organization_id=UUID(request.state.organization_id),
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            trace_id=trace_id,
            span_id=span_id,
            #
            annotation_edit=annotation_edit_request.annotation,
        )

        annotation_response = AnnotationResponse(
            count=1 if annotation else 0,
            annotation=annotation,
        )

        return annotation_response

    @intercept_exceptions()
    async def delete_annotation(
        self,
        request: Request,
        *,
        trace_id: str,
        span_id: Optional[str] = None,
    ) -> AnnotationLinkResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_ANNOTATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        annotation_link: Optional[Link] = await self.annotations_service.delete(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            trace_id=trace_id,
            span_id=span_id,
        )

        annotation_link_response = AnnotationLinkResponse(
            count=1 if annotation_link else 0,
            annotation_link=annotation_link,
        )

        return annotation_link_response

    @intercept_exceptions()
    @suppress_exceptions(default=AnnotationsResponse(), exclude=[HTTPException])
    async def query_annotations(
        self,
        request: Request,
        *,
        annotation_query_request: AnnotationQueryRequest,
    ) -> AnnotationsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_ANNOTATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        annotations = await self.annotations_service.query(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id) if request.state.user_id else None,
            #
            annotation_query=annotation_query_request.annotation,
            #
            annotation_links=annotation_query_request.annotation_links,
            #
            windowing=annotation_query_request.windowing,
        )

        annotations_response = AnnotationsResponse(
            count=len(annotations),
            annotations=annotations,
        )

        return annotations_response
