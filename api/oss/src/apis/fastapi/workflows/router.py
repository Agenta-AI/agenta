from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Request, status, HTTPException, Depends

from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions, suppress_exceptions
from oss.src.utils.caching import get_cache, set_cache, invalidate_cache

from oss.src.core.shared.dtos import Reference
from oss.src.core.workflows.service import WorkflowsService
from oss.src.apis.fastapi.workflows.models import (
    WorkflowCreateRequest,
    WorkflowEditRequest,
    WorkflowQueryRequest,
    WorkflowForkRequest,
    WorkflowLogRequest,
    WorkflowResponse,
    WorkflowsResponse,
    #
    WorkflowVariantCreateRequest,
    WorkflowVariantEditRequest,
    WorkflowVariantQueryRequest,
    WorkflowVariantResponse,
    WorkflowVariantsResponse,
    #
    WorkflowRevisionCreateRequest,
    WorkflowRevisionEditRequest,
    WorkflowRevisionQueryRequest,
    WorkflowRevisionCommitRequest,
    WorkflowRevisionResponse,
    WorkflowRevisionsResponse,
    #
    WorkflowRevisionRetrieveRequest,
    #
    WorkflowServiceRequest,
    WorkflowServiceResponse,
    WorkflowServiceInterface,
)

from oss.src.core.workflows.dtos import (
    WorkflowRevision,
    WorkflowRevisionData,
)

from oss.src.apis.fastapi.workflows.utils import (
    parse_workflow_query_request_from_params,
    parse_workflow_query_request_from_body,
    merge_workflow_query_requests,
    parse_workflow_variant_query_request_from_params,
    parse_workflow_variant_query_request_from_body,
    merge_workflow_variant_query_requests,
    parse_workflow_revision_query_request_from_params,
    parse_workflow_revision_query_request_from_body,
    merge_workflow_revision_query_requests,
    parse_workflow_revision_retrieve_request_from_params,
    parse_workflow_revision_retrieve_request_from_body,
)

if is_ee():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access, FORBIDDEN_EXCEPTION


log = get_module_logger(__name__)


class WorkflowsRouter:
    VERSION = "1.0.0"

    def __init__(
        self,
        workflows_service: WorkflowsService,
    ):
        self.workflows_service = workflows_service

        self.router = APIRouter()

        # — workflows ——————————————————————————————————————————————————————————

        self.router.add_api_route(
            "/",
            self.create_workflow,
            methods=["POST"],
            operation_id="create_workflow",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{workflow_id}",
            self.fetch_workflow,
            methods=["GET"],
            operation_id="fetch_workflow",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{workflow_id}",
            self.edit_workflow,
            methods=["PUT"],
            operation_id="edit_workflow",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{workflow_id}/archive",
            self.archive_workflow,
            methods=["POST"],
            operation_id="archive_workflow",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{workflow_id}/unarchive",
            self.unarchive_workflow,
            methods=["POST"],
            operation_id="unarchive_workflow",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/",
            self.query_workflows,
            methods=["GET"],
            operation_id="list_workflows",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowsResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/query",
            self.query_workflows,
            methods=["POST"],
            operation_id="query_workflows",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowsResponse,
            response_model_exclude_none=True,
        )

        # ——————————————————————————————————————————————————————————————————————

        # — workflow variants ——————————————————————————————————————————————————

        self.router.add_api_route(
            "/variants/",
            self.create_workflow_variant,
            methods=["POST"],
            operation_id="create_workflow_variant",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowVariantResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/variants/{workflow_variant_id}",
            self.fetch_workflow_variant,
            methods=["GET"],
            operation_id="fetch_workflow_variant",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowVariantResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/variants/{workflow_variant_id}",
            self.edit_workflow_variant,
            methods=["PUT"],
            operation_id="edit_workflow_variant",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowVariantResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/variants/{workflow_variant_id}/archive",
            self.archive_workflow_variant,
            methods=["POST"],
            operation_id="archive_workflow_variant",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowVariantResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/variants/{workflow_variant_id}/unarchive",
            self.unarchive_workflow_variant,
            methods=["POST"],
            operation_id="unarchive_workflow_variant",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowVariantResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/variants/",
            self.query_workflow_variants,
            methods=["GET"],
            operation_id="list_workflow_variants",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowVariantsResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/variants/query",
            self.query_workflow_variants,
            methods=["POST"],
            operation_id="query_workflow_variants",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowVariantsResponse,
            response_model_exclude_none=True,
        )

        # ----------------------------------------------------------------------

        self.router.add_api_route(
            "/variants/fork",
            self.fork_workflow_variant,
            methods=["POST"],
            operation_id="fork_workflow_variant",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowVariantResponse,
            response_model_exclude_none=True,
        )

        # ——————————————————————————————————————————————————————————————————————

        # — workflow revisions —————————————————————————————————————————————————

        self.router.add_api_route(
            "/revisions/retrieve",
            self.retrieve_workflow_revision,
            methods=["GET"],
            operation_id="retrieve_workflow_revision",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowRevisionResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/",
            self.create_workflow_revision,
            methods=["POST"],
            operation_id="create_workflow_revision",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowRevisionResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/{workflow_revision_id}",
            self.fetch_workflow_revision,
            methods=["GET"],
            operation_id="fetch_workflow_revision",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowRevisionResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/{workflow_revision_id}",
            self.edit_workflow_revision,
            methods=["PUT"],
            operation_id="edit_workflow_revision",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowRevisionResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/{workflow_revision_id}/archive",
            self.archive_workflow_revision,
            methods=["POST"],
            operation_id="archive_workflow_revision_rpc",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowRevisionResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/{workflow_revision_id}/unarchive",
            self.unarchive_workflow_revision,
            methods=["POST"],
            operation_id="unarchive_workflow_revision_rpc",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowRevisionResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/",
            self.query_workflow_revisions,
            methods=["GET"],
            operation_id="list_workflow_revisions",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowRevisionsResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/query",
            self.query_workflow_revisions,
            methods=["POST"],
            operation_id="query_workflow_revisions",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowRevisionsResponse,
            response_model_exclude_none=True,
        )

        # ----------------------------------------------------------------------

        self.router.add_api_route(
            "/revisions/commit",
            self.commit_workflow_revision,
            methods=["POST"],
            operation_id="commit_workflow_revision",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowRevisionResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/log",
            self.log_workflow_revisions,
            methods=["POST"],
            operation_id="log_workflow_revisions",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowRevisionsResponse,
            response_model_exclude_none=True,
        )

        # ——————————————————————————————————————————————————————————————————————

        # — workflow executions ————————————————————————————————————————————————

        self.router.add_api_route(
            "/invoke",
            self.invoke_workflow,
            methods=["POST"],
            operation_id="invoke_workflow",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowServiceResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/inspect",
            self.inspect_workflow,
            methods=["GET"],
            operation_id="inspect_workflow",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowServiceInterface,
            response_model_exclude_none=True,
        )

        # ——————————————————————————————————————————————————————————————————————

    # — artifacts ——————————————————————————————————————————————————————————————

    @intercept_exceptions()
    async def create_workflow(
        self,
        request: Request,
        *,
        workflow_create_request: WorkflowCreateRequest,
    ) -> WorkflowResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        workflow = await self.workflows_service.create_workflow(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            workflow_create=workflow_create_request.workflow,
        )

        workflow_response = WorkflowResponse(
            count=1 if workflow is not None else 0,
            workflow=workflow,
        )

        return workflow_response

    @intercept_exceptions()
    @suppress_exceptions(default=WorkflowResponse())
    async def fetch_workflow(
        self,
        request: Request,
        *,
        workflow_id: UUID,
    ) -> WorkflowResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        workflow = await self.workflows_service.fetch_workflow(
            project_id=UUID(request.state.project_id),
            #
            workflow_ref=Reference(id=workflow_id),
        )

        workflow_response = WorkflowResponse(
            count=1 if workflow is not None else 0,
            workflow=workflow,
        )

        return workflow_response

    @intercept_exceptions()
    async def edit_workflow(
        self,
        request: Request,
        *,
        workflow_id: UUID,
        workflow_edit_request: WorkflowEditRequest,
    ) -> WorkflowResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        if str(workflow_id) != str(workflow_edit_request.workflow.id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"ID mismatch between path params and body params: {workflow_id} != {workflow_edit_request.workflow.id}",
            )

        workflow = await self.workflows_service.edit_workflow(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            workflow_edit=workflow_edit_request.workflow,
        )

        workflow_response = WorkflowResponse(
            count=1 if workflow is not None else 0,
            workflow=workflow,
        )

        return workflow_response

    @intercept_exceptions()
    async def archive_workflow(
        self,
        request: Request,
        *,
        workflow_id: UUID,
    ) -> WorkflowResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        workflow = await self.workflows_service.archive_workflow(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            workflow_id=workflow_id,
        )

        workflow_response = WorkflowResponse(
            count=1 if workflow is not None else 0,
            workflow=workflow,
        )

        return workflow_response

    @intercept_exceptions()
    async def unarchive_workflow(
        self,
        request: Request,
        *,
        workflow_id: UUID,
    ) -> WorkflowResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        workflow = await self.workflows_service.unarchive_workflow(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            workflow_id=workflow_id,
        )

        workflow_response = WorkflowResponse(
            count=1 if workflow is not None else 0,
            workflow=workflow,
        )

        return workflow_response

    @intercept_exceptions()
    @suppress_exceptions(default=WorkflowsResponse())
    async def query_workflows(
        self,
        request: Request,
        *,
        query_request_params: Optional[WorkflowQueryRequest] = Depends(
            parse_workflow_query_request_from_params
        ),
    ) -> WorkflowsResponse:
        body_json = None
        query_request_body = None

        try:
            body_json = await request.json()

            if body_json:
                query_request_body = parse_workflow_query_request_from_body(**body_json)

        except:  # pylint: disable=bare-except
            pass

        workflow_query_request = merge_workflow_query_requests(
            query_request_params,
            query_request_body,
        )

        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        workflows = await self.workflows_service.query_workflows(
            project_id=UUID(request.state.project_id),
            #
            workflow_query=workflow_query_request.workflow,
            #
            workflow_refs=workflow_query_request.workflow_refs,
            #
            include_archived=workflow_query_request.include_archived,
            #
            windowing=workflow_query_request.windowing,
        )

        workflows_response = WorkflowsResponse(
            count=len(workflows),
            workflows=workflows,
        )

        return workflows_response

    # ——————————————————————————————————————————————————————————————————————————

    # — workflow variants ——————————————————————————————————————————————————————

    @intercept_exceptions()
    async def create_workflow_variant(
        self,
        request: Request,
        *,
        workflow_variant_create_request: WorkflowVariantCreateRequest,
    ) -> WorkflowVariantResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        workflow_variant = await self.workflows_service.create_workflow_variant(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            workflow_variant_create=workflow_variant_create_request.workflow_variant,
        )

        workflow_variant_response = WorkflowVariantResponse(
            count=1 if workflow_variant is not None else 0,
            workflow_variant=workflow_variant,
        )

        return workflow_variant_response

    @intercept_exceptions()
    @suppress_exceptions(default=WorkflowVariantResponse())
    async def fetch_workflow_variant(
        self,
        request: Request,
        *,
        workflow_variant_id: UUID,
    ) -> WorkflowVariantResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        workflow_variant = await self.workflows_service.fetch_workflow_variant(
            project_id=UUID(request.state.project_id),
            #
            workflow_variant_ref=Reference(id=workflow_variant_id),
        )

        workflow_variant_response = WorkflowVariantResponse(
            count=1 if workflow_variant is not None else 0,
            workflow_variant=workflow_variant,
        )

        return workflow_variant_response

    @intercept_exceptions()
    async def edit_workflow_variant(
        self,
        request: Request,
        *,
        workflow_variant_id: UUID,
        workflow_variant_edit_request: WorkflowVariantEditRequest,
    ) -> WorkflowVariantResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        if str(workflow_variant_id) != str(
            workflow_variant_edit_request.workflow_variant.id
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"ID mismatch between path params and body params: {workflow_variant_id} != {workflow_variant_edit_request.variant.id}",
            )

        workflow_variant = await self.workflows_service.edit_workflow_variant(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            workflow_variant_edit=workflow_variant_edit_request.workflow_variant,
        )

        workflow_variant_response = WorkflowVariantResponse(
            count=1 if workflow_variant is not None else 0,
            variant=workflow_variant,
        )

        return workflow_variant_response

    @intercept_exceptions()
    async def archive_workflow_variant(
        self,
        request: Request,
        *,
        workflow_variant_id: UUID,
    ) -> WorkflowVariantResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        workflow_variant = await self.workflows_service.archive_workflow_variant(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            workflow_variant_id=workflow_variant_id,
        )

        workflow_variant_response = WorkflowVariantResponse(
            count=1 if workflow_variant is not None else 0,
            workflow_variant=workflow_variant,
        )

        return workflow_variant_response

    @intercept_exceptions()
    async def unarchive_workflow_variant(
        self,
        request: Request,
        *,
        workflow_variant_id: UUID,
    ) -> WorkflowVariantResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        workflow_variant = await self.workflows_service.unarchive_workflow_variant(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            workflow_variant_id=workflow_variant_id,
        )

        workflow_variant_response = WorkflowVariantResponse(
            count=1 if workflow_variant is not None else 0,
            workflow_variant=workflow_variant,
        )

        return workflow_variant_response

    @intercept_exceptions()
    @suppress_exceptions(default=WorkflowVariantsResponse())
    async def query_workflow_variants(
        self,
        request: Request,
        *,
        query_request_params: Optional[WorkflowVariantQueryRequest] = Depends(
            parse_workflow_variant_query_request_from_params
        ),
    ) -> WorkflowVariantsResponse:
        body_json = None
        query_request_body = None

        try:
            body_json = await request.json()

            if body_json:
                query_request_body = parse_workflow_variant_query_request_from_body(
                    **body_json
                )

        except:  # pylint: disable=bare-except
            pass

        workflow_variant_query_request = merge_workflow_variant_query_requests(
            query_request_params,
            query_request_body,
        )

        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        workflow_variants = await self.workflows_service.query_workflow_variants(
            project_id=UUID(request.state.project_id),
            #
            workflow_variant_query=workflow_variant_query_request.workflow_variant,
            #
            workflow_refs=workflow_variant_query_request.workflow_refs,
            workflow_variant_refs=workflow_variant_query_request.workflow_variant_refs,
            #
            include_archived=workflow_variant_query_request.include_archived,
            #
            windowing=workflow_variant_query_request.windowing,
        )

        workflow_variants_response = WorkflowVariantsResponse(
            count=len(workflow_variants),
            workflow_variants=workflow_variants,
        )

        return workflow_variants_response

    # --------------------------------------------------------------------------

    @intercept_exceptions()
    async def fork_workflow_variant(
        self,
        request: Request,
        *,
        workflow_fork_request: WorkflowForkRequest,
    ) -> WorkflowVariantResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        workflow_variant = await self.workflows_service.fork_workflow_variant(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            workflow_fork=workflow_fork_request.workflow,
        )

        workflow_variant_response = WorkflowVariantResponse(
            count=1 if workflow_variant is not None else 0,
            workflow_variant=workflow_variant,
        )

        return workflow_variant_response

    # ——————————————————————————————————————————————————————————————————————————

    # — workflow revisions —————————————————————————————————————————————————————

    @intercept_exceptions()
    async def create_workflow_revision(
        self,
        request: Request,
        *,
        workflow_revision_create_request: WorkflowRevisionCreateRequest,
    ) -> WorkflowRevisionResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        workflow_revision = await self.workflows_service.create_workflow_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            workflow_revision_create=workflow_revision_create_request.workflow_revision,
        )

        workflow_revision_response = WorkflowRevisionResponse(
            count=1 if workflow_revision is not None else 0,
            workflow_revision=workflow_revision,
        )

        return workflow_revision_response

    @intercept_exceptions()
    @suppress_exceptions(default=WorkflowRevisionResponse())
    async def fetch_workflow_revision(
        self,
        request: Request,
        *,
        workflow_revision_id: UUID,
    ) -> WorkflowRevisionResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        workflow_revision = await self.workflows_service.fetch_workflow_revision(
            project_id=UUID(request.state.project_id),
            #
            workflow_revision_ref=Reference(id=workflow_revision_id),
        )

        workflow_revision_response = WorkflowRevisionResponse(
            count=1 if workflow_revision is not None else 0,
            workflow_revision=workflow_revision,
        )

        return workflow_revision_response

    @intercept_exceptions()
    async def edit_workflow_revision(
        self,
        request: Request,
        *,
        workflow_revision_id: UUID,
        workflow_revision_request: WorkflowRevisionEditRequest,
    ) -> WorkflowRevisionResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        if str(workflow_revision_id) != str(
            workflow_revision_request.workflow_revision.id
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"ID mismatch between path params and body params: {workflow_revision_id} != {workflow_revision_request.workflow_revision.id}",
            )

        workflow_revision = await self.workflows_service.edit_workflow_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            workflow_revision_edit=workflow_revision_request.workflow_revision,
        )

        workflow_revision_response = WorkflowRevisionResponse(
            count=1 if workflow_revision is not None else 0,
            workflow_revision=workflow_revision,
        )

        return workflow_revision_response

    @intercept_exceptions()
    async def archive_workflow_revision(
        self,
        request: Request,
        *,
        workflow_revision_id: UUID,
    ) -> WorkflowRevisionResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        workflow_revision = await self.workflows_service.archive_workflow_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            workflow_revision_id=workflow_revision_id,
        )

        workflow_revision_response = WorkflowRevisionResponse(
            count=1 if workflow_revision is not None else 0,
            workflow_revision=workflow_revision,
        )

        return workflow_revision_response

    @intercept_exceptions()
    async def unarchive_workflow_revision(
        self,
        request: Request,
        *,
        workflow_revision_id: UUID,
    ) -> WorkflowRevisionResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        workflow_revision = await self.workflows_service.unarchive_workflow_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            workflow_revision_id=workflow_revision_id,
        )

        workflow_revision_response = WorkflowRevisionResponse(
            count=1 if workflow_revision is not None else 0,
            workflow_revision=workflow_revision,
        )

        return workflow_revision_response

    @intercept_exceptions()
    @suppress_exceptions(default=WorkflowRevisionsResponse())
    async def query_workflow_revisions(
        self,
        request: Request,
        query_request_params: Optional[WorkflowRevisionQueryRequest] = Depends(
            parse_workflow_revision_query_request_from_params
        ),
    ) -> WorkflowRevisionsResponse:
        body_json = None
        query_request_body = None

        try:
            body_json = await request.json()

            if body_json:
                query_request_body = parse_workflow_revision_query_request_from_body(
                    **body_json
                )

        except:  # pylint: disable=bare-except
            pass

        workflow_revision_query_request = merge_workflow_revision_query_requests(
            query_request_params, query_request_body
        )

        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        workflow_revisions = await self.workflows_service.query_workflow_revisions(
            project_id=UUID(request.state.project_id),
            #
            workflow_revision_query=workflow_revision_query_request.workflow_revision,
            #
            workflow_refs=workflow_revision_query_request.workflow_refs,
            workflow_variant_refs=workflow_revision_query_request.workflow_variant_refs,
            workflow_revision_refs=workflow_revision_query_request.workflow_revision_refs,
            #
            include_archived=workflow_revision_query_request.include_archived,
            #
            windowing=workflow_revision_query_request.windowing,
        )

        workflow_revisions_response = WorkflowRevisionsResponse(
            count=len(workflow_revisions),
            workflow_revisions=workflow_revisions,
        )

        return workflow_revisions_response

    # --------------------------------------------------------------------------

    @intercept_exceptions()
    async def commit_workflow_revision(
        self,
        request: Request,
        *,
        workflow_revision_commit_request: WorkflowRevisionCommitRequest,
        workflow_variant_id: Optional[UUID] = None,
    ) -> WorkflowRevisionResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        if workflow_variant_id:
            if str(workflow_variant_id) != str(
                workflow_revision_commit_request.workflow_revision.workflow_variant_id
            ):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"ID mismatch between path params and body params: {workflow_variant_id} != {workflow_revision_commit_request.workflow_revision.workflow_variant_id}",
                )

        workflow_revision = await self.workflows_service.commit_workflow_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            workflow_revision_commit=workflow_revision_commit_request.workflow_revision,
        )

        workflow_revision_response = WorkflowRevisionResponse(
            count=1 if workflow_revision is not None else 0,
            workflow_revision=workflow_revision,
        )

        return workflow_revision_response

    @intercept_exceptions()
    @suppress_exceptions(default=WorkflowRevisionsResponse())
    async def log_workflow_revisions(
        self,
        request: Request,
        *,
        workflow_log_request: WorkflowLogRequest,
    ) -> WorkflowRevisionsResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        revisions = await self.workflows_service.log_workflow_revisions(
            project_id=UUID(request.state.project_id),
            #
            workflow_log=workflow_log_request.workflow,
        )

        revisions_response = WorkflowRevisionsResponse(
            count=len(revisions),
            revisions=revisions,
        )

        return revisions_response

    @intercept_exceptions()
    @suppress_exceptions(default=WorkflowRevisionResponse())
    async def retrieve_workflow_revision(
        self,
        request: Request,
        *,
        retrieve_request_params: Optional[WorkflowRevisionRetrieveRequest] = Depends(
            parse_workflow_revision_retrieve_request_from_params
        ),
    ) -> WorkflowRevisionResponse:
        body_json = None
        retrieve_request_body = None

        try:
            body_json = await request.json()

            if body_json:
                retrieve_request_body = (
                    parse_workflow_revision_retrieve_request_from_body(**body_json)
                )

        except:  # pylint: disable=bare-except
            pass

        workflow_revision_retrieve_request = (
            retrieve_request_params or retrieve_request_body
        )

        if not workflow_revision_retrieve_request:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Could not retrieve workflow revision. Please provide a valid request.",
            )

        cache_key = {
            "artifact_ref": workflow_revision_retrieve_request.workflow_ref,
            "variant_ref": workflow_revision_retrieve_request.workflow_variant_ref,
            "revision_ref": workflow_revision_retrieve_request.workflow_revision_ref,
        }

        workflow_revision = get_cache(
            namespace="workflows:retrieve",
            project_id=request.state.project_id,
            user_id=request.state.user_id,
            key=cache_key,
            model=WorkflowRevision,
        )

        if not workflow_revision:
            workflow_revision = await self.workflows_service.fetch_workflow_revision(
                project_id=UUID(request.state.project_id),
                #
                workflow_ref=workflow_revision_retrieve_request.workflow_ref,
                workflow_variant_ref=workflow_revision_retrieve_request.workflow_variant_ref,
                workflow_revision_ref=workflow_revision_retrieve_request.workflow_revision_ref,
            )

            set_cache(
                namespace="workflows:retrieve",
                project_id=request.state.project_id,
                user_id=request.state.user_id,
                key=cache_key,
                value=workflow_revision,
            )

        workflow_revision_response = WorkflowRevisionResponse(
            count=1 if workflow_revision is not None else 0,
            workflow_revision=workflow_revision,
        )

        return workflow_revision_response

    # ——————————————————————————————————————————————————————————————————————————

    # — workflow executions ————————————————————————————————————————————————————

    @intercept_exceptions()
    @suppress_exceptions(default=WorkflowServiceResponse())
    async def invoke_workflow(
        self,
        request: Request,
        *,
        workflow_service_request: WorkflowServiceRequest,
        workflow_revision_data: Optional[WorkflowRevisionData] = None,
        workflow_retrieve_request: Optional[WorkflowRevisionRetrieveRequest] = Depends(
            parse_workflow_revision_retrieve_request_from_params
        ),
    ) -> WorkflowServiceResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.RUN_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        workflow_revision = None

        if not workflow_revision_data:
            if not workflow_retrieve_request:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Workflow revision data or retrieve request must be provided.",
                )

            workflow_revision_response = await self.retrieve_workflow_revision(
                request=request,
                retrieve_request_params=workflow_retrieve_request,
            )

            workflow_revision = workflow_revision_response.workflow_revision

        else:
            workflow_revision = WorkflowRevision(
                data=workflow_revision_data,
            )

        if not workflow_revision:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Workflow revision could not be found.",
            )

        if workflow_revision.data.url:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Workflows with URLs cannot be invoked with this endpoint. Please send a request directly to the URL.",
            )

        if not workflow_revision.data.uri:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Workflows without URIs cannot be invoked with this endpoint. Please use a workflow revision with URI.",
            )

        workflow_service_response = await self.workflows_service.invoke_workflow(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            request=workflow_service_request,
            revision=workflow_revision,
        )

        return workflow_service_response

    @intercept_exceptions()
    @suppress_exceptions(default=WorkflowServiceInterface())
    async def inspect_workflow(
        self,
        request: Request,
        *,
        workflow_service_interface: WorkflowServiceInterface,
    ) -> WorkflowServiceInterface:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        cache_key = {
            "uri": workflow_service_interface.uri,
            "url": workflow_service_interface.url,
        }

        workflow_service_interface = get_cache(
            namespace="workflows:inspect",
            project_id=request.state.project_id,
            user_id=request.state.user_id,
            key=cache_key,
            model=WorkflowServiceInterface,
        )

        if not workflow_service_interface:
            workflow_service_interface = await self.workflows_service.inspect_workflow(
                project_id=UUID(request.state.project_id),
                user_id=UUID(request.state.user_id),
                #
                interface=workflow_service_interface,
            )

            set_cache(
                namespace="workflows:inspect",
                project_id=request.state.project_id,
                user_id=request.state.user_id,
                key=cache_key,
                value=workflow_service_interface,
            )

        return workflow_service_interface

    # ——————————————————————————————————————————————————————————————————————————
