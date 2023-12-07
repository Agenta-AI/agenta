import os
import logging
from typing import List, Optional

from fastapi.responses import JSONResponse
from fastapi import APIRouter, HTTPException, Request

from agenta_backend.config import settings
from agenta_backend.services.selectors import get_user_own_org
from agenta_backend.services import (
    app_manager,
    db_manager,
)
from agenta_backend.utils.common import (
    check_access_to_app,
    check_user_org_access,
)
from agenta_backend.models.api.api_models import (
    App,
    CreateApp,
    CreateAppOutput,
    CreateAppVariant,
    AppVariantOutput,
    AddVariantFromImagePayload,
    EnvironmentOutput,
    Image,
)
from agenta_backend.models import converters

from docker.errors import DockerException


if os.environ["FEATURE_FLAG"] in ["cloud", "ee"]:
    from agenta_backend.commons.services.selectors import (
        get_user_and_org_id,
    )  # noqa pylint: disable-all
else:
    from agenta_backend.services.selectors import get_user_and_org_id

if os.environ["FEATURE_FLAG"] in ["cloud"]:
    from agenta_backend.cloud.services import (
        lambda_deployment_manager as deployment_manager,
    )  # noqa pylint: disable-all
elif os.environ["FEATURE_FLAG"] in ["ee"]:
    from agenta_backend.ee.services import (
        deployment_manager,
    )  # noqa pylint: disable-all
else:
    from agenta_backend.services import deployment_manager

router = APIRouter()
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


@router.get("/{app_id}/variants/", response_model=List[AppVariantOutput])
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
        List[AppVariantOutput]: A list of app variants for the given app ID.
    """
    try:
        user_org_data: dict = await get_user_and_org_id(request.state.user_id)

        access_app = await check_access_to_app(
            user_org_data=user_org_data, app_id=app_id
        )
        if not access_app:
            error_msg = f"You cannot access app: {app_id}"
            logger.error(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )

        app_variants = await db_manager.list_app_variants(
            app_id=app_id, **user_org_data
        )
        return [
            await converters.app_variant_db_to_output(app_variant)
            for app_variant in app_variants
        ]

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/get_variant_by_env/", response_model=AppVariantOutput)
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
        AppVariantOutput: The retrieved app variant.
    """
    try:
        # Retrieve the user and organization ID based on the session token
        user_org_data = await get_user_and_org_id(request.state.user_id)
        await check_access_to_app(user_org_data, app_id=app_id)

        # Fetch the app variant using the provided app_id and environment
        app_variant_db = await db_manager.get_app_variant_by_app_name_and_environment(
            app_id=app_id, environment=environment, **user_org_data
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
    except Exception as e:
        # Handle all other exceptions and return 500 status code
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/", response_model=CreateAppOutput)
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
    try:
        user_org_data: dict = await get_user_and_org_id(request.state.user_id)
        if payload.organization_id:
            access = await check_user_org_access(user_org_data, payload.organization_id)
            if not access:
                raise HTTPException(
                    status_code=403,
                    detail="You do not have permission to access this app",
                )
            organization_id = payload.organization_id
        else:
            # Retrieve or create user organization
            organization = await get_user_own_org(user_org_data["uid"])
            if organization is None:  # TODO: Check whether we need this
                logger.error("Organization for user not found.")
                organization = await db_manager.create_user_organization(
                    user_org_data["uid"]
                )
            organization_id = str(organization.id)

        app_db = await db_manager.create_app_and_envs(
            payload.app_name, organization_id, **user_org_data
        )
        return CreateAppOutput(app_id=str(app_db.id), app_name=str(app_db.app_name))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/", response_model=List[App])
async def list_apps(
    request: Request,
    app_name: Optional[str] = None,
    org_id: Optional[str] = None,
) -> List[App]:
    """
    Retrieve a list of apps filtered by app_name and org_id.

    Args:
        app_name (Optional[str]): The name of the app to filter by.
        org_id (Optional[str]): The ID of the organization to filter by.
        stoken_session (SessionContainer): The session container.

    Returns:
        List[App]: A list of apps filtered by app_name and org_id.

    Raises:
        HTTPException: If there was an error retrieving the list of apps.
    """
    try:
        user_org_data: dict = await get_user_and_org_id(request.state.user_id)
        apps = await db_manager.list_apps(app_name, org_id, **user_org_data)
        return apps
    except Exception as e:
        logger.error(f"list_apps exception ===> {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{app_id}/variant/from-image/")
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
        stoken_session (SessionContainer, optional): The session container. Defaults to Depends(verify_session()).

    Raises:
        HTTPException: If the feature flag is set to "demo" or if the image does not have a tag starting with the registry name (agenta-server) or if the image is not found or if the user does not have access to the app.

    Returns:
        dict: The newly added variant.
    """

    if os.environ["FEATURE_FLAG"] not in ["cloud", "ee"]:
        image = Image(
            type="image",
            docker_id=payload.docker_id,
            tags=payload.tags,
        )
        if not payload.tags.startswith(settings.registry):
            raise HTTPException(
                status_code=500,
                detail="Image should have a tag starting with the registry name (agenta-server)",
            )
        elif await deployment_manager.validate_image(image) is False:
            raise HTTPException(status_code=404, detail="Image not found")

    try:
        user_org_data: dict = await get_user_and_org_id(request.state.user_id)
        access_app = await check_access_to_app(user_org_data, app_id=app_id)
        if not access_app:
            error_msg = f"You cannot access app: {app_id}"
            logger.error(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=403,
            )
        app = await db_manager.fetch_app_by_id(app_id)

        app_variant_db = await app_manager.add_variant_based_on_image(
            app=app,
            variant_name=payload.variant_name,
            docker_id_or_template_uri=payload.docker_id,
            tags=payload.tags,
            base_name=payload.base_name,
            config_name=payload.config_name,
            is_template_image=False,
            **user_org_data,
        )
        return await converters.app_variant_db_to_output(app_variant_db)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{app_id}/")
async def remove_app(app_id: str, request: Request):
    """Remove app, all its variant, containers and images

    Arguments:
        app -- App to remove
    """
    try:
        user_org_data: dict = await get_user_and_org_id(request.state.user_id)
        access_app = await check_access_to_app(
            user_org_data, app_id=app_id, check_owner=True
        )

        if not access_app:
            error_msg = f"You do not have permission to delete app: {app_id}"
            logger.error(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=400,
            )
        else:
            await app_manager.remove_app(app_id=app_id, **user_org_data)
    except DockerException as e:
        detail = f"Docker error while trying to remove the app: {str(e)}"
        raise HTTPException(status_code=500, detail=detail)
    except Exception as e:
        detail = f"Unexpected error while trying to remove the app: {str(e)}"
        raise HTTPException(status_code=500, detail=detail)


@router.post("/app_and_variant_from_template/")
async def create_app_and_variant_from_template(
    payload: CreateAppVariant,
    request: Request,
) -> AppVariantOutput:
    """
    Create an app and variant from a template.

    Args:
        payload (CreateAppVariant): The payload containing the app and variant information.
        stoken_session (SessionContainer, optional): The session container. Defaults to Depends(verify_session()).

    Raises:
        HTTPException: If the user has reached the app limit or if an app with the same name already exists.

    Returns:
        AppVariantOutput: The output of the created app variant.
    """
    try:
        logger.debug("Start: Creating app and variant from template")

        # Get user and org id
        logger.debug("Step 1: Getting user and organization ID")
        user_org_data: dict = await get_user_and_org_id(request.state.user_id)

        logger.debug("Step 2: Setting organization ID")
        if payload.organization_id is None:
            organization = await get_user_own_org(user_org_data["uid"])
            organization_id = organization.id
        else:
            organization_id = payload.organization_id

        logger.debug(f"Step 3 Checking if app {payload.app_name} already exists")
        app_name = payload.app_name.lower()
        app = await db_manager.fetch_app_by_name_and_organization(
            app_name, organization_id, **user_org_data
        )
        if app is not None:
            raise HTTPException(
                status_code=400,
                detail=f"App with name {app_name} already exists",
            )

        logger.debug("Step 4: Creating new app and initializing environments")
        if app is None:
            app = await db_manager.create_app_and_envs(
                app_name, organization_id, **user_org_data
            )

        logger.debug("Step 5: Retrieve template from db")
        template_db = await db_manager.get_template(payload.template_id)
        repo_name = os.environ.get("AGENTA_TEMPLATE_REPO", "agentaai/templates_v2")
        image_name = f"{repo_name}:{template_db.name}"

        logger.debug(
            "Step 6: Creating image instance and adding variant based on image"
        )
        app_variant_db = await app_manager.add_variant_based_on_image(
            app=app,
            variant_name="app.default",
            docker_id_or_template_uri=template_db.template_uri
            if os.environ["FEATURE_FLAG"] in ["cloud", "ee"]
            else template_db.digest,
            tags=f"{image_name}"
            if os.environ["FEATURE_FLAG"] not in ["cloud", "ee"]
            else None,
            base_name="app",
            config_name="default",
            is_template_image=True,
            **user_org_data,
        )

        logger.debug("Step 7: Creating testset for app variant")
        await db_manager.add_testset_to_app_variant(
            app_id=str(app.id),
            org_id=organization_id,
            template_name=template_db.name,
            app_name=app.app_name,
            **user_org_data,
        )

        logger.debug("Step 8: Starting variant and injecting environment variables")
        if os.environ["FEATURE_FLAG"] in ["cloud", "ee"]:
            if not os.environ["OPENAI_API_KEY"]:
                raise HTTPException(
                    status_code=400,
                    detail="Unable to start app container. Please file an issue by clicking on the button below.",
                )
            envvars = {
                **(payload.env_vars or {}),
                "OPENAI_API_KEY": os.environ[
                    "OPENAI_API_KEY"
                ],  # order is important here
            }
        else:
            envvars = {} if payload.env_vars is None else payload.env_vars

        await app_manager.start_variant(app_variant_db, envvars, **user_org_data)

        logger.debug("End: Successfully created app and variant")
        return await converters.app_variant_db_to_output(app_variant_db)

    except Exception as e:
        logger.debug(f"Error: Exception caught - {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{app_id}/environments/", response_model=List[EnvironmentOutput])
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
    try:
        logger.debug("get user and org data")
        user_and_org_data: dict = await get_user_and_org_id(request.state.user_id)

        # Check if has app access
        logger.debug("check_access_to_app")
        access_app = await check_access_to_app(
            user_org_data=user_and_org_data, app_id=app_id
        )
        logger.debug(f"access_app: {access_app}")
        if not access_app:
            error_msg = f"You do not have access to this app: {app_id}"
            return JSONResponse(
                {"detail": error_msg},
                status_code=400,
            )
        else:
            environments_db = await db_manager.list_environments(
                app_id=app_id, **user_and_org_data
            )
            logger.debug(f"environments_db: {environments_db}")
            return [
                await converters.environment_db_to_output(env)
                for env in environments_db
            ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
