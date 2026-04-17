from uuid import UUID, uuid4
from typing import Optional

from fastapi import APIRouter, status, Request, Depends, HTTPException

from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions, suppress_exceptions
from oss.src.utils.caching import invalidate_cache

from oss.src.core.shared.dtos import (
    Reference,
)
from oss.src.core.applications.service import (
    ApplicationsService,
    SimpleApplicationsService,
)
from oss.src.core.environments.service import (
    EnvironmentsService,
)
from oss.src.core.environments.dtos import (
    EnvironmentRevisionCommit,
    EnvironmentRevisionDelta,
)
from oss.src.core.applications.dtos import (
    ApplicationCatalogType,
    ApplicationCatalogTemplate,
    ApplicationCatalogPreset,
    ApplicationRevisionData,
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
    ApplicationRevisionDeployRequest,
    ApplicationRevisionResponse,
    ApplicationRevisionsResponse,
    ApplicationCatalogPresetResponse,
    ApplicationCatalogPresetsResponse,
    ApplicationCatalogTypesResponse,
    ApplicationCatalogTemplateResponse,
    ApplicationCatalogTemplatesResponse,
    ApplicationRevisionResolveRequest,
    ApplicationRevisionResolveResponse,
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
from oss.src.apis.fastapi.environments.utils import (
    ensure_environment_deploy_allowed,
)
from oss.src.resources.workflows.catalog import (
    get_workflow_catalog_types,
    get_filtered_workflow_catalog_templates,
    get_workflow_catalog_template,
    get_filtered_workflow_catalog_presets,
    get_workflow_catalog_preset,
)

if is_ee():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access, FORBIDDEN_EXCEPTION


log = get_module_logger(__name__)
# TEMPORARY: Disabling name editing
RENAME_APPS_DISABLED_MESSAGE = "Renaming applications is temporarily disabled."


def _build_rename_apps_disabled_detail(*, existing_name: Optional[str]) -> str:
    if existing_name:
        return (
            f"{RENAME_APPS_DISABLED_MESSAGE} "
            f"Current application name is '{existing_name}'."
        )

    return RENAME_APPS_DISABLED_MESSAGE


class ApplicationsRouter:
    def __init__(
        self,
        *,
        applications_service: ApplicationsService,
        environments_service: EnvironmentsService,
    ):
        self.applications_service = applications_service
        self.environments_service = environments_service

        self.router = APIRouter()

        # APPLICATION CATALOG --------------------------------------------------

        self.router.add_api_route(
            "/catalog/types/",
            self.list_application_catalog_types,
            methods=["GET"],
            operation_id="list_application_catalog_types",
            status_code=status.HTTP_200_OK,
            response_model=ApplicationCatalogTypesResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/catalog/templates/",
            self.list_application_catalog_templates,
            methods=["GET"],
            operation_id="list_application_catalog_templates",
            status_code=status.HTTP_200_OK,
            response_model=ApplicationCatalogTemplatesResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/catalog/templates/{template_key}",
            self.fetch_application_catalog_template,
            methods=["GET"],
            operation_id="fetch_application_catalog_template",
            status_code=status.HTTP_200_OK,
            response_model=ApplicationCatalogTemplateResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/catalog/templates/{template_key}/presets/",
            self.list_application_catalog_presets,
            methods=["GET"],
            operation_id="list_application_catalog_presets",
            status_code=status.HTTP_200_OK,
            response_model=ApplicationCatalogPresetsResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/catalog/templates/{template_key}/presets/{preset_key}",
            self.fetch_application_catalog_preset,
            methods=["GET"],
            operation_id="fetch_application_catalog_preset",
            status_code=status.HTTP_200_OK,
            response_model=ApplicationCatalogPresetResponse,
            response_model_exclude_none=True,
        )

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
            "/revisions/deploy",
            self.deploy_application_revision,
            methods=["POST"],
            operation_id="deploy_application_revision",
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

        self.router.add_api_route(
            "/revisions/resolve",
            self.resolve_application_revision,
            methods=["POST"],
            operation_id="resolve_application_revision",
            status_code=status.HTTP_200_OK,
            response_model=ApplicationRevisionResolveResponse,
            response_model_exclude_none=True,
        )

    # APPLICATION CATALOG ------------------------------------------------------

    @intercept_exceptions()
    async def list_application_catalog_types(
        self,
    ) -> ApplicationCatalogTypesResponse:
        """List shared catalog types.

        Catalog types are reusable JSON-Schema building blocks referenced from
        template schemas (for example `message`, `prompt-template`). Types are
        read-only and version with the product.
        See the [Applications guide](/reference/api-guide/applications#catalog).
        """
        types = [
            ApplicationCatalogType(**type_data.model_dump())
            for type_data in get_workflow_catalog_types()
        ]

        return ApplicationCatalogTypesResponse(
            count=len(types),
            types=types,
        )

    @intercept_exceptions()
    @suppress_exceptions(
        default=ApplicationCatalogTemplatesResponse(), exclude=[HTTPException]
    )
    async def list_application_catalog_templates(
        self,
        *,
        include_archived: Optional[bool] = None,
    ) -> ApplicationCatalogTemplatesResponse:
        """List application templates available in the catalog.

        Templates describe the handler (`uri`) and JSON schemas used to create
        a new application. Pass `include_archived=true` to include retired
        templates (useful when editing applications created from an old
        template). Templates are global and read-only.
        """
        templates = [
            ApplicationCatalogTemplate(**entry.model_dump())
            for entry in get_filtered_workflow_catalog_templates(is_application=True)
            if include_archived or not (entry.flags and entry.flags.is_archived)
        ]

        return ApplicationCatalogTemplatesResponse(
            count=len(templates),
            templates=templates,
        )

    @intercept_exceptions()
    @suppress_exceptions(
        default=ApplicationCatalogTemplateResponse(), exclude=[HTTPException]
    )
    async def fetch_application_catalog_template(
        self,
        *,
        template_key: str,
    ) -> ApplicationCatalogTemplateResponse:
        """Fetch one application template by key.

        Use this to inspect the exact `uri`, `data`, and JSON Schemas for a
        template before creating an application from it. `template_key` comes
        from the `key` field of a template returned by the list endpoint
        (for example `completion`, `chat`, `hook`).
        """
        template_data = get_workflow_catalog_template(
            template_key=template_key,
            is_application=True,
        )
        template = (
            ApplicationCatalogTemplate(**template_data.model_dump())
            if template_data
            else None
        )

        return ApplicationCatalogTemplateResponse(
            count=1 if template else 0,
            template=template,
        )

    @intercept_exceptions()
    @suppress_exceptions(
        default=ApplicationCatalogPresetsResponse(), exclude=[HTTPException]
    )
    async def list_application_catalog_presets(
        self,
        *,
        template_key: str,
        include_archived: Optional[bool] = None,
    ) -> ApplicationCatalogPresetsResponse:
        """List presets scoped to a template.

        Presets are named parameter sets (for example a curated prompt +
        model combination) that scaffold the first revision when creating an
        application from a template. Pass `include_archived=true` to include
        retired presets.
        """
        presets = [
            ApplicationCatalogPreset(**preset.model_dump())
            for preset in get_filtered_workflow_catalog_presets(
                template_key=template_key,
                is_application=True,
            )
            if include_archived or not (preset.flags and preset.flags.is_archived)
        ]

        return ApplicationCatalogPresetsResponse(
            count=len(presets),
            presets=presets,
        )

    @intercept_exceptions()
    @suppress_exceptions(
        default=ApplicationCatalogPresetResponse(), exclude=[HTTPException]
    )
    async def fetch_application_catalog_preset(
        self,
        *,
        template_key: str,
        preset_key: str,
    ) -> ApplicationCatalogPresetResponse:
        """Fetch one preset by key within a template.

        Returns the preset's `data` so clients can use it as the payload for a
        first revision when creating an application from a template.
        """
        preset_data = get_workflow_catalog_preset(
            template_key=template_key,
            preset_key=preset_key,
            is_application=True,
        )
        preset = (
            ApplicationCatalogPreset(**preset_data.model_dump())
            if preset_data
            else None
        )

        return ApplicationCatalogPresetResponse(
            count=1 if preset else 0,
            preset=preset,
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
        """Create an application artifact only.

        Returns an empty application without any variants or revisions.
        Most callers should use `POST /simple/applications/` instead — it
        creates the artifact, a default variant, and a first committed
        revision in one request.
        See the [Applications guide](/reference/api-guide/applications).
        """
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
        """Fetch one application artifact by ID.

        Returns artifact-level fields only. To get the current variant,
        revision, and `data` in a single call, use
        `GET /simple/applications/{application_id}`.
        """
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
        """Edit artifact-level fields on an application.

        Editable fields: `description`, `flags`, `tags`, `meta`. Editing `name`
        is currently disabled and returns `400`. Prompt or model-parameter
        changes go through `POST /applications/revisions/commit`, not this
        endpoint.
        """
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
                detail=_build_rename_apps_disabled_detail(
                    existing_name=existing_application.name
                ),
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
        """Soft-delete an application.

        Archiving sets `deleted_at` on the application and hides it from
        queries that don't set `include_archived: true`. Its variants and
        revisions become unreachable from listing but their IDs remain
        resolvable so historical traces stay intact.
        See [Versioning](/reference/api-guide/versioning#archive-and-unarchive).
        """
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
        """Restore a previously archived application.

        Clears `deleted_at` and makes the application visible to standard
        queries again. Safe to call on an already-active application; it is a
        no-op in that case.
        """
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
        """Query application artifacts.

        Returns only artifact-level fields; the variant, revision, and `data`
        payload are not included. For one row per application with those
        merged in, use `POST /simple/applications/query`.
        See [Query Pattern](/reference/api-guide/query-pattern).
        """
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
        """Create a new variant on an existing application.

        A variant is an independent branch of the application's history. The
        new variant starts empty — call `POST /applications/revisions/commit`
        to add its first revision. Use `POST /applications/variants/fork` when
        you want the new variant to inherit an existing revision history.
        """
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
        """Fetch one variant by ID.

        Returns variant-level fields. To get the variant's tip revision and
        its `data`, call `POST /applications/revisions/retrieve` with
        `application_variant_ref`.
        """
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
        """Edit a variant's header fields (`name`, `description`, `tags`, `meta`).

        Configuration changes go through a new commit via
        `POST /applications/revisions/commit`. This endpoint only touches
        variant-level metadata.
        """
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
        """Soft-delete a variant.

        The variant and its revisions are hidden from queries unless
        `include_archived: true` is sent. Revision IDs remain resolvable so
        historical traces are preserved.
        """
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
        """Restore a previously archived variant."""
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
        """Query variants across one or more applications.

        Filters are parsed from both query-string parameters and the request
        body; body values take precedence. Use `application_refs` to scope to
        specific applications, `application_variant_refs` to narrow to
        specific variants.
        See [Query Pattern](/reference/api-guide/query-pattern).
        """
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
        """Fork an existing variant into a new variant on the same application.

        Use this to experiment without touching the source variant's history.
        The fork copies the source variant's revisions up to the specified
        revision (or tip) into the new variant, then commits the supplied
        `revision` object on top. Both `variant` and `revision` sub-objects
        in the request must be present; the server returns `count: 0` when
        either is missing.
        """
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
    async def deploy_application_revision(
        self,
        request: Request,
        *,
        application_deploy_request: ApplicationRevisionDeployRequest,
    ) -> ApplicationRevisionResponse:
        """Deploy an application revision to an environment.

        Writes a reference from the environment revision to the application
        revision under `key` (default: `{application_slug}.revision`). Clients
        that subsequently call `/applications/revisions/retrieve` with the
        same `environment_ref` and `key` resolve to this revision.
        See the [Applications guide](/reference/api-guide/applications#deployment).
        """
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_APPLICATIONS,  # type: ignore
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
                application_deploy_request.application_ref,
                application_deploy_request.application_variant_ref,
                application_deploy_request.application_revision_ref,
            )
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Application deploy requires application refs.",
            )

        if not any(
            (
                application_deploy_request.environment_ref,
                application_deploy_request.environment_variant_ref,
                application_deploy_request.environment_revision_ref,
            )
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Application deploy requires environment refs.",
            )

        application_revision = await self.applications_service.fetch_application_revision(
            project_id=UUID(request.state.project_id),
            #
            application_ref=application_deploy_request.application_ref,
            application_variant_ref=application_deploy_request.application_variant_ref,
            application_revision_ref=application_deploy_request.application_revision_ref,
        )

        if not application_revision:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Application revision not found.",
            )

        (
            target_environment_revision,
            _,
        ) = await self.environments_service.retrieve_environment_revision(
            project_id=UUID(request.state.project_id),
            #
            environment_ref=application_deploy_request.environment_ref,
            environment_variant_ref=application_deploy_request.environment_variant_ref,
            environment_revision_ref=application_deploy_request.environment_revision_ref,
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
        application_id = (
            application_revision.application_id or application_revision.artifact_id
        )
        application_variant_id = (
            application_revision.application_variant_id
            or application_revision.variant_id
        )
        key = application_deploy_request.key

        if not environment_id or not environment_variant_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Environment revision is missing environment ids.",
            )

        if not application_id or not application_variant_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Application revision is missing application ids.",
            )

        if key is None:
            application = await self.applications_service.fetch_application(
                project_id=UUID(request.state.project_id),
                application_ref=Reference(id=application_id),
            )

            if not application or not application.slug:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Application deploy could not derive key from application slug.",
                )

            key = f"{application.slug}.revision"

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
                message=application_deploy_request.message,
                delta=EnvironmentRevisionDelta(
                    set={
                        key: {
                            "application": Reference(id=application_id),
                            "application_variant": Reference(id=application_variant_id),
                            "application_revision": Reference(
                                id=application_revision.id,
                                slug=application_revision.slug,
                                version=application_revision.version,
                            ),
                        }
                    }
                ),
            ),
        )

        await invalidate_cache(project_id=request.state.project_id)

        return ApplicationRevisionResponse(
            count=1 if application_revision else 0,
            application_revision=application_revision,
        )

    @intercept_exceptions()
    @suppress_exceptions(default=ApplicationRevisionResponse(), exclude=[HTTPException])
    async def retrieve_application_revision(
        self,
        request: Request,
        *,
        application_revision_retrieve_request: ApplicationRevisionRetrieveRequest,
    ) -> ApplicationRevisionResponse:
        """Retrieve one application revision by reference.

        Accepts application / variant / revision references for direct lookup,
        or an environment reference (with optional `key`) to resolve the
        currently-deployed revision in that environment. Returns the revision
        including its `data` payload (URL, parameters, schemas), which clients
        use to invoke the application.
        Set `resolve: true` to inline embedded references inside `data`.
        """
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_APPLICATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        application_ref = application_revision_retrieve_request.application_ref
        application_variant_ref = (
            application_revision_retrieve_request.application_variant_ref
        )
        application_revision_ref = (
            application_revision_retrieve_request.application_revision_ref
        )

        application_lookup_requested = any(
            (
                application_ref,
                application_variant_ref,
                application_revision_ref,
            )
        )
        environment_ref = application_revision_retrieve_request.environment_ref
        environment_variant_ref = (
            application_revision_retrieve_request.environment_variant_ref
        )
        environment_revision_ref = (
            application_revision_retrieve_request.environment_revision_ref
        )
        key = application_revision_retrieve_request.key

        environment_refs_requested = any(
            (
                environment_ref,
                environment_variant_ref,
                environment_revision_ref,
            )
        )
        environment_lookup_requested = environment_refs_requested or key is not None

        if not application_lookup_requested and not environment_lookup_requested:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Provide application refs or environment refs with key to retrieve an application revision."
                ),
            )

        if environment_lookup_requested:
            if not environment_refs_requested:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Environment-backed application retrieve requires environment refs.",
                )

            if not key:
                if application_ref and application_ref.slug:
                    key = f"{application_ref.slug}.revision"
                elif application_ref and application_ref.id:
                    application = await self.applications_service.fetch_application(
                        project_id=UUID(request.state.project_id),
                        application_ref=application_ref,
                    )
                    if not application or not application.slug:
                        raise HTTPException(
                            status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Environment-backed application retrieve could not derive key from application slug.",
                        )
                    key = f"{application.slug}.revision"
                else:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Environment-backed application retrieve requires key.",
                    )

        (
            application_revision,
            resolution_info,
        ) = await self.applications_service.retrieve_application_revision(
            project_id=UUID(request.state.project_id),
            #
            environment_ref=environment_ref,
            environment_variant_ref=environment_variant_ref,
            environment_revision_ref=environment_revision_ref,
            key=key,
            #
            application_ref=application_ref,
            application_variant_ref=application_variant_ref,
            application_revision_ref=application_revision_ref,
            #
            resolve=application_revision_retrieve_request.resolve or False,
        )

        if environment_lookup_requested and not application_revision:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Environment revision does not contain application references for the requested key.",
            )

        application_revision_response = ApplicationRevisionResponse(
            count=1 if application_revision else 0,
            application_revision=application_revision,
            resolution_info=resolution_info,
        )

        return application_revision_response

    @intercept_exceptions()
    async def create_application_revision(
        self,
        request: Request,
        *,
        application_revision_create_request: ApplicationRevisionCreateRequest,
    ) -> ApplicationRevisionResponse:
        """Create a revision row directly, without the commit workflow.

        Advanced use only. For normal development loops prefer
        `POST /applications/revisions/commit`, which commits the new revision
        as the variant's tip and assigns a version number.
        """
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
        """Fetch one revision by its ID.

        Returns the revision including its `data` payload. For lookup by
        variant slug or environment, use `POST /applications/revisions/retrieve`.
        """
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
        """Edit a revision's header fields only.

        Revisions are immutable snapshots; `data`, `author`, `date`, and
        `message` cannot be changed. This endpoint updates header fields such
        as `description` and `tags`. To change configuration, commit a new
        revision with `POST /applications/revisions/commit`.
        """
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
        """Soft-delete a revision.

        Archived revisions are hidden from `/query` and `/log` responses
        unless `include_archived: true` is set. The ID remains resolvable for
        traces and deployed environment references.
        """
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
        """Restore a previously archived revision."""
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
        """Query revisions across one or more applications or variants.

        Use `application_refs` / `application_variant_refs` to scope the
        query, or filter on commit metadata (`author`, `date`, `message`) via
        the `application_revision` object. For the ordered history of a
        single variant, `POST /applications/revisions/log` is more direct.
        Set `resolve: true` to inline embedded references in each revision's
        `data`.
        """
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

        # Optionally resolve embeds for all revisions if requested
        if application_revisions and application_revision_query_request.resolve:
            embeds_service = self.applications_service.embeds_service

            for revision in application_revisions:
                if revision and revision.data:
                    try:
                        resolved_config, _ = await embeds_service.resolve_configuration(
                            project_id=UUID(request.state.project_id),
                            configuration=revision.data.model_dump(),
                        )
                        revision.data = ApplicationRevisionData(**resolved_config)
                    except Exception as e:
                        log.error(
                            f"Failed to resolve embeds for revision {revision.id}: {e}"
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
        """Commit a new revision on a variant.

        The new revision becomes the variant's tip and is assigned the next
        `version` number. Revisions are immutable once committed; to change
        configuration, commit a new revision.
        See [Versioning](/reference/api-guide/versioning#committing-a-revision).
        """
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
        """Return the ordered revision log for a variant.

        Pass `application_variant_id` to list the full history of that
        variant; optionally pass `application_revision_id` + `depth` to walk
        back a bounded number of commits from a specific revision. Entries
        are returned newest-first and include the full revision record.
        """
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

    @intercept_exceptions()
    async def resolve_application_revision(
        self,
        request: Request,
        *,
        application_revision_resolve_request: ApplicationRevisionResolveRequest,
    ) -> ApplicationRevisionResolveResponse:
        """Fetch a revision with embedded references inlined.

        When a revision's `data` carries references to other entities
        (snippets, linked revisions), this endpoint resolves them in place and
        returns the fully-inlined configuration along with `resolution_info`
        describing what was substituted. Use it when clients need a
        self-contained configuration for invocation or export.
        """
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_APPLICATIONS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        result = await self.applications_service.resolve_application_revision(
            project_id=UUID(request.state.project_id),
            #
            application_ref=application_revision_resolve_request.application_ref,
            application_variant_ref=application_revision_resolve_request.application_variant_ref,
            application_revision_ref=application_revision_resolve_request.application_revision_ref,
            #
            max_depth=application_revision_resolve_request.max_depth or 10,
            max_embeds=application_revision_resolve_request.max_embeds or 100,
            error_policy=application_revision_resolve_request.error_policy.value
            if application_revision_resolve_request.error_policy
            else "exception",
        )

        if not result:
            return ApplicationRevisionResolveResponse()

        application_revision, resolution_info = result

        return ApplicationRevisionResolveResponse(
            count=1,
            application_revision=application_revision,
            resolution_info=resolution_info,
        )


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
        """Create an application end-to-end.

        Creates the application artifact, a default variant, and a first
        committed revision whose `data` comes from the request. This is the
        recommended entry point for "spin up a new application from a
        template". For more control over variant and revision creation, use
        the structured endpoints under `/applications/`.
        See [Simple Endpoints](/reference/api-guide/simple-endpoints).
        """
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
        """Fetch one application with its current variant, revision, and `data` merged.

        The returned `data` includes the invocation `url`, the `parameters`
        the revision was committed with, and the JSON `schemas` for inputs,
        outputs, and parameters.
        """
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
        """Edit an application and commit a new revision if configuration changed.

        Fields other than `id` in the request body are treated as changes and
        produce a new committed revision. Supplying `data` changes the
        configuration; supplying only header fields (`flags`, `tags`, `meta`)
        still produces a new revision with the updated header but the
        existing `data`. Editing the application `name` is currently
        disabled and returns `400`.
        """
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
                detail=_build_rename_apps_disabled_detail(
                    existing_name=existing_application.name
                ),
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
        """Archive an application through the simple endpoint layer.

        Equivalent to `POST /applications/{application_id}/archive`; returns
        the archived application in the simple shape (with its last known
        variant, revision, and `data`).
        """
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
        """Unarchive an application through the simple endpoint layer.

        Equivalent to `POST /applications/{application_id}/unarchive`, with
        the response shape of `/simple/applications/`.
        """
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
        """Query applications with variant, revision, and `data` merged per row.

        This is the shape most clients want for dashboards or invocation
        pickers: each row carries `variant_id`, `revision_id`, and `data`
        (URL, parameters, schemas) alongside the artifact fields. For the
        structured query that returns artifacts only, use
        `POST /applications/query`.
        """
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
            application_refs=simple_application_query_request.application_refs,
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
