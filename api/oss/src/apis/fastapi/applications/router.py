from uuid import UUID
from typing import Optional

from fastapi import APIRouter, status, Request, Depends, HTTPException

from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions, suppress_exceptions
from oss.src.utils.caching import set_cache

from oss.src.core.shared.dtos import (
    Reference,
)
from oss.src.core.applications.services import (
    ApplicationsService,
    SimpleApplicationsService,
)

from oss.src.apis.fastapi.applications.models import (
    ApplicationCreateRequest,
    ApplicationEditRequest,
    ApplicationQueryRequest,
    ApplicationForkRequest,
    ApplicationRevisionsLogRequest,
    ApplicationResponse,
    ApplicationsResponse,
    #
    ApplicationVariantCreateRequest,
    ApplicationVariantEditRequest,
    ApplicationVariantQueryRequest,
    ApplicationVariantResponse,
    ApplicationVariantsResponse,
    #
    ApplicationRevisionCreateRequest,
    ApplicationRevisionEditRequest,
    ApplicationRevisionQueryRequest,
    ApplicationRevisionCommitRequest,
    ApplicationRevisionRetrieveRequest,
    ApplicationRevisionResponse,
    ApplicationRevisionsResponse,
    #
    SimpleApplicationCreateRequest,
    SimpleApplicationEditRequest,
    SimpleApplicationQueryRequest,
    SimpleApplicationResponse,
    SimpleApplicationsResponse,
)
from oss.src.apis.fastapi.applications.utils import (
    parse_application_variant_query_request_from_params,
    parse_application_variant_query_request_from_body,
    merge_application_variant_query_requests,
)

if is_ee():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access, FORBIDDEN_EXCEPTION


log = get_module_logger(__name__)
# TEMPORARY: Disabling name editing
RENAME_APPS_DISABLED_MESSAGE = "Renaming applications is temporarily disabled."


class ApplicationsRouter:
    def __init__(
        self,
        *,
        applications_service: ApplicationsService,
    ):
        self.applications_service = applications_service

        self.router = APIRouter()

        # APPLICATIONS ---------------------------------------------------------

        self.router.add_api_route(
            "/",
            self.create_application,
            methods=["POST"],
            operation_id="create_application",
            status_code=status.HTTP_200_OK,
            response_model=ApplicationResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{application_id}",
            self.fetch_application,
            methods=["GET"],
            operation_id="fetch_application",
            status_code=status.HTTP_200_OK,
            response_model=ApplicationResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{application_id}",
            self.edit_application,
            methods=["PUT"],
            operation_id="edit_application",
            status_code=status.HTTP_200_OK,
            response_model=ApplicationResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{application_id}/archive",
            self.archive_application,
            methods=["POST"],
            operation_id="archive_application",
            status_code=status.HTTP_200_OK,
            response_model=ApplicationResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{application_id}/unarchive",
            self.unarchive_application,
            methods=["POST"],
            operation_id="unarchive_application",
            status_code=status.HTTP_200_OK,
            response_model=ApplicationResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/query",
            self.query_applications,
            methods=["POST"],
            operation_id="query_applications",
            status_code=status.HTTP_200_OK,
            response_model=ApplicationsResponse,
            response_model_exclude_none=True,
        )

        # APPLICATION VARIANTS -------------------------------------------------

        self.router.add_api_route(
            "/variants/",
            self.create_application_variant,
            methods=["POST"],
            operation_id="create_application_variant",
            status_code=status.HTTP_200_OK,
            response_model=ApplicationVariantResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/variants/{application_variant_id}",
            self.fetch_application_variant,
            methods=["GET"],
            operation_id="fetch_application_variant",
            status_code=status.HTTP_200_OK,
            response_model=ApplicationVariantResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/variants/{application_variant_id}",
            self.edit_application_variant,
            methods=["PUT"],
            operation_id="edit_application_variant",
            status_code=status.HTTP_200_OK,
            response_model=ApplicationVariantResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/variants/{application_variant_id}/archive",
            self.archive_application_variant,
            methods=["POST"],
            operation_id="archive_application_variant",
            status_code=status.HTTP_200_OK,
            response_model=ApplicationVariantResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/variants/{application_variant_id}/unarchive",
            self.unarchive_application_variant,
            methods=["POST"],
            operation_id="unarchive_application_variant",
            status_code=status.HTTP_200_OK,
            response_model=ApplicationVariantResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/variants/query",
            self.query_application_variants,
            methods=["POST"],
            operation_id="query_application_variants",
            status_code=status.HTTP_200_OK,
            response_model=ApplicationVariantsResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/variants/fork",
            self.fork_application_variant,
            methods=["POST"],
            operation_id="fork_application_variant",
            status_code=status.HTTP_200_OK,
            response_model=ApplicationVariantResponse,
            response_model_exclude_none=True,
        )

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

        self.router.add_api_route(
            "/revisions/",
            self.create_application_revision,
            methods=["POST"],
            operation_id="create_application_revision",
            status_code=status.HTTP_200_OK,
            response_model=ApplicationRevisionResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/{application_revision_id}",
            self.fetch_application_revision,
            methods=["GET"],
            operation_id="fetch_application_revision",
            status_code=status.HTTP_200_OK,
            response_model=ApplicationRevisionResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/{application_revision_id}",
            self.edit_application_revision,
            methods=["PUT"],
            operation_id="edit_application_revision",
            status_code=status.HTTP_200_OK,
            response_model=ApplicationRevisionResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/{application_revision_id}/archive",
            self.archive_application_revision,
            methods=["POST"],
            operation_id="archive_application_revision",
            status_code=status.HTTP_200_OK,
            response_model=ApplicationRevisionResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/{application_revision_id}/unarchive",
            self.unarchive_application_revision,
            methods=["POST"],
            operation_id="unarchive_application_revision",
            status_code=status.HTTP_200_OK,
            response_model=ApplicationRevisionResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/query",
            self.query_application_revisions,
            methods=["POST"],
            operation_id="query_application_revisions",
            status_code=status.HTTP_200_OK,
            response_model=ApplicationRevisionsResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/commit",
            self.commit_application_revision,
            methods=["POST"],
            operation_id="commit_application_revision",
            status_code=status.HTTP_200_OK,
            response_model=ApplicationRevisionResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/log",
            self.log_application_revisions,
            methods=["POST"],
            operation_id="log_application_revisions",
            status_code=status.HTTP_200_OK,
            response_model=ApplicationRevisionsResponse,
            response_model_exclude_none=True,
        )

    # APPLICATIONS -------------------------------------------------------------

    @intercept_exceptions()
    async def create_application(
        self,
        request: Request,
        *,
        application_id: Optional[UUID] = None,
        #
        application_create_request: ApplicationCreateRequest,
    ) -> ApplicationResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_APPLICATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        application = await self.applications_service.create_application(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            application_id=application_id,
            #
            application_create=application_create_request.application,
        )

        return ApplicationResponse(
            count=1 if application else 0,
            application=application,
        )

    @intercept_exceptions()
    @suppress_exceptions(default=ApplicationResponse())
    async def fetch_application(
        self,
        request: Request,
        *,
        application_id: UUID,
    ) -> ApplicationResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_APPLICATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        application = await self.applications_service.fetch_application(
            project_id=UUID(request.state.project_id),
            #
            application_ref=Reference(id=application_id),
        )

        return ApplicationResponse(
            count=1 if application else 0,
            application=application,
        )

    @intercept_exceptions()
    async def edit_application(
        self,
        request: Request,
        *,
        application_id: UUID,
        #
        application_edit_request: ApplicationEditRequest,
    ) -> ApplicationResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_APPLICATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        if str(application_id) != str(application_edit_request.application.id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Application ID in path does not match application ID in request body.",
            )

        # TEMPORARY: Disabling name editing
        existing_application = await self.applications_service.fetch_application(
            project_id=UUID(request.state.project_id),
            application_ref=Reference(id=application_id),
        )
        if existing_application is None:
            return ApplicationResponse()

        edit_model = application_edit_request.application
        if (
            "name" in edit_model.model_fields_set
            and edit_model.name is not None
            and edit_model.name != existing_application.name
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=RENAME_APPS_DISABLED_MESSAGE,
            )

        application = await self.applications_service.edit_application(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            application_edit=application_edit_request.application,
        )

        return ApplicationResponse(
            count=1 if application else 0,
            application=application,
        )

    @intercept_exceptions()
    async def archive_application(
        self,
        request: Request,
        *,
        application_id: UUID,
    ) -> ApplicationResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_APPLICATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        application = await self.applications_service.archive_application(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            application_id=application_id,
        )

        return ApplicationResponse(
            count=1 if application else 0,
            application=application,
        )

    @intercept_exceptions()
    async def unarchive_application(
        self,
        request: Request,
        *,
        application_id: UUID,
    ) -> ApplicationResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_APPLICATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        application = await self.applications_service.unarchive_application(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            application_id=application_id,
        )

        return ApplicationResponse(
            count=1 if application else 0,
            application=application,
        )

    @intercept_exceptions()
    @suppress_exceptions(default=ApplicationsResponse())
    async def query_applications(
        self,
        request: Request,
        *,
        application_query_request: ApplicationQueryRequest,
    ) -> ApplicationsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_APPLICATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        applications = await self.applications_service.query_applications(
            project_id=UUID(request.state.project_id),
            #
            application_query=application_query_request.application,
            #
            application_refs=application_query_request.application_refs,
            #
            include_archived=application_query_request.include_archived,
            #
            windowing=application_query_request.windowing,
        )

        applications_response = ApplicationsResponse(
            count=len(applications),
            applications=applications,
        )

        return applications_response

    # APPLICATION VARIANTS -----------------------------------------------------

    @intercept_exceptions()
    async def create_application_variant(
        self,
        request: Request,
        *,
        application_variant_create_request: ApplicationVariantCreateRequest,
    ) -> ApplicationVariantResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_APPLICATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        application_variant = await self.applications_service.create_application_variant(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            application_variant_create=application_variant_create_request.application_variant,
        )

        application_variant_response = ApplicationVariantResponse(
            count=1 if application_variant else 0,
            application_variant=application_variant,
        )

        return application_variant_response

    @intercept_exceptions()
    async def fetch_application_variant(
        self,
        request: Request,
        *,
        application_variant_id: UUID,
    ) -> ApplicationVariantResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_APPLICATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        application_variant = await self.applications_service.fetch_application_variant(
            project_id=UUID(request.state.project_id),
            #
            application_variant_ref=Reference(id=application_variant_id),
        )

        application_variant_response = ApplicationVariantResponse(
            count=1 if application_variant else 0,
            application_variant=application_variant,
        )

        return application_variant_response

    @intercept_exceptions()
    async def edit_application_variant(
        self,
        request: Request,
        *,
        application_variant_id: UUID,
        #
        application_variant_edit_request: ApplicationVariantEditRequest,
    ) -> ApplicationVariantResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_APPLICATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        if str(application_variant_id) != str(
            application_variant_edit_request.application_variant.id
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Application variant ID in path does not match application variant ID in request body.",
            )

        application_variant = await self.applications_service.edit_application_variant(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            application_variant_edit=application_variant_edit_request.application_variant,
        )

        application_variant_response = ApplicationVariantResponse(
            count=1 if application_variant else 0,
            application_variant=application_variant,
        )

        return application_variant_response

    @intercept_exceptions()
    async def archive_application_variant(
        self,
        request: Request,
        *,
        application_variant_id: UUID,
    ) -> ApplicationVariantResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_APPLICATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        application_variant = (
            await self.applications_service.archive_application_variant(
                project_id=UUID(request.state.project_id),
                user_id=UUID(request.state.user_id),
                #
                application_variant_id=application_variant_id,
            )
        )

        application_variant_response = ApplicationVariantResponse(
            count=1 if application_variant else 0,
            application_variant=application_variant,
        )

        return application_variant_response

    @intercept_exceptions()
    async def unarchive_application_variant(
        self,
        request: Request,
        *,
        application_variant_id: UUID,
    ) -> ApplicationVariantResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_APPLICATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        application_variant = (
            await self.applications_service.unarchive_application_variant(
                project_id=UUID(request.state.project_id),
                user_id=UUID(request.state.user_id),
                #
                application_variant_id=application_variant_id,
            )
        )

        application_variant_response = ApplicationVariantResponse(
            count=1 if application_variant else 0,
            application_variant=application_variant,
        )

        return application_variant_response

    @intercept_exceptions()
    async def query_application_variants(
        self,
        request: Request,
        *,
        query_request_params: Optional[ApplicationVariantQueryRequest] = Depends(
            parse_application_variant_query_request_from_params
        ),
    ) -> ApplicationVariantsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_APPLICATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        body_json = None
        query_request_body = None

        try:
            body_json = await request.json()

            if body_json:
                query_request_body = parse_application_variant_query_request_from_body(
                    **body_json
                )

        except Exception:
            pass

        workflow_variant_query_request = merge_application_variant_query_requests(
            query_request_params,
            query_request_body,
        )

        application_variants = await self.applications_service.query_application_variants(
            project_id=UUID(request.state.project_id),
            #
            application_variant_query=workflow_variant_query_request.application_variant,
            #
            application_refs=workflow_variant_query_request.application_refs,
            application_variant_refs=workflow_variant_query_request.application_variant_refs,
            #
            include_archived=workflow_variant_query_request.include_archived,
            #
            windowing=workflow_variant_query_request.windowing,
        )

        application_variants_response = ApplicationVariantsResponse(
            count=len(application_variants),
            application_variants=application_variants,
        )

        return application_variants_response

    @intercept_exceptions()
    async def fork_application_variant(
        self,
        request: Request,
        *,
        application_variant_id: Optional[UUID] = None,
        #
        application_variant_fork_request: ApplicationForkRequest,
    ) -> ApplicationVariantResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_APPLICATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        fork_request = application_variant_fork_request.application

        if application_variant_id:
            if (
                fork_request.application_variant_id
                and fork_request.application_variant_id != application_variant_id
            ):
                return ApplicationVariantResponse()

            if not fork_request.application_variant_id:
                fork_request.application_variant_id = application_variant_id

        application_variant = await self.applications_service.fork_application_variant(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            application_fork=fork_request,
        )

        application_variant_response = ApplicationVariantResponse(
            count=1 if application_variant else 0,
            application_variant=application_variant,
        )

        return application_variant_response

    # APPLICATION REVISIONS ----------------------------------------------------

    @intercept_exceptions()
    @suppress_exceptions(default=ApplicationRevisionResponse(), exclude=[HTTPException])
    async def retrieve_application_revision(
        self,
        request: Request,
        *,
        application_revision_retrieve_request: ApplicationRevisionRetrieveRequest,
    ) -> ApplicationRevisionResponse:
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
            application_revision = await self.applications_service.fetch_application_revision(
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

    @intercept_exceptions()
    async def create_application_revision(
        self,
        request: Request,
        *,
        application_revision_create_request: ApplicationRevisionCreateRequest,
    ) -> ApplicationRevisionResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_APPLICATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        application_revision = await self.applications_service.create_application_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            application_revision_create=application_revision_create_request.application_revision,
        )

        return ApplicationRevisionResponse(
            count=1 if application_revision else 0,
            application_revision=application_revision,
        )

    @intercept_exceptions()
    @suppress_exceptions(default=ApplicationRevisionResponse(), exclude=[HTTPException])
    async def fetch_application_revision(
        self,
        request: Request,
        *,
        application_revision_id: UUID,
    ) -> ApplicationRevisionResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_APPLICATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        application_revision = (
            await self.applications_service.fetch_application_revision(
                project_id=UUID(request.state.project_id),
                #
                application_revision_ref=Reference(id=application_revision_id),
            )
        )

        return ApplicationRevisionResponse(
            count=1 if application_revision else 0,
            application_revision=application_revision,
        )

    @intercept_exceptions()
    async def edit_application_revision(
        self,
        request: Request,
        *,
        application_revision_id: UUID,
        #
        application_revision_edit_request: ApplicationRevisionEditRequest,
    ) -> ApplicationRevisionResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_APPLICATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        if str(application_revision_id) != str(
            application_revision_edit_request.application_revision.id
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Application revision ID in path does not match application revision ID in request body.",
            )

        application_revision = await self.applications_service.edit_application_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            application_revision_edit=application_revision_edit_request.application_revision,
        )

        return ApplicationRevisionResponse(
            count=1 if application_revision else 0,
            application_revision=application_revision,
        )

    @intercept_exceptions()
    async def archive_application_revision(
        self,
        request: Request,
        *,
        application_revision_id: UUID,
    ) -> ApplicationRevisionResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_APPLICATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        application_revision = (
            await self.applications_service.archive_application_revision(
                project_id=UUID(request.state.project_id),
                user_id=UUID(request.state.user_id),
                #
                application_revision_id=application_revision_id,
            )
        )

        return ApplicationRevisionResponse(
            count=1 if application_revision else 0,
            application_revision=application_revision,
        )

    @intercept_exceptions()
    async def unarchive_application_revision(
        self,
        request: Request,
        *,
        application_revision_id: UUID,
    ) -> ApplicationRevisionResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_APPLICATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        application_revision = (
            await self.applications_service.unarchive_application_revision(
                project_id=UUID(request.state.project_id),
                user_id=UUID(request.state.user_id),
                #
                application_revision_id=application_revision_id,
            )
        )

        return ApplicationRevisionResponse(
            count=1 if application_revision else 0,
            application_revision=application_revision,
        )

    @intercept_exceptions()
    @suppress_exceptions(default=ApplicationRevisionsResponse())
    async def query_application_revisions(
        self,
        request: Request,
        *,
        application_revision_query_request: ApplicationRevisionQueryRequest,
    ) -> ApplicationRevisionsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_APPLICATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        application_revisions = await self.applications_service.query_application_revisions(
            project_id=UUID(request.state.project_id),
            #
            application_revision_query=application_revision_query_request.application_revision,
            #
            application_refs=application_revision_query_request.application_refs,
            application_variant_refs=application_revision_query_request.application_variant_refs,
            application_revision_refs=application_revision_query_request.application_revision_refs,
            #
            include_archived=application_revision_query_request.include_archived,
            #
            windowing=application_revision_query_request.windowing,
        )

        return ApplicationRevisionsResponse(
            count=len(application_revisions),
            application_revisions=application_revisions,
        )

    @intercept_exceptions()
    async def commit_application_revision(
        self,
        request: Request,
        *,
        application_revision_commit_request: ApplicationRevisionCommitRequest,
    ) -> ApplicationRevisionResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_APPLICATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        application_revision = await self.applications_service.commit_application_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            application_revision_commit=application_revision_commit_request.application_revision_commit,
        )

        return ApplicationRevisionResponse(
            count=1 if application_revision else 0,
            application_revision=application_revision,
        )

    @intercept_exceptions()
    async def log_application_revisions(
        self,
        request: Request,
        *,
        application_revisions_log_request: ApplicationRevisionsLogRequest,
    ) -> ApplicationRevisionsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_APPLICATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        application_revisions = (
            await self.applications_service.log_application_revisions(
                project_id=UUID(request.state.project_id),
                #
                application_revisions_log=application_revisions_log_request.application,
            )
        )

        revisions_response = ApplicationRevisionsResponse(
            count=len(application_revisions),
            application_revisions=application_revisions,
        )

        return revisions_response


class SimpleApplicationsRouter:
    def __init__(
        self,
        *,
        simple_applications_service: SimpleApplicationsService,
    ):
        self.simple_applications_service = simple_applications_service
        self.applications_service = (
            self.simple_applications_service.applications_service
        )

        self.router = APIRouter()

        # SIMPLE APPLICATIONS --------------------------------------------------

        self.router.add_api_route(
            "/",
            self.create_simple_application,
            methods=["POST"],
            operation_id="create_simple_application",
            status_code=status.HTTP_200_OK,
            response_model=SimpleApplicationResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/query",
            self.query_simple_applications,
            methods=["POST"],
            operation_id="query_simple_applications",
            status_code=status.HTTP_200_OK,
            response_model=SimpleApplicationsResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{application_id}",
            self.fetch_simple_application,
            methods=["GET"],
            operation_id="fetch_simple_application",
            status_code=status.HTTP_200_OK,
            response_model=SimpleApplicationResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{application_id}",
            self.edit_simple_application,
            methods=["PUT"],
            operation_id="edit_simple_application",
            status_code=status.HTTP_200_OK,
            response_model=SimpleApplicationResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{application_id}/archive",
            self.archive_simple_application,
            methods=["POST"],
            operation_id="archive_simple_application",
            status_code=status.HTTP_200_OK,
            response_model=SimpleApplicationResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{application_id}/unarchive",
            self.unarchive_simple_application,
            methods=["POST"],
            operation_id="unarchive_simple_application",
            status_code=status.HTTP_200_OK,
            response_model=SimpleApplicationResponse,
            response_model_exclude_none=True,
        )

    # SIMPLE APPLICATIONS ------------------------------------------------------

    @intercept_exceptions()
    async def create_simple_application(
        self,
        request: Request,
        *,
        application_id: Optional[UUID] = None,
        #
        simple_application_create_request: SimpleApplicationCreateRequest,
    ) -> SimpleApplicationResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_APPLICATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        simple_application = await self.simple_applications_service.create(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            simple_application_create=simple_application_create_request.application,
            #
            application_id=application_id,
        )

        simple_application_response = SimpleApplicationResponse(
            count=1 if simple_application else 0,
            application=simple_application,
        )

        return simple_application_response

    @intercept_exceptions()
    @suppress_exceptions(default=SimpleApplicationResponse())
    async def fetch_simple_application(
        self,
        request: Request,
        *,
        application_id: UUID,
    ) -> SimpleApplicationResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_APPLICATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        simple_application = await self.simple_applications_service.fetch(
            project_id=UUID(request.state.project_id),
            #
            application_id=application_id,
        )

        simple_application_response = SimpleApplicationResponse(
            count=1 if simple_application else 0,
            application=simple_application,
        )

        return simple_application_response

    @intercept_exceptions()
    async def edit_simple_application(
        self,
        request: Request,
        *,
        application_id: UUID,
        #
        simple_application_edit_request: SimpleApplicationEditRequest,
    ) -> SimpleApplicationResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_APPLICATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        if str(application_id) != str(simple_application_edit_request.application.id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Application ID in path does not match application ID in request body.",
            )

        # TEMPORARY: Disabling name editing
        existing_application = await self.simple_applications_service.applications_service.fetch_application(
            project_id=UUID(request.state.project_id),
            application_ref=Reference(id=application_id),
        )
        if existing_application is None:
            return SimpleApplicationResponse()

        edit_model = simple_application_edit_request.application
        if (
            "name" in edit_model.model_fields_set
            and edit_model.name is not None
            and edit_model.name != existing_application.name
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=RENAME_APPS_DISABLED_MESSAGE,
            )

        simple_application = await self.simple_applications_service.edit(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            simple_application_edit=simple_application_edit_request.application,
        )

        simple_application_response = SimpleApplicationResponse(
            count=1 if simple_application else 0,
            application=simple_application,
        )

        return simple_application_response

    @intercept_exceptions()
    async def archive_simple_application(
        self,
        request: Request,
        *,
        application_id: UUID,
    ) -> SimpleApplicationResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_APPLICATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        simple_application = await self.simple_applications_service.archive(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            application_id=application_id,
        )

        simple_application_response = SimpleApplicationResponse(
            count=1 if simple_application else 0,
            application=simple_application,
        )

        return simple_application_response

    @intercept_exceptions()
    async def unarchive_simple_application(
        self,
        request: Request,
        *,
        application_id: UUID,
    ) -> SimpleApplicationResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_APPLICATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        simple_application = await self.simple_applications_service.unarchive(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            application_id=application_id,
        )

        simple_application_response = SimpleApplicationResponse(
            count=1 if simple_application else 0,
            application=simple_application,
        )

        return simple_application_response

    @intercept_exceptions()
    async def query_simple_applications(
        self,
        request: Request,
        *,
        simple_application_query_request: SimpleApplicationQueryRequest,
    ) -> SimpleApplicationsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_APPLICATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        simple_applications = await self.simple_applications_service.query(
            project_id=UUID(request.state.project_id),
            #
            simple_application_query=simple_application_query_request.application,
            #
            include_archived=simple_application_query_request.include_archived,
            #
            windowing=simple_application_query_request.windowing,
        )

        simple_applications_response = SimpleApplicationsResponse(
            count=len(simple_applications),
            applications=simple_applications,
        )

        return simple_applications_response
