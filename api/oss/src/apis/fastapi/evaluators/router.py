from typing import Optional, List
from uuid import UUID

from fastapi import APIRouter, Request, status, Depends, HTTPException

from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions, suppress_exceptions
from oss.src.utils.caching import set_cache

from oss.src.core.shared.dtos import (
    Reference,
)
from oss.src.core.evaluators.dtos import (
    EvaluatorQueryFlags,
    #
    EvaluatorQuery,
    #
    SimpleEvaluatorData,
    SimpleEvaluatorQuery,
    SimpleEvaluator,
    #
    SimpleEvaluatorFlags,
    SimpleEvaluatorQueryFlags,
)
from oss.src.core.evaluators.service import (
    SimpleEvaluatorsService,
    EvaluatorsService,
)

from oss.src.apis.fastapi.evaluators.models import (
    EvaluatorCreateRequest,
    EvaluatorEditRequest,
    EvaluatorQueryRequest,
    EvaluatorForkRequest,
    EvaluatorRevisionsLogRequest,
    EvaluatorResponse,
    EvaluatorsResponse,
    #
    EvaluatorVariantCreateRequest,
    EvaluatorVariantEditRequest,
    EvaluatorVariantQueryRequest,
    EvaluatorVariantResponse,
    EvaluatorVariantsResponse,
    #
    EvaluatorRevisionCreateRequest,
    EvaluatorRevisionEditRequest,
    EvaluatorRevisionQueryRequest,
    EvaluatorRevisionCommitRequest,
    EvaluatorRevisionRetrieveRequest,
    EvaluatorRevisionResponse,
    EvaluatorRevisionsResponse,
    #
    SimpleEvaluatorCreateRequest,
    SimpleEvaluatorEditRequest,
    SimpleEvaluatorQueryRequest,
    SimpleEvaluatorResponse,
    SimpleEvaluatorsResponse,
    #
    EvaluatorTemplate,
    EvaluatorTemplatesResponse,
)
from oss.src.apis.fastapi.evaluators.utils import (
    parse_evaluator_variant_query_request_from_params,
    parse_evaluator_variant_query_request_from_body,
    merge_evaluator_variant_query_requests,
)

if is_ee():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access, FORBIDDEN_EXCEPTION


log = get_module_logger(__name__)
# TEMPORARY: Disabling name editing
RENAME_EVALUATORS_DISABLED_MESSAGE = "Renaming evaluators is temporarily disabled."


def _build_rename_evaluators_disabled_detail(*, existing_name: Optional[str]) -> str:
    if existing_name:
        return (
            f"{RENAME_EVALUATORS_DISABLED_MESSAGE} "
            f"Current evaluator name is '{existing_name}'."
        )

    return RENAME_EVALUATORS_DISABLED_MESSAGE


class EvaluatorsRouter:
    def __init__(
        self,
        *,
        evaluators_service: EvaluatorsService,
    ):
        self.evaluators_service = evaluators_service

        self.router = APIRouter()

        # EVALUATORS -----------------------------------------------------------

        self.router.add_api_route(
            "/",
            self.create_evaluator,
            methods=["POST"],
            operation_id="create_evaluator",
            status_code=status.HTTP_200_OK,
            response_model=EvaluatorResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{evaluator_id}",
            self.fetch_evaluator,
            methods=["GET"],
            operation_id="fetch_evaluator",
            status_code=status.HTTP_200_OK,
            response_model=EvaluatorResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{evaluator_id}",
            self.edit_evaluator,
            methods=["PUT"],
            operation_id="edit_evaluator",
            status_code=status.HTTP_200_OK,
            response_model=EvaluatorResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{evaluator_id}/archive",
            self.archive_evaluator,
            methods=["POST"],
            operation_id="archive_evaluator",
            status_code=status.HTTP_200_OK,
            response_model=EvaluatorResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{evaluator_id}/unarchive",
            self.unarchive_evaluator,
            methods=["POST"],
            operation_id="unarchive_evaluator",
            status_code=status.HTTP_200_OK,
            response_model=EvaluatorResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/query",
            self.query_evaluators,
            methods=["POST"],
            operation_id="query_evaluators",
            status_code=status.HTTP_200_OK,
            response_model=EvaluatorsResponse,
            response_model_exclude_none=True,
        )

        # EVALUATOR VARIANTS ---------------------------------------------------

        self.router.add_api_route(
            "/variants/",
            self.create_evaluator_variant,
            methods=["POST"],
            operation_id="create_evaluator_variant",
            status_code=status.HTTP_200_OK,
            response_model=EvaluatorVariantResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/variants/{evaluator_variant_id}",
            self.fetch_evaluator_variant,
            methods=["GET"],
            operation_id="fetch_evaluator_variant",
            status_code=status.HTTP_200_OK,
            response_model=EvaluatorVariantResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/variants/{evaluator_variant_id}",
            self.edit_evaluator_variant,
            methods=["PUT"],
            operation_id="edit_evaluator_variant",
            status_code=status.HTTP_200_OK,
            response_model=EvaluatorVariantResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/variants/{evaluator_variant_id}/archive",
            self.archive_evaluator_variant,
            methods=["POST"],
            operation_id="archive_evaluator_variant",
            status_code=status.HTTP_200_OK,
            response_model=EvaluatorVariantResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/variants/{evaluator_variant_id}/unarchive",
            self.unarchive_evaluator_variant,
            methods=["POST"],
            operation_id="unarchive_evaluator_variant",
            status_code=status.HTTP_200_OK,
            response_model=EvaluatorVariantResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/variants/query",
            self.query_evaluator_variants,
            methods=["POST"],
            operation_id="query_evaluator_variants",
            status_code=status.HTTP_200_OK,
            response_model=EvaluatorVariantsResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/variants/fork",
            self.fork_evaluator_variant,
            methods=["POST"],
            operation_id="fork_evaluator_variant",
            status_code=status.HTTP_200_OK,
            response_model=EvaluatorVariantResponse,
            response_model_exclude_none=True,
        )

        # EVALUATOR REVISIONS --------------------------------------------------

        self.router.add_api_route(
            "/revisions/retrieve",
            self.retrieve_evaluator_revision,
            methods=["POST"],
            operation_id="retrieve_evaluator_revision",
            status_code=status.HTTP_200_OK,
            response_model=EvaluatorRevisionResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/",
            self.create_evaluator_revision,
            methods=["POST"],
            operation_id="create_evaluator_revision",
            status_code=status.HTTP_200_OK,
            response_model=EvaluatorRevisionResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/{evaluator_revision_id}",
            self.fetch_evaluator_revision,
            methods=["GET"],
            operation_id="fetch_evaluator_revision",
            status_code=status.HTTP_200_OK,
            response_model=EvaluatorRevisionResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/{evaluator_revision_id}",
            self.edit_evaluator_revision,
            methods=["PUT"],
            operation_id="edit_evaluator_revision",
            status_code=status.HTTP_200_OK,
            response_model=EvaluatorRevisionResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/{evaluator_revision_id}/archive",
            self.archive_evaluator_revision,
            methods=["POST"],
            operation_id="archive_evaluator_revision",
            status_code=status.HTTP_200_OK,
            response_model=EvaluatorRevisionResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/{evaluator_revision_id}/unarchive",
            self.unarchive_evaluator_revision,
            methods=["POST"],
            operation_id="unarchive_evaluator_revision",
            status_code=status.HTTP_200_OK,
            response_model=EvaluatorRevisionResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/query",
            self.query_evaluator_revisions,
            methods=["POST"],
            operation_id="query_evaluator_revisions",
            status_code=status.HTTP_200_OK,
            response_model=EvaluatorRevisionsResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/commit",
            self.commit_evaluator_revision,
            methods=["POST"],
            operation_id="commit_evaluator_revision",
            status_code=status.HTTP_200_OK,
            response_model=EvaluatorRevisionResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/log",
            self.log_evaluator_revisions,
            methods=["POST"],
            operation_id="log_evaluator_revisions",
            status_code=status.HTTP_200_OK,
            response_model=EvaluatorRevisionsResponse,
            response_model_exclude_none=True,
        )

    # EVALUATORS ---------------------------------------------------------------

    @intercept_exceptions()
    async def create_evaluator(
        self,
        request: Request,
        *,
        evaluator_id: Optional[UUID] = None,
        #
        evaluator_create_request: EvaluatorCreateRequest,
    ) -> EvaluatorResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATORS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        evaluator = await self.evaluators_service.create_evaluator(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            evaluator_id=evaluator_id,
            #
            evaluator_create=evaluator_create_request.evaluator,
        )

        return EvaluatorResponse(
            count=1 if evaluator else 0,
            evaluator=evaluator,
        )

    @intercept_exceptions()
    @suppress_exceptions(default=EvaluatorResponse(), exclude=[HTTPException])
    async def fetch_evaluator(
        self,
        request: Request,
        *,
        evaluator_id: UUID,
    ) -> EvaluatorResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_EVALUATORS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        evaluator = await self.evaluators_service.fetch_evaluator(
            project_id=UUID(request.state.project_id),
            #
            evaluator_ref=Reference(id=evaluator_id),
        )

        return EvaluatorResponse(
            count=1 if evaluator else 0,
            evaluator=evaluator,
        )

    @intercept_exceptions()
    async def edit_evaluator(
        self,
        request: Request,
        *,
        evaluator_id: UUID,
        #
        evaluator_edit_request: EvaluatorEditRequest,
    ) -> EvaluatorResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATORS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        if str(evaluator_id) != str(evaluator_edit_request.evaluator.id):
            return EvaluatorResponse()

        # TEMPORARY: Disabling name editing
        existing_evaluator = await self.evaluators_service.fetch_evaluator(
            project_id=UUID(request.state.project_id),
            evaluator_ref=Reference(id=evaluator_id),
        )
        if existing_evaluator is None:
            return EvaluatorResponse()

        edit_model = evaluator_edit_request.evaluator
        if (
            "name" in edit_model.model_fields_set
            and edit_model.name is not None
            and edit_model.name != existing_evaluator.name
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=_build_rename_evaluators_disabled_detail(
                    existing_name=existing_evaluator.name
                ),
            )

        evaluator = await self.evaluators_service.edit_evaluator(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            evaluator_edit=evaluator_edit_request.evaluator,
        )

        return EvaluatorResponse(
            count=1 if evaluator else 0,
            evaluator=evaluator,
        )

    @intercept_exceptions()
    async def archive_evaluator(
        self,
        request: Request,
        *,
        evaluator_id: UUID,
    ) -> EvaluatorResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATORS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        evaluator = await self.evaluators_service.archive_evaluator(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            evaluator_id=evaluator_id,
        )

        return EvaluatorResponse(
            count=1 if evaluator else 0,
            evaluator=evaluator,
        )

    @intercept_exceptions()
    async def unarchive_evaluator(
        self,
        request: Request,
        *,
        evaluator_id: UUID,
    ) -> EvaluatorResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATORS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        evaluator = await self.evaluators_service.unarchive_evaluator(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            evaluator_id=evaluator_id,
        )

        return EvaluatorResponse(
            count=1 if evaluator else 0,
            evaluator=evaluator,
        )

    @intercept_exceptions()
    @suppress_exceptions(default=EvaluatorsResponse(), exclude=[HTTPException])
    async def query_evaluators(
        self,
        request: Request,
        *,
        evaluator_query_request: EvaluatorQueryRequest,
    ) -> EvaluatorsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_EVALUATORS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        evaluators = await self.evaluators_service.query_evaluators(
            project_id=UUID(request.state.project_id),
            #
            evaluator_query=evaluator_query_request.evaluator,
            #
            evaluator_refs=evaluator_query_request.evaluator_refs,
            #
            include_archived=evaluator_query_request.include_archived,
            #
            windowing=evaluator_query_request.windowing,
        )

        evaluators_response = EvaluatorsResponse(
            count=len(evaluators),
            evaluators=evaluators,
        )

        return evaluators_response

    # EVALUATOR VARIANTS -------------------------------------------------------

    @intercept_exceptions()
    async def create_evaluator_variant(
        self,
        request: Request,
        *,
        evaluator_variant_create_request: EvaluatorVariantCreateRequest,
    ) -> EvaluatorVariantResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        evaluator_variant = await self.evaluators_service.create_evaluator_variant(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            evaluator_variant_create=evaluator_variant_create_request.evaluator_variant,
        )

        evaluator_variant_response = EvaluatorVariantResponse(
            count=1 if evaluator_variant else 0,
            evaluator_variant=evaluator_variant,
        )

        return evaluator_variant_response

    @intercept_exceptions()
    async def fetch_evaluator_variant(
        self,
        request: Request,
        *,
        evaluator_variant_id: UUID,
    ) -> EvaluatorVariantResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        evaluator_variant = await self.evaluators_service.fetch_evaluator_variant(
            project_id=UUID(request.state.project_id),
            #
            evaluator_variant_ref=Reference(id=evaluator_variant_id),
        )

        evaluator_variant_response = EvaluatorVariantResponse(
            count=1 if evaluator_variant else 0,
            evaluator_variant=evaluator_variant,
        )

        return evaluator_variant_response

    @intercept_exceptions()
    async def edit_evaluator_variant(
        self,
        request: Request,
        *,
        evaluator_variant_id: UUID,
        #
        evaluator_variant_edit_request: EvaluatorVariantEditRequest,
    ) -> EvaluatorVariantResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        if str(evaluator_variant_id) != str(
            evaluator_variant_edit_request.evaluator_variant.id
        ):
            return EvaluatorVariantResponse()

        evaluator_variant = await self.evaluators_service.edit_evaluator_variant(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            evaluator_variant_edit=evaluator_variant_edit_request.evaluator_variant,
        )

        evaluator_variant_response = EvaluatorVariantResponse(
            count=1 if evaluator_variant else 0,
            evaluator_variant=evaluator_variant,
        )

        return evaluator_variant_response

    @intercept_exceptions()
    async def archive_evaluator_variant(
        self,
        request: Request,
        *,
        evaluator_variant_id: UUID,
    ) -> EvaluatorVariantResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        evaluator_variant = await self.evaluators_service.archive_evaluator_variant(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            evaluator_variant_id=evaluator_variant_id,
        )

        evaluator_variant_response = EvaluatorVariantResponse(
            count=1 if evaluator_variant else 0,
            evaluator_variant=evaluator_variant,
        )

        return evaluator_variant_response

    @intercept_exceptions()
    async def unarchive_evaluator_variant(
        self,
        request: Request,
        *,
        evaluator_variant_id: UUID,
    ) -> EvaluatorVariantResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        evaluator_variant = await self.evaluators_service.unarchive_evaluator_variant(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            evaluator_variant_id=evaluator_variant_id,
        )

        evaluator_variant_response = EvaluatorVariantResponse(
            count=1 if evaluator_variant else 0,
            evaluator_variant=evaluator_variant,
        )

        return evaluator_variant_response

    @intercept_exceptions()
    async def query_evaluator_variants(
        self,
        request: Request,
        *,
        query_request_params: Optional[EvaluatorVariantQueryRequest] = Depends(
            parse_evaluator_variant_query_request_from_params
        ),
    ) -> EvaluatorVariantsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        body_json = None
        query_request_body = None

        try:
            body_json = await request.json()

            if body_json:
                query_request_body = parse_evaluator_variant_query_request_from_body(
                    **body_json
                )

        except Exception:
            pass

        workflow_variant_query_request = merge_evaluator_variant_query_requests(
            query_request_params,
            query_request_body,
        )

        evaluator_variants = await self.evaluators_service.query_evaluator_variants(
            project_id=UUID(request.state.project_id),
            #
            evaluator_variant_query=workflow_variant_query_request.evaluator_variant,
            #
            evaluator_refs=workflow_variant_query_request.evaluator_refs,
            evaluator_variant_refs=workflow_variant_query_request.evaluator_variant_refs,
            #
            include_archived=workflow_variant_query_request.include_archived,
            #
            windowing=workflow_variant_query_request.windowing,
        )

        evaluator_variants_response = EvaluatorVariantsResponse(
            count=len(evaluator_variants),
            evaluator_variants=evaluator_variants,
        )

        return evaluator_variants_response

    @intercept_exceptions()  # TODO: FIX ME
    async def fork_evaluator_variant(
        self,
        request: Request,
        *,
        evaluator_variant_id: Optional[UUID] = None,
        #
        evaluator_variant_fork_request: EvaluatorForkRequest,
    ):
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        fork_request = evaluator_variant_fork_request.evaluator

        if evaluator_variant_id:
            if (
                fork_request.evaluator_variant_id
                and fork_request.evaluator_variant_id != evaluator_variant_id
            ):
                return EvaluatorVariantResponse()

            if not fork_request.evaluator_variant_id:
                fork_request.evaluator_variant_id = evaluator_variant_id

        evaluator_variant = await self.evaluators_service.fork_evaluator_variant(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            evaluator_fork=fork_request,
        )

        evaluator_variant_response = EvaluatorVariantResponse(
            count=1 if evaluator_variant else 0,
            evaluator_variant=evaluator_variant,
        )

        return evaluator_variant_response

    # EVALUATOR REVISIONS ------------------------------------------------------

    @intercept_exceptions()
    async def retrieve_evaluator_revision(
        self,
        request: Request,
        *,
        evaluator_revision_retrieve_request: EvaluatorRevisionRetrieveRequest,
    ) -> EvaluatorRevisionResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_EVALUATORS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        cache_key = {
            "artifact_ref": evaluator_revision_retrieve_request.evaluator_ref,  # type: ignore
            "variant_ref": evaluator_revision_retrieve_request.evaluator_variant_ref,  # type: ignore
            "revision_ref": evaluator_revision_retrieve_request.evaluator_revision_ref,  # type: ignore
        }

        evaluator_revision = None
        # evaluator_revision = await get_cache(
        #     namespace="evaluators:retrieve",
        #     project_id=request.state.project_id,
        #     user_id=request.state.user_id,
        #     key=cache_key,
        #     model=EvaluatorRevision,
        # )

        if not evaluator_revision:
            evaluator_revision = await self.evaluators_service.fetch_evaluator_revision(
                project_id=UUID(request.state.project_id),
                #
                evaluator_ref=evaluator_revision_retrieve_request.evaluator_ref,  # type: ignore
                evaluator_variant_ref=evaluator_revision_retrieve_request.evaluator_variant_ref,  # type: ignore
                evaluator_revision_ref=evaluator_revision_retrieve_request.evaluator_revision_ref,  # type: ignore
            )

            await set_cache(
                namespace="evaluators:retrieve",
                project_id=request.state.project_id,
                user_id=request.state.user_id,
                key=cache_key,
                value=evaluator_revision,
            )

        evaluator_revision_response = EvaluatorRevisionResponse(
            count=1 if evaluator_revision else 0,
            evaluator_revision=evaluator_revision,
        )

        return evaluator_revision_response

    @intercept_exceptions()
    async def create_evaluator_revision(
        self,
        request: Request,
        *,
        evaluator_revision_create_request: EvaluatorRevisionCreateRequest,
    ) -> EvaluatorRevisionResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATORS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        evaluator_revision = await self.evaluators_service.create_evaluator_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            evaluator_revision_create=evaluator_revision_create_request.evaluator_revision,
        )

        return EvaluatorRevisionResponse(
            count=1 if evaluator_revision else 0,
            evaluator_revision=evaluator_revision,
        )

    @intercept_exceptions()
    @suppress_exceptions(default=EvaluatorRevisionResponse(), exclude=[HTTPException])
    async def fetch_evaluator_revision(
        self,
        request: Request,
        *,
        evaluator_revision_id: UUID,
    ) -> EvaluatorRevisionResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_EVALUATORS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        evaluator_revision = await self.evaluators_service.fetch_evaluator_revision(
            project_id=UUID(request.state.project_id),
            #
            evaluator_revision_ref=Reference(id=evaluator_revision_id),
        )

        return EvaluatorRevisionResponse(
            count=1 if evaluator_revision else 0,
            evaluator_revision=evaluator_revision,
        )

    @intercept_exceptions()
    async def edit_evaluator_revision(
        self,
        request: Request,
        *,
        evaluator_revision_id: UUID,
        #
        evaluator_revision_edit_request: EvaluatorRevisionEditRequest,
    ) -> EvaluatorRevisionResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATORS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        if str(evaluator_revision_id) != str(
            evaluator_revision_edit_request.evaluator_revision.id
        ):
            return EvaluatorRevisionResponse()

        evaluator_revision = await self.evaluators_service.edit_evaluator_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            evaluator_revision_edit=evaluator_revision_edit_request.evaluator_revision,
        )

        return EvaluatorRevisionResponse(
            count=1 if evaluator_revision else 0,
            evaluator_revision=evaluator_revision,
        )

    @intercept_exceptions()
    async def archive_evaluator_revision(
        self,
        request: Request,
        *,
        evaluator_revision_id: UUID,
    ) -> EvaluatorRevisionResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATORS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        evaluator_revision = await self.evaluators_service.archive_evaluator_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            evaluator_revision_id=evaluator_revision_id,
        )

        return EvaluatorRevisionResponse(
            count=1 if evaluator_revision else 0,
            evaluator_revision=evaluator_revision,
        )

    @intercept_exceptions()
    async def unarchive_evaluator_revision(
        self,
        request: Request,
        *,
        evaluator_revision_id: UUID,
    ) -> EvaluatorRevisionResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATORS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        evaluator_revision = await self.evaluators_service.unarchive_evaluator_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            evaluator_revision_id=evaluator_revision_id,
        )

        return EvaluatorRevisionResponse(
            count=1 if evaluator_revision else 0,
            evaluator_revision=evaluator_revision,
        )

    @intercept_exceptions()
    @suppress_exceptions(default=EvaluatorRevisionsResponse(), exclude=[HTTPException])
    async def query_evaluator_revisions(
        self,
        request: Request,
        *,
        evaluator_revision_query_request: EvaluatorRevisionQueryRequest,
    ) -> EvaluatorRevisionsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_EVALUATORS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        evaluator_revisions = await self.evaluators_service.query_evaluator_revisions(
            project_id=UUID(request.state.project_id),
            #
            evaluator_revision_query=evaluator_revision_query_request.evaluator_revision,
            #
            evaluator_refs=evaluator_revision_query_request.evaluator_refs,
            evaluator_variant_refs=evaluator_revision_query_request.evaluator_variant_refs,
            evaluator_revision_refs=evaluator_revision_query_request.evaluator_revision_refs,
            #
            include_archived=evaluator_revision_query_request.include_archived,
            #
            windowing=evaluator_revision_query_request.windowing,
        )

        return EvaluatorRevisionsResponse(
            count=len(evaluator_revisions),
            evaluator_revisions=evaluator_revisions,
        )

    @intercept_exceptions()
    async def commit_evaluator_revision(
        self,
        request: Request,
        *,
        evaluator_revision_commit_request: EvaluatorRevisionCommitRequest,
    ) -> EvaluatorRevisionResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATORS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        evaluator_revision = await self.evaluators_service.commit_evaluator_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            evaluator_revision_commit=evaluator_revision_commit_request.evaluator_revision_commit,
        )

        return EvaluatorRevisionResponse(
            count=1 if evaluator_revision else 0,
            evaluator_revision=evaluator_revision,
        )

    @intercept_exceptions()
    async def log_evaluator_revisions(
        self,
        request: Request,
        *,
        evaluator_revisions_log_request: EvaluatorRevisionsLogRequest,
    ):
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_WORKFLOWS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        evaluator_revisions = await self.evaluators_service.log_evaluator_revisions(
            project_id=UUID(request.state.project_id),
            #
            evaluator_revisions_log=evaluator_revisions_log_request.evaluator,
        )

        revisions_response = EvaluatorRevisionsResponse(
            count=len(evaluator_revisions),
            evaluator_revisions=evaluator_revisions,
        )

        return revisions_response


class SimpleEvaluatorsRouter:
    def __init__(
        self,
        *,
        simple_evaluators_service: SimpleEvaluatorsService,
    ):
        self.simple_evaluators_service = simple_evaluators_service
        self.evaluators_service = self.simple_evaluators_service.evaluators_service

        self.router = APIRouter()

        # SIMPLE EVALUATORS ----------------------------------------------------

        self.router.add_api_route(
            "/",
            self.create_simple_evaluator,
            methods=["POST"],
            operation_id="create_simple_evaluator",
            status_code=status.HTTP_200_OK,
            response_model=SimpleEvaluatorResponse,
            response_model_exclude_none=True,
        )

        # EVALUATOR TEMPLATES --------------------------------------------------
        # NOTE: This must be registered BEFORE /{evaluator_id} routes to avoid
        # FastAPI matching "templates" as a UUID path parameter

        self.router.add_api_route(
            "/templates",
            self.list_evaluator_templates,
            methods=["GET"],
            operation_id="list_evaluator_templates",
            status_code=status.HTTP_200_OK,
            response_model=EvaluatorTemplatesResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{evaluator_id}",
            self.fetch_simple_evaluator,
            methods=["GET"],
            operation_id="fetch_simple_evaluator",
            status_code=status.HTTP_200_OK,
            response_model=SimpleEvaluatorResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{evaluator_id}",
            self.edit_simple_evaluator,
            methods=["PUT"],
            operation_id="edit_simple_evaluator",
            status_code=status.HTTP_200_OK,
            response_model=SimpleEvaluatorResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{evaluator_id}/archive",
            self.archive_simple_evaluator,
            methods=["POST"],
            operation_id="archive_simple_evaluator",
            status_code=status.HTTP_200_OK,
            response_model=SimpleEvaluatorResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{evaluator_id}/unarchive",
            self.unarchive_simple_evaluator,
            methods=["POST"],
            operation_id="unarchive_simple_evaluator",
            status_code=status.HTTP_200_OK,
            response_model=SimpleEvaluatorResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/query",
            self.query_simple_evaluators,
            methods=["POST"],
            operation_id="query_simple_evaluators",
            status_code=status.HTTP_200_OK,
            response_model=SimpleEvaluatorsResponse,
            response_model_exclude_none=True,
        )

    # SIMPLE EVALUATORS --------------------------------------------------------

    @intercept_exceptions()
    async def create_simple_evaluator(
        self,
        request: Request,
        *,
        evaluator_id: Optional[UUID] = None,
        #
        simple_evaluator_create_request: SimpleEvaluatorCreateRequest,
    ) -> SimpleEvaluatorResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATORS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        simple_evaluator = await self.simple_evaluators_service.create(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            evaluator_id=evaluator_id,
            #
            simple_evaluator_create=simple_evaluator_create_request.evaluator,
        )

        simple_evaluator_response = SimpleEvaluatorResponse(
            count=1 if simple_evaluator else 0,
            evaluator=simple_evaluator,
        )

        return simple_evaluator_response

    @intercept_exceptions()
    @suppress_exceptions(default=SimpleEvaluatorResponse(), exclude=[HTTPException])
    async def fetch_simple_evaluator(
        self,
        request: Request,
        *,
        evaluator_id: UUID,
    ) -> SimpleEvaluatorResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_EVALUATORS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        simple_evaluator = await self.simple_evaluators_service.fetch(
            project_id=UUID(request.state.project_id),
            #
            evaluator_id=evaluator_id,
        )

        simple_evaluator_response = SimpleEvaluatorResponse(
            count=1 if simple_evaluator else 0,
            evaluator=simple_evaluator,
        )

        return simple_evaluator_response

    @intercept_exceptions()
    async def edit_simple_evaluator(
        self,
        request: Request,
        *,
        evaluator_id: UUID,
        #
        simple_evaluator_edit_request: SimpleEvaluatorEditRequest,
    ) -> SimpleEvaluatorResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATORS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        if str(evaluator_id) != str(simple_evaluator_edit_request.evaluator.id):
            return SimpleEvaluatorResponse()

        # TEMPORARY: Disabling name editing
        existing_simple_evaluator = await self.simple_evaluators_service.fetch(
            project_id=UUID(request.state.project_id),
            evaluator_id=evaluator_id,
        )
        if existing_simple_evaluator is None:
            return SimpleEvaluatorResponse()

        edit_model = simple_evaluator_edit_request.evaluator
        if (
            "name" in edit_model.model_fields_set
            and edit_model.name is not None
            and edit_model.name != existing_simple_evaluator.name
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=_build_rename_evaluators_disabled_detail(
                    existing_name=existing_simple_evaluator.name
                ),
            )

        simple_evaluator = await self.simple_evaluators_service.edit(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            simple_evaluator_edit=simple_evaluator_edit_request.evaluator,
        )

        simple_evaluator_response = SimpleEvaluatorResponse(
            count=1 if simple_evaluator else 0,
            evaluator=simple_evaluator,
        )

        return simple_evaluator_response

    @intercept_exceptions()
    async def archive_simple_evaluator(  # TODO: FIX ME
        self,
        request: Request,
        *,
        evaluator_id: UUID,
    ) -> SimpleEvaluatorResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATORS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        evaluator = await self.evaluators_service.fetch_evaluator(
            project_id=UUID(request.state.project_id),
            #
            evaluator_ref=Reference(id=evaluator_id),
        )

        if not evaluator or not evaluator.id:
            return SimpleEvaluatorResponse()

        evaluator = await self.evaluators_service.archive_evaluator(  # type: ignore
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            evaluator_id=evaluator.id,
        )

        if not evaluator or not evaluator.id:
            return SimpleEvaluatorResponse()

        evaluator_variant = await self.evaluators_service.fetch_evaluator_variant(
            project_id=UUID(request.state.project_id),
            #
            evaluator_ref=Reference(id=evaluator.id),
        )

        if evaluator_variant is None:
            return SimpleEvaluatorResponse()

        evaluator_variant = await self.evaluators_service.archive_evaluator_variant(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            evaluator_variant_id=evaluator_variant.id,  # type: ignore
        )

        if evaluator_variant is None:
            return SimpleEvaluatorResponse()

        simple_evaluator_flags = (
            SimpleEvaluatorFlags(
                **evaluator.flags.model_dump(
                    mode="json",
                    exclude_none=True,
                    exclude_unset=True,
                ),
            )
            if evaluator.flags
            else SimpleEvaluatorFlags()
        )

        simple_evaluator = SimpleEvaluator(
            id=evaluator.id,
            slug=evaluator.slug,
            #
            created_at=evaluator.created_at,
            updated_at=evaluator.updated_at,
            deleted_at=evaluator.deleted_at,
            created_by_id=evaluator.created_by_id,
            updated_by_id=evaluator.updated_by_id,
            deleted_by_id=evaluator.deleted_by_id,
            #
            name=evaluator.name,
            description=evaluator.description,
            #
            flags=simple_evaluator_flags,
            tags=evaluator.tags,
            meta=evaluator.meta,
        )

        simple_evaluator_response = SimpleEvaluatorResponse(
            count=1,
            evaluator=simple_evaluator,
        )

        return simple_evaluator_response

    @intercept_exceptions()
    async def unarchive_simple_evaluator(  # TODO: FIX ME
        self,
        *,
        request: Request,
        evaluator_id: UUID,
    ) -> SimpleEvaluatorResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATORS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        evaluator_ref = Reference(
            id=evaluator_id,
        )

        evaluator = await self.evaluators_service.fetch_evaluator(
            project_id=UUID(request.state.project_id),
            #
            evaluator_ref=evaluator_ref,
        )

        if evaluator is None or not evaluator.id:
            return SimpleEvaluatorResponse()

        evaluator = await self.evaluators_service.unarchive_evaluator(  # type: ignore
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            evaluator_id=evaluator.id,
        )

        if evaluator is None:
            return SimpleEvaluatorResponse()

        evaluator_variant = await self.evaluators_service.fetch_evaluator_variant(
            project_id=UUID(request.state.project_id),
            #
            evaluator_ref=evaluator_ref,
        )

        if evaluator_variant is None:
            return SimpleEvaluatorResponse()

        evaluator_variant = await self.evaluators_service.unarchive_evaluator_variant(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            evaluator_variant_id=evaluator_variant.id,  # type: ignore
        )

        if evaluator_variant is None:
            return SimpleEvaluatorResponse()

        simple_evaluator_flags = (
            SimpleEvaluatorFlags(
                **evaluator.flags.model_dump(
                    mode="json",
                    exclude_none=True,
                    exclude_unset=True,
                ),
            )
            if evaluator.flags
            else SimpleEvaluatorFlags()
        )

        simple_evaluator = SimpleEvaluator(
            id=evaluator.id,
            slug=evaluator.slug,
            #
            created_at=evaluator.created_at,
            updated_at=evaluator.updated_at,
            deleted_at=evaluator.deleted_at,
            created_by_id=evaluator.created_by_id,
            updated_by_id=evaluator.updated_by_id,
            deleted_by_id=evaluator.deleted_by_id,
            #
            name=evaluator.name,
            description=evaluator.description,
            #
            flags=simple_evaluator_flags,
            tags=evaluator.tags,
            meta=evaluator.meta,
        )

        simple_evaluator_response = SimpleEvaluatorResponse(
            count=1 if simple_evaluator else 0,
            evaluator=simple_evaluator,
        )

        return simple_evaluator_response

    @intercept_exceptions()
    @suppress_exceptions(default=SimpleEvaluatorsResponse(), exclude=[HTTPException])
    async def list_simple_evaluators(
        self,
        request: Request,
    ) -> SimpleEvaluatorsResponse:
        simple_evaluator_query_request = SimpleEvaluatorQueryRequest(
            evaluator=SimpleEvaluatorQuery(
                flags=SimpleEvaluatorQueryFlags(
                    is_evaluator=True,
                )
            )
        )

        return await self.query_simple_evaluators(
            request=request,
            #
            simple_evaluator_query_request=simple_evaluator_query_request,
        )

    @intercept_exceptions()
    @suppress_exceptions(default=SimpleEvaluatorsResponse(), exclude=[HTTPException])
    async def query_simple_evaluators(  # TODO: FIX ME
        self,
        request: Request,
        *,
        simple_evaluator_query_request: SimpleEvaluatorQueryRequest,
    ) -> SimpleEvaluatorsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_EVALUATORS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        simple_evaluator_flags = (
            simple_evaluator_query_request.evaluator.flags
            if simple_evaluator_query_request.evaluator
            else None
        )

        flags = EvaluatorQueryFlags(
            is_custom=(
                simple_evaluator_flags.is_custom if simple_evaluator_flags else None
            ),
            is_evaluator=True,
            is_human=(
                simple_evaluator_flags.is_human if simple_evaluator_flags else None
            ),
        )

        evaluator_query = EvaluatorQuery(
            flags=flags,
            tags=(
                simple_evaluator_query_request.evaluator.tags
                if simple_evaluator_query_request.evaluator
                else None
            ),
            meta=(
                simple_evaluator_query_request.evaluator.meta
                if simple_evaluator_query_request.evaluator
                else None
            ),
            #
        )

        evaluators = await self.evaluators_service.query_evaluators(
            project_id=UUID(request.state.project_id),
            #
            evaluator_query=evaluator_query,
            #
            evaluator_refs=simple_evaluator_query_request.evaluator_refs,
            #
            include_archived=simple_evaluator_query_request.include_archived,
            #
            windowing=simple_evaluator_query_request.windowing,
        )

        simple_evaluators: List[SimpleEvaluator] = []

        for evaluator in evaluators:
            evaluator_ref = Reference(
                id=evaluator.id,
            )

            evaluator_variant = await self.evaluators_service.fetch_evaluator_variant(
                project_id=UUID(request.state.project_id),
                #
                evaluator_ref=evaluator_ref,
            )

            if evaluator_variant is None:
                continue

            evaluator_variant_ref = Reference(
                id=evaluator_variant.id,
            )

            evaluator_revision = await self.evaluators_service.fetch_evaluator_revision(
                project_id=UUID(request.state.project_id),
                #
                evaluator_ref=evaluator_ref,
                evaluator_variant_ref=evaluator_variant_ref,
            )

            if evaluator_revision is None:
                continue

            simple_evaluator_flags = (
                SimpleEvaluatorFlags(
                    **evaluator.flags.model_dump(
                        mode="json",
                        exclude_none=True,
                        exclude_unset=True,
                    ),
                )
                if evaluator.flags
                else SimpleEvaluatorFlags()
            )

            simple_evaluator = SimpleEvaluator(
                id=evaluator.id,
                slug=evaluator.slug,
                #
                created_at=evaluator.created_at,
                updated_at=evaluator.updated_at,
                deleted_at=evaluator.deleted_at,
                created_by_id=evaluator.created_by_id,
                updated_by_id=evaluator.updated_by_id,
                deleted_by_id=evaluator.deleted_by_id,
                #
                name=evaluator.name,
                description=evaluator.description,
                #
                flags=simple_evaluator_flags,
                tags=evaluator.tags,
                meta=evaluator.meta,
                #
                data=SimpleEvaluatorData(
                    **(
                        evaluator_revision.data.model_dump(mode="json")
                        if evaluator_revision.data
                        else {}
                    ),
                ),
            )

            simple_evaluators.append(simple_evaluator)

        simple_evaluators_response = SimpleEvaluatorsResponse(
            count=len(simple_evaluators),
            evaluators=simple_evaluators,
        )

        return simple_evaluators_response

    # EVALUATOR TEMPLATES ------------------------------------------------------

    @intercept_exceptions()
    async def list_evaluator_templates(
        self,
        request: Request,
        *,
        include_archived: bool = False,
    ) -> EvaluatorTemplatesResponse:
        """
        Returns the list of built-in evaluator templates.

        These are static evaluator type definitions (not user-created configs).
        """
        from oss.src.resources.evaluators.evaluators import get_all_evaluators

        all_templates = get_all_evaluators()

        # Filter templates based on include_archived flag
        templates = [
            EvaluatorTemplate(**template)
            for template in all_templates
            if include_archived or not template.get("archived", False)
        ]

        return EvaluatorTemplatesResponse(
            count=len(templates),
            templates=templates,
        )
