from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Request, status, Depends, HTTPException

from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions, suppress_exceptions

from oss.src.core.shared.dtos import (
    Reference,
)
from oss.src.core.environments.dtos import (
    EnvironmentFlags,
    EnvironmentEdit,
    #
    SimpleEnvironment,
)
from oss.src.core.environments.service import (
    SimpleEnvironmentsService,
    EnvironmentsService,
)

from oss.src.apis.fastapi.environments.models import (
    EnvironmentCreateRequest,
    EnvironmentEditRequest,
    EnvironmentQueryRequest,
    EnvironmentRevisionsLogRequest,
    EnvironmentResponse,
    EnvironmentsResponse,
    #
    EnvironmentVariantCreateRequest,
    EnvironmentVariantEditRequest,
    EnvironmentVariantQueryRequest,
    EnvironmentVariantResponse,
    EnvironmentVariantsResponse,
    #
    EnvironmentRevisionCreateRequest,
    EnvironmentRevisionEditRequest,
    EnvironmentRevisionQueryRequest,
    EnvironmentRevisionCommitRequest,
    EnvironmentRevisionRetrieveRequest,
    EnvironmentRevisionResponse,
    EnvironmentRevisionsResponse,
    #
    SimpleEnvironmentCreateRequest,
    SimpleEnvironmentEditRequest,
    SimpleEnvironmentQueryRequest,
    SimpleEnvironmentResponse,
    SimpleEnvironmentsResponse,
)
from oss.src.apis.fastapi.environments.utils import (
    parse_environment_query_request_from_params,
    parse_environment_query_request_from_body,
    merge_environment_query_requests,
    parse_environment_variant_query_request_from_params,
    parse_environment_variant_query_request_from_body,
    merge_environment_variant_query_requests,
    parse_environment_revision_query_request_from_params,
    parse_environment_revision_query_request_from_body,
    merge_environment_revision_query_requests,
)

if is_ee():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access, FORBIDDEN_EXCEPTION


log = get_module_logger(__name__)


class EnvironmentsRouter:
    def __init__(
        self,
        *,
        environments_service: EnvironmentsService,
    ):
        self.environments_service = environments_service

        self.router = APIRouter()

        # ENVIRONMENTS ---------------------------------------------------------

        self.router.add_api_route(
            "/",
            self.create_environment,
            methods=["POST"],
            operation_id="create_environment",
            status_code=status.HTTP_200_OK,
            response_model=EnvironmentResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{environment_id}",
            self.fetch_environment,
            methods=["GET"],
            operation_id="fetch_environment",
            status_code=status.HTTP_200_OK,
            response_model=EnvironmentResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{environment_id}",
            self.edit_environment,
            methods=["PUT"],
            operation_id="edit_environment",
            status_code=status.HTTP_200_OK,
            response_model=EnvironmentResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{environment_id}/archive",
            self.archive_environment,
            methods=["POST"],
            operation_id="archive_environment",
            status_code=status.HTTP_200_OK,
            response_model=EnvironmentResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{environment_id}/unarchive",
            self.unarchive_environment,
            methods=["POST"],
            operation_id="unarchive_environment",
            status_code=status.HTTP_200_OK,
            response_model=EnvironmentResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/query",
            self.query_environments,
            methods=["POST"],
            operation_id="query_environments",
            status_code=status.HTTP_200_OK,
            response_model=EnvironmentsResponse,
            response_model_exclude_none=True,
        )

        # ENVIRONMENT VARIANTS -------------------------------------------------

        self.router.add_api_route(
            "/variants/",
            self.create_environment_variant,
            methods=["POST"],
            operation_id="create_environment_variant",
            status_code=status.HTTP_200_OK,
            response_model=EnvironmentVariantResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/variants/{environment_variant_id}",
            self.fetch_environment_variant,
            methods=["GET"],
            operation_id="fetch_environment_variant",
            status_code=status.HTTP_200_OK,
            response_model=EnvironmentVariantResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/variants/{environment_variant_id}",
            self.edit_environment_variant,
            methods=["PUT"],
            operation_id="edit_environment_variant",
            status_code=status.HTTP_200_OK,
            response_model=EnvironmentVariantResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/variants/{environment_variant_id}/archive",
            self.archive_environment_variant,
            methods=["POST"],
            operation_id="archive_environment_variant",
            status_code=status.HTTP_200_OK,
            response_model=EnvironmentVariantResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/variants/{environment_variant_id}/unarchive",
            self.unarchive_environment_variant,
            methods=["POST"],
            operation_id="unarchive_environment_variant",
            status_code=status.HTTP_200_OK,
            response_model=EnvironmentVariantResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/variants/query",
            self.query_environment_variants,
            methods=["POST"],
            operation_id="query_environment_variants",
            status_code=status.HTTP_200_OK,
            response_model=EnvironmentVariantsResponse,
            response_model_exclude_none=True,
        )

        # ENVIRONMENT REVISIONS ------------------------------------------------

        self.router.add_api_route(
            "/revisions/retrieve",
            self.retrieve_environment_revision,
            methods=["POST"],
            operation_id="retrieve_environment_revision",
            status_code=status.HTTP_200_OK,
            response_model=EnvironmentRevisionResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/",
            self.create_environment_revision,
            methods=["POST"],
            operation_id="create_environment_revision",
            status_code=status.HTTP_200_OK,
            response_model=EnvironmentRevisionResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/{environment_revision_id}",
            self.fetch_environment_revision,
            methods=["GET"],
            operation_id="fetch_environment_revision",
            status_code=status.HTTP_200_OK,
            response_model=EnvironmentRevisionResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/{environment_revision_id}",
            self.edit_environment_revision,
            methods=["PUT"],
            operation_id="edit_environment_revision",
            status_code=status.HTTP_200_OK,
            response_model=EnvironmentRevisionResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/{environment_revision_id}/archive",
            self.archive_environment_revision,
            methods=["POST"],
            operation_id="archive_environment_revision",
            status_code=status.HTTP_200_OK,
            response_model=EnvironmentRevisionResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/{environment_revision_id}/unarchive",
            self.unarchive_environment_revision,
            methods=["POST"],
            operation_id="unarchive_environment_revision",
            status_code=status.HTTP_200_OK,
            response_model=EnvironmentRevisionResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/query",
            self.query_environment_revisions,
            methods=["POST"],
            operation_id="query_environment_revisions",
            status_code=status.HTTP_200_OK,
            response_model=EnvironmentRevisionsResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/commit",
            self.commit_environment_revision,
            methods=["POST"],
            operation_id="commit_environment_revision",
            status_code=status.HTTP_200_OK,
            response_model=EnvironmentRevisionResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/log",
            self.log_environment_revisions,
            methods=["POST"],
            operation_id="log_environment_revisions",
            status_code=status.HTTP_200_OK,
            response_model=EnvironmentRevisionsResponse,
            response_model_exclude_none=True,
        )

    # ENVIRONMENTS ---------------------------------------------------------

    @intercept_exceptions()
    async def create_environment(
        self,
        request: Request,
        *,
        environment_id: Optional[UUID] = None,
        #
        environment_create_request: EnvironmentCreateRequest,
    ) -> EnvironmentResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_ENVIRONMENTS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        environment = await self.environments_service.create_environment(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            environment_id=environment_id,
            #
            environment_create=environment_create_request.environment,
        )

        return EnvironmentResponse(
            count=1 if environment else 0,
            environment=environment,
        )

    @intercept_exceptions()
    @suppress_exceptions(default=EnvironmentResponse(), exclude=[HTTPException])
    async def fetch_environment(
        self,
        request: Request,
        *,
        environment_id: UUID,
    ) -> EnvironmentResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_ENVIRONMENTS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        environment = await self.environments_service.fetch_environment(
            project_id=UUID(request.state.project_id),
            #
            environment_ref=Reference(id=environment_id),
        )

        return EnvironmentResponse(
            count=1 if environment else 0,
            environment=environment,
        )

    @intercept_exceptions()
    async def edit_environment(
        self,
        request: Request,
        *,
        environment_id: UUID,
        #
        environment_edit_request: EnvironmentEditRequest,
    ) -> EnvironmentResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_ENVIRONMENTS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        if str(environment_id) != str(environment_edit_request.environment.id):
            return EnvironmentResponse()

        environment = await self.environments_service.edit_environment(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            environment_edit=environment_edit_request.environment,
        )

        return EnvironmentResponse(
            count=1 if environment else 0,
            environment=environment,
        )

    @intercept_exceptions()
    async def archive_environment(
        self,
        request: Request,
        *,
        environment_id: UUID,
    ) -> EnvironmentResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_ENVIRONMENTS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        environment = await self.environments_service.archive_environment(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            environment_id=environment_id,
        )

        return EnvironmentResponse(
            count=1 if environment else 0,
            environment=environment,
        )

    @intercept_exceptions()
    async def unarchive_environment(
        self,
        request: Request,
        *,
        environment_id: UUID,
    ) -> EnvironmentResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_ENVIRONMENTS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        environment = await self.environments_service.unarchive_environment(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            environment_id=environment_id,
        )

        return EnvironmentResponse(
            count=1 if environment else 0,
            environment=environment,
        )

    @intercept_exceptions()
    @suppress_exceptions(default=EnvironmentsResponse(), exclude=[HTTPException])
    async def query_environments(
        self,
        request: Request,
        *,
        query_request_params: Optional[EnvironmentQueryRequest] = Depends(
            parse_environment_query_request_from_params
        ),
    ) -> EnvironmentsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_ENVIRONMENTS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        body_json = None
        query_request_body = None

        try:
            body_json = await request.json()

            if body_json:
                query_request_body = parse_environment_query_request_from_body(
                    **body_json
                )

        except Exception:
            # Failed to parse JSON body; proceed as if no body was provided.
            log.debug("Failed to parse JSON body for environment query.", exc_info=True)

        environment_query_request = merge_environment_query_requests(
            query_request_params,
            query_request_body,
        )

        environments = await self.environments_service.query_environments(
            project_id=UUID(request.state.project_id),
            #
            environment_query=environment_query_request.environment,
            #
            environment_refs=environment_query_request.environment_refs,
            #
            include_archived=environment_query_request.include_archived,
            #
            windowing=environment_query_request.windowing,
        )

        environments_response = EnvironmentsResponse(
            count=len(environments),
            environments=environments,
        )

        return environments_response

    # ENVIRONMENT VARIANTS -------------------------------------------------

    @intercept_exceptions()
    async def create_environment_variant(
        self,
        request: Request,
        *,
        environment_variant_create_request: EnvironmentVariantCreateRequest,
    ) -> EnvironmentVariantResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_ENVIRONMENTS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        environment_variant = await self.environments_service.create_environment_variant(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            environment_variant_create=environment_variant_create_request.environment_variant,
        )

        environment_variant_response = EnvironmentVariantResponse(
            count=1 if environment_variant else 0,
            environment_variant=environment_variant,
        )

        return environment_variant_response

    @intercept_exceptions()
    @suppress_exceptions(default=EnvironmentVariantResponse(), exclude=[HTTPException])
    async def fetch_environment_variant(
        self,
        request: Request,
        *,
        environment_variant_id: UUID,
    ) -> EnvironmentVariantResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_ENVIRONMENTS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        environment_variant = await self.environments_service.fetch_environment_variant(
            project_id=UUID(request.state.project_id),
            #
            environment_variant_ref=Reference(id=environment_variant_id),
        )

        environment_variant_response = EnvironmentVariantResponse(
            count=1 if environment_variant else 0,
            environment_variant=environment_variant,
        )

        return environment_variant_response

    @intercept_exceptions()
    async def edit_environment_variant(
        self,
        request: Request,
        *,
        environment_variant_id: UUID,
        #
        environment_variant_edit_request: EnvironmentVariantEditRequest,
    ) -> EnvironmentVariantResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_ENVIRONMENTS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        if str(environment_variant_id) != str(
            environment_variant_edit_request.environment_variant.id
        ):
            return EnvironmentVariantResponse()

        environment_variant = await self.environments_service.edit_environment_variant(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            environment_variant_edit=environment_variant_edit_request.environment_variant,
        )

        environment_variant_response = EnvironmentVariantResponse(
            count=1 if environment_variant else 0,
            environment_variant=environment_variant,
        )

        return environment_variant_response

    @intercept_exceptions()
    async def archive_environment_variant(
        self,
        request: Request,
        *,
        environment_variant_id: UUID,
    ) -> EnvironmentVariantResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_ENVIRONMENTS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        environment_variant = (
            await self.environments_service.archive_environment_variant(
                project_id=UUID(request.state.project_id),
                user_id=UUID(request.state.user_id),
                #
                environment_variant_id=environment_variant_id,
            )
        )

        environment_variant_response = EnvironmentVariantResponse(
            count=1 if environment_variant else 0,
            environment_variant=environment_variant,
        )

        return environment_variant_response

    @intercept_exceptions()
    async def unarchive_environment_variant(
        self,
        request: Request,
        *,
        environment_variant_id: UUID,
    ) -> EnvironmentVariantResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_ENVIRONMENTS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        environment_variant = (
            await self.environments_service.unarchive_environment_variant(
                project_id=UUID(request.state.project_id),
                user_id=UUID(request.state.user_id),
                #
                environment_variant_id=environment_variant_id,
            )
        )

        environment_variant_response = EnvironmentVariantResponse(
            count=1 if environment_variant else 0,
            environment_variant=environment_variant,
        )

        return environment_variant_response

    @intercept_exceptions()
    async def query_environment_variants(
        self,
        request: Request,
        *,
        query_request_params: Optional[EnvironmentVariantQueryRequest] = Depends(
            parse_environment_variant_query_request_from_params
        ),
    ) -> EnvironmentVariantsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_ENVIRONMENTS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        body_json = None
        query_request_body = None

        try:
            body_json = await request.json()

            if body_json:
                query_request_body = parse_environment_variant_query_request_from_body(
                    **body_json
                )

        except (ValueError, UnicodeDecodeError):
            # Body may be missing or contain invalid JSON; ignore and rely on query params only.
            pass

        environment_variant_query_request = merge_environment_variant_query_requests(
            query_request_params,
            query_request_body,
        )

        environment_variants = await self.environments_service.query_environment_variants(
            project_id=UUID(request.state.project_id),
            #
            environment_variant_query=environment_variant_query_request.environment_variant,
            #
            environment_refs=environment_variant_query_request.environment_refs,
            environment_variant_refs=environment_variant_query_request.environment_variant_refs,
            #
            include_archived=environment_variant_query_request.include_archived,
            #
            windowing=environment_variant_query_request.windowing,
        )

        environment_variants_response = EnvironmentVariantsResponse(
            count=len(environment_variants),
            environment_variants=environment_variants,
        )

        return environment_variants_response

    # ENVIRONMENT REVISIONS ------------------------------------------------

    @intercept_exceptions()
    async def retrieve_environment_revision(
        self,
        request: Request,
        *,
        environment_revision_retrieve_request: EnvironmentRevisionRetrieveRequest,
    ) -> EnvironmentRevisionResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_ENVIRONMENTS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        environment_revision = await self.environments_service.fetch_environment_revision(
            project_id=UUID(request.state.project_id),
            #
            environment_ref=environment_revision_retrieve_request.environment_ref,  # type: ignore
            environment_variant_ref=environment_revision_retrieve_request.environment_variant_ref,  # type: ignore
            environment_revision_ref=environment_revision_retrieve_request.environment_revision_ref,  # type: ignore
        )

        environment_revision_response = EnvironmentRevisionResponse(
            count=1 if environment_revision else 0,
            environment_revision=environment_revision,
        )

        return environment_revision_response

    @intercept_exceptions()
    async def create_environment_revision(
        self,
        request: Request,
        *,
        environment_revision_create_request: EnvironmentRevisionCreateRequest,
    ) -> EnvironmentRevisionResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_ENVIRONMENTS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        environment_revision = await self.environments_service.create_environment_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            environment_revision_create=environment_revision_create_request.environment_revision,
        )

        return EnvironmentRevisionResponse(
            count=1 if environment_revision else 0,
            environment_revision=environment_revision,
        )

    @intercept_exceptions()
    @suppress_exceptions(default=EnvironmentRevisionResponse(), exclude=[HTTPException])
    async def fetch_environment_revision(
        self,
        request: Request,
        *,
        environment_revision_id: UUID,
    ) -> EnvironmentRevisionResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_ENVIRONMENTS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        environment_revision = (
            await self.environments_service.fetch_environment_revision(
                project_id=UUID(request.state.project_id),
                #
                environment_revision_ref=Reference(id=environment_revision_id),
            )
        )

        return EnvironmentRevisionResponse(
            count=1 if environment_revision else 0,
            environment_revision=environment_revision,
        )

    @intercept_exceptions()
    async def edit_environment_revision(
        self,
        request: Request,
        *,
        environment_revision_id: UUID,
        #
        environment_revision_edit_request: EnvironmentRevisionEditRequest,
    ) -> EnvironmentRevisionResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_ENVIRONMENTS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        if str(environment_revision_id) != str(
            environment_revision_edit_request.environment_revision.id
        ):
            return EnvironmentRevisionResponse()

        environment_revision = await self.environments_service.edit_environment_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            environment_revision_edit=environment_revision_edit_request.environment_revision,
        )

        return EnvironmentRevisionResponse(
            count=1 if environment_revision else 0,
            environment_revision=environment_revision,
        )

    @intercept_exceptions()
    async def archive_environment_revision(
        self,
        request: Request,
        *,
        environment_revision_id: UUID,
    ) -> EnvironmentRevisionResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_ENVIRONMENTS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        environment_revision = (
            await self.environments_service.archive_environment_revision(
                project_id=UUID(request.state.project_id),
                user_id=UUID(request.state.user_id),
                #
                environment_revision_id=environment_revision_id,
            )
        )

        return EnvironmentRevisionResponse(
            count=1 if environment_revision else 0,
            environment_revision=environment_revision,
        )

    @intercept_exceptions()
    async def unarchive_environment_revision(
        self,
        request: Request,
        *,
        environment_revision_id: UUID,
    ) -> EnvironmentRevisionResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_ENVIRONMENTS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        environment_revision = (
            await self.environments_service.unarchive_environment_revision(
                project_id=UUID(request.state.project_id),
                user_id=UUID(request.state.user_id),
                #
                environment_revision_id=environment_revision_id,
            )
        )

        return EnvironmentRevisionResponse(
            count=1 if environment_revision else 0,
            environment_revision=environment_revision,
        )

    @intercept_exceptions()
    @suppress_exceptions(
        default=EnvironmentRevisionsResponse(), exclude=[HTTPException]
    )
    async def query_environment_revisions(
        self,
        request: Request,
        *,
        query_request_params: Optional[EnvironmentRevisionQueryRequest] = Depends(
            parse_environment_revision_query_request_from_params
        ),
    ) -> EnvironmentRevisionsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_ENVIRONMENTS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        body_json = None
        query_request_body = None

        try:
            body_json = await request.json()

            if body_json:
                query_request_body = parse_environment_revision_query_request_from_body(
                    **body_json
                )

        except Exception as exc:
            # Ignore JSON parsing issues and proceed without a body filter.
            log.debug(
                "Failed to parse environment revision query request body as JSON: %s",
                exc,
            )

        environment_revision_query_request = merge_environment_revision_query_requests(
            query_request_params,
            query_request_body,
        )

        environment_revisions = await self.environments_service.query_environment_revisions(
            project_id=UUID(request.state.project_id),
            #
            environment_revision_query=environment_revision_query_request.environment_revision,
            #
            environment_refs=environment_revision_query_request.environment_refs,
            environment_variant_refs=environment_revision_query_request.environment_variant_refs,
            environment_revision_refs=environment_revision_query_request.environment_revision_refs,
            #
            include_archived=environment_revision_query_request.include_archived,
            #
            windowing=environment_revision_query_request.windowing,
        )

        return EnvironmentRevisionsResponse(
            count=len(environment_revisions),
            environment_revisions=environment_revisions,
        )

    @intercept_exceptions()
    async def commit_environment_revision(
        self,
        request: Request,
        *,
        environment_revision_commit_request: EnvironmentRevisionCommitRequest,
    ) -> EnvironmentRevisionResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_ENVIRONMENTS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        # If the environment is guarded, require DEPLOY_ENVIRONMENTS permission
        commit = environment_revision_commit_request.environment_revision_commit
        if is_ee() and commit.environment_id:
            environment = await self.environments_service.fetch_environment(
                project_id=UUID(request.state.project_id),
                environment_ref=Reference(id=commit.environment_id),
            )
            is_guarded = False
            if environment and environment.flags:
                flags = environment.flags
                if isinstance(flags, EnvironmentFlags):
                    is_guarded = bool(getattr(flags, "is_guarded", False))
                elif isinstance(flags, dict):
                    is_guarded = bool(flags.get("is_guarded", False))
            if is_guarded:
                if not await check_action_access(  # type: ignore
                    user_uid=request.state.user_id,
                    project_id=request.state.project_id,
                    permission=Permission.DEPLOY_ENVIRONMENTS,  # type: ignore
                ):
                    raise FORBIDDEN_EXCEPTION  # type: ignore

        environment_revision = await self.environments_service.commit_environment_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            environment_revision_commit=environment_revision_commit_request.environment_revision_commit,
        )

        return EnvironmentRevisionResponse(
            count=1 if environment_revision else 0,
            environment_revision=environment_revision,
        )

    @intercept_exceptions()
    async def log_environment_revisions(
        self,
        request: Request,
        *,
        environment_revisions_log_request: EnvironmentRevisionsLogRequest,
    ) -> EnvironmentRevisionsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_ENVIRONMENTS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        environment_revisions = (
            await self.environments_service.log_environment_revisions(
                project_id=UUID(request.state.project_id),
                #
                environment_revisions_log=environment_revisions_log_request.environment,
            )
        )

        revisions_response = EnvironmentRevisionsResponse(
            count=len(environment_revisions),
            environment_revisions=environment_revisions,
        )

        return revisions_response


class SimpleEnvironmentsRouter:
    def __init__(
        self,
        *,
        simple_environments_service: SimpleEnvironmentsService,
    ):
        self.simple_environments_service = simple_environments_service
        self.environments_service = (
            self.simple_environments_service.environments_service
        )

        self.router = APIRouter()

        # SIMPLE ENVIRONMENTS --------------------------------------------------

        self.router.add_api_route(
            "/",
            self.create_simple_environment,
            methods=["POST"],
            operation_id="create_simple_environment",
            status_code=status.HTTP_200_OK,
            response_model=SimpleEnvironmentResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{environment_id}",
            self.fetch_simple_environment,
            methods=["GET"],
            operation_id="fetch_simple_environment",
            status_code=status.HTTP_200_OK,
            response_model=SimpleEnvironmentResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{environment_id}",
            self.edit_simple_environment,
            methods=["PUT"],
            operation_id="edit_simple_environment",
            status_code=status.HTTP_200_OK,
            response_model=SimpleEnvironmentResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{environment_id}/archive",
            self.archive_simple_environment,
            methods=["POST"],
            operation_id="archive_simple_environment",
            status_code=status.HTTP_200_OK,
            response_model=SimpleEnvironmentResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{environment_id}/unarchive",
            self.unarchive_simple_environment,
            methods=["POST"],
            operation_id="unarchive_simple_environment",
            status_code=status.HTTP_200_OK,
            response_model=SimpleEnvironmentResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/query",
            self.query_simple_environments,
            methods=["POST"],
            operation_id="query_simple_environments",
            status_code=status.HTTP_200_OK,
            response_model=SimpleEnvironmentsResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{environment_id}/guard",
            self.guard_simple_environment,
            methods=["POST"],
            operation_id="guard_simple_environment",
            status_code=status.HTTP_200_OK,
            response_model=SimpleEnvironmentResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{environment_id}/unguard",
            self.unguard_simple_environment,
            methods=["POST"],
            operation_id="unguard_simple_environment",
            status_code=status.HTTP_200_OK,
            response_model=SimpleEnvironmentResponse,
            response_model_exclude_none=True,
        )

    # SIMPLE ENVIRONMENTS --------------------------------------------------

    @intercept_exceptions()
    async def create_simple_environment(
        self,
        request: Request,
        *,
        environment_id: Optional[UUID] = None,
        #
        simple_environment_create_request: SimpleEnvironmentCreateRequest,
    ) -> SimpleEnvironmentResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_ENVIRONMENTS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        simple_environment = await self.simple_environments_service.create(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            environment_id=environment_id,
            #
            simple_environment_create=simple_environment_create_request.environment,
        )

        simple_environment_response = SimpleEnvironmentResponse(
            count=1 if simple_environment else 0,
            environment=simple_environment,
        )

        return simple_environment_response

    @intercept_exceptions()
    @suppress_exceptions(default=SimpleEnvironmentResponse(), exclude=[HTTPException])
    async def fetch_simple_environment(
        self,
        request: Request,
        *,
        environment_id: UUID,
    ) -> SimpleEnvironmentResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_ENVIRONMENTS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        simple_environment = await self.simple_environments_service.fetch(
            project_id=UUID(request.state.project_id),
            #
            environment_id=environment_id,
        )

        simple_environment_response = SimpleEnvironmentResponse(
            count=1 if simple_environment else 0,
            environment=simple_environment,
        )

        return simple_environment_response

    @intercept_exceptions()
    async def edit_simple_environment(
        self,
        request: Request,
        *,
        environment_id: UUID,
        #
        simple_environment_edit_request: SimpleEnvironmentEditRequest,
    ) -> SimpleEnvironmentResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_ENVIRONMENTS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

            # If guarded, require DEPLOY_ENVIRONMENTS permission
            environment = await self.environments_service.fetch_environment(
                project_id=UUID(request.state.project_id),
                environment_ref=Reference(id=environment_id),
            )
            is_guarded = False
            if environment and environment.flags:
                flags = environment.flags
                if isinstance(flags, EnvironmentFlags):
                    is_guarded = bool(getattr(flags, "is_guarded", False))
                elif isinstance(flags, dict):
                    is_guarded = bool(flags.get("is_guarded", False))
            if is_guarded:
                if not await check_action_access(  # type: ignore
                    user_uid=request.state.user_id,
                    project_id=request.state.project_id,
                    permission=Permission.DEPLOY_ENVIRONMENTS,  # type: ignore
                ):
                    raise FORBIDDEN_EXCEPTION  # type: ignore

        if str(environment_id) != str(simple_environment_edit_request.environment.id):
            return SimpleEnvironmentResponse()

        simple_environment = await self.simple_environments_service.edit(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            simple_environment_edit=simple_environment_edit_request.environment,
        )

        simple_environment_response = SimpleEnvironmentResponse(
            count=1 if simple_environment else 0,
            environment=simple_environment,
        )

        return simple_environment_response

    @intercept_exceptions()
    async def archive_simple_environment(
        self,
        request: Request,
        *,
        environment_id: UUID,
    ) -> SimpleEnvironmentResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_ENVIRONMENTS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        environment = await self.environments_service.fetch_environment(
            project_id=UUID(request.state.project_id),
            #
            environment_ref=Reference(id=environment_id),
        )

        if not environment or not environment.id:
            return SimpleEnvironmentResponse()

        # If guarded, require DEPLOY_ENVIRONMENTS permission
        if is_ee():
            is_guarded = False
            if environment.flags:
                flags = environment.flags
                if isinstance(flags, EnvironmentFlags):
                    is_guarded = bool(getattr(flags, "is_guarded", False))
                elif isinstance(flags, dict):
                    is_guarded = bool(flags.get("is_guarded", False))
            if is_guarded:
                if not await check_action_access(  # type: ignore
                    user_uid=request.state.user_id,
                    project_id=request.state.project_id,
                    permission=Permission.DEPLOY_ENVIRONMENTS,  # type: ignore
                ):
                    raise FORBIDDEN_EXCEPTION  # type: ignore

        environment = await self.environments_service.archive_environment(  # type: ignore
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            environment_id=environment.id,
        )

        if not environment or not environment.id:
            return SimpleEnvironmentResponse()

        environment_variant = await self.environments_service.fetch_environment_variant(
            project_id=UUID(request.state.project_id),
            #
            environment_ref=Reference(id=environment.id),
        )

        if environment_variant is None:
            return SimpleEnvironmentResponse()

        environment_variant = (
            await self.environments_service.archive_environment_variant(
                project_id=UUID(request.state.project_id),
                user_id=UUID(request.state.user_id),
                #
                environment_variant_id=environment_variant.id,  # type: ignore
            )
        )

        if environment_variant is None:
            return SimpleEnvironmentResponse()

        simple_environment = SimpleEnvironment(
            id=environment.id,
            slug=environment.slug,
            #
            created_at=environment.created_at,
            updated_at=environment.updated_at,
            deleted_at=environment.deleted_at,
            created_by_id=environment.created_by_id,
            updated_by_id=environment.updated_by_id,
            deleted_by_id=environment.deleted_by_id,
            #
            name=environment.name,
            description=environment.description,
            #
            flags=(
                EnvironmentFlags(**environment.flags) if environment.flags else None
            ),
            tags=environment.tags,
            meta=environment.meta,
            #
            variant_id=environment_variant.id,
        )

        simple_environment_response = SimpleEnvironmentResponse(
            count=1,
            environment=simple_environment,
        )

        return simple_environment_response

    @intercept_exceptions()
    async def unarchive_simple_environment(
        self,
        *,
        request: Request,
        environment_id: UUID,
    ) -> SimpleEnvironmentResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_ENVIRONMENTS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        environment_ref = Reference(
            id=environment_id,
        )

        environment = await self.environments_service.fetch_environment(
            project_id=UUID(request.state.project_id),
            #
            environment_ref=environment_ref,
        )

        if environment is None or not environment.id:
            return SimpleEnvironmentResponse()

        environment = await self.environments_service.unarchive_environment(  # type: ignore
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            environment_id=environment.id,
        )

        if environment is None:
            return SimpleEnvironmentResponse()

        environment_variant = await self.environments_service.fetch_environment_variant(
            project_id=UUID(request.state.project_id),
            #
            environment_ref=environment_ref,
        )

        if environment_variant is None:
            return SimpleEnvironmentResponse()

        environment_variant = (
            await self.environments_service.unarchive_environment_variant(
                project_id=UUID(request.state.project_id),
                user_id=UUID(request.state.user_id),
                #
                environment_variant_id=environment_variant.id,  # type: ignore
            )
        )

        if environment_variant is None:
            return SimpleEnvironmentResponse()

        simple_environment = SimpleEnvironment(
            id=environment.id,
            slug=environment.slug,
            #
            created_at=environment.created_at,
            updated_at=environment.updated_at,
            deleted_at=environment.deleted_at,
            created_by_id=environment.created_by_id,
            updated_by_id=environment.updated_by_id,
            deleted_by_id=environment.deleted_by_id,
            #
            name=environment.name,
            description=environment.description,
            #
            flags=(
                EnvironmentFlags(**environment.flags) if environment.flags else None
            ),
            tags=environment.tags,
            meta=environment.meta,
            #
            variant_id=environment_variant.id,
        )

        simple_environment_response = SimpleEnvironmentResponse(
            count=1 if simple_environment else 0,
            environment=simple_environment,
        )

        return simple_environment_response

    @intercept_exceptions()
    @suppress_exceptions(default=SimpleEnvironmentsResponse(), exclude=[HTTPException])
    async def query_simple_environments(
        self,
        request: Request,
        *,
        simple_environment_query_request: SimpleEnvironmentQueryRequest,
    ) -> SimpleEnvironmentsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_ENVIRONMENTS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        simple_environments = await self.simple_environments_service.query(
            project_id=UUID(request.state.project_id),
            #
            simple_environment_query=(simple_environment_query_request.environment),
            #
            simple_environment_refs=simple_environment_query_request.environment_refs,
            #
            include_archived=simple_environment_query_request.include_archived,
            #
            windowing=simple_environment_query_request.windowing,
        )

        simple_environments_response = SimpleEnvironmentsResponse(
            count=len(simple_environments),
            environments=simple_environments,
        )

        return simple_environments_response

    @intercept_exceptions()
    async def guard_simple_environment(
        self,
        request: Request,
        *,
        environment_id: UUID,
    ) -> SimpleEnvironmentResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.DEPLOY_ENVIRONMENTS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        environment = await self.environments_service.fetch_environment(
            project_id=UUID(request.state.project_id),
            environment_ref=Reference(id=environment_id),
        )

        if not environment or not environment.id:
            return SimpleEnvironmentResponse()

        environment_edit = EnvironmentEdit(
            id=environment.id,
            name=environment.name,
            description=environment.description,
            flags=EnvironmentFlags(is_guarded=True),
            tags=environment.tags,
            meta=environment.meta,
        )

        environment = await self.environments_service.edit_environment(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            environment_edit=environment_edit,
        )

        if not environment:
            return SimpleEnvironmentResponse()

        simple_environment = await self.simple_environments_service.fetch(
            project_id=UUID(request.state.project_id),
            environment_id=environment.id,
        )

        return SimpleEnvironmentResponse(
            count=1 if simple_environment else 0,
            environment=simple_environment,
        )

    @intercept_exceptions()
    async def unguard_simple_environment(
        self,
        request: Request,
        *,
        environment_id: UUID,
    ) -> SimpleEnvironmentResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.DEPLOY_ENVIRONMENTS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        environment = await self.environments_service.fetch_environment(
            project_id=UUID(request.state.project_id),
            environment_ref=Reference(id=environment_id),
        )

        if not environment or not environment.id:
            return SimpleEnvironmentResponse()

        environment_edit = EnvironmentEdit(
            id=environment.id,
            name=environment.name,
            description=environment.description,
            flags=EnvironmentFlags(is_guarded=False),
            tags=environment.tags,
            meta=environment.meta,
        )

        environment = await self.environments_service.edit_environment(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            environment_edit=environment_edit,
        )

        if not environment:
            return SimpleEnvironmentResponse()

        simple_environment = await self.simple_environments_service.fetch(
            project_id=UUID(request.state.project_id),
            environment_id=environment.id,
        )

        return SimpleEnvironmentResponse(
            count=1 if simple_environment else 0,
            environment=simple_environment,
        )
