from typing import Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Request, status, HTTPException, Depends

from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions, suppress_exceptions
from oss.src.utils.caching import invalidate_cache

from oss.src.core.shared.dtos import (
    Reference,
)
from oss.src.core.git.types import VariantForkError
from oss.src.core.workflows.service import (
    WorkflowsService,
    SimpleWorkflowsService,
)
from oss.src.core.environments.service import (
    EnvironmentsService,
)
from oss.src.core.environments.dtos import (
    EnvironmentRevisionCommit,
    EnvironmentRevisionDelta,
)
from oss.src.core.embeds.dtos import ErrorPolicy

from oss.src.apis.fastapi.workflows.models import (
    WorkflowCreateRequest,
    WorkflowEditRequest,
    WorkflowQueryRequest,
    WorkflowForkRequest,
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
    WorkflowRevisionRetrieveRequest,
    WorkflowRevisionDeployRequest,
    WorkflowRevisionsLogRequest,
    WorkflowRevisionResponse,
    WorkflowRevisionsResponse,
    #
    WorkflowRevisionResolveRequest,
    WorkflowRevisionResolveResponse,
    ResolutionInfo,
    #
    WorkflowCatalogTypeResponse,  # noqa: F401
    WorkflowCatalogTypesResponse,
    WorkflowCatalogPresetResponse,
    WorkflowCatalogTemplateResponse,
    WorkflowCatalogTemplatesResponse,
    WorkflowCatalogPresetsResponse,
    #
    SimpleWorkflowCreateRequest,
    SimpleWorkflowEditRequest,
    SimpleWorkflowQueryRequest,
    SimpleWorkflowResponse,
    SimpleWorkflowsResponse,
)
from oss.src.apis.fastapi.shared.utils import (
    compute_next_windowing,
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
)
from oss.src.apis.fastapi.environments.utils import (
    ensure_environment_deploy_allowed,
)
from oss.src.resources.workflows.catalog import (
    get_workflow_catalog_types,
    get_workflow_catalog_type,
    get_filtered_workflow_catalog_templates,
    get_workflow_catalog_template,
    get_filtered_workflow_catalog_presets,
    get_workflow_catalog_preset,
)


if is_ee():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access, FORBIDDEN_EXCEPTION


log = get_module_logger(__name__)


class WorkflowsRouter:
    def __init__(
        self,
        workflows_service: WorkflowsService,
        environments_service: EnvironmentsService,
    ):
        self.workflows_service = workflows_service
        self.environments_service = environments_service

        self.router = APIRouter()

        # WORKFLOW CATALOG -----------------------------------------------------

        self.router.add_api_route(
            "/catalog/types/",
            self.list_workflow_catalog_types,
            methods=["GET"],
            operation_id="list_workflow_catalog_types",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowCatalogTypesResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/catalog/types/{ag_type}",
            self.fetch_workflow_catalog_type,
            methods=["GET"],
            operation_id="fetch_workflow_catalog_type",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowCatalogTypeResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/catalog/templates/",
            self.list_workflow_catalog_templates,
            methods=["GET"],
            operation_id="list_workflow_catalog_templates",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowCatalogTemplatesResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/catalog/templates/{template_key}",
            self.fetch_workflow_catalog_template,
            methods=["GET"],
            operation_id="fetch_workflow_catalog_template",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowCatalogTemplateResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/catalog/templates/{template_key}/presets/",
            self.list_workflow_catalog_presets,
            methods=["GET"],
            operation_id="list_workflow_catalog_presets",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowCatalogPresetsResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/catalog/templates/{template_key}/presets/{preset_key}",
            self.fetch_workflow_catalog_preset,
            methods=["GET"],
            operation_id="fetch_workflow_catalog_preset",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowCatalogPresetResponse,
            response_model_exclude_none=True,
        )

        # WORKFLOWS ------------------------------------------------------------

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
            "/query",
            self.query_workflows,
            methods=["POST"],
            operation_id="query_workflows",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowsResponse,
            response_model_exclude_none=True,
        )

        # WORKFLOW VARIANTS ----------------------------------------------------

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
            "/variants/query",
            self.query_workflow_variants,
            methods=["POST"],
            operation_id="query_workflow_variants",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowVariantsResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/variants/fork",
            self.fork_workflow_variant,
            methods=["POST"],
            operation_id="fork_workflow_variant",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowVariantResponse,
            response_model_exclude_none=True,
        )

        # WORKFLOW REVISIONS ---------------------------------------------------

        self.router.add_api_route(
            "/revisions/retrieve",
            self.retrieve_workflow_revision,
            methods=["POST"],
            operation_id="retrieve_workflow_revision",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowRevisionResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/deploy",
            self.deploy_workflow_revision,
            methods=["POST"],
            operation_id="deploy_workflow_revision",
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
            operation_id="archive_workflow_revision",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowRevisionResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/revisions/{workflow_revision_id}/unarchive",
            self.unarchive_workflow_revision,
            methods=["POST"],
            operation_id="unarchive_workflow_revision",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowRevisionResponse,
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

        self.router.add_api_route(
            "/revisions/resolve",
            self.resolve_workflow_revision_endpoint,
            methods=["POST"],
            operation_id="resolve_workflow_revision",
            status_code=status.HTTP_200_OK,
            response_model=WorkflowRevisionResolveResponse,
            response_model_exclude_none=True,
        )

    # WORKFLOW CATALOG ---------------------------------------------------------

    @intercept_exceptions()
    async def list_workflow_catalog_types(
        self,
    ) -> WorkflowCatalogTypesResponse:
        types = get_workflow_catalog_types()

        return WorkflowCatalogTypesResponse(
            count=len(types),
            types=types,
        )

    @intercept_exceptions()
    async def fetch_workflow_catalog_type(
        self,
        *,
        ag_type: str,
    ) -> WorkflowCatalogTypeResponse:
        workflow_type = get_workflow_catalog_type(ag_type=ag_type)

        if workflow_type is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Unknown ag-type: {ag_type}",
            )

        return WorkflowCatalogTypeResponse(
            count=1,
            type=workflow_type,
        )

    @intercept_exceptions()
    @suppress_exceptions(
        default=WorkflowCatalogTemplatesResponse(), exclude=[HTTPException]
    )
    async def list_workflow_catalog_templates(
        self,
        *,
        include_archived: Optional[bool] = None,
        is_application: Optional[bool] = None,
        is_evaluator: Optional[bool] = None,
        is_snippet: Optional[bool] = None,
    ) -> WorkflowCatalogTemplatesResponse:
        entries = get_filtered_workflow_catalog_templates(
            is_application=is_application,
            is_evaluator=is_evaluator,
            is_snippet=is_snippet,
        )

        templates = [
            template
            for template in entries
            if include_archived or not (template.flags and template.flags.is_archived)
        ]

        return WorkflowCatalogTemplatesResponse(
            count=len(templates),
            templates=templates,
        )

    @intercept_exceptions()
    @suppress_exceptions(
        default=WorkflowCatalogTemplateResponse(), exclude=[HTTPException]
    )
    async def fetch_workflow_catalog_template(
        self,
        *,
        template_key: str,
    ) -> WorkflowCatalogTemplateResponse:
        template = get_workflow_catalog_template(template_key=template_key)

        return WorkflowCatalogTemplateResponse(
            count=1 if template else 0,
            template=template,
        )

    @intercept_exceptions()
    @suppress_exceptions(
        default=WorkflowCatalogPresetsResponse(), exclude=[HTTPException]
    )
    async def list_workflow_catalog_presets(
        self,
        *,
        template_key: str,
        include_archived: Optional[bool] = None,
    ) -> WorkflowCatalogPresetsResponse:
        presets = [
            preset
            for preset in get_filtered_workflow_catalog_presets(
                template_key=template_key,
            )
            if include_archived or not (preset.flags and preset.flags.is_archived)
        ]

        return WorkflowCatalogPresetsResponse(
            count=len(presets),
            presets=presets,
        )

    @intercept_exceptions()
    @suppress_exceptions(
        default=WorkflowCatalogPresetResponse(), exclude=[HTTPException]
    )
    async def fetch_workflow_catalog_preset(
        self,
        *,
        template_key: str,
        preset_key: str,
    ) -> WorkflowCatalogPresetResponse:
        preset = get_workflow_catalog_preset(
            template_key=template_key,
            preset_key=preset_key,
        )

        return WorkflowCatalogPresetResponse(
            count=1 if preset else 0,
            preset=preset,
        )

    # WORKFLOWS ----------------------------------------------------------------

    @intercept_exceptions()
    async def create_workflow(
        self,
        request: Request,
        *,
        workflow_create_request: WorkflowCreateRequest,
    ) -> WorkflowResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        workflow = await self.workflows_service.create_workflow(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            workflow_create=workflow_create_request.workflow,
        )

        # Invalidate legacy caches so the registry/apps list reflects the new workflow
        await invalidate_cache(project_id=request.state.project_id)

        workflow_response = WorkflowResponse(
            count=1 if workflow else 0,
            workflow=workflow,
        )

        return workflow_response

    @intercept_exceptions()
    @suppress_exceptions(default=WorkflowResponse(), exclude=[HTTPException])
    async def fetch_workflow(
        self,
        request: Request,
        *,
        workflow_id: UUID,
    ) -> WorkflowResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_WORKFLOWS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        workflow = await self.workflows_service.fetch_workflow(
            project_id=UUID(request.state.project_id),
            #
            workflow_ref=Reference(id=workflow_id),
        )

        workflow_response = WorkflowResponse(
            count=1 if workflow else 0,
            workflow=workflow,
        )

        return workflow_response

    @intercept_exceptions()
    async def edit_workflow(
        self,
        request: Request,
        *,
        workflow_id: UUID,
        #
        workflow_edit_request: WorkflowEditRequest,
    ) -> WorkflowResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        if str(workflow_id) != str(workflow_edit_request.workflow.id):
            return WorkflowResponse()

        workflow = await self.workflows_service.edit_workflow(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            workflow_edit=workflow_edit_request.workflow,
        )

        workflow_response = WorkflowResponse(
            count=1 if workflow else 0,
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
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        workflow = await self.workflows_service.archive_workflow(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            workflow_id=workflow_id,
        )

        # Invalidate legacy caches so the registry/apps list reflects the change
        await invalidate_cache(project_id=request.state.project_id)

        workflow_response = WorkflowResponse(
            count=1 if workflow else 0,
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
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        workflow = await self.workflows_service.unarchive_workflow(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            workflow_id=workflow_id,
        )

        # Invalidate legacy caches so the registry/apps list reflects the change
        await invalidate_cache(project_id=request.state.project_id)

        workflow_response = WorkflowResponse(
            count=1 if workflow else 0,
            workflow=workflow,
        )

        return workflow_response

    @intercept_exceptions()
    @suppress_exceptions(default=WorkflowsResponse(), exclude=[HTTPException])
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

        except Exception:  # pylint: disable=bare-except
            pass

        workflow_query_request = merge_workflow_query_requests(
            query_request_params,
            query_request_body,
        )

        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_WORKFLOWS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

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

        next_windowing = compute_next_windowing(
            entities=workflows,
            attribute="id",
            windowing=workflow_query_request.windowing,
            order="descending",
        )

        workflows_response = WorkflowsResponse(
            count=len(workflows),
            workflows=workflows,
            windowing=next_windowing,
        )

        return workflows_response

    # WORKFLOW VARIANTS --------------------------------------------------------

    @intercept_exceptions()
    async def create_workflow_variant(
        self,
        request: Request,
        *,
        workflow_variant_create_request: WorkflowVariantCreateRequest,
    ) -> WorkflowVariantResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        workflow_variant = await self.workflows_service.create_workflow_variant(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            workflow_variant_create=workflow_variant_create_request.workflow_variant,
        )

        # Invalidate legacy caches so the registry page reflects the new variant
        await invalidate_cache(project_id=request.state.project_id)

        workflow_variant_response = WorkflowVariantResponse(
            count=1 if workflow_variant else 0,
            workflow_variant=workflow_variant,
        )

        return workflow_variant_response

    @intercept_exceptions()
    @suppress_exceptions(default=WorkflowVariantResponse(), exclude=[HTTPException])
    async def fetch_workflow_variant(
        self,
        request: Request,
        *,
        workflow_variant_id: UUID,
    ) -> WorkflowVariantResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_WORKFLOWS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        workflow_variant = await self.workflows_service.fetch_workflow_variant(
            project_id=UUID(request.state.project_id),
            #
            workflow_variant_ref=Reference(id=workflow_variant_id),
        )

        workflow_variant_response = WorkflowVariantResponse(
            count=1 if workflow_variant else 0,
            workflow_variant=workflow_variant,
        )

        return workflow_variant_response

    @intercept_exceptions()
    async def edit_workflow_variant(
        self,
        request: Request,
        *,
        workflow_variant_id: UUID,
        #
        workflow_variant_edit_request: WorkflowVariantEditRequest,
    ) -> WorkflowVariantResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        if str(workflow_variant_id) != str(
            workflow_variant_edit_request.workflow_variant.id
        ):
            return WorkflowVariantResponse()

        workflow_variant = await self.workflows_service.edit_workflow_variant(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            workflow_variant_edit=workflow_variant_edit_request.workflow_variant,
        )

        workflow_variant_response = WorkflowVariantResponse(
            count=1 if workflow_variant else 0,
            workflow_variant=workflow_variant,
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
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        workflow_variant = await self.workflows_service.archive_workflow_variant(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            workflow_variant_id=workflow_variant_id,
        )

        # Invalidate legacy caches so the registry/apps list reflects the change
        await invalidate_cache(project_id=request.state.project_id)

        workflow_variant_response = WorkflowVariantResponse(
            count=1 if workflow_variant else 0,
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
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        workflow_variant = await self.workflows_service.unarchive_workflow_variant(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            workflow_variant_id=workflow_variant_id,
        )

        # Invalidate legacy caches so the registry/apps list reflects the change
        await invalidate_cache(project_id=request.state.project_id)

        workflow_variant_response = WorkflowVariantResponse(
            count=1 if workflow_variant else 0,
            workflow_variant=workflow_variant,
        )

        return workflow_variant_response

    @intercept_exceptions()
    @suppress_exceptions(default=WorkflowVariantsResponse(), exclude=[HTTPException])
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

        except Exception:  # pylint: disable=bare-except
            pass

        workflow_variant_query_request = merge_workflow_variant_query_requests(
            query_request_params,
            query_request_body,
        )

        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_WORKFLOWS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

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

        next_windowing = compute_next_windowing(
            entities=workflow_variants,
            attribute="id",
            windowing=workflow_variant_query_request.windowing,
            order="descending",
        )

        workflow_variants_response = WorkflowVariantsResponse(
            count=len(workflow_variants),
            workflow_variants=workflow_variants,
            windowing=next_windowing,
        )

        return workflow_variants_response

    @intercept_exceptions()
    async def fork_workflow_variant(
        self,
        request: Request,
        *,
        workflow_fork_request: WorkflowForkRequest,
    ) -> WorkflowVariantResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        try:
            workflow_variant = await self.workflows_service.fork_workflow_variant(
                project_id=UUID(request.state.project_id),
                user_id=UUID(request.state.user_id),
                #
                workflow_fork=workflow_fork_request.workflow,
            )
        except VariantForkError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=e.message,
            ) from e

        # Invalidate legacy caches so the registry page reflects the forked variant
        await invalidate_cache(project_id=request.state.project_id)

        workflow_variant_response = WorkflowVariantResponse(
            count=1 if workflow_variant else 0,
            workflow_variant=workflow_variant,
        )

        return workflow_variant_response

    # WORKFLOW REVISIONS -------------------------------------------------------

    @intercept_exceptions()
    async def create_workflow_revision(
        self,
        request: Request,
        *,
        workflow_revision_create_request: WorkflowRevisionCreateRequest,
    ) -> WorkflowRevisionResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        workflow_revision = await self.workflows_service.create_workflow_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            workflow_revision_create=workflow_revision_create_request.workflow_revision,
        )

        # Invalidate legacy caches so the registry page reflects the new revision
        await invalidate_cache(project_id=request.state.project_id)

        workflow_revision_response = WorkflowRevisionResponse(
            count=1 if workflow_revision else 0,
            workflow_revision=workflow_revision,
        )

        return workflow_revision_response

    @intercept_exceptions()
    @suppress_exceptions(default=WorkflowRevisionResponse(), exclude=[HTTPException])
    async def fetch_workflow_revision(
        self,
        request: Request,
        *,
        workflow_revision_id: UUID,
    ) -> WorkflowRevisionResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_WORKFLOWS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        workflow_revision = await self.workflows_service.fetch_workflow_revision(
            project_id=UUID(request.state.project_id),
            #
            workflow_revision_ref=Reference(id=workflow_revision_id),
        )

        workflow_revision_response = WorkflowRevisionResponse(
            count=1 if workflow_revision else 0,
            workflow_revision=workflow_revision,
        )

        return workflow_revision_response

    @intercept_exceptions()
    async def edit_workflow_revision(
        self,
        request: Request,
        *,
        workflow_revision_id: UUID,
        #
        workflow_revision_request: WorkflowRevisionEditRequest,
    ) -> WorkflowRevisionResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        if str(workflow_revision_id) != str(
            workflow_revision_request.workflow_revision.id
        ):
            return WorkflowRevisionResponse()

        workflow_revision = await self.workflows_service.edit_workflow_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            workflow_revision_edit=workflow_revision_request.workflow_revision,
        )

        workflow_revision_response = WorkflowRevisionResponse(
            count=1 if workflow_revision else 0,
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
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        workflow_revision = await self.workflows_service.archive_workflow_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            workflow_revision_id=workflow_revision_id,
        )

        # Invalidate legacy caches so the registry page reflects the change
        await invalidate_cache(project_id=request.state.project_id)

        workflow_revision_response = WorkflowRevisionResponse(
            count=1 if workflow_revision else 0,
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
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        workflow_revision = await self.workflows_service.unarchive_workflow_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            workflow_revision_id=workflow_revision_id,
        )

        # Invalidate legacy caches so the registry page reflects the change
        await invalidate_cache(project_id=request.state.project_id)

        workflow_revision_response = WorkflowRevisionResponse(
            count=1 if workflow_revision else 0,
            workflow_revision=workflow_revision,
        )

        return workflow_revision_response

    @intercept_exceptions()
    @suppress_exceptions(default=WorkflowRevisionsResponse(), exclude=[HTTPException])
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

        except Exception:  # pylint: disable=bare-except
            pass

        workflow_revision_query_request = merge_workflow_revision_query_requests(
            query_request_params, query_request_body
        )

        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_WORKFLOWS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

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

        next_windowing = compute_next_windowing(
            entities=workflow_revisions,
            attribute="id",
            windowing=workflow_revision_query_request.windowing,
            order="descending",
        )

        workflow_revisions_response = WorkflowRevisionsResponse(
            count=len(workflow_revisions),
            workflow_revisions=workflow_revisions,
            windowing=next_windowing,
        )

        return workflow_revisions_response

    @intercept_exceptions()
    async def commit_workflow_revision(
        self,
        request: Request,
        *,
        workflow_variant_id: Optional[UUID] = None,
        #
        workflow_revision_commit_request: WorkflowRevisionCommitRequest,
    ) -> WorkflowRevisionResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        if workflow_variant_id is not None and str(workflow_variant_id) != str(
            workflow_revision_commit_request.workflow_revision.workflow_variant_id
        ):
            return WorkflowRevisionResponse()

        workflow_revision = await self.workflows_service.commit_workflow_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            workflow_revision_commit=workflow_revision_commit_request.workflow_revision,
        )

        # Invalidate legacy caches so the registry page reflects the new revision
        await invalidate_cache(project_id=request.state.project_id)

        workflow_revision_response = WorkflowRevisionResponse(
            count=1 if workflow_revision else 0,
            workflow_revision=workflow_revision,
        )

        return workflow_revision_response

    @intercept_exceptions()
    @suppress_exceptions(default=WorkflowRevisionsResponse(), exclude=[HTTPException])
    async def log_workflow_revisions(
        self,
        request: Request,
        *,
        workflow_revisions_log_request: WorkflowRevisionsLogRequest,
    ) -> WorkflowRevisionsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_WORKFLOWS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        workflow_revisions = await self.workflows_service.log_workflow_revisions(
            project_id=UUID(request.state.project_id),
            #
            workflow_revisions_log=workflow_revisions_log_request.workflow,
        )

        workflow_revisions_response = WorkflowRevisionsResponse(
            count=len(workflow_revisions),
            workflow_revisions=workflow_revisions,
        )

        return workflow_revisions_response

    @intercept_exceptions()
    async def deploy_workflow_revision(
        self,
        request: Request,
        *,
        workflow_deploy_request: WorkflowRevisionDeployRequest,
    ) -> WorkflowRevisionResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_ENVIRONMENTS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        if not any(
            (
                workflow_deploy_request.workflow_ref,
                workflow_deploy_request.workflow_variant_ref,
                workflow_deploy_request.workflow_revision_ref,
            )
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Workflow deploy requires workflow refs.",
            )

        if not any(
            (
                workflow_deploy_request.environment_ref,
                workflow_deploy_request.environment_variant_ref,
                workflow_deploy_request.environment_revision_ref,
            )
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Workflow deploy requires environment refs.",
            )

        workflow_revision = await self.workflows_service.fetch_workflow_revision(
            project_id=UUID(request.state.project_id),
            #
            workflow_ref=workflow_deploy_request.workflow_ref,
            workflow_variant_ref=workflow_deploy_request.workflow_variant_ref,
            workflow_revision_ref=workflow_deploy_request.workflow_revision_ref,
        )

        if not workflow_revision:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Workflow revision not found.",
            )

        target_environment_revision = await self.environments_service.fetch_environment_revision(
            project_id=UUID(request.state.project_id),
            #
            environment_ref=workflow_deploy_request.environment_ref,
            environment_variant_ref=workflow_deploy_request.environment_variant_ref,
            environment_revision_ref=workflow_deploy_request.environment_revision_ref,
        )

        if not target_environment_revision:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Environment revision not found.",
            )

        environment_id = (
            target_environment_revision.environment_id
            or target_environment_revision.artifact_id
        )
        environment_variant_id = (
            target_environment_revision.environment_variant_id
            or target_environment_revision.variant_id
        )
        workflow_id = workflow_revision.workflow_id or workflow_revision.artifact_id
        workflow_variant_id = (
            workflow_revision.workflow_variant_id or workflow_revision.variant_id
        )
        key = workflow_deploy_request.key

        if not environment_id or not environment_variant_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Environment revision is missing environment ids.",
            )

        if not workflow_id or not workflow_variant_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Workflow revision is missing workflow ids.",
            )

        if key is None:
            workflow = await self.workflows_service.fetch_workflow(
                project_id=UUID(request.state.project_id),
                workflow_ref=Reference(id=workflow_id),
            )

            if not workflow or not workflow.slug:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Workflow deploy could not derive key from workflow slug.",
                )

            key = f"{workflow.slug}.revision"

        await ensure_environment_deploy_allowed(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            environment_id=environment_id,
            environments_service=self.environments_service,
        )

        await self.environments_service.commit_environment_revision(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            environment_revision_commit=EnvironmentRevisionCommit(
                slug=uuid4().hex[-12:],
                environment_id=environment_id,
                environment_variant_id=environment_variant_id,
                message=workflow_deploy_request.message,
                delta=EnvironmentRevisionDelta(
                    set={
                        key: {
                            "workflow": Reference(id=workflow_id),
                            "workflow_variant": Reference(id=workflow_variant_id),
                            "workflow_revision": Reference(
                                id=workflow_revision.id,
                                slug=workflow_revision.slug,
                                version=workflow_revision.version,
                            ),
                        }
                    }
                ),
            ),
        )

        await invalidate_cache(project_id=request.state.project_id)

        return WorkflowRevisionResponse(
            count=1 if workflow_revision else 0,
            workflow_revision=workflow_revision,
        )

    @intercept_exceptions()
    @suppress_exceptions(default=WorkflowRevisionResponse(), exclude=[HTTPException])
    async def retrieve_workflow_revision(
        self,
        request: Request,
        *,
        workflow_revision_retrieve_request: WorkflowRevisionRetrieveRequest,
    ) -> WorkflowRevisionResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_WORKFLOWS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        workflow_ref = workflow_revision_retrieve_request.workflow_ref
        workflow_variant_ref = workflow_revision_retrieve_request.workflow_variant_ref
        workflow_revision_ref = workflow_revision_retrieve_request.workflow_revision_ref

        workflow_lookup_requested = any(
            (
                workflow_ref,
                workflow_variant_ref,
                workflow_revision_ref,
            )
        )
        environment_ref = workflow_revision_retrieve_request.environment_ref
        environment_variant_ref = (
            workflow_revision_retrieve_request.environment_variant_ref
        )
        environment_revision_ref = (
            workflow_revision_retrieve_request.environment_revision_ref
        )
        key = workflow_revision_retrieve_request.key

        environment_refs_requested = any(
            (
                environment_ref,
                environment_variant_ref,
                environment_revision_ref,
            )
        )
        environment_lookup_requested = environment_refs_requested or key is not None

        if workflow_lookup_requested and environment_lookup_requested:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Provide either workflow refs or environment refs with key, not both."
                ),
            )

        if not workflow_lookup_requested and not environment_lookup_requested:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Provide workflow refs or environment refs with key to retrieve a workflow revision."
                ),
            )

        if environment_lookup_requested:
            if not environment_refs_requested:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Environment-backed workflow retrieve requires environment refs.",
                )

            if not key:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Environment-backed workflow retrieve requires key.",
                )

        (
            workflow_revision,
            resolution_info,
        ) = await self.workflows_service.retrieve_workflow_revision(
            project_id=UUID(request.state.project_id),
            #
            environment_ref=environment_ref,
            environment_variant_ref=environment_variant_ref,
            environment_revision_ref=environment_revision_ref,
            key=key,
            #
            workflow_ref=workflow_ref,
            workflow_variant_ref=workflow_variant_ref,
            workflow_revision_ref=workflow_revision_ref,
            #
            resolve=workflow_revision_retrieve_request.resolve or False,
        )

        if environment_lookup_requested and not workflow_revision:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Environment revision does not contain workflow references for the requested key.",
            )

        workflow_revision_response = WorkflowRevisionResponse(
            count=1 if workflow_revision else 0,
            workflow_revision=workflow_revision,
            resolution_info=resolution_info,
        )

        return workflow_revision_response

    @intercept_exceptions()
    async def resolve_workflow_revision_endpoint(
        self,
        request: Request,
        *,
        workflow_revision_resolve_request: WorkflowRevisionResolveRequest,
    ) -> WorkflowRevisionResolveResponse:
        """
        Resolve embedded references in a workflow revision configuration.

        This endpoint:
        1. Fetches the workflow revision
        2. Resolves all @ag.references tokens in the configuration
        3. Returns the revision with resolved configuration + metadata
        """
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_WORKFLOWS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        # Resolve the workflow revision
        result = await self.workflows_service.resolve_workflow_revision(
            project_id=UUID(request.state.project_id),
            #
            workflow_ref=workflow_revision_resolve_request.workflow_ref,
            workflow_variant_ref=workflow_revision_resolve_request.workflow_variant_ref,
            workflow_revision_ref=workflow_revision_resolve_request.workflow_revision_ref,
            #
            workflow_revision=workflow_revision_resolve_request.workflow_revision,
            #
            max_depth=workflow_revision_resolve_request.max_depth or 10,
            max_embeds=workflow_revision_resolve_request.max_embeds or 100,
            error_policy=workflow_revision_resolve_request.error_policy
            or ErrorPolicy.EXCEPTION,
        )

        if not result:
            return WorkflowRevisionResolveResponse()

        # Unpack the result tuple
        workflow_revision, resolution_info = result

        # Build resolution metadata
        resolution_info = ResolutionInfo(
            references_used=resolution_info.references_used,
            depth_reached=resolution_info.depth_reached,
            embeds_resolved=resolution_info.embeds_resolved,
            errors=resolution_info.errors,
        )

        workflow_revision_resolve_response = WorkflowRevisionResolveResponse(
            count=1 if workflow_revision else 0,
            workflow_revision=workflow_revision,
            resolution_info=resolution_info,
        )

        return workflow_revision_resolve_response


class SimpleWorkflowsRouter:
    def __init__(
        self,
        *,
        simple_workflows_service: SimpleWorkflowsService,
    ):
        self.simple_workflows_service = simple_workflows_service

        self.router = APIRouter()

        self.router.add_api_route(
            "/",
            self.create_simple_workflow,
            methods=["POST"],
            operation_id="create_simple_workflow",
            status_code=status.HTTP_200_OK,
            response_model=SimpleWorkflowResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{workflow_id}",
            self.fetch_simple_workflow,
            methods=["GET"],
            operation_id="fetch_simple_workflow",
            status_code=status.HTTP_200_OK,
            response_model=SimpleWorkflowResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{workflow_id}",
            self.edit_simple_workflow,
            methods=["PUT"],
            operation_id="edit_simple_workflow",
            status_code=status.HTTP_200_OK,
            response_model=SimpleWorkflowResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{workflow_id}/archive",
            self.archive_simple_workflow,
            methods=["POST"],
            operation_id="archive_simple_workflow",
            status_code=status.HTTP_200_OK,
            response_model=SimpleWorkflowResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{workflow_id}/unarchive",
            self.unarchive_simple_workflow,
            methods=["POST"],
            operation_id="unarchive_simple_workflow",
            status_code=status.HTTP_200_OK,
            response_model=SimpleWorkflowResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/query",
            self.query_simple_workflows,
            methods=["POST"],
            operation_id="query_simple_workflows",
            status_code=status.HTTP_200_OK,
            response_model=SimpleWorkflowsResponse,
            response_model_exclude_none=True,
        )

    # SIMPLE WORKFLOWS ---------------------------------------------------------

    @intercept_exceptions()
    async def create_simple_workflow(
        self,
        request: Request,
        *,
        workflow_id: Optional[UUID] = None,
        #
        simple_workflow_create_request: SimpleWorkflowCreateRequest,
    ) -> SimpleWorkflowResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        simple_workflow = await self.simple_workflows_service.create(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            simple_workflow_create=simple_workflow_create_request.workflow,
            #
            workflow_id=workflow_id,
        )

        await invalidate_cache(project_id=request.state.project_id)

        return SimpleWorkflowResponse(
            count=1 if simple_workflow else 0,
            workflow=simple_workflow,
        )

    @intercept_exceptions()
    @suppress_exceptions(default=SimpleWorkflowResponse(), exclude=[HTTPException])
    async def fetch_simple_workflow(
        self,
        request: Request,
        *,
        workflow_id: UUID,
    ) -> SimpleWorkflowResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_WORKFLOWS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        simple_workflow = await self.simple_workflows_service.fetch(
            project_id=UUID(request.state.project_id),
            #
            workflow_id=workflow_id,
        )

        return SimpleWorkflowResponse(
            count=1 if simple_workflow else 0,
            workflow=simple_workflow,
        )

    @intercept_exceptions()
    async def edit_simple_workflow(
        self,
        request: Request,
        *,
        workflow_id: UUID,
        #
        simple_workflow_edit_request: SimpleWorkflowEditRequest,
    ) -> SimpleWorkflowResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        if str(workflow_id) != str(simple_workflow_edit_request.workflow.id):
            return SimpleWorkflowResponse()

        simple_workflow = await self.simple_workflows_service.edit(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            simple_workflow_edit=simple_workflow_edit_request.workflow,
        )

        return SimpleWorkflowResponse(
            count=1 if simple_workflow else 0,
            workflow=simple_workflow,
        )

    @intercept_exceptions()
    async def archive_simple_workflow(
        self,
        request: Request,
        *,
        workflow_id: UUID,
    ) -> SimpleWorkflowResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        simple_workflow = await self.simple_workflows_service.archive(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            workflow_id=workflow_id,
        )

        await invalidate_cache(project_id=request.state.project_id)

        return SimpleWorkflowResponse(
            count=1 if simple_workflow else 0,
            workflow=simple_workflow,
        )

    @intercept_exceptions()
    async def unarchive_simple_workflow(
        self,
        request: Request,
        *,
        workflow_id: UUID,
    ) -> SimpleWorkflowResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_WORKFLOWS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        simple_workflow = await self.simple_workflows_service.unarchive(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            #
            workflow_id=workflow_id,
        )

        await invalidate_cache(project_id=request.state.project_id)

        return SimpleWorkflowResponse(
            count=1 if simple_workflow else 0,
            workflow=simple_workflow,
        )

    @intercept_exceptions()
    @suppress_exceptions(default=SimpleWorkflowsResponse(), exclude=[HTTPException])
    async def query_simple_workflows(
        self,
        request: Request,
        *,
        simple_workflow_query_request: SimpleWorkflowQueryRequest,
    ) -> SimpleWorkflowsResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_WORKFLOWS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        simple_workflows = await self.simple_workflows_service.query(
            project_id=UUID(request.state.project_id),
            #
            simple_workflow_query=simple_workflow_query_request.workflow,
            #
            workflow_refs=simple_workflow_query_request.workflow_refs,
            #
            include_archived=simple_workflow_query_request.include_archived,
            #
            windowing=simple_workflow_query_request.windowing,
        )

        return SimpleWorkflowsResponse(
            count=len(simple_workflows),
            workflows=simple_workflows,
        )
