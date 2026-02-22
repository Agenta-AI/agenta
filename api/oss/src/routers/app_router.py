from uuid import UUID
from typing import List, Optional

from fastapi.responses import JSONResponse
from fastapi import HTTPException, Request

from oss.src.utils.logging import get_module_logger
from oss.src.utils.caching import get_cache, set_cache, invalidate_cache
from oss.src.utils.exceptions import build_entity_creation_conflict_message
from oss.src.core.shared.exceptions import EntityCreationConflict

from oss.src.utils.common import APIRouter, is_ee
from oss.src.services import db_manager, app_manager
from oss.src.services.legacy_adapter import (
    get_legacy_adapter,
    get_legacy_environments_adapter,
)
from oss.src.models.api.api_models import (
    App,
    UpdateApp,
    CreateAppOutput,
    ReadAppOutput,
    UpdateAppOutput,
    AddVariantFromURLPayload,
    AddVariantFromKeyPayload,
)

if is_ee():
    from ee.src.services.selectors import (
        get_user_org_and_workspace_id,
    )
    from ee.src.utils.permissions import (
        check_action_access,
        check_rbac_permission,
        # check_apikey_action_access,
    )
    from ee.src.models.shared_models import Permission
    from ee.src.models.api.api_models import (
        CreateApp_ as CreateApp,
        AppVariantResponse_ as AppVariantResponse,
        EnvironmentOutput_ as EnvironmentOutput,
        EnvironmentOutputExtended_ as EnvironmentOutputExtended,
    )

    from ee.src.utils.entitlements import (
        check_entitlements,
        Tracker,
        Gauge,
        Flag,
        NOT_ENTITLED_RESPONSE,
    )
else:
    from oss.src.models.api.api_models import (
        CreateApp,
        AppVariantResponse,
        EnvironmentOutput,
        EnvironmentOutputExtended,
    )

from oss.src.models.shared_models import AppType


router = APIRouter()

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


@router.get(
    "/{app_id}/variants/",
    response_model=List[AppVariantResponse],
    operation_id="list_app_variants",
)
async def list_app_variants(
    app_id: str,
    request: Request,
):
    """
    Retrieve a list of app variants for a given app ID.

    Args:
        app_id (str): The ID of the app to retrieve variants for.

    Returns:
        List[AppVariantResponse]: A list of app variants for the given app ID.
    """

    if is_ee():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_APPLICATIONS,
        )
        if not has_permission:
            error_msg = "You do not have access to perform this action. Please contact your organization admin."
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    cache_key = {
        "app_id": app_id,
    }

    app_variants = await get_cache(
        project_id=request.state.project_id,
        namespace="list_app_variants",
        key=cache_key,
        model=AppVariantResponse,
        is_list=True,
    )

    if app_variants is not None:
        return app_variants

    adapter = get_legacy_adapter()
    app_variants = await adapter.list_app_variants(
        project_id=UUID(request.state.project_id),
        app_id=UUID(app_id),
    )

    await set_cache(
        project_id=request.state.project_id,
        namespace="list_app_variants",
        key=cache_key,
        value=app_variants,
    )

    return app_variants


@router.get(
    "/get_variant_by_env/",
    response_model=AppVariantResponse,
    operation_id="get_variant_by_env",
)
async def get_variant_by_env(
    app_id: str,
    environment: str,
    request: Request,
):
    """
    Retrieve the app variant based on the provided app_id and environment.

    Args:
        app_id (str): The ID of the app to retrieve the variant for.
        environment (str): The environment of the app variant to retrieve.

    Raises:
        HTTPException: If the app variant is not found (status_code=500), or if a ValueError is raised (status_code=400), or if any other exception is raised (status_code=500).

    Returns:
        AppVariantResponse: The retrieved app variant.
    """
    try:
        if is_ee():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_APPLICATIONS,
            )
            if not has_permission:
                error_msg = "You do not have access to perform this action. Please contact your organization admin."
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=403,
                )

        env_adapter = get_legacy_environments_adapter()
        app_variant = await env_adapter.fetch_variant_by_environment(
            project_id=UUID(request.state.project_id),
            app_id=UUID(app_id),
            environment_name=environment,
        )

        if app_variant is None:
            raise HTTPException(status_code=500, detail="App Variant not found")

        return app_variant
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException as e:
        raise e


@router.post("/", response_model=CreateAppOutput, operation_id="create_app")
async def create_app(
    payload: CreateApp,
    request: Request,
) -> CreateAppOutput:
    """
    Create a new app for a user or organization.

    Args:
        payload (CreateApp): The payload containing the app name and organization ID (optional).

    Returns:
        CreateAppOutput: The output containing the newly created app's ID and name.

    Raises:
        HTTPException: If there is an error creating the app or the user does not have permission to access the app.
    """

    if is_ee():
        try:
            user_org_workspace_data = await get_user_org_and_workspace_id(
                request.state.user_id
            )
            if user_org_workspace_data is None:
                raise HTTPException(
                    status_code=400,
                    detail="Failed to get user org and workspace data",
                )

            has_permission = await check_rbac_permission(
                user_org_workspace_data=user_org_workspace_data,
                project_id=request.state.project_id,
                permission=Permission.EDIT_APPLICATIONS,
            )
            if not has_permission:
                error_msg = "You do not have access to perform this action. Please contact your organization admin."
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=403,
                )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        if await db_manager.get_app_type(payload.template_key) == AppType.CUSTOM:
            check, _, _ = await check_entitlements(
                organization_id=request.state.organization_id,
                key=Flag.HOOKS,
            )

            if not check:
                return NOT_ENTITLED_RESPONSE(Tracker.FLAGS)

        check, _, _ = await check_entitlements(
            organization_id=request.state.organization_id,
            key=Gauge.APPLICATIONS,
            delta=1,
        )

        if not check:
            return NOT_ENTITLED_RESPONSE(Tracker.GAUGES)

    adapter = get_legacy_adapter()

    try:
        app_output = await adapter.create_app(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            app_name=payload.app_name,
            folder_id=UUID(payload.folder_id) if payload.folder_id else None,
            template_key=payload.template_key,
        )
    except EntityCreationConflict as e:
        raise HTTPException(
            status_code=409,
            detail={
                "message": build_entity_creation_conflict_message(
                    conflict=e.conflict,
                    default_message=e.message,
                ),
                "conflict": e.conflict,
            },
        ) from e

    if app_output is None:
        raise HTTPException(
            status_code=500,
            detail="Failed to create application",
        )

    await invalidate_cache(
        project_id=request.state.project_id,
    )

    return app_output


@router.get("/{app_id}/", response_model=ReadAppOutput, operation_id="read_app")
async def read_app(
    request: Request,
    app_id: str,
) -> ReadAppOutput:
    """
    Retrieve an app by its ID.

    Args:
        app_id (str): The ID of the app to retrieve.

    Returns:
        ReadAppOutput: The output containing the app's ID and name.

    Raises:
        HTTPException: If there is an error retrieving the app or the user does not have permission to access the app.
    """

    adapter = get_legacy_adapter()
    app = await adapter.fetch_app(
        project_id=UUID(request.state.project_id),
        app_id=UUID(app_id),
    )

    if app is None:
        raise HTTPException(
            status_code=404, detail=f"No application with ID '{app_id}' found"
        )

    if is_ee():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_APPLICATIONS,
        )
        if not has_permission:
            error_msg = "You do not have access to perform this action. Please contact your organization admin."
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    return app


@router.patch("/{app_id}/", response_model=UpdateAppOutput, operation_id="update_app")
async def update_app(
    app_id: str,
    payload: UpdateApp,
    request: Request,
) -> UpdateAppOutput:
    """
    Update an app for a user or organization.

    Args:
        app_id (str): The ID of the app.
        payload (UpdateApp): The payload containing the app name.

    Returns:
        UpdateAppOutput: The output containing the newly created app's ID and name.

    Raises:
        HTTPException: If there is an error creating the app or the user does not have permission to access the app.
    """

    adapter = get_legacy_adapter()
    app = await adapter.fetch_app(
        project_id=UUID(request.state.project_id),
        app_id=UUID(app_id),
    )

    if app is None:
        raise HTTPException(
            status_code=404, detail=f"No application with ID '{app_id}' found"
        )

    if is_ee():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.EDIT_APPLICATIONS,
        )
        if not has_permission:
            error_msg = "You do not have access to perform this action. Please contact your organization admin."
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    # TEMPORARY: Disabling name editing
    if (
        "app_name" in payload.model_fields_set
        and payload.app_name is not None
        and payload.app_name != app.app_name
    ):
        raise HTTPException(
            status_code=400,
            detail=_build_rename_apps_disabled_detail(existing_name=app.app_name),
        )

    updated_app = await adapter.update_app(
        project_id=UUID(request.state.project_id),
        user_id=UUID(request.state.user_id),
        app_id=UUID(app_id),
        app_name=payload.app_name,
        folder_id=UUID(payload.folder_id) if payload.folder_id else None,
    )

    if updated_app is None:
        raise HTTPException(
            status_code=500,
            detail="Failed to update application",
        )

    await invalidate_cache(
        project_id=request.state.project_id,
    )

    return updated_app


@router.get("/", response_model=List[App], operation_id="list_apps")
async def list_apps(
    request: Request,
    app_name: Optional[str] = None,
) -> List[App]:
    """
    Retrieve a list of apps filtered by app_name.

    Args:
        app_name (Optional[str]): The name of the app to filter by.

    Returns:
        List[App]: A list of apps filtered by app_name.

    Raises:
        HTTPException: If there was an error retrieving the list of apps.
    """

    if is_ee():
        user_org_workspace_data = await get_user_org_and_workspace_id(
            request.state.user_id
        )  # type: ignore
        has_permission = await check_rbac_permission(  # type: ignore
            user_org_workspace_data=user_org_workspace_data,
            project_id=request.state.project_id,
            permission=Permission.VIEW_APPLICATIONS,  # type: ignore
        )
        if not has_permission:
            raise HTTPException(
                status_code=403,
                detail="You do not have access to perform this action. Please contact your organization admin.",
            )

    adapter = get_legacy_adapter()
    apps = await adapter.list_apps(
        project_id=UUID(request.state.project_id),
        app_name=app_name,
    )
    return apps


async def add_variant_from_url(
    app_id: str,
    payload: AddVariantFromURLPayload,
    request: Request,
):
    """
    Add a new variant to an app based on a URL.

    Args:
        app_id (str): The ID of the app to add the variant to.
        payload (AddVariantFromURLPayload): The payload containing information about the variant to add.

    Raises:
        HTTPException: If the user does not have access to the app or if there is an error adding the variant.

    Returns:
        dict: The newly added variant.
    """

    adapter = get_legacy_adapter()
    app = await adapter.fetch_app(
        project_id=UUID(request.state.project_id),
        app_id=UUID(app_id),
    )

    if app is None:
        raise HTTPException(
            status_code=404, detail=f"No application with ID '{app_id}' found"
        )

    try:
        if is_ee():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_APPLICATIONS,
            )
            if not has_permission:
                error_msg = "You do not have access to perform this action. Please contact your organization admin."
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=403,
                )

        app_variant = await adapter.create_variant_from_url(
            project_id=UUID(request.state.project_id),
            user_id=UUID(request.state.user_id),
            app_id=UUID(app_id),
            variant_name=payload.variant_name,
            url=payload.url,
            base_name=payload.base_name,
            config_name=payload.config_name,
            commit_message=payload.commit_message,
        )

        if app_variant is None:
            raise HTTPException(
                status_code=500,
                detail="Failed to create variant from URL",
            )

        await invalidate_cache(
            project_id=request.state.project_id,
        )

        return app_variant

    except HTTPException:
        raise
    except EntityCreationConflict as e:
        raise HTTPException(
            status_code=409,
            detail={
                "message": build_entity_creation_conflict_message(
                    conflict=e.conflict,
                    default_message=e.message,
                ),
                "conflict": e.conflict,
            },
        ) from e
    except Exception as e:
        log.error(f"An error occurred: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{app_id}/variant/from-service/", operation_id="add_variant_from_url")
async def add_variant_from_url_route(
    app_id: str,
    payload: AddVariantFromURLPayload,
    request: Request,
):
    if is_ee():
        check, _, _ = await check_entitlements(
            organization_id=request.state.organization_id,
            key=Flag.HOOKS,
        )

        if not check:
            return NOT_ENTITLED_RESPONSE(Tracker.FLAGS)

    return await add_variant_from_url(app_id, payload, request)


@router.post("/{app_id}/variant/from-template/", operation_id="add_variant_from_key")
async def add_variant_from_key_route(
    app_id: str,
    payload: AddVariantFromKeyPayload,
    request: Request,
):
    try:
        url = app_manager.get_service_url_from_template_key(payload.key)

    except NotImplementedError as e:
        log.error(f"An error occurred: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

    except Exception as e:
        log.error(f"An error occurred: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

    if not url:
        raise HTTPException(status_code=400, detail="Service key not supported")

    payload = AddVariantFromURLPayload(
        variant_name=payload.variant_name,
        url=url,
        commit_message=payload.commit_message,
        base_name=payload.base_name,
        config_name=payload.config_name,
    )

    return await add_variant_from_url(app_id, payload, request)


@router.delete("/{app_id}/", operation_id="remove_app")
async def remove_app(
    app_id: str,
    request: Request,
):
    """Remove app, all its variant.

    Arguments:
        app -- App to remove
    """

    adapter = get_legacy_adapter()
    app = await adapter.fetch_app(
        project_id=UUID(request.state.project_id),
        app_id=UUID(app_id),
    )

    if app is None:
        raise HTTPException(
            status_code=404, detail=f"No application with ID '{app_id}' found"
        )

    if is_ee():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.EDIT_APPLICATIONS,
        )
        if not has_permission:
            error_msg = "You do not have access to perform this action. Please contact your organization admin."
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

        check, _, _ = await check_entitlements(
            organization_id=request.state.organization_id,
            key=Gauge.APPLICATIONS,
            delta=-1,
        )

    await adapter.delete_app(
        project_id=UUID(request.state.project_id),
        user_id=UUID(request.state.user_id),
        app_id=UUID(app_id),
    )

    await invalidate_cache(
        project_id=request.state.project_id,
    )


@router.get(
    "/{app_id}/environments/",
    response_model=List[EnvironmentOutput],
    operation_id="list_environments",
)
async def list_environments(
    app_id: str,
    request: Request,
):
    """
    Retrieve a list of environments for a given app ID.

    Args:
        app_id (str): The ID of the app to retrieve environments for.

    Returns:
        List[EnvironmentOutput]: A list of environment objects.
    """

    cache_key = {
        "app_id": app_id,
    }

    environments = await get_cache(
        project_id=request.state.project_id,
        namespace="list_environments",
        key=cache_key,
        model=EnvironmentOutput,
        is_list=True,
    )

    if environments is not None:
        return environments

    if is_ee():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_APPLICATIONS,
        )
        if not has_permission:
            error_msg = "You do not have access to perform this action. Please contact your organization admin."
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    env_adapter = get_legacy_environments_adapter()
    env_dicts = await env_adapter.list_environments(
        project_id=UUID(request.state.project_id),
        app_id=UUID(app_id),
    )

    fixed_order = ["development", "staging", "production"]

    sorted_env_dicts = sorted(
        env_dicts, key=lambda env: (fixed_order + [env["name"]]).index(env["name"])
    )

    environments = [EnvironmentOutput(**env) for env in sorted_env_dicts]

    await set_cache(
        project_id=request.state.project_id,
        namespace="list_environments",
        key=cache_key,
        value=environments,
    )

    return environments


@router.get(
    "/{app_id}/revisions/{environment_name}/",
    operation_id="environment_revisions",
    response_model=EnvironmentOutputExtended,
)
async def list_app_environment_revisions(
    request: Request,
    app_id: str,
    environment_name,
):
    if is_ee():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_APPLICATIONS,
        )
        if not has_permission:
            error_msg = "You do not have access to perform this action. Please contact your organization admin."
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    env_adapter = get_legacy_environments_adapter()
    result = await env_adapter.list_environment_revisions(
        project_id=UUID(request.state.project_id),
        app_id=UUID(app_id),
        environment_name=environment_name,
    )
    if result is None:
        return JSONResponse({"detail": "App environment not found"}, status_code=404)

    return EnvironmentOutputExtended(**result)
