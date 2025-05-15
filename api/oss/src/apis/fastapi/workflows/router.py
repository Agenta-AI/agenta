from typing import Optional
from uuid import UUID

from fastapi import Request, status, HTTPException, Depends

from oss.src.core.shared.dtos import Reference
from oss.src.utils.common import APIRouter, is_ee
from oss.src.core.workflows.dtos import WorkflowQuery
from oss.src.core.workflows.service import WorkflowsService
from oss.src.apis.fastapi.shared.utils import handle_exceptions
from oss.src.apis.fastapi.workflows.models import (
    WorkflowRequest,
    WorkflowResponse,
    WorkflowsResponse,
    WorkflowVariantRequest,
    WorkflowVariantResponse,
    WorkflowVariantsResponse,
    WorkflowRevisionRequest,
    WorkflowRevisionResponse,
    WorkflowRevisionsResponse,
)
from oss.src.apis.fastapi.workflows.utils import (
    parse_workflow_query_request,
    parse_workflow_body_request,
    parse_variant_query_request,
    parse_variant_body_request,
    parse_revision_query_request,
    parse_revision_body_request,
    merge_requests,
)

if is_ee():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access, FORBIDDEN_EXCEPTION


class WorkflowsRouter:
    VERSION = "1.0.0"

    def __init__(
        self,
        workflows_service: WorkflowsService,
    ):
        self.workflows_service = workflows_service

        self.router = APIRouter()

        # — artifacts ——————————————————————————————————————————————————————————

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

        # — variants ———————————————————————————————————————————————————————————

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
            "/variants/{variant_id}",
            self.fetch_workflow_variant,
            methods=["GET"],
            operation_id="fetch_workflow_variant",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowVariantResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/variants/{variant_id}",
            self.edit_workflow_variant,
            methods=["PUT"],
            operation_id="edit_workflow_variant",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowVariantResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/variants/{variant_id}/archive",
            self.archive_workflow_variant,
            methods=["POST"],
            operation_id="archive_workflow_variant",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowVariantResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/variants/{variant_id}/unarchive",
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
            "/variants/{variant_id}/commit",
            self.commit_workflow_revision,
            methods=["POST"],
            operation_id="commit_workflow_revision_by_variant_id",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowRevisionResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/variants/{variant_id}/fork",
            self.fork_workflow_variant,
            methods=["POST"],
            operation_id="fork_workflow_variant",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowVariantResponse,
            response_model_exclude_none=True,
        )

        # ——————————————————————————————————————————————————————————————————————

        # — revisions ——————————————————————————————————————————————————————————

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
            "/revisions/{revision_id}",
            self.fetch_workflow_revision,
            methods=["GET"],
            operation_id="fetch_workflow_revision",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowRevisionResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/{revision_id}",
            self.edit_workflow_revision,
            methods=["PUT"],
            operation_id="edit_workflow_revision",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowRevisionResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/{revision_id}/archive",
            self.archive_workflow_revision,
            methods=["POST"],
            operation_id="archive_workflow_revision_rpc",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowRevisionResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/{revision_id}/unarchive",
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
            "/revisions/{revision_id}/fork",
            self.fork_workflow_variant,
            methods=["POST"],
            operation_id="fork_workflow_variant_by_revision_id",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowVariantResponse,
            response_model_exclude_none=True,
        )

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

    # — artifacts ——————————————————————————————————————————————————————————————

    @handle_exceptions()
    async def create_workflow(
        self,
        request: Request,
        *,
        workflow_request: WorkflowRequest,
    ):
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        artifact = await self.workflows_service.create_artifact(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            artifact_slug=workflow_request.workflow.slug,
            #
            artifact_flags=workflow_request.workflow.flags,
            artifact_metadata=workflow_request.workflow.metadata,
            artifact_name=workflow_request.workflow.name,
            artifact_description=workflow_request.workflow.description,
        )

        artifact_response = WorkflowResponse(
            count=1 if artifact is not None else 0,
            artifact=artifact,
        )

        return artifact_response

    @handle_exceptions()
    async def fetch_workflow(
        self,
        request: Request,
        *,
        artifact_id: UUID,
    ):
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        artifact = await self.workflows_service.fetch_artifact(
            project_id=UUID(request.state.project_id),
            #
            artifact_ref=Reference(id=artifact_id),
        )

        artifact_response = WorkflowResponse(
            count=1 if artifact is not None else 0,
            artifact=artifact,
        )

        return artifact_response

    @handle_exceptions()
    async def edit_workflow(
        self,
        request: Request,
        *,
        workflow_id: UUID,
        workflow_request: WorkflowRequest,
    ):
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        if str(workflow_id) != str(workflow_request.workflow.id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"ID mismatch between path params and body params: {workflow_id} != {workflow_request.workflow.id}",
            )

        artifact = await self.workflows_service.edit_artifact(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            artifact_id=workflow_request.workflow.id,
            #
            artifact_flags=workflow_request.workflow.flags,
            artifact_metadata=workflow_request.workflow.metadata,
            artifact_name=workflow_request.workflow.name,
            artifact_description=workflow_request.workflow.description,
        )

        artifact_response = WorkflowResponse(
            count=1 if artifact is not None else 0,
            artifact=artifact,
        )

        return artifact_response

    @handle_exceptions()
    async def archive_workflow(
        self,
        request: Request,
        *,
        artifact_id: UUID,
    ):
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        artifact = await self.workflows_service.archive_artifact(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            artifact_id=artifact_id,
        )

        artifact_response = WorkflowResponse(
            count=1 if artifact is not None else 0,
            artifact=artifact,
        )

        return artifact_response

    @handle_exceptions()
    async def unarchive_workflow(
        self,
        request: Request,
        *,
        artifact_id: UUID,
    ):
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        artifact = await self.workflows_service.unarchive_artifact(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            artifact_id=artifact_id,
        )

        artifact_response = WorkflowResponse(
            count=1 if artifact is not None else 0,
            artifact=artifact,
        )

        return artifact_response

    @handle_exceptions()
    async def query_workflows(
        self,
        request: Request,
        *,
        query: Optional[WorkflowQuery] = Depends(parse_workflow_query_request),
    ):
        body_json = None
        query_from_body = None

        try:
            body_json = await request.json()

            if body_json:
                query_from_body = parse_workflow_body_request(**body_json)

        except:  # pylint: disable=bare-except
            pass

        _query = merge_requests(query, query_from_body)

        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        artifacts = []

        if _query.artifact_ref:
            artifact = await self.workflows_service.fetch_artifact(
                project_id=UUID(request.state.project_id),
                #
                artifact_ref=_query.artifact_ref,
            )

            artifacts = [artifact]

        else:
            artifacts = await self.workflows_service.query_artifacts(
                project_id=UUID(request.state.project_id),
                #
                artifact_flags=_query.flags,
                artifact_metadata=_query.metadata,
                #
                include_archived=_query.include_archived,
            )

        artifacts_response = WorkflowsResponse(
            count=len(artifacts),
            artifacts=artifacts,
        )

        return artifacts_response

    # ——————————————————————————————————————————————————————————————————————————

    # — variants ———————————————————————————————————————————————————————————————

    @handle_exceptions()
    async def create_workflow_variant(
        self,
        request: Request,
        *,
        variant_request: WorkflowVariantRequest,
    ):
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        variant = await self.workflows_service.create_variant(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            artifact_id=variant_request.variant.artifact_id,
            #
            variant_slug=variant_request.variant.slug,
            #
            variant_flags=variant_request.variant.flags,
            variant_metadata=variant_request.variant.metadata,
            variant_name=variant_request.variant.name,
            variant_description=variant_request.variant.description,
        )

        variant_response = WorkflowVariantResponse(
            count=1 if variant is not None else 0,
            variant=variant,
        )

        return variant_response

    @handle_exceptions()
    async def fetch_workflow_variant(
        self,
        request: Request,
        *,
        variant_id: UUID,
    ):
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        variant = await self.workflows_service.fetch_variant(
            project_id=UUID(request.state.project_id),
            #
            variant_ref=Reference(id=variant_id),
        )

        variant_response = WorkflowVariantResponse(
            count=1 if variant is not None else 0,
            variant=variant,
        )

        return variant_response

    @handle_exceptions()
    async def edit_workflow_variant(
        self,
        request: Request,
        *,
        variant_id: UUID,
        variant_request: WorkflowVariantRequest,
    ):
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        if str(variant_id) != str(variant_request.variant.id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"ID mismatch between path params and body params: {variant_id} != {variant_request.variant.id}",
            )

        variant = await self.workflows_service.edit_variant(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            variant_id=variant_request.variant.id,
            #
            variant_flags=variant_request.variant.flags,
            variant_metadata=variant_request.variant.metadata,
            variant_name=variant_request.variant.name,
            variant_description=variant_request.variant.description,
        )

        variant_response = WorkflowVariantResponse(
            count=1 if variant is not None else 0,
            variant=variant,
        )

        return variant_response

    @handle_exceptions()
    async def archive_workflow_variant(
        self,
        request: Request,
        *,
        variant_id: UUID,
    ):
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        variant = await self.workflows_service.archive_variant(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            variant_id=variant_id,
        )

        variant_response = WorkflowVariantResponse(
            count=1 if variant is not None else 0,
            variant=variant,
        )

        return variant_response

    @handle_exceptions()
    async def unarchive_workflow_variant(
        self,
        request: Request,
        *,
        variant_id: UUID,
    ):
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        variant = await self.workflows_service.unarchive_variant(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            variant_id=variant_id,
        )

        variant_response = WorkflowVariantResponse(
            count=1 if variant is not None else 0,
            variant=variant,
        )

        return variant_response

    @handle_exceptions()
    async def query_workflow_variants(
        self,
        request: Request,
        *,
        query: Optional[WorkflowQuery] = Depends(parse_variant_query_request),
    ):
        body_json = None
        query_from_body = None

        try:
            body_json = await request.json()

            if body_json:
                query_from_body = parse_variant_body_request(**body_json)

        except:  # pylint: disable=bare-except
            pass

        _query = merge_requests(query, query_from_body)

        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        variants = []

        if _query.artifact_ref or _query.variant_ref:
            variant = await self.workflows_service.fetch_variant(
                project_id=UUID(request.state.project_id),
                #
                artifact_ref=_query.artifact_ref,
                variant_ref=_query.variant_ref,
            )

            variants = [variant]

        else:
            variants = await self.workflows_service.query_variants(
                project_id=UUID(request.state.project_id),
                #
                variant_flags=_query.flags,
                variant_metadata=_query.metadata,
                #
                include_archived=_query.include_archived,
            )

        variants_response = WorkflowVariantsResponse(
            count=len(variants),
            variants=variants,
        )

        return variants_response

    # --------------------------------------------------------------------------

    @handle_exceptions()
    async def fork_workflow_variant(
        self,
        request: Request,
        *,
        revision_request: WorkflowRevisionRequest,
        variant_id: Optional[UUID] = None,
        revision_id: Optional[UUID] = None,
    ):
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        if variant_id:
            if str(variant_id) != str(revision_request.revision.variant_id):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"ID mismatch between path params and body params: {variant_id} != {revision_request.revision.variant_id}",
                )

            if revision_request.revision.variant:
                if (
                    revision_request.revision.variant_id
                    != revision_request.revision.variant.id
                ):
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"ID mismatch between revision and variant: {revision_request.revision.variant_id} != {revision_request.revision.variant.id}",
                    )

        if revision_id:
            if str(revision_id) != str(revision_request.revision.id):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"ID mismatch between path params and body params: {revision_id} != {revision_request.revision.id}",
                )

        if not revision_request.revision.variant:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Missing variant in revision request",
            )

        variant = await self.workflows_service.fork_variant(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            variant_slug=revision_request.revision.variant.slug,
            revision_slug=revision_request.revision.slug,
            #
            variant_id=revision_request.revision.variant_id,
            revision_id=revision_request.revision.id,
            # depth=depth,
            #
            variant_flags=revision_request.revision.variant.flags,
            variant_metadata=revision_request.revision.variant.metadata,
            variant_name=revision_request.revision.variant.name,
            variant_description=revision_request.revision.variant.description,
            #
            revision_flags=revision_request.revision.flags,
            revision_metadata=revision_request.revision.metadata,
            revision_name=revision_request.revision.name,
            revision_description=revision_request.revision.description,
            revision_message=revision_request.revision.message,
        )

        variant_response = WorkflowVariantResponse(
            count=1 if variant is not None else 0,
            variant=variant,
        )

        return variant_response

    # ——————————————————————————————————————————————————————————————————————————

    # — revisions ——————————————————————————————————————————————————————————————

    @handle_exceptions()
    async def create_workflow_revision(
        self,
        request: Request,
        *,
        revision_request: WorkflowRevisionRequest,
    ):
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        revision = await self.workflows_service.create_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            artifact_id=revision_request.revision.artifact_id,
            variant_id=revision_request.revision.variant_id,
            #
            revision_slug=revision_request.revision.slug,
            #
            revision_flags=revision_request.revision.flags,
            revision_metadata=revision_request.revision.metadata,
            revision_name=revision_request.revision.name,
            revision_description=revision_request.revision.description,
        )

        revision_response = WorkflowRevisionResponse(
            count=1 if revision is not None else 0,
            revision=revision,
        )

        return revision_response

    @handle_exceptions()
    async def fetch_workflow_revision(
        self,
        request: Request,
        *,
        variant_ref: Optional[Reference] = None,
        revision_ref: Optional[Reference] = None,
    ):
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        revision = await self.workflows_service.fetch_revision(
            project_id=UUID(request.state.project_id),
            #
            variant_ref=variant_ref,
            revision_ref=revision_ref,
        )

        revision_response = WorkflowRevisionResponse(
            count=1 if revision is not None else 0,
            revision=revision,
        )

        return revision_response

    @handle_exceptions()
    async def edit_workflow_revision(
        self,
        request: Request,
        *,
        revision_id: UUID,
        revision_request: WorkflowRevisionRequest,
    ):
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        if str(revision_id) != str(revision_request.revision.id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"ID mismatch between path params and body params: {revision_id} != {revision_request.revision.id}",
            )

        revision = await self.workflows_service.edit_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            revision_id=revision_request.revision.id,
            #
            revision_flags=revision_request.revision.flags,
            revision_metadata=revision_request.revision.metadata,
            revision_name=revision_request.revision.name,
            revision_description=revision_request.revision.description,
        )

        revision_response = WorkflowRevisionResponse(
            count=1 if revision is not None else 0,
            revision=revision,
        )

        return revision_response

    @handle_exceptions()
    async def archive_workflow_revision(
        self,
        request: Request,
        *,
        revision_id: UUID,
    ):
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        revision = await self.workflows_service.archive_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            revision_id=revision_id,
        )

        revision_response = WorkflowRevisionResponse(
            count=1 if revision is not None else 0,
            revision=revision,
        )

        return revision_response

    @handle_exceptions()
    async def unarchive_workflow_revision(
        self,
        request: Request,
        *,
        revision_id: UUID,
    ):
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        revision = await self.workflows_service.unarchive_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            revision_id=revision_id,
        )

        revision_response = WorkflowRevisionResponse(
            count=1 if revision is not None else 0,
            revision=revision,
        )

        return revision_response

    @handle_exceptions()
    async def query_workflow_revisions(
        self,
        request: Request,
        query: Optional[WorkflowQuery] = Depends(parse_revision_query_request),
    ):
        body_json = None
        query_from_body = None

        try:
            body_json = await request.json()

            if body_json:
                query_from_body = parse_revision_body_request(**body_json)

        except:  # pylint: disable=bare-except
            pass

        _query = merge_requests(query, query_from_body)

        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        revisions = []

        if _query.variant_ref or _query.revision_ref:
            revision = await self.workflows_service.fetch_revision(
                project_id=UUID(request.state.project_id),
                #
                variant_ref=_query.variant_ref,
                revision_ref=_query.revision_ref,
            )

            revisions = [revision]

        else:
            revisions = await self.workflows_service.query_revisions(
                project_id=UUID(request.state.project_id),
                #
                revision_flags=_query.flags,
                revision_metadata=_query.metadata,
                #
                include_archived=_query.include_archived,
            )

        revisions_response = WorkflowRevisionsResponse(
            count=len(revisions),
            revisions=revisions,
        )

        return revisions_response

    # --------------------------------------------------------------------------

    @handle_exceptions()
    async def commit_workflow_revision(
        self,
        request: Request,
        *,
        revision_request: WorkflowRevisionRequest,
        variant_id: Optional[UUID] = None,
    ):
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        if variant_id:
            if str(variant_id) != str(revision_request.revision.variant_id):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"ID mismatch between path params and body params: {variant_id} != {revision_request.revision.variant_id}",
                )

        revision = await self.workflows_service.commit_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            variant_id=revision_request.revision.variant_id,
            #
            revision_flags=revision_request.revision.flags,
            revision_metadata=revision_request.revision.metadata,
            revision_name=revision_request.revision.name,
            revision_description=revision_request.revision.description,
            revision_message=revision_request.revision.message,
            revision_data=revision_request.revision.data,
        )

        revision_response = WorkflowRevisionResponse(
            count=1 if revision is not None else 0,
            revision=revision,
        )

        return revision_response

    @handle_exceptions()
    async def log_workflow_revisions(
        self,
        request: Request,
        *,
        variant_ref: Optional[Reference] = None,
        revision_ref: Optional[Reference] = None,
        depth: Optional[int] = None,
    ):
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_WORKFLOWS,
            ):
                raise FORBIDDEN_EXCEPTION

        revisions = await self.workflows_service.log_revisions(
            project_id=UUID(request.state.project_id),
            #
            variant_ref=variant_ref,
            revision_ref=revision_ref,
            depth=depth,
        )

        revisions_response = WorkflowRevisionsResponse(
            count=len(revisions),
            revisions=revisions,
        )

        return revisions_response

    # ——————————————————————————————————————————————————————————————————————————
