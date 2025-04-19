import os
from typing import List, Optional

from fastapi.responses import JSONResponse
from fastapi import HTTPException, Request

from oss.src.utils.logging import get_module_logger
from oss.src.models import converters
from oss.src.utils.common import APIRouter, is_ee
from oss.src.services import db_manager, app_manager
from oss.src.models.api.api_models import (
    App,
    UpdateApp,
    UpdateAppOutput,
    CreateAppOutput,
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
        check_apikey_action_access,
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

log = get_module_logger(__file__)

registry_repo_name = os.environ.get("REGISTRY_REPO_NAME")


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

    app = await db_manager.get_app_instance_by_id(app_id=app_id)
    if is_ee():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=str(app.project_id),
            permission=Permission.VIEW_APPLICATION,
        )
        if not has_permission:
            error_msg = f"You do not have access to perform this action. Please contact your organization admin."
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    app_variants = await db_manager.list_app_variants(app_id=app_id)
    return [
        await converters.app_variant_db_to_output(app_variant)
        for app_variant in app_variants
    ]


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
        app = await db_manager.get_app_instance_by_id(app_id=app_id)
        if is_ee():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                project_id=str(app.project_id),
                permission=Permission.VIEW_APPLICATION,
            )
            if not has_permission:
                error_msg = f"You do not have access to perform this action. Please contact your organization admin."
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=403,
                )

        # Fetch the app variant using the provided app_id and environment
        app_variant_db = await db_manager.get_app_variant_by_app_name_and_environment(
            app_id=app_id, environment=environment
        )

        # Check if the fetched app variant is None and raise exception if it is
        if app_variant_db is None:
            raise HTTPException(status_code=500, detail="App Variant not found")
        return await converters.app_variant_db_to_output(app_variant_db)
    except ValueError as e:
        # Handle ValueErrors and return 400 status code
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
        api_key_from_headers = request.headers.get("Authorization", None)
        if api_key_from_headers is not None:
            api_key = api_key_from_headers.split(" ")[-1]  # ["ApiKey", "xxxxx.xxxxxx"]
            await check_apikey_action_access(
                api_key,
                request.state.user_id,
                Permission.CREATE_APPLICATION,
            )

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
                permission=Permission.CREATE_APPLICATION,
            )
            if not has_permission:
                error_msg = f"You do not have access to perform this action. Please contact your organization admin."
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=403,
                )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

        if db_manager.get_app_type(payload.template_key) == AppType.CUSTOM:
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

    try:
        app_db = await db_manager.create_app_and_envs(
            payload.app_name,
            project_id=request.state.project_id,
            template_key=payload.template_key,
        )
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="App with the same name already exists",
        )

    return CreateAppOutput(app_id=str(app_db.id), app_name=str(app_db.app_name))


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

    try:
        app = await db_manager.fetch_app_by_id(app_id)
    except db_manager.NoResultFound:
        raise HTTPException(
            status_code=404, detail=f"No application with ID '{app_id}' found"
        )

    if is_ee():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=str(app.project_id),
            permission=Permission.EDIT_APPLICATION,
        )
        if not has_permission:
            error_msg = f"You do not have access to perform this action. Please contact your organization admin."
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )
    await db_manager.update_app(app_id=app_id, values_to_update=payload.model_dump())
    return UpdateAppOutput(app_id=app_id, app_name=payload.app_name)


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
        user_org_workspace_data = await get_user_org_and_workspace_id(request.state.user_id)  # type: ignore
        has_permission = await check_rbac_permission(  # type: ignore
            user_org_workspace_data=user_org_workspace_data,
            project_id=request.state.project_id,
            permission=Permission.VIEW_APPLICATION,  # type: ignore
        )
        if not has_permission:
            raise HTTPException(
                status_code=403,
                detail="You do not have access to perform this action. Please contact your organization admin.",
            )

    apps = await db_manager.list_apps(
        project_id=request.state.project_id,
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

    try:
        app = await db_manager.fetch_app_by_id(app_id=app_id)
    except db_manager.NoResultFound:
        raise HTTPException(
            status_code=404, detail=f"No application with ID '{app_id}' found"
        )

    try:
        if is_ee():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                project_id=str(app.project_id),
                permission=Permission.CREATE_APPLICATION,
            )
            if not has_permission:
                error_msg = f"You do not have access to perform this action. Please contact your organization admin."
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=403,
                )

        variant_db = await app_manager.add_variant_from_url(
            app=app,
            project_id=str(app.project_id),
            variant_name=payload.variant_name,
            url=payload.url,
            base_name=payload.base_name,
            config_name=payload.config_name,
            user_uid=request.state.user_id,
            commit_message=payload.commit_message,
        )

        app_variant_db = await db_manager.fetch_app_variant_by_id(
            str(variant_db.id),
        )

        app_variant_dto = await converters.app_variant_db_to_output(
            app_variant_db,
        )

        return app_variant_dto

    except Exception as e:
        log.exception(f"An error occurred: {str(e)}")
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
        log.exception(f"An error occurred: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

    except Exception as e:
        log.exception(f"An error occurred: {str(e)}")
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

    try:
        app = await db_manager.fetch_app_by_id(app_id)
    except db_manager.NoResultFound:
        raise HTTPException(
            status_code=404, detail=f"No application with ID '{app_id}' found"
        )

    if is_ee():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=str(app.project_id),
            permission=Permission.DELETE_APPLICATION,
        )
        if not has_permission:
            error_msg = f"You do not have access to perform this action. Please contact your organization admin."
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

        check, _, _ = await check_entitlements(
            organization_id=request.state.organization_id,
            key=Gauge.APPLICATIONS,
            delta=-1,
        )

    await app_manager.remove_app(app)


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

    if is_ee():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_APPLICATION,
        )
        if not has_permission:
            error_msg = f"You do not have access to perform this action. Please contact your organization admin."
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    environments_db = await db_manager.list_environments(
        app_id=app_id, project_id=request.state.project_id
    )

    fixed_order = ["development", "staging", "production"]

    sorted_environments = sorted(
        environments_db, key=lambda env: (fixed_order + [env.name]).index(env.name)
    )

    return [
        await converters.environment_db_to_output(env) for env in sorted_environments
    ]


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
            permission=Permission.VIEW_APPLICATION,
        )
        if not has_permission:
            error_msg = f"You do not have access to perform this action. Please contact your organization admin."
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    app_environment = await db_manager.fetch_app_environment_by_name_and_appid(
        app_id,
        environment_name,
    )
    if app_environment is None:
        return JSONResponse({"detail": "App environment not found"}, status_code=404)

    app_environment_revisions = (
        await db_manager.fetch_environment_revisions_for_environment(app_environment)
    )
    if app_environment_revisions is None:
        return JSONResponse(
            {"detail": "No revisions found for app environment"}, status_code=404
        )

    return await converters.environment_db_and_revision_to_extended_output(
        app_environment, app_environment_revisions
    )
