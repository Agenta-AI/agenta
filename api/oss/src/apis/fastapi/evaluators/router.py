from typing import Optional, List
from uuid import uuid4, UUID

from fastapi import APIRouter, Request, status, HTTPException

from oss.src.utils.helpers import get_slug_from_name_and_id

from oss.src.services.db_manager import fetch_evaluator_config
from oss.src.models.db_models import EvaluatorConfigDB

from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions, suppress_exceptions
from oss.src.utils.caching import get_cache, set_cache, invalidate_cache

from oss.src.core.shared.dtos import Reference
from oss.src.core.workflows.dtos import WorkflowFlags
from oss.src.core.workflows.service import WorkflowsService

from oss.src.core.workflows.dtos import (
    Workflow,
    WorkflowCreate,
    WorkflowEdit,
    WorkflowQuery,
    #
    WorkflowVariant,
    WorkflowVariantCreate,
    WorkflowVariantEdit,
    WorkflowVariantQuery,
    #
    WorkflowRevision,
    WorkflowRevisionCreate,
    WorkflowRevisionQuery,
    WorkflowRevisionCommit,
    #
    WorkflowFlags,
    WorkflowRevisionData,
)

from oss.src.apis.fastapi.evaluators.models import (
    SimpleEvaluator,
    SimpleEvaluatorCreate,
    SimpleEvaluatorEdit,
    SimpleEvaluatorQuery,
    #
    SimpleEvaluatorCreateRequest,
    SimpleEvaluatorEditRequest,
    SimpleEvaluatorQueryRequest,
    #
    SimpleEvaluatorResponse,
    SimpleEvaluatorsResponse,
    #
    SimpleEvaluatorFlags,
)

if is_ee():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access, FORBIDDEN_EXCEPTION


log = get_module_logger(__name__)


class SimpleEvaluatorsRouter:
    VERSION = "1.0.0"

    def __init__(
        self,
        *,
        workflows_service: WorkflowsService,
    ):
        self.workflows_service = workflows_service

        self.router = APIRouter()

        self.router.add_api_route(
            "/",
            self.create_simple_evaluator,
            methods=["POST"],
            operation_id="create_simple_evaluator",
            status_code=status.HTTP_200_OK,
            response_model=SimpleEvaluatorResponse,
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
            "/",
            self.list_simple_evaluators,
            methods=["GET"],
            operation_id="list_simple_evaluators",
            status_code=status.HTTP_200_OK,
            response_model=SimpleEvaluatorsResponse,
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

        self.router.add_api_route(
            "/{evaluator_id}/transfer",
            self.transfer_simple_evaluator,
            methods=["POST"],
            operation_id="transfer_simple_evaluator",
            status_code=status.HTTP_200_OK,
            response_model=SimpleEvaluatorResponse,
            response_model_exclude_none=True,
        )

    @intercept_exceptions()
    async def create_simple_evaluator(
        self,
        *,
        request: Request,
        simple_evaluator_create_request: SimpleEvaluatorCreateRequest,
        evaluator_id: Optional[UUID] = None,
    ) -> SimpleEvaluatorResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATORS,
            ):
                raise FORBIDDEN_EXCEPTION

        simple_evaluator_flags = (
            SimpleEvaluatorFlags(
                **(
                    simple_evaluator_create_request.evaluator.flags.model_dump(
                        mode="json"
                    )
                )
            )
            if simple_evaluator_create_request.evaluator.flags
            else SimpleEvaluatorFlags(
                is_custom=False,
                is_human=False,
                is_evaluator=True,
            )
        )

        workflow_flags = WorkflowFlags(
            **simple_evaluator_flags.model_dump(mode="json"),
        )

        _workflow_create = WorkflowCreate(
            slug=simple_evaluator_create_request.evaluator.slug,
            #
            name=simple_evaluator_create_request.evaluator.name,
            description=simple_evaluator_create_request.evaluator.description,
            #
            flags=workflow_flags,
            tags=simple_evaluator_create_request.evaluator.tags,
            meta=simple_evaluator_create_request.evaluator.meta,
        )

        workflow: Optional[Workflow] = await self.workflows_service.create_workflow(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            workflow_create=_workflow_create,
            #
            workflow_id=evaluator_id,
        )

        if workflow is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create simple evaluator. Please try again or contact support.",
            )

        workflow_variant_slug = uuid4().hex

        _workflow_variant_create = WorkflowVariantCreate(
            slug=workflow_variant_slug,
            #
            name=simple_evaluator_create_request.evaluator.name,
            description=simple_evaluator_create_request.evaluator.description,
            #
            flags=workflow_flags,
            tags=simple_evaluator_create_request.evaluator.tags,
            meta=simple_evaluator_create_request.evaluator.meta,
            #
            workflow_id=workflow.id,  # type: ignore
        )

        workflow_variant: Optional[
            WorkflowVariant
        ] = await self.workflows_service.create_workflow_variant(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            workflow_variant_create=_workflow_variant_create,
        )

        if workflow_variant is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create simple evaluator. Please try again or contact support.",
            )

        workflow_revision_slug = uuid4().hex

        _workflow_revision_create = WorkflowRevisionCreate(
            slug=workflow_revision_slug,
            #
            name=simple_evaluator_create_request.evaluator.name,
            description=simple_evaluator_create_request.evaluator.description,
            #
            flags=workflow_flags,
            tags=simple_evaluator_create_request.evaluator.tags,
            meta=simple_evaluator_create_request.evaluator.meta,
            #
            workflow_id=workflow.id,
            workflow_variant_id=workflow_variant.id,
        )

        workflow_revision: Optional[
            WorkflowRevision
        ] = await self.workflows_service.create_workflow_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            workflow_revision_create=_workflow_revision_create,
        )

        if workflow_revision is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create simple evaluator. Please try again or contact support.",
            )

        workflow_revision_slug = uuid4().hex

        _workflow_revision_commit = WorkflowRevisionCommit(
            slug=workflow_revision_slug,
            #
            name=simple_evaluator_create_request.evaluator.name,
            description=simple_evaluator_create_request.evaluator.description,
            #
            flags=workflow_flags,
            tags=simple_evaluator_create_request.evaluator.tags,
            meta=simple_evaluator_create_request.evaluator.meta,
            #
            # message=
            #
            data=simple_evaluator_create_request.evaluator.data,
            #
            workflow_id=workflow.id,
            workflow_variant_id=workflow_variant.id,
        )

        workflow_revision: Optional[
            WorkflowRevision
        ] = await self.workflows_service.commit_workflow_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            workflow_revision_commit=_workflow_revision_commit,
        )

        if workflow_revision is None:
            # do something
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create simple evaluator. Please try again or contact support.",
            )

        simple_evaluator = SimpleEvaluator(
            id=workflow.id,
            slug=workflow.slug,
            #
            created_at=workflow.created_at,
            updated_at=workflow.updated_at,
            deleted_at=workflow.deleted_at,
            created_by_id=workflow.created_by_id,
            updated_by_id=workflow.updated_by_id,
            deleted_by_id=workflow.deleted_by_id,
            #
            name=workflow.name,
            description=workflow.description,
            #
            flags=simple_evaluator_flags,
            tags=workflow.tags,
            meta=workflow.meta,
            #
            data=workflow_revision.data,
        )

        simple_evaluator_response = SimpleEvaluatorResponse(
            count=1,
            evaluator=simple_evaluator,
        )

        return simple_evaluator_response

    @intercept_exceptions()
    @suppress_exceptions(default=SimpleEvaluatorResponse())
    async def fetch_simple_evaluator(
        self,
        *,
        request: Request,
        evaluator_id: UUID,
    ) -> SimpleEvaluatorResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_EVALUATORS,
            ):
                raise FORBIDDEN_EXCEPTION

        workflow_ref = Reference(
            id=evaluator_id,
        )

        workflow: Optional[Workflow] = await self.workflows_service.fetch_workflow(
            project_id=UUID(request.state.project_id),
            #
            workflow_ref=workflow_ref,
        )

        if workflow is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Simple evaluator not found. Please check the ID and try again.",
            )

        workflow_variant: Optional[
            WorkflowVariant
        ] = await self.workflows_service.fetch_workflow_variant(
            project_id=UUID(request.state.project_id),
            #
            workflow_ref=workflow_ref,
        )

        if workflow_variant is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Simple evaluator variant not found. Please check the ID and try again.",
            )

        workflow_variant_ref = Reference(
            id=workflow_variant.id,
        )

        workflow_revision: Optional[
            WorkflowRevision
        ] = await self.workflows_service.fetch_workflow_revision(
            project_id=UUID(request.state.project_id),
            #
            workflow_variant_ref=workflow_variant_ref,
        )

        if workflow_revision is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Simple evaluator revision not found. Please check the ID and try again.",
            )

        simple_evaluator_flags = SimpleEvaluatorFlags(
            **(
                workflow.flags.model_dump(mode="json")
                if workflow.flags
                else SimpleEvaluatorFlags()
            )
        )

        simple_evaluator = SimpleEvaluator(
            id=workflow.id,
            slug=workflow.slug,
            #
            created_at=workflow.created_at,
            updated_at=workflow.updated_at,
            deleted_at=workflow.deleted_at,
            created_by_id=workflow.created_by_id,
            updated_by_id=workflow.updated_by_id,
            deleted_by_id=workflow.deleted_by_id,
            #
            name=workflow.name,
            description=workflow.description,
            #
            flags=simple_evaluator_flags,
            tags=workflow.tags,
            meta=workflow.meta,
            #
            data=workflow_revision.data,
        )

        simple_evaluator_response = SimpleEvaluatorResponse(
            count=1,
            evaluator=simple_evaluator,
        )

        return simple_evaluator_response

    @intercept_exceptions()
    async def edit_simple_evaluator(
        self,
        *,
        request: Request,
        evaluator_id: UUID,
        simple_evaluator_edit_request: SimpleEvaluatorEditRequest,
    ) -> SimpleEvaluatorResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATORS,
            ):
                raise FORBIDDEN_EXCEPTION

        simple_evaluator_flags = (
            SimpleEvaluatorFlags(
                **(
                    simple_evaluator_edit_request.evaluator.flags.model_dump(
                        mode="json"
                    )
                )
            )
            if simple_evaluator_edit_request.evaluator.flags
            else SimpleEvaluatorFlags()
        )

        workflow_flags = WorkflowFlags(**simple_evaluator_flags.model_dump())

        if str(evaluator_id) != str(simple_evaluator_edit_request.evaluator.id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"ID mismatch between path params and body params: {evaluator_id} != {simple_evaluator_edit_request.evaluator.id}",
            )

        workflow_ref = Reference(
            id=simple_evaluator_edit_request.evaluator.id,
        )

        workflow: Optional[Workflow] = await self.workflows_service.fetch_workflow(
            project_id=UUID(request.state.project_id),
            #
            workflow_ref=workflow_ref,
        )

        if workflow is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Simple evaluator not found. Please check the ID and try again.",
            )

        _workflow_edit = WorkflowEdit(
            id=workflow.id,
            #
            name=simple_evaluator_edit_request.evaluator.name,
            description=simple_evaluator_edit_request.evaluator.description,
            #
            flags=workflow_flags,
            tags=simple_evaluator_edit_request.evaluator.tags,
            meta=simple_evaluator_edit_request.evaluator.meta,
        )

        workflow: Optional[Workflow] = await self.workflows_service.edit_workflow(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            workflow_edit=_workflow_edit,
        )

        if workflow is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to edit simple evaluator. Please try again or contact support.",
            )

        workflow_variant: Optional[
            WorkflowVariant
        ] = await self.workflows_service.fetch_workflow_variant(
            project_id=UUID(request.state.project_id),
            #
            workflow_ref=workflow_ref,
        )

        if workflow_variant is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Simple evaluator variant not found. Please check the ID and try again.",
            )

        _workflow_variant_edit = WorkflowVariantEdit(
            id=workflow_variant.id,
            #
            name=simple_evaluator_edit_request.evaluator.name,
            description=simple_evaluator_edit_request.evaluator.description,
            #
            flags=workflow_flags,
            tags=simple_evaluator_edit_request.evaluator.tags,
            meta=simple_evaluator_edit_request.evaluator.meta,
        )

        workflow_variant: Optional[
            WorkflowVariant
        ] = await self.workflows_service.edit_workflow_variant(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            workflow_variant_edit=_workflow_variant_edit,
        )

        if workflow_variant is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to edit simple evaluator variant. Please try again or contact support.",
            )

        workflow_variant_ref = Reference(
            id=workflow_variant.id,
        )

        workflow_revision: Optional[
            WorkflowRevision
        ] = await self.workflows_service.fetch_workflow_revision(
            project_id=UUID(request.state.project_id),
            #
            workflow_variant_ref=workflow_variant_ref,
        )

        if workflow_revision is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Simple evaluator revision not found. Please check the ID and try again.",
            )

        workflow_revision_slug = uuid4().hex

        _workflow_revision_commit = WorkflowRevisionCommit(
            slug=workflow_revision_slug,
            #
            name=simple_evaluator_edit_request.evaluator.name,
            description=simple_evaluator_edit_request.evaluator.description,
            #
            flags=workflow_flags,
            tags=simple_evaluator_edit_request.evaluator.tags,
            meta=simple_evaluator_edit_request.evaluator.meta,
            #
            data=simple_evaluator_edit_request.evaluator.data,
            #
            workflow_id=workflow.id,
            workflow_variant_id=workflow_variant.id,
        )

        workflow_revision: Optional[
            WorkflowRevision
        ] = await self.workflows_service.commit_workflow_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            workflow_revision_commit=_workflow_revision_commit,
        )

        if workflow_revision is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to edit simple evaluator revision. Please try again or contact support.",
            )

        simple_evaluator = SimpleEvaluator(
            id=workflow.id,
            slug=workflow.slug,
            #
            created_at=workflow.created_at,
            updated_at=workflow.updated_at,
            deleted_at=workflow.deleted_at,
            created_by_id=workflow.created_by_id,
            updated_by_id=workflow.updated_by_id,
            deleted_by_id=workflow.deleted_by_id,
            #
            name=workflow.name,
            description=workflow.description,
            #
            flags=simple_evaluator_flags,
            tags=workflow.tags,
            meta=workflow.meta,
            #
            data=workflow_revision.data,
        )

        simple_evaluator_response = SimpleEvaluatorResponse(
            count=1,
            evaluator=simple_evaluator,
        )

        return simple_evaluator_response

    @intercept_exceptions()
    async def archive_simple_evaluator(
        self,
        *,
        request: Request,
        evaluator_id: UUID,
    ) -> SimpleEvaluatorResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATORS,
            ):
                raise FORBIDDEN_EXCEPTION

        workflow_ref = Reference(
            id=evaluator_id,
        )

        workflow: Optional[Workflow] = await self.workflows_service.fetch_workflow(
            project_id=UUID(request.state.project_id),
            #
            workflow_ref=workflow_ref,
        )

        if workflow is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Simple evaluator not found. Please check the ID and try again.",
            )

        workflow: Optional[Workflow] = await self.workflows_service.archive_workflow(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            workflow_id=evaluator_id,
        )

        if workflow is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to archive simple evaluator. Please try again or contact support.",
            )

        workflow_variant: Optional[
            WorkflowVariant
        ] = await self.workflows_service.fetch_workflow_variant(
            project_id=UUID(request.state.project_id),
            #
            workflow_ref=workflow_ref,
        )

        if workflow_variant is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to fetch simple evaluator variant. Please try again or contact support.",
            )

        workflow_variant: Optional[
            WorkflowVariant
        ] = await self.workflows_service.archive_workflow_variant(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            workflow_variant_id=workflow_variant.id,
        )

        if workflow_variant is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to archive simple evaluator. Please try again or contact support.",
            )

        simple_evaluator_flags = (
            SimpleEvaluatorFlags(
                **workflow.flags.model_dump(mode="json"),
            )
            if workflow.flags
            else SimpleEvaluatorFlags()
        )

        simple_evaluator = SimpleEvaluator(
            id=workflow.id,
            slug=workflow.slug,
            #
            created_at=workflow.created_at,
            updated_at=workflow.updated_at,
            deleted_at=workflow.deleted_at,
            created_by_id=workflow.created_by_id,
            updated_by_id=workflow.updated_by_id,
            deleted_by_id=workflow.deleted_by_id,
            #
            name=workflow.name,
            description=workflow.description,
            #
            flags=simple_evaluator_flags,
            tags=workflow.tags,
            meta=workflow.meta,
        )

        simple_evaluator_response = SimpleEvaluatorResponse(
            count=1,
            evaluator=simple_evaluator,
        )

        return simple_evaluator_response

    @intercept_exceptions()
    async def unarchive_simple_evaluator(
        self,
        *,
        request: Request,
        evaluator_id: UUID,
    ) -> SimpleEvaluatorResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATORS,
            ):
                raise FORBIDDEN_EXCEPTION

        workflow_ref = Reference(
            id=evaluator_id,
        )

        workflow: Optional[Workflow] = await self.workflows_service.fetch_workflow(
            project_id=UUID(request.state.project_id),
            #
            workflow_ref=workflow_ref,
        )

        if workflow is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Simple evaluator not found. Please check the ID and try again.",
            )

        workflow: Optional[Workflow] = await self.workflows_service.unarchive_workflow(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            workflow_id=evaluator_id,
        )

        if workflow is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to unarchive simple evaluator. Please try again or contact support.",
            )

        workflow_variant: Optional[
            WorkflowVariant
        ] = await self.workflows_service.fetch_workflow_variant(
            project_id=UUID(request.state.project_id),
            #
            workflow_ref=workflow_ref,
        )

        if workflow_variant is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to fetch simple evaluator. Please try again or contact support.",
            )

        workflow_variant: Optional[
            WorkflowVariant
        ] = await self.workflows_service.unarchive_workflow_variant(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            workflow_variant_id=workflow_variant.id,
        )

        if workflow_variant is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to unarchive simple evaluator. Please try again or contact support.",
            )

        simple_evaluator_flags = (
            SimpleEvaluatorFlags(
                **workflow.flags.model_dump(mode="json"),
            )
            if workflow.flags
            else SimpleEvaluatorFlags()
        )

        simple_evaluator = SimpleEvaluator(
            id=workflow.id,
            slug=workflow.slug,
            #
            created_at=workflow.created_at,
            updated_at=workflow.updated_at,
            deleted_at=workflow.deleted_at,
            created_by_id=workflow.created_by_id,
            updated_by_id=workflow.updated_by_id,
            deleted_by_id=workflow.deleted_by_id,
            #
            name=workflow.name,
            description=workflow.description,
            #
            flags=simple_evaluator_flags,
            tags=workflow.tags,
            meta=workflow.meta,
        )

        simple_evaluator_response = SimpleEvaluatorResponse(
            count=1,
            evaluator=simple_evaluator,
        )

        return simple_evaluator_response

    @intercept_exceptions()
    @suppress_exceptions(default=SimpleEvaluatorsResponse())
    async def list_simple_evaluators(
        self,
        *,
        request: Request,
    ) -> SimpleEvaluatorsResponse:
        simple_evaluator_query_request = SimpleEvaluatorQueryRequest(
            evaluator=SimpleEvaluatorQuery(
                flags=SimpleEvaluatorFlags(
                    is_evaluator=True,
                )
            )
        )

        return await self.query_simple_evaluators(
            request=request,
            simple_evaluator_query_request=simple_evaluator_query_request,
        )

    @intercept_exceptions()
    @suppress_exceptions(default=SimpleEvaluatorsResponse())
    async def query_simple_evaluators(
        self,
        *,
        request: Request,
        simple_evaluator_query_request: SimpleEvaluatorQueryRequest,
    ) -> SimpleEvaluatorsResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_EVALUATORS,
            ):
                raise FORBIDDEN_EXCEPTION

        simple_evaluator_flags = (
            simple_evaluator_query_request.evaluator.flags
            if simple_evaluator_query_request.evaluator
            else None
        )

        flags = WorkflowFlags(
            is_evaluator=True,
            is_custom=(
                simple_evaluator_flags.is_custom if simple_evaluator_flags else None
            ),
            is_human=(
                simple_evaluator_flags.is_human if simple_evaluator_flags else None
            ),
        )

        _workflow_query = WorkflowQuery(
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

        workflows: List[Workflow] = await self.workflows_service.query_workflows(
            project_id=UUID(request.state.project_id),
            #
            workflow_query=_workflow_query,
            #
            workflow_refs=simple_evaluator_query_request.evaluator_refs,
            #
            include_archived=simple_evaluator_query_request.include_archived,
            #
            windowing=simple_evaluator_query_request.windowing,
        )

        if workflows is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to query simple evaluators. Please try again or contact support.",
            )

        simple_evaluators: List[SimpleEvaluator] = []

        for workflow in workflows:
            workflow_ref = Reference(
                id=workflow.id,
            )

            workflow_variant: Optional[
                WorkflowVariant
            ] = await self.workflows_service.fetch_workflow_variant(
                project_id=UUID(request.state.project_id),
                #
                workflow_ref=workflow_ref,
            )

            if workflow_variant is None:
                continue

            workflow_variant_ref = Reference(
                id=workflow_variant.id,
            )

            workflow_revision: Optional[
                WorkflowRevision
            ] = await self.workflows_service.fetch_workflow_revision(
                project_id=UUID(request.state.project_id),
                #
                workflow_variant_ref=workflow_variant_ref,
            )

            if workflow_revision is None:
                continue

            simple_evaluator_flags = (
                SimpleEvaluatorFlags(
                    **workflow.flags.model_dump(mode="json"),
                )
                if workflow.flags
                else SimpleEvaluatorFlags()
            )

            simple_evaluator = SimpleEvaluator(
                id=workflow.id,
                slug=workflow.slug,
                #
                created_at=workflow.created_at,
                updated_at=workflow.updated_at,
                deleted_at=workflow.deleted_at,
                created_by_id=workflow.created_by_id,
                updated_by_id=workflow.updated_by_id,
                deleted_by_id=workflow.deleted_by_id,
                #
                name=workflow.name,
                description=workflow.description,
                #
                flags=simple_evaluator_flags,
                tags=workflow.tags,
                meta=workflow.meta,
                #
                data=workflow_revision.data,
            )

            simple_evaluators.append(simple_evaluator)

        simple_evaluators_response = SimpleEvaluatorsResponse(
            count=len(simple_evaluators),
            evaluators=simple_evaluators,
        )

        return simple_evaluators_response

    @intercept_exceptions()
    async def transfer_simple_evaluator(
        self,
        *,
        request: Request,
        evaluator_id: UUID,
    ) -> SimpleEvaluatorResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATORS,
            ):
                raise FORBIDDEN_EXCEPTION

        old_evaluator = await fetch_evaluator_config(
            evaluator_config_id=str(evaluator_id),
        )

        if old_evaluator is None:
            return SimpleEvaluatorsResponse()

        workflow_revision_data = self._transfer_workflow_revision_data(
            old_evaluator=old_evaluator,
        )

        new_evaluator = await self.workflows_service.fetch_workflow(
            project_id=UUID(request.state.project_id),
            #
            workflow_ref=Reference(id=evaluator_id),
        )

        if not new_evaluator:
            slug = get_slug_from_name_and_id(
                name=old_evaluator.name,
                id=evaluator_id,
            )

            simple_evaluator_create_request = SimpleEvaluatorCreateRequest(
                evaluator=SimpleEvaluatorCreate(
                    slug=slug,
                    name=old_evaluator.name,
                    description=None,
                    flags=SimpleEvaluatorFlags(
                        is_custom=False,
                        is_human=False,
                        is_evaluator=True,
                    ),
                    tags=None,
                    meta=None,
                    data=workflow_revision_data,
                )
            )

            return await self.create_simple_evaluator(
                request=request,
                evaluator_id=evaluator_id,
                simple_evaluator_create_request=simple_evaluator_create_request,
            )

        else:
            simple_evaluator_edit_request = SimpleEvaluatorEditRequest(
                evaluator=SimpleEvaluatorEdit(
                    id=evaluator_id,
                    name=new_evaluator.name,
                    description=new_evaluator.description,
                    flags=SimpleEvaluatorFlags(**new_evaluator.flags.model_dump()),
                    tags=new_evaluator.tags,
                    meta=new_evaluator.meta,
                    data=workflow_revision_data,
                )
            )

            return await self.edit_simple_evaluator(
                request=request,
                evaluator_id=evaluator_id,
                simple_evaluator_edit_request=simple_evaluator_edit_request,
            )

    def _transfer_workflow_revision_data(
        self,
        *,
        old_evaluator: EvaluatorConfigDB,
    ) -> WorkflowRevisionData:
        version = "2025.07.14"
        uri = f"agenta:built-in:{old_evaluator.evaluator_key}:v0"
        url = (
            old_evaluator.settings_values.get("webhook_url", None)
            if old_evaluator.evaluator_key == "auto_webhook_test"
            else None
        )
        headers = None
        mappings = None
        properties = (
            {"score": {"type": "number"}, "success": {"type": "boolean"}}
            if old_evaluator.evaluator_key
            in (
                "auto_levenshtein_distance",
                "auto_semantic_similarity",
                "auto_similarity_match",
                "auto_json_diff",
                "auto_webhook_test",
                "auto_custom_code_run",
                "auto_ai_critique",
                "rag_faithfulness",
                "rag_context_relevancy",
            )
            else {"success": {"type": "boolean"}}
        )
        schemas = {
            "outputs": {
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "type": "object",
                "properties": properties,
                "required": (
                    list(properties.keys())
                    if old_evaluator.evaluator_key
                    not in (
                        "auto_levenshtein_distance",
                        "auto_semantic_similarity",
                        "auto_similarity_match",
                        "auto_json_diff",
                        "auto_webhook_test",
                        "auto_custom_code_run",
                        "auto_ai_critique",
                        "rag_faithfulness",
                        "rag_context_relevancy",
                    )
                    else []
                ),
                "additionalProperties": False,
            }
        }
        script = (
            old_evaluator.settings_values.get("code", None)
            if old_evaluator.evaluator_key == "auto_custom_code_run"
            else None
        )
        parameters = old_evaluator.settings_values
        service = {
            "agenta": "0.1.0",
            "format": {
                "type": "object",
                "$schema": "http://json-schema.org/schema#",
                "required": ["outputs"],
                "properties": {
                    "outputs": schemas["outputs"],
                },
            },
        }
        configuration = parameters

        return WorkflowRevisionData(
            version=version,
            uri=uri,
            url=url,
            headers=headers,
            mappings=mappings,
            schemas=schemas,
            script=script,
            parameters=parameters,
            # LEGACY
            service=service,
            configuration=configuration,
        )
