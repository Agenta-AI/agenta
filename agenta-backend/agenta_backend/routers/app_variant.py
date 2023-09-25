"""Routes for image-related operations (push, remove).
Does not deal with the instanciation of the images
"""

import os
import logging
from docker.errors import DockerException
from sqlalchemy.exc import SQLAlchemyError
from fastapi.responses import JSONResponse
from agenta_backend.config import settings
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Body, HTTPException, Depends
from agenta_backend.services.selectors import get_user_own_org
from agenta_backend.services import app_manager, db_manager, docker_utils, new_db_manager, new_app_manager
from agenta_backend.utills.common import check_access_to_app, get_app_instance

from agenta_backend.models.api.api_models import (
    URI,
    App,
    AppVariant,
    Image,
    DockerEnvVars,
    CreateAppVariant,
    AddVariantFromPreviousPayload,
)
from agenta_backend.models.db_models import (
    AppDB,
    AppVariantDB,
    EnvironmentDB,
    ImageDB,
    TemplateDB,
    UserDB,
    OrganizationDB,
    BaseDB,
    ConfigDB,
)


if os.environ["FEATURE_FLAG"] in ["cloud", "ee", "demo"]:
    from agenta_backend.ee.services.auth_helper import (
        SessionContainer,
        verify_session,
    )
    from agenta_backend.ee.services.selectors import get_user_and_org_id
else:
    from agenta_backend.services.auth_helper import (
        SessionContainer,
        verify_session,
    )
    from agenta_backend.services.selectors import get_user_and_org_id

router = APIRouter()
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


@router.get("/list_variants/", response_model=List[AppVariant])
async def list_app_variants(
    app_name: Optional[str] = None,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    """Lists the app variants from our repository.

    Arguments:
        app_name -- If specified, only returns the app variants for the specified app
    Raises:
        HTTPException: _description_

    Returns:
        List[AppVariant]
    """

    try:
        kwargs: dict = await get_user_and_org_id(stoken_session)

        if app_name is not None:
            access_app = await check_access_to_app(kwargs, app_name=app_name)

            if not access_app:
                error_msg = f"You cannot access app: {app_name}"
                logger.error(error_msg)
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=400,
                )

        app_variants = await db_manager.list_app_variants(app_name=app_name, **kwargs)
        return app_variants

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/get_variant_by_name/", response_model=AppVariant)
async def get_variant_by_name(
    app_name: str,
    variant_name: str,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    """Fetches a specific app variant based on the given app_name and variant_name.

    Arguments:
        app_name (str): The name of the app to query.
        variant_name (str): The name of the variant to query.

    Raises:
        HTTPException: Raises 404 if no matching variant is found,
                       400 for ValueError, or 500 for any other exceptions.

    Returns:
        AppVariant: The fetched app variant.
    """

    try:
        # Retrieve the user and organization ID based on the session token
        kwargs = await get_user_and_org_id(stoken_session)

        # Fetch the app variant using the provided app_name and variant_name
        app_variant = await db_manager.get_app_variant_by_app_name_and_variant_name(
            app_name=app_name, variant_name=variant_name, **kwargs
        )
        # Check if the fetched app variant is None and raise 404 if it is
        if app_variant is None:
            raise HTTPException(status_code=500, detail="App Variant not found")
        return app_variant
    except ValueError as e:
        # Handle ValueErrors and return 400 status code
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException as e:
        raise e
    except Exception as e:
        # Handle all other exceptions and return 500 status code
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/get_variant_by_env/", response_model=AppVariant)
async def get_variant_by_env(
    app_name: str,
    environment: str,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    """Fetches a specific app variant based on the given app_name and environment."""

    try:
        # Retrieve the user and organization ID based on the session token
        kwargs = await get_user_and_org_id(stoken_session)

        # Fetch the app variant using the provided app_name and variant_name
        app_variant = await db_manager.get_app_variant_by_app_name_and_environment(
            app_name=app_name, environment=environment, **kwargs
        )
        # Check if the fetched app variant is None and raise 404 if it is
        if app_variant is None:
            raise HTTPException(status_code=500, detail="App Variant not found")
        return app_variant
    except ValueError as e:
        # Handle ValueErrors and return 400 status code
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException as e:
        raise e
    except Exception as e:
        # Handle all other exceptions and return 500 status code
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/list_apps/", response_model=List[App])
async def list_apps(
    org_id: Optional[str] = None,
    stoken_session: SessionContainer = Depends(verify_session()),
) -> List[App]:
    """Lists the apps from our repository.

    Raises:
        HTTPException: _description_

    Returns:
        List[App]
    """
    try:
        kwargs: dict = await get_user_and_org_id(stoken_session)
        apps = await db_manager.list_apps(org_id, **kwargs)
        return apps
    except Exception as e:
        logger.error(f"list_apps exception ===> {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/add/from_image/")
async def add_variant_from_image(
    app_variant: AppVariant,
    image: Image,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    """Add a variant to the server based on an image.

    Arguments:
        app_variant -- AppVariant to add
        image -- The image tags should start with the registry name (agenta-server) and end with :latest

    Raises:
        HTTPException: If image tag doesn't start with registry name
        HTTPException: If image not found in docker utils list
        HTTPException: If there is a problem adding the app variant
    """
    if os.environ["FEATURE_FLAG"] == "demo":
        raise HTTPException(
            status_code=500,
            detail="This feature is not available in the demo version",
        )
    if not image.tags.startswith(settings.registry):
        raise HTTPException(
            status_code=500,
            detail="Image should have a tag starting with the registry name (agenta-server)",
        )
    elif image not in docker_utils.list_images():
        raise HTTPException(status_code=500, detail="Image not found")

    try:
        # Get user and org id
        kwargs: dict = await get_user_and_org_id(stoken_session)

        if app_variant.organization_id is None:
            organization = await get_user_own_org(kwargs["uid"])
            app_variant.organization_id = str(organization.id)

        if image.organization_id is None:
            image.organization_id = str(organization.id)

        await db_manager.add_variant_based_on_image(app_variant, image, **kwargs)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/add/from_previous/")
async def add_variant_from_previous(
    payload: AddVariantFromPreviousPayload,
    stoken_session: SessionContainer = Depends(verify_session()),
) -> AppVariantDB:
    """Add a variant to the server based on a previous variant.

    Arguments:
        app_variant -- AppVariant to add
        previous_app_variant -- Previous AppVariant to use as a base
        parameters -- parameters for the variant

    Raises:
        HTTPException: If there is a problem adding the app variant
    """
    if payload.previous_variant_id is None:
        raise HTTPException(
            status_code=500,
            detail="Previous app variant id is required",
        )
    if payload.new_variant_name is None:
        raise HTTPException(
            status_code=500,
            detail="New variant name is required",
        )
    if payload.parameters is None:
        raise HTTPException(
            status_code=500,
            detail="Parameters are required",
        )

    try:
        app_variant_db = await new_db_manager.fetch_app_variant_by_id(payload.previous_variant_id)
        if app_variant_db is None:
            raise HTTPException(
                status_code=500,
                detail="Previous app variant not found",
            )
        kwargs: dict = await get_user_and_org_id(stoken_session)
        if app_variant_db.organization_id.id not in kwargs["organization_ids"]:
            raise HTTPException(
                status_code=500,
                detail="You do not have permission to access this app variant",
            )

        db_app_variant = await new_db_manager.add_variant_based_on_previous(
            previous_app_variant=app_variant_db,
            new_variant_name=payload.new_variant_name,
            parameters=payload.parameters,
            **kwargs
        )
        return db_app_variant
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/start/")
async def start_variant(
    app_variant: AppVariant,
    env_vars: Optional[DockerEnvVars] = None,
    stoken_session: SessionContainer = Depends(verify_session()),
) -> URI:
    print(f"Starting variant {app_variant}")
    logger.info("Starting variant %s", app_variant)
    try:
        # Get user and org iD
        kwargs: dict = await get_user_and_org_id(stoken_session)

        # Inject env vars to docker container
        if os.environ["FEATURE_FLAG"] == "demo":
            if not os.environ["OPENAI_API_KEY"]:
                raise HTTPException(
                    status_code=400,
                    detail="Unable to start app container. Please file an issue by clicking on the button below.",
                )
            envvars = {
                "OPENAI_API_KEY": os.environ["OPENAI_API_KEY"],
            }
        else:
            envvars = {} if env_vars is None else env_vars.env_vars

        if app_variant.organization_id is None:
            organization = await get_user_own_org(kwargs["uid"])
            app_variant.organization_id = str(organization.id)

        url = await app_manager.start_variant(app_variant, envvars, **kwargs)
        return url
    except Exception as e:
        variant_from_db = await db_manager.get_variant_from_db(app_variant, **kwargs)
        if variant_from_db is not None:
            await app_manager.remove_app_variant(app_variant, **kwargs)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/stop/")
async def stop_variant(app_variant: AppVariant):
    assert NotImplementedError("Not implemented yet")


@router.get("/list_images/", response_model=List[Image])
async def list_images(stoken_session: SessionContainer = Depends(verify_session())):
    """Lists the images from our repository

    Raises:
        HTTPException: _description_

    Returns:
        List[AppVariant]
    """
    try:
        list_images = docker_utils.list_images()
        return list_images
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/remove_variant/")
async def remove_variant(
    app_variant: AppVariant,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    """Remove a variant from the server.
    In the case it's the last variant using the image, stop the container and remove the image.

    Arguments:
        app_variant -- AppVariant to remove

    Raises:
        HTTPException: If there is a problem removing the app variant
    """
    try:
        kwargs: dict = await get_user_and_org_id(stoken_session)

        # Check app access
        access_app = await check_access_to_app(
            kwargs, app_variant=app_variant, check_owner=True
        )

        if not access_app:
            error_msg = f"You do not have permission to delete app variant: {app_variant.variant_name}"
            logger.error(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=400,
            )
        else:
            await app_manager.remove_app_variant(app_variant, **kwargs)
    except SQLAlchemyError as e:
        detail = f"Database error while trying to remove the app variant: {str(e)}"
        raise HTTPException(status_code=500, detail=detail)
    except DockerException as e:
        detail = f"Docker error while trying to remove the app variant: {str(e)}"
        raise HTTPException(status_code=500, detail=detail)
    except Exception as e:
        detail = f"Unexpected error while trying to remove the app variant: {str(e)}"
        raise HTTPException(status_code=500, detail=detail)


@router.delete("/remove_app/")
async def remove_app(
    app: App, stoken_session: SessionContainer = Depends(verify_session())
):
    """Remove app, all its variant, containers and images

    Arguments:
        app -- App to remove
    """

    try:
        kwargs: dict = await get_user_and_org_id(stoken_session)
        access_app = await check_access_to_app(
            kwargs, app_name=app.app_name, check_owner=True
        )

        if not access_app:
            error_msg = f"You do not have permission to delete app: {app.app_name}"
            logger.error(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=400,
            )
        else:
            await app_manager.remove_app(app, **kwargs)
    except SQLAlchemyError as e:
        detail = f"Database error while trying to remove the app: {str(e)}"
        raise HTTPException(status_code=500, detail=detail)
    except DockerException as e:
        detail = f"Docker error while trying to remove the app: {str(e)}"
        raise HTTPException(status_code=500, detail=detail)
    except Exception as e:
        detail = f"Unexpected error while trying to remove the app: {str(e)}"
        raise HTTPException(status_code=500, detail=detail)


@router.put("/update_variant_parameters/")
async def update_variant_parameters(
    app_variant: AppVariant,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    """Updates the parameters for an app variant

    Arguments:
        app_variant -- Appvariant to update
    """

    try:
        kwargs: dict = await get_user_and_org_id(stoken_session)
        if app_variant.organization_id is None:
            app_instance = await get_app_instance(
                app_variant.app_name, app_variant.variant_name
            )
            app_variant.organization_id = str(app_instance.organization_id)

        access_app = await check_access_to_app(kwargs, app_variant=app_variant)

        if not access_app:
            error_msg = f"You do not have permission to update app variant: {app_variant.variant_name}"
            logger.error(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=400,
            )
        else:
            await app_manager.update_variant_parameters(app_variant, **kwargs)
    except ValueError as e:
        detail = f"Error while trying to update the app variant: {str(e)}"
        raise HTTPException(status_code=500, detail=detail)
    except SQLAlchemyError as e:
        detail = f"Database error while trying to update the app variant: {str(e)}"
        raise HTTPException(status_code=500, detail=detail)
    except Exception as e:
        detail = f"Unexpected error while trying to update the app variant: {str(e)}"
        raise HTTPException(status_code=500, detail=detail)


@router.put("/update_variant_image/")
async def update_variant_image(
    app_variant: AppVariant,
    image: Image,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    """Updates the image used in an app variant

    Arguments:
        app_variant -- the app variant to update
        image -- the image information
    """

    try:
        kwargs: dict = await get_user_and_org_id(stoken_session)
        if app_variant.organization_id is None:
            app_instance = await get_app_instance(
                app_variant.app_name, app_variant.variant_name
            )
            app_variant.organization_id = str(app_instance.organization_id)

        if image.organization_id is None:
            image.organization_id = str(app_instance.organization_id.id)

        access_app = await check_access_to_app(kwargs, app_variant=app_variant)

        if not access_app:
            error_msg = f"You do not have permission to make an update"
            logger.error(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=400,
            )
        else:
            await app_manager.update_variant_image(app_variant, image, **kwargs)
    except ValueError as e:
        detail = f"Error while trying to update the app variant: {str(e)}"
        raise HTTPException(status_code=500, detail=detail)
    except SQLAlchemyError as e:
        detail = f"Database error while trying to update the app variant: {str(e)}"
        raise HTTPException(status_code=500, detail=detail)
    except DockerException as e:
        detail = f"Docker error while trying to update the app variant: {str(e)}"
        raise HTTPException(status_code=500, detail=detail)
    except Exception as e:
        detail = f"Unexpected error while trying to update the app variant: {str(e)}"
        raise HTTPException(status_code=500, detail=detail)


@router.post("/add/from_template/")
async def add_app_variant_from_template(
    payload: CreateAppVariant,
    stoken_session: SessionContainer = Depends(verify_session()),
) -> AppVariantDB:
    """Creates or updates an app variant based on the provided image and starts the variant

    Arguments:
        payload -- a data model that contains the necessary information to create an app variant from an image

    Returns:
        a JSON response with a message and data
    """

    # Get user and org id
    kwargs: dict = await get_user_and_org_id(stoken_session)

    # Check if the user has reached app limit
    if os.environ["FEATURE_FLAG"] == "demo":
        if await db_manager.count_apps(**kwargs) > 2:
            raise HTTPException(
                status_code=500,
                detail="Sorry, you can only create two Apps at this time.",
            )

    if payload.organization_id is None:
        organization = await get_user_own_org(kwargs["uid"])
        organization_id = organization.id
    else:
        organization_id = payload.organization_id

    # Check if the app exists, if not create it
    app_name = payload.app_name.lower()
    app = await new_db_manager.fetch_app_by_name_and_organization(app_name, organization_id, **kwargs)
    if app is None:
        app = await new_db_manager.create_app(app_name, organization_id, **kwargs)

    # Create an Image instance with the extracted image id, and defined image name
    image_name = f"agentaai/templates:{payload.image_tag}"
    # Save variant based on the image to database
    db_app_variant = await new_db_manager.add_variant_based_on_image(app_id=app,
                                                                     variant_name="app",
                                                                     docker_id=payload.image_id,
                                                                     tags=f"{image_name}",
                                                                     organization_id=organization_id,
                                                                     base_name=None,
                                                                     config_name="default",
                                                                     **kwargs)

    # Inject env vars to docker container
    if os.environ["FEATURE_FLAG"] == "demo":
        if not os.environ["OPENAI_API_KEY"]:
            raise HTTPException(
                status_code=400,
                detail="Unable to start app container. Please file an issue by clicking on the button below.",
            )
        envvars = {
            "OPENAI_API_KEY": os.environ["OPENAI_API_KEY"],
        }
    else:
        envvars = {} if payload.env_vars is None else payload.env_vars

    await new_app_manager.start_variant(db_app_variant, envvars, **kwargs)

    return db_app_variant
