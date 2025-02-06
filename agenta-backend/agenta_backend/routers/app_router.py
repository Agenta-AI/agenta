import os
import logging

from typing import List, Optional
from docker.errors import DockerException

from fastapi.responses import JSONResponse
from fastapi import HTTPException, Request

from agenta_backend.models import converters
from agenta_backend.utils.common import (
    isEE,
    isCloudProd,
    isCloudDev,
    APIRouter,
    isCloudEE,
)

from agenta_backend.services import (
    db_manager,
    app_manager,
    evaluator_manager,
)
from agenta_backend.models.api.api_models import (
    App,
    UpdateApp,
    UpdateAppOutput,
    CreateAppOutput,
    AddVariantFromImagePayload,
    AddVariantFromURLPayload,
    AddVariantFromKeyPayload,
)

if isCloudEE():
    from agenta_backend.commons.models.api.api_models import (
        Image_ as Image,
        CreateApp_ as CreateApp,
        AppVariantResponse_ as AppVariantResponse,
        CreateAppVariant_ as CreateAppVariant,
        EnvironmentOutput_ as EnvironmentOutput,
        EnvironmentOutputExtended_ as EnvironmentOutputExtended,
    )
else:
    from agenta_backend.models.api.api_models import (
        Image,
        CreateApp,
        AppVariantResponse,
        CreateAppVariant,
        EnvironmentOutput,
        EnvironmentOutputExtended,
    )
if isCloudEE():
    from agenta_backend.commons.services import db_manager_ee
    from agenta_backend.commons.services.selectors import (
        get_user_org_and_workspace_id,
    )  # noqa pylint: disable-all
    from agenta_backend.commons.utils.permissions import (
        check_action_access,
        check_rbac_permission,
        check_apikey_action_access,
    )
    from agenta_backend.commons.models.shared_models import Permission


if isCloudProd():
    from agenta_backend.cloud.services import (
        lambda_deployment_manager as deployment_manager,
    )  # noqa pylint: disable-all
elif isCloudDev():
    from agenta_backend.services import deployment_manager
elif isEE():
    from agenta_backend.ee.services import (
        deployment_manager,
    )  # noqa pylint: disable-all
else:
    from agenta_backend.services import deployment_manager

router = APIRouter()
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

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
        stoken_session (SessionContainer, optional): The session container to verify the user's session. Defaults to Depends(verify_session()).

    Returns:
        List[AppVariantResponse]: A list of app variants for the given app ID.
    """

    app = await db_manager.get_app_instance_by_id(app_id=app_id)
    if isCloudEE():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=str(app.project_id),
            permission=Permission.VIEW_APPLICATION,
        )
        logger.debug(f"User has Permission to list app variants: {has_permission}")
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
        stoken_session (SessionContainer, optional): The session token container. Defaults to Depends(verify_session()).

    Raises:
        HTTPException: If the app variant is not found (status_code=500), or if a ValueError is raised (status_code=400), or if any other exception is raised (status_code=500).

    Returns:
        AppVariantResponse: The retrieved app variant.
    """
    try:
        app = await db_manager.get_app_instance_by_id(app_id=app_id)
        if isCloudEE():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                project_id=str(app.project_id),
                permission=Permission.VIEW_APPLICATION,
            )
            logger.debug(
                f"user has Permission to get variant by environment: {has_permission}"
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
        stoken_session (SessionContainer): The session container containing the user's session token.

    Returns:
        CreateAppOutput: The output containing the newly created app's ID and name.

    Raises:
        HTTPException: If there is an error creating the app or the user does not have permission to access the app.
    """

    if isCloudEE():
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
            logger.debug(f"User has Permission to Create Application: {has_permission}")
            if not has_permission:
                error_msg = f"You do not have access to perform this action. Please contact your organization admin."
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=403,
                )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

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
        stoken_session (SessionContainer): The session container containing the user's session token.

    Returns:
        UpdateAppOuput: The output containing the newly created app's ID and name.

    Raises:
        HTTPException: If there is an error creating the app or the user does not have permission to access the app.
    """

    try:
        app = await db_manager.fetch_app_by_id(app_id)
    except db_manager.NoResultFound:
        raise HTTPException(
            status_code=404, detail=f"No application with ID '{app_id}' found"
        )

    if isCloudEE():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=str(app.project_id),
            permission=Permission.EDIT_APPLICATION,
        )
        logger.debug(f"User has Permission to update app: {has_permission}")
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
        stoken_session (SessionContainer): The session container.

    Returns:
        List[App]: A list of apps filtered by app_name.

    Raises:
        HTTPException: If there was an error retrieving the list of apps.
    """

    if isCloudEE():
        user_org_workspace_data = await get_user_org_and_workspace_id(request.state.user_id)  # type: ignore
        has_permission = await check_rbac_permission(  # type: ignore
            user_org_workspace_data=user_org_workspace_data,
            project_id=request.state.project_id,
            permission=Permission.VIEW_APPLICATION,  # type: ignore
        )
        logger.debug(f"User has Permission to list apps: {has_permission}")
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


@router.post("/{app_id}/variant/from-image/", operation_id="add_variant_from_image")
async def add_variant_from_image(
    app_id: str,
    payload: AddVariantFromImagePayload,
    request: Request,
):
    """
    Add a new variant to an app based on a Docker image.

    Args:
        app_id (str): The ID of the app to add the variant to.
        payload (AddVariantFromImagePayload): The payload containing information about the variant to add.

    Raises:
        HTTPException: If the feature flag is set to "demo" or if the image does not have a tag starting with the registry name (agenta-server) or if the image is not found or if the user does not have access to the app.

    Returns:
        dict: The newly added variant.
    """

    if not isCloudEE():
        image = Image(
            type="image",
            docker_id=payload.docker_id,
            tags=payload.tags,
        )
        if not payload.tags.startswith(registry_repo_name):
            raise HTTPException(
                status_code=500,
                detail="Image should have a tag starting with the registry name (agenta-server)",
            )
        elif await deployment_manager.validate_image(image) is False:
            raise HTTPException(status_code=404, detail="Image not found")

    try:
        app = await db_manager.fetch_app_by_id(app_id)
    except db_manager.NoResultFound:
        raise HTTPException(
            status_code=404, detail=f"No application with ID '{app_id}' found"
        )

    if isCloudEE():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=str(app.project_id),
            permission=Permission.CREATE_APPLICATION,
        )
        logger.debug(f"User has Permission to create app from image: {has_permission}")
        if not has_permission:
            error_msg = f"You do not have access to perform this action. Please contact your organization admin."
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    variant_db = await app_manager.add_variant_from_image(
        app=app,
        project_id=str(app.project_id),
        variant_name=payload.variant_name,
        docker_id_or_template_uri=payload.docker_id,
        tags=payload.tags,
        base_name=payload.base_name,
        config_name=payload.config_name,
        is_template_image=False,
        user_uid=request.state.user_id,
    )
    app_variant_db = await db_manager.fetch_app_variant_by_id(str(variant_db.id))

    return await converters.app_variant_db_to_output(app_variant_db)


@router.post("/{app_id}/variant/from-service/", operation_id="add_variant_from_url")
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
        app = await db_manager.fetch_app_by_id(app_id)
    except db_manager.NoResultFound:
        raise HTTPException(
            status_code=404, detail=f"No application with ID '{app_id}' found"
        )

    try:
        if isCloudEE():
            has_permission = await check_action_access(
                user_uid=request.state.user_id,
                project_id=str(app.project_id),
                permission=Permission.CREATE_APPLICATION,
            )
            logger.debug(
                f"User has Permission to create app from url: {has_permission}"
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
        )

        app_variant_db = await db_manager.fetch_app_variant_by_id(
            str(variant_db.id),
        )

        app_variant_dto = await converters.app_variant_db_to_output(
            app_variant_db,
        )

        return app_variant_dto

    except Exception as e:
        logger.exception(f"An error occurred: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{app_id}/variant/from-template/", operation_id="add_variant_from_key")
async def add_variant_from_key(
    app_id: str,
    payload: AddVariantFromKeyPayload,
    request: Request,
):
    try:
        url = app_manager.get_service_url_from_template_key(payload.key)

    except NotImplementedError as e:
        logger.exception(f"An error occurred: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

    except Exception as e:
        logger.exception(f"An error occurred: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

    if not url:
        raise HTTPException(status_code=400, detail="Service key not supported")

    payload = AddVariantFromURLPayload(
        variant_name=payload.variant_name,
        url=url,
        base_name=payload.base_name,
        config_name=payload.config_name,
    )

    return await add_variant_from_url(app_id, payload, request)


@router.delete("/{app_id}/", operation_id="remove_app")
async def remove_app(
    app_id: str,
    request: Request,
):
    """Remove app, all its variant, containers and images

    Arguments:
        app -- App to remove
    """

    try:
        app = await db_manager.fetch_app_by_id(app_id)
    except db_manager.NoResultFound:
        raise HTTPException(
            status_code=404, detail=f"No application with ID '{app_id}' found"
        )

    if isCloudEE():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=str(app.project_id),
            permission=Permission.DELETE_APPLICATION,
        )
        logger.debug(f"User has Permission to delete app: {has_permission}")
        if not has_permission:
            error_msg = f"You do not have access to perform this action. Please contact your organization admin."
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    await app_manager.remove_app(app)


@router.post(
    "/app_and_variant_from_template/",
    operation_id="create_app_and_variant_from_template",
)
async def create_app_and_variant_from_template(
    payload: CreateAppVariant,
    request: Request,
) -> AppVariantResponse:
    """
    Create an app and variant from a template.

    Args:
        payload (CreateAppVariant): The payload containing the app and variant information.
        stoken_session (SessionContainer, optional): The session container. Defaults to Depends(verify_session()).

    Raises:
        HTTPException: If the user has reached the app limit or if an app with the same name already exists.

    Returns:
        AppVariantResponse: The output of the created app variant.
    """

    logger.debug("Start: Creating app and variant from template")

    if isCloudEE():
        # Get user and org id
        logger.debug("Step 1: Getting user and organization ID")
        user_org_workspace_data: dict = await get_user_org_and_workspace_id(
            request.state.user_id
        )

        logger.debug("Step 2: Checking that Project ID is provided")
        if request.state.project_id is None:
            raise Exception(
                "Project ID must be provided to create app from template",
            )

        logger.debug("Step 3: Checking user has permission to create app")
        has_permission = await check_rbac_permission(
            user_org_workspace_data=user_org_workspace_data,
            project_id=request.state.project_id,
            permission=Permission.CREATE_APPLICATION,
        )
        logger.debug(
            f"User has Permission to create app from template: {has_permission}"
        )
        if not has_permission:
            error_msg = f"You do not have permission to perform this action. Please contact your organization admin."
            logger.error(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    logger.debug(
        f"Step 4: Checking if app {payload.app_name} already exists"
        if isCloudEE()
        else f"Step 1: Checking if app {payload.app_name} already exists"
    )
    app_name = payload.app_name.lower()
    app = await db_manager.fetch_app_by_name_and_parameters(
        app_name,
        project_id=request.state.project_id,
    )
    if app is not None:
        raise Exception(
            f"App with name {app_name} already exists",
        )

    logger.debug(
        "Step 5: Retrieve template from db"
        if isCloudEE()
        else "Step 2: Retrieve template from db"
    )
    template_db = await db_manager.get_template(payload.template_id)

    logger.debug(
        "Step 6: Creating new app and initializing environments"
        if isCloudEE()
        else "Step 3: Creating new app and initializing environments"
    )
    if app is None:
        try:
            app = await db_manager.create_app_and_envs(
                app_name=app_name,
                template_id=str(template_db.id),
                project_id=request.state.project_id,
            )
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail="App with the same name already exists",
            )

    logger.debug(
        "Step 7: Creating image instance and adding variant based on image"
        if isCloudEE()
        else "Step 4: Creating image instance and adding variant based on image"
    )
    repo_name = os.environ.get("AGENTA_TEMPLATE_REPO", "agentaai/templates_v2")
    image_name = f"{repo_name}:{template_db.name}"
    app_variant_db = await app_manager.add_variant_based_on_image(
        app=app,
        project_id=str(app.project_id),
        variant_name="app.default",
        docker_id_or_template_uri=(  # type: ignore
            template_db.template_uri if isCloudProd() else template_db.digest
        ),
        tags=f"{image_name}" if not isCloudProd() else None,  # type: ignore
        base_name="app",
        config_name="default",
        is_template_image=True,
        user_uid=request.state.user_id,
    )

    logger.debug(
        "Step 8: Starting variant and injecting environment variables"
        if isCloudEE()
        else "Step 5: Starting variant and injecting environment variables"
    )

    envvars = {}
    if isCloudEE():
        supported_llm_prodviders_keys = [
            "OPENAI_API_KEY",
            "MISTRAL_API_KEY",
            "COHERE_API_KEY",
            "ANTHROPIC_API_KEY",
            "ANYSCALE_API_KEY",
            "PERPLEXITYAI_API_KEY",
            "DEEPINFRA_API_KEY",
            "TOGETHERAI_API_KEY",
            "ALEPHALPHA_API_KEY",
            "OPENROUTER_API_KEY",
            "GROQ_API_KEY",
            "GEMINI_API_KEY",
        ]

        missing_keys = [
            key for key in supported_llm_prodviders_keys if not os.environ.get(key)
        ]

        if missing_keys:
            missing_keys_str = ", ".join(missing_keys)
            raise Exception(
                f"Unable to start app container. The following environment variables are missing: {missing_keys_str}. Please file an issue by clicking on the button below."
            )

        if not isCloudEE():
            envvars = {**(payload.env_vars or {})}

        for key in supported_llm_prodviders_keys:
            if not envvars.get(key):
                envvars[key] = os.environ[key]

    else:
        envvars = {} if payload.env_vars is None else payload.env_vars

    await app_manager.start_variant(
        app_variant_db,
        str(app.project_id),
        envvars,
        user_uid=request.state.user_id,
    )

    logger.debug("End: Successfully created app and variant")
    return await converters.app_variant_db_to_output(app_variant_db)


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
        stoken_session (SessionContainer, optional): The session container. Defaults to Depends(verify_session()).

    Returns:
        List[EnvironmentOutput]: A list of environment objects.
    """

    logger.debug(f"Listing environments for app: {app_id}")
    if isCloudEE():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_APPLICATION,
        )
        logger.debug(f"User has Permission to list environments: {has_permission}")
        if not has_permission:
            error_msg = f"You do not have access to perform this action. Please contact your organization admin."
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    environments_db = await db_manager.list_environments(
        app_id=app_id, project_id=request.state.project_id
    )
    logger.debug(f"environments_db: {environments_db}")

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
    logger.debug("getting environment " + environment_name)
    user_org_workspace_data: dict = await get_user_org_and_workspace_id(
        request.state.user_id
    )
    if isCloudEE():
        has_permission = await check_action_access(
            user_uid=request.state.user_id,
            project_id=request.state.project_id,
            permission=Permission.VIEW_APPLICATION,
        )
        logger.debug(f"User has Permission to list environments: {has_permission}")
        if not has_permission:
            error_msg = f"You do not have access to perform this action. Please contact your organization admin."
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

    app_environment = await db_manager.fetch_app_environment_by_name_and_appid(
        app_id, environment_name, **user_org_workspace_data
    )
    if app_environment is None:
        return JSONResponse({"detail": "App environment not found"}, status_code=404)

    app_environment_revisions = (
        await db_manager.fetch_environment_revisions_for_environment(
            app_environment, **user_org_workspace_data
        )
    )
    if app_environment_revisions is None:
        return JSONResponse(
            {"detail": "No revisions found for app environment"}, status_code=404
        )

    return await converters.environment_db_and_revision_to_extended_output(
        app_environment, app_environment_revisions
    )
