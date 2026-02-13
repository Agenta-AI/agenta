from uuid import UUID
from typing import Optional

from fastapi import APIRouter, status, Request, Depends, HTTPException

from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions, suppress_exceptions
from oss.src.utils.caching import get_cache, set_cache, invalidate_cache


from oss.src.core.applications.dtos import (
    ApplicationRevision,
)
from oss.src.core.applications.service import (
    LegacyApplicationsService,
)

from oss.src.apis.fastapi.applications.models import (
    ApplicationRevisionRetrieveRequest,
    ApplicationRevisionResponse,
    #
    LegacyApplicationCreateRequest,
    LegacyApplicationEditRequest,
    LegacyApplicationResponse,
)
from oss.src.apis.fastapi.applications.utils import (
    parse_application_revision_retrieve_request_from_params,
    parse_application_revision_retrieve_request_from_body,
)

if is_ee():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access, FORBIDDEN_EXCEPTION


log = get_module_logger(__name__)


class LegacyApplicationsRouter:
    def __init__(
        self,
        *,
        legacy_applications_service: LegacyApplicationsService,
    ):
        self.legacy_applications_service = legacy_applications_service

        self.router = APIRouter()

        # APPLICATION REVISIONS ------------------------------------------------

        self.router.add_api_route(
            "/revisions/retrieve",
            self.retrieve_application_revision,
            methods=["POST"],
            operation_id="retrieve_application_revision",
            status_code=status.HTTP_200_OK,
            response_model=ApplicationRevisionResponse,
            response_model_exclude_none=True,
        )

        # LEGACY APPLICATIONS --------------------------------------------------

        self.router.add_api_route(
            "/",
            self.create_legacy_application,
            methods=["POST"],
            response_model=LegacyApplicationResponse,
            status_code=status.HTTP_200_OK,
            summary="Create Application",
            description="Create a new application using workflow data stored in legacy format",
            operation_id="create_legacy_application",
        )

        self.router.add_api_route(
            "/{application_id}",
            self.fetch_legacy_application,
            methods=["GET"],
            response_model=LegacyApplicationResponse,
            status_code=status.HTTP_200_OK,
            summary="Fetch Application",
            description="Get an application using workflow data stored in legacy format",
            operation_id="fetch_legacy_application",
        )

        self.router.add_api_route(
            "/{application_id}",
            self.edit_legacy_application,
            methods=["PUT"],
            response_model=LegacyApplicationResponse,
            status_code=status.HTTP_200_OK,
            summary="Update Application",
            description="Update an application using workflow data stored in legacy format",
            operation_id="edit_legacy_application",
        )

    # APPLICATION REVISIONS ----------------------------------------------------

    @intercept_exceptions()
    @suppress_exceptions(default=ApplicationRevisionResponse(), exclude=[HTTPException])
    async def retrieve_application_revision(
        self,
        request: Request,
        *,
        application_revision_retrieve_request: ApplicationRevisionRetrieveRequest,
    ):
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_APPLICATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        cache_key = {
            "artifact_ref": application_revision_retrieve_request.application_ref,  # type: ignore
            "variant_ref": application_revision_retrieve_request.application_variant_ref,  # type: ignore
            "revision_ref": application_revision_retrieve_request.application_revision_ref,  # type: ignore
        }

        application_revision = None
        # application_revision = await get_cache(
        #     namespace="applications:retrieve",
        #     project_id=request.state.project_id,
        #     user_id=request.state.user_id,
        #     key=cache_key,
        #     model=ApplicationRevision,
        # )

        if not application_revision:
            application_revision = await self.legacy_applications_service.retrieve(
                project_id=UUID(request.state.project_id),
                #
                application_ref=application_revision_retrieve_request.application_ref,  # type: ignore
                application_variant_ref=application_revision_retrieve_request.application_variant_ref,  # type: ignore
                application_revision_ref=application_revision_retrieve_request.application_revision_ref,  # type: ignore
            )

            await set_cache(
                namespace="applications:retrieve",
                project_id=request.state.project_id,
                user_id=request.state.user_id,
                key=cache_key,
                value=application_revision,
            )

        application_revision_response = ApplicationRevisionResponse(
            count=1 if application_revision else 0,
            application_revision=application_revision,
        )

        return application_revision_response

    # LEGACY APPLICATIONS ------------------------------------------------------

    @intercept_exceptions()
    async def create_legacy_application(
        self,
        request: Request,
        *,
        legacy_application_create_request: LegacyApplicationCreateRequest,
    ):
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_APPLICATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        legacy_application = await self.legacy_applications_service.create(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            legacy_application_create=legacy_application_create_request.application,
        )

        legacy_application_response = LegacyApplicationResponse(
            count=1 if legacy_application else 0,
            application=legacy_application,
        )

        return legacy_application_response

    @intercept_exceptions()
    @suppress_exceptions(default=LegacyApplicationResponse(), exclude=[HTTPException])
    async def fetch_legacy_application(
        self,
        request: Request,
        *,
        application_id: UUID,
    ):
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_APPLICATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        legacy_application = await self.legacy_applications_service.fetch(
            project_id=UUID(request.state.project_id),
            #
            application_id=application_id,
        )

        legacy_application_response = LegacyApplicationResponse(
            count=1 if legacy_application else 0,
            application=legacy_application,
        )

        return legacy_application_response

    @intercept_exceptions()
    async def edit_legacy_application(
        self,
        request: Request,
        *,
        application_id: UUID,
        #
        legacy_application_edit_request: LegacyApplicationEditRequest,
    ):
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_APPLICATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        if str(application_id) != str(legacy_application_edit_request.application.id):
            return LegacyApplicationResponse()

        legacy_application = await self.legacy_applications_service.edit(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            legacy_application_edit=legacy_application_edit_request.application,
        )

        legacy_application_response = LegacyApplicationResponse(
            count=1 if legacy_application else 0,
            application=legacy_application,
        )

        return legacy_application_response
