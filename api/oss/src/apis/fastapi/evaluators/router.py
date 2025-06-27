from typing import Union, Optional, List
from uuid import uuid4, UUID

from fastapi import APIRouter, Request, status, HTTPException

from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions, suppress_exceptions
from oss.src.utils.caching import get_cache, set_cache, invalidate_cache

from oss.src.core.shared.dtos import Reference
from oss.src.core.workflows.dtos import WorkflowFlags
from oss.src.core.workflows.service import WorkflowsService

from oss.src.core.workflows.dtos import (
    WorkflowArtifact,
    WorkflowVariant,
    WorkflowRevision,
    WorkflowFlags,
)

from oss.src.apis.fastapi.evaluators.models import (
    EvaluatorQueryRequest,
    EvaluatorRequest,
    EvaluatorResponse,
    EvaluatorsResponse,
    Evaluator,
    EvaluatorFlags,
)

if is_ee():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access, FORBIDDEN_EXCEPTION


log = get_module_logger(__name__)


class EvaluatorsRouter:
    VERSION = "1.0.0"

    def __init__(
        self,
        *,
        workflows_service: WorkflowsService,
    ):
        self.workflows_service = workflows_service

        self.router = APIRouter()

        ### CRUD

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

        ### RPC

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
            "/",
            self.query_evaluators,
            methods=["GET"],
            operation_id="list_evaluators",
            status_code=status.HTTP_200_OK,
            response_model=EvaluatorsResponse,
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

    @intercept_exceptions()
    async def create_evaluator(
        self,
        *,
        request: Request,
        evaluator_request: EvaluatorRequest,
    ) -> EvaluatorResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATORS,
            ):
                raise FORBIDDEN_EXCEPTION

        # TODO: VALIDATE DATA

        evaluator_flags = EvaluatorFlags(
            **(
                evaluator_request.evaluator.flags.model_dump()
                if evaluator_request.evaluator.flags
                else {}
            )
        )

        workflow_flags = WorkflowFlags(**evaluator_flags.model_dump())

        workflow_artifact: Optional[
            WorkflowArtifact
        ] = await self.workflows_service.create_artifact(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            artifact_slug=evaluator_request.evaluator.slug,
            #
            artifact_flags=workflow_flags,
            artifact_meta=evaluator_request.evaluator.meta,
            artifact_name=evaluator_request.evaluator.name,
            artifact_description=evaluator_request.evaluator.description,
        )

        if workflow_artifact is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create evaluator. Please try again or contact support.",
            )

        workflow_variant_slug = uuid4().hex

        workflow_variant: Optional[
            WorkflowVariant
        ] = await self.workflows_service.create_variant(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            artifact_id=workflow_artifact.id,
            #
            variant_slug=workflow_variant_slug,
            #
            variant_flags=workflow_flags,
            variant_meta=evaluator_request.evaluator.meta,
        )

        if workflow_variant is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create evaluator. Please try again or contact support.",
            )

        workflow_revision_slug = uuid4().hex

        workflow_revision: Optional[
            WorkflowRevision
        ] = await self.workflows_service.create_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            artifact_id=workflow_artifact.id,
            variant_id=workflow_variant.id,
            #
            revision_slug=workflow_revision_slug,
            #
            revision_flags=workflow_flags,
            revision_meta=evaluator_request.evaluator.meta,
        )

        if workflow_revision is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create evaluator. Please try again or contact support.",
            )

        workflow_revision_slug = uuid4().hex

        workflow_revision: Optional[
            WorkflowRevision
        ] = await self.workflows_service.commit_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            variant_id=workflow_variant.id,
            #
            revision_slug=workflow_revision_slug,
            #
            revision_flags=workflow_flags,
            revision_meta=evaluator_request.evaluator.meta,
            revision_data=evaluator_request.evaluator.data,
        )

        if workflow_revision is None:
            # do something
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create evaluator. Please try again or contact support.",
            )

        evaluator = Evaluator(
            id=workflow_artifact.id,
            slug=workflow_artifact.slug,
            #
            created_at=workflow_artifact.created_at,
            updated_at=workflow_artifact.updated_at,
            deleted_at=workflow_artifact.deleted_at,
            created_by_id=workflow_artifact.created_by_id,
            updated_by_id=workflow_artifact.updated_by_id,
            deleted_by_id=workflow_artifact.deleted_by_id,
            #
            flags=evaluator_flags,
            meta=workflow_artifact.meta,
            name=workflow_artifact.name,
            description=workflow_artifact.description,
            data=workflow_revision.data,
        )

        evaluator_response = EvaluatorResponse(
            count=1,
            evaluator=evaluator,
        )

        return evaluator_response

    @intercept_exceptions()
    @suppress_exceptions(default=EvaluatorResponse())
    async def fetch_evaluator(
        self,
        *,
        request: Request,
        evaluator_id: Union[UUID, str],
    ) -> EvaluatorResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_EVALUATORS,
            ):
                raise FORBIDDEN_EXCEPTION

        workflow_artifact_ref = Reference(
            id=evaluator_id,
        )

        workflow_artifact: Optional[
            WorkflowArtifact
        ] = await self.workflows_service.fetch_artifact(
            project_id=UUID(request.state.project_id),
            #
            artifact_ref=workflow_artifact_ref,
        )

        if workflow_artifact is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Basic evaluator not found. Please check the ID and try again.",
            )

        workflow_variant: Optional[
            WorkflowVariant
        ] = await self.workflows_service.fetch_variant(
            project_id=UUID(request.state.project_id),
            #
            artifact_ref=workflow_artifact_ref,
        )

        if workflow_variant is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Basic evaluator not found. Please check the ID and try again.",
            )

        workflow_variant_ref = Reference(
            id=workflow_variant.id,
        )

        workflow_revision: Optional[
            WorkflowRevision
        ] = await self.workflows_service.fetch_revision(
            project_id=UUID(request.state.project_id),
            #
            variant_ref=workflow_variant_ref,
        )

        if workflow_revision is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Basic evaluator not found. Please check the ID and try again.",
            )

        evaluator_flags = EvaluatorFlags(
            **(workflow_artifact.flags.model_dump() if workflow_artifact.flags else {})
        )

        evaluator = Evaluator(
            id=workflow_artifact.id,
            slug=workflow_artifact.slug,
            #
            created_at=workflow_artifact.created_at,
            updated_at=workflow_artifact.updated_at,
            deleted_at=workflow_artifact.deleted_at,
            created_by_id=workflow_artifact.created_by_id,
            updated_by_id=workflow_artifact.updated_by_id,
            deleted_by_id=workflow_artifact.deleted_by_id,
            #
            flags=evaluator_flags,
            meta=workflow_artifact.meta,
            name=workflow_artifact.name,
            description=workflow_artifact.description,
            data=workflow_revision.data,
        )

        evaluator_response = EvaluatorResponse(
            count=1,
            evaluator=evaluator,
        )

        return evaluator_response

    @intercept_exceptions()
    async def edit_evaluator(
        self,
        *,
        request: Request,
        evaluator_id: Union[UUID, str],
        evaluator_request: EvaluatorRequest,
    ) -> EvaluatorResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATORS,
            ):
                raise FORBIDDEN_EXCEPTION

        # TODO: VALIDATE DATA

        evaluator_flags = EvaluatorFlags(
            **(
                evaluator_request.evaluator.flags.model_dump()
                if evaluator_request.evaluator.flags
                else {}
            )
        )

        workflow_flags = WorkflowFlags(**evaluator_flags.model_dump())

        if str(evaluator_id) != str(evaluator_request.evaluator.id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"ID mismatch between path params and body params: {evaluator_id} != {evaluator_request.evaluator.id}",
            )

        workflow_artifact_ref = Reference(
            id=evaluator_request.evaluator.id,
        )

        workflow_artifact: Optional[
            WorkflowArtifact
        ] = await self.workflows_service.fetch_artifact(
            project_id=UUID(request.state.project_id),
            #
            artifact_ref=workflow_artifact_ref,
        )

        if workflow_artifact is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Basic evaluator not found. Please check the ID and try again.",
            )

        workflow_artifact: Optional[
            WorkflowArtifact
        ] = await self.workflows_service.edit_artifact(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            artifact_id=evaluator_request.evaluator.id,
            #
            artifact_flags=workflow_flags,
            artifact_meta=evaluator_request.evaluator.meta,
            artifact_name=evaluator_request.evaluator.name,
            artifact_description=evaluator_request.evaluator.description,
        )

        if workflow_artifact is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to edit evaluator. Please try again or contact support.",
            )

        workflow_variant: Optional[
            WorkflowVariant
        ] = await self.workflows_service.fetch_variant(
            project_id=UUID(request.state.project_id),
            #
            artifact_ref=workflow_artifact_ref,
        )

        if workflow_variant is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Basic evaluator not found. Please check the ID and try again.",
            )

        workflow_variant: Optional[
            WorkflowVariant
        ] = await self.workflows_service.edit_variant(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            variant_id=workflow_variant.id,
            #
            variant_flags=workflow_flags,
            variant_meta=evaluator_request.evaluator.meta,
        )

        if workflow_variant is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to edit evaluator. Please try again or contact support.",
            )

        workflow_variant_ref = Reference(
            id=workflow_variant.id,
        )

        workflow_revision: Optional[
            WorkflowRevision
        ] = await self.workflows_service.fetch_revision(
            project_id=UUID(request.state.project_id),
            #
            variant_ref=workflow_variant_ref,
        )

        if workflow_revision is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Basic evaluator not found. Please check the ID and try again.",
            )

        workflow_revision_slug = uuid4().hex

        workflow_revision: Optional[
            WorkflowRevision
        ] = await self.workflows_service.commit_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            variant_id=workflow_variant.id,
            #
            revision_slug=workflow_revision_slug,
            #
            revision_flags=workflow_flags,
            revision_meta=evaluator_request.evaluator.meta,
            revision_data=evaluator_request.evaluator.data,
        )

        if workflow_revision is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to edit evaluator. Please try again or contact support.",
            )

        evaluator = Evaluator(
            id=workflow_artifact.id,
            slug=workflow_artifact.slug,
            #
            created_at=workflow_artifact.created_at,
            updated_at=workflow_artifact.updated_at,
            deleted_at=workflow_artifact.deleted_at,
            created_by_id=workflow_artifact.created_by_id,
            updated_by_id=workflow_artifact.updated_by_id,
            deleted_by_id=workflow_artifact.deleted_by_id,
            #
            flags=evaluator_flags,
            meta=workflow_artifact.meta,
            name=workflow_artifact.name,
            description=workflow_artifact.description,
            data=workflow_revision.data,
        )

        evaluator_response = EvaluatorResponse(
            count=1,
            evaluator=evaluator,
        )

        return evaluator_response

    @intercept_exceptions()
    async def archive_evaluator(
        self,
        *,
        request: Request,
        evaluator_id: Union[UUID, str],
    ) -> EvaluatorResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATORS,
            ):
                raise FORBIDDEN_EXCEPTION

        workflow_artifact_ref = Reference(
            id=evaluator_id,
        )

        workflow_artifact: Optional[
            WorkflowArtifact
        ] = await self.workflows_service.fetch_artifact(
            project_id=UUID(request.state.project_id),
            #
            artifact_ref=workflow_artifact_ref,
        )

        if workflow_artifact is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Basic evaluator not found. Please check the ID and try again.",
            )

        workflow_artifact: Optional[
            WorkflowArtifact
        ] = await self.workflows_service.archive_artifact(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            artifact_id=evaluator_id,
        )

        if workflow_artifact is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to archive evaluator. Please try again or contact support.",
            )

        evaluator = Evaluator(
            id=workflow_artifact.id,
            slug=workflow_artifact.slug,
            #
            created_at=workflow_artifact.created_at,
            updated_at=workflow_artifact.updated_at,
            deleted_at=workflow_artifact.deleted_at,
            created_by_id=workflow_artifact.created_by_id,
            updated_by_id=workflow_artifact.updated_by_id,
            deleted_by_id=workflow_artifact.deleted_by_id,
            #
            meta=workflow_artifact.meta,
            name=workflow_artifact.name,
            description=workflow_artifact.description,
        )

        evaluator_response = EvaluatorResponse(
            count=1,
            evaluator=evaluator,
        )

        return evaluator_response

    @intercept_exceptions()
    async def unarchive_evaluator(
        self,
        *,
        request: Request,
        evaluator_id: Union[UUID, str],
    ) -> EvaluatorResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_EVALUATORS,
            ):
                raise FORBIDDEN_EXCEPTION

        workflow_artifact_ref = Reference(
            id=evaluator_id,
        )

        workflow_artifact: Optional[
            WorkflowArtifact
        ] = await self.workflows_service.fetch_artifact(
            project_id=UUID(request.state.project_id),
            #
            artifact_ref=workflow_artifact_ref,
        )

        if workflow_artifact is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Basic evaluator not found. Please check the ID and try again.",
            )

        workflow_artifact: Optional[
            WorkflowArtifact
        ] = await self.workflows_service.unarchive_artifact(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            artifact_id=evaluator_id,
        )

        if workflow_artifact is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to unarchive evaluator. Please try again or contact support.",
            )

        evaluator = Evaluator(
            id=workflow_artifact.id,
            slug=workflow_artifact.slug,
            #
            created_at=workflow_artifact.created_at,
            updated_at=workflow_artifact.updated_at,
            deleted_at=workflow_artifact.deleted_at,
            created_by_id=workflow_artifact.created_by_id,
            updated_by_id=workflow_artifact.updated_by_id,
            deleted_by_id=workflow_artifact.deleted_by_id,
            #
            meta=workflow_artifact.meta,
            name=workflow_artifact.name,
            description=workflow_artifact.description,
        )

        evaluator_response = EvaluatorResponse(
            count=1,
            evaluator=evaluator,
        )

        return evaluator_response

    @intercept_exceptions()
    @suppress_exceptions(default=EvaluatorsResponse())
    async def query_evaluators(
        self,
        *,
        request: Request,
        evaluator_query_request: Optional[EvaluatorQueryRequest] = None,
    ) -> EvaluatorsResponse:
        if is_ee():
            if not await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_EVALUATORS,
            ):
                raise FORBIDDEN_EXCEPTION

        evaluators: List[Evaluator] = []

        evaluator_flags = (
            evaluator_query_request.evaluator.flags if evaluator_query_request else None
        )

        flags = WorkflowFlags(
            is_evaluator=True,
            is_custom=evaluator_flags.is_custom if evaluator_flags else None,
            is_human=evaluator_flags.is_human if evaluator_flags else None,
        )

        meta = (
            evaluator_query_request.evaluator.meta if evaluator_query_request else None
        )

        log.debug(
            flags=flags,
            meta=meta,
        )

        workflow_artifacts: List[
            WorkflowArtifact
        ] = await self.workflows_service.query_artifacts(
            project_id=UUID(request.state.project_id),
            #
            artifact_flags=flags,
            artifact_meta=meta,
        )

        if workflow_artifacts is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to query evaluators. Please try again or contact support.",
            )

        for workflow_artifact in workflow_artifacts:
            workflow_artifact_ref = Reference(
                id=workflow_artifact.id,
            )

            workflow_variant: Optional[
                WorkflowVariant
            ] = await self.workflows_service.fetch_variant(
                project_id=UUID(request.state.project_id),
                #
                artifact_ref=workflow_artifact_ref,
            )

            if workflow_variant is None:
                continue

            workflow_variant_ref = Reference(
                id=workflow_variant.id,
            )

            workflow_revision: Optional[
                WorkflowRevision
            ] = await self.workflows_service.fetch_revision(
                project_id=UUID(request.state.project_id),
                #
                variant_ref=workflow_variant_ref,
            )

            if workflow_revision is None:
                continue

            evaluator_flags = EvaluatorFlags(
                **(
                    workflow_artifact.flags.model_dump()
                    if workflow_artifact.flags
                    else {}
                )
            )

            evaluators.append(
                Evaluator(
                    id=workflow_artifact.id,
                    slug=workflow_artifact.slug,
                    #
                    created_at=workflow_artifact.created_at,
                    updated_at=workflow_artifact.updated_at,
                    deleted_at=workflow_artifact.deleted_at,
                    created_by_id=workflow_artifact.created_by_id,
                    updated_by_id=workflow_artifact.updated_by_id,
                    deleted_by_id=workflow_artifact.deleted_by_id,
                    #
                    flags=evaluator_flags,
                    meta=workflow_artifact.meta,
                    name=workflow_artifact.name,
                    description=workflow_artifact.description,
                    data=workflow_revision.data,
                )
            )

        evaluators_response = EvaluatorsResponse(
            count=len(evaluators),
            evaluator=evaluators,
        )

        return evaluators_response
