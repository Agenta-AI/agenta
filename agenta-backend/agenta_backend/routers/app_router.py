"""Routes for image-related operations (push, remove).
Does not deal with the instanciation of the images
"""

import os
import logging
from docker.errors import DockerException
from sqlalchemy.exc import SQLAlchemyError
from fastapi.responses import JSONResponse
from agenta_backend.config import settings
from typing import Any, Dict, List, Optional, Union
from fastapi import APIRouter, Body, HTTPException, Depends
from agenta_backend.services.selectors import get_user_own_org
from agenta_backend.services import (
    app_manager,
    db_manager,
    docker_utils,
    new_db_manager,
    new_app_manager,
)
from agenta_backend.utills.common import check_access_to_app, get_app_instance
from agenta_backend.models.converters import app_variant_db_to_output
from agenta_backend.utills.common import check_user_org_access, check_access_to_variant
from agenta_backend.models.api.api_models import (
    URI,
    App,
    AppOutput,
    CreateApp,
    CreateAppOutput,
    AppVariant,
    Image,
    DockerEnvVars,
    CreateAppVariant,
    AddVariantFromPreviousPayload,
    AppVariantOutput,
    Variant,
    UpdateVariantParameterPayload,
    AddVariantFromBasePayload,
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
    from agenta_backend.ee.services.auth_helper import (  # noqa pylint: disable-all
        SessionContainer,
        verify_session,
    )
    from agenta_backend.ee.services.selectors import (
        get_user_and_org_id,
    )  # noqa pylint: disable-all
else:
    from agenta_backend.services.auth_helper import (
        SessionContainer,
        verify_session,
    )
    from agenta_backend.services.selectors import get_user_and_org_id

router = APIRouter()
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


@router.get("/list_variants/", response_model=List[AppVariantOutput])
async def list_app_variants(
    app_id: Optional[str] = None,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    """Lists the app variants from our repository.

    Arguments:
        app_id -- If specified, only returns the app variants for the specified app
    Raises:
        HTTPException: _description_

    Returns:
        List[AppVariant]
    """

    try:
        kwargs: dict = await get_user_and_org_id(stoken_session)

        if app_id is not None:
            access_app = await check_access_to_app(
                kwargs, app_id=app_id, check_owner=True
            )
            if not access_app:
                error_msg = f"You cannot access app: {app_id}"
                logger.error(error_msg)
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=400,
                )

        app_variants = await new_db_manager.list_app_variants(app_id=app_id, **kwargs)
        return [app_variant_db_to_output(app_variant) for app_variant in app_variants]

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/get_variant_by_env/", response_model=AppVariantOutput)
async def get_variant_by_env(
    app_id: str,
    environment: str,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    """Fetches a specific app variant based on the given app_name and environment."""

    try:
        # Retrieve the user and organization ID based on the session token
        kwargs = await get_user_and_org_id(stoken_session)
        await check_access_to_app(kwargs, app_id=app_id)
        # Fetch the app variant using the provided app_name and variant_name
        app_variant_db = (
            await new_db_manager.get_app_variant_by_app_name_and_environment(
                app_id=app_id, environment=environment, **kwargs
            )
        )
        # Check if the fetched app variant is None and raise 404 if it is
        if app_variant_db is None:
            raise HTTPException(status_code=500, detail="App Variant not found")
        return app_variant_db_to_output(app_variant_db)
    except ValueError as e:
        # Handle ValueErrors and return 400 status code
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException as e:
        raise e
    except Exception as e:
        # Handle all other exceptions and return 500 status code
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/apps/{app_name}/", response_model=AppOutput)
async def get_app_by_name(
    app_name: str,
    organization_id: Optional[str] = None,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    """Get an app by its name.

    Arguments:
        app_name (str): Name of app

    Returns:
        CreateAppOutput: the app id and name
    """

    try:
        # Get user and org id
        kwargs: dict = await get_user_and_org_id(stoken_session)
        if organization_id:
            # check if user has access to the organization
            access = await check_user_org_access(kwargs, organization_id)
            if not access:
                raise HTTPException(
                    status_code=403,
                    detail="You do not have permission to access this app",
                )
        app_db = await new_db_manager.fetch_app_by_name(app_name, organization_id ** kwargs)
        return AppOutput(app_id=str(app_db.id), app_name=app_db.app_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/apps/", response_model=CreateAppOutput)
async def create_app(
    payload: CreateApp,
    stoken_session: SessionContainer = Depends(verify_session()),
) -> CreateAppOutput:
    """Create a new app.

    Arguments:
        app_name (str): Name of app

    Returns:
        CreateAppOutput: the app id and name
    """

    try:
        # Get user and org id
        kwargs: dict = await get_user_and_org_id(stoken_session)
        if payload.organization_id:
            # check if user has access to the organization
            access = await check_user_org_access(kwargs, payload.organization_id)
            if not access:
                raise HTTPException(
                    status_code=403,
                    detail="You do not have permission to access this app",
                )
            organization_id = payload.organization_id
        else:
            # Retrieve or create user organization
            organization = await get_user_own_org(kwargs["uid"])
            if organization is None:
                organization = await new_db_manager.create_user_organization(kwargs["uid"])
            organization_id = str(organization.id)

        # Create new app and return the output
        app_db = await new_db_manager.create_app(
            payload.app_name, organization_id, **kwargs
        )
        return CreateAppOutput(app_id=str(app_db.id), app_name=str(app_db.app_name))
    except Exception as e:
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
        apps = await new_db_manager.list_apps(org_id, **kwargs)
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

        # Get user organization
        organization = await get_user_own_org(kwargs["uid"])
        if app_variant.organization_id is None:
            app_variant.organization_id = str(organization.id)

        if image.organization_id is None:
            image.organization_id = str(organization.id)

        app_db = await new_db_manager.fetch_app_by_id(app_variant.app_id)
        await new_db_manager.add_variant_based_on_image(
            app_db,
            app_variant.variant_name,
            image.docker_id,
            image.tags,
            app_variant.organization_id,
            **kwargs,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/add/from_previous/")
async def add_variant_from_previous(
    payload: AddVariantFromPreviousPayload,
    stoken_session: SessionContainer = Depends(verify_session()),
) -> AppVariantOutput:
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
        app_variant_db = await new_db_manager.fetch_app_variant_by_id(
            payload.previous_variant_id
        )
        if app_variant_db is None:
            raise HTTPException(
                status_code=500,
                detail="Previous app variant not found",
            )
        kwargs: dict = await get_user_and_org_id(stoken_session)
        access = await check_user_org_access(kwargs, app_variant_db.organization_id.id)
        if not access:
            raise HTTPException(
                status_code=500,
                detail="You do not have permission to access this app variant",
            )
        db_app_variant = await new_db_manager.add_variant_based_on_previous(
            previous_app_variant=app_variant_db,
            new_variant_name=payload.new_variant_name,
            parameters=payload.parameters,
            **kwargs,
        )
        return app_variant_db_to_output(db_app_variant)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/add/from_base/")
async def add_variant_from_base(
    payload: AddVariantFromBasePayload,
    stoken_session: SessionContainer = Depends(verify_session),
) -> Union[AppVariantOutput, Any]:
    """Add a new variant based on an existing one.

    Args:
        payload (AddVariantFromBasePayload): Payload containing base variant ID, new variant name, and parameters.
        stoken_session (SessionContainer, optional): Session container. Defaults to result of verify_session().

    Raises:
        HTTPException: Raised if the variant could not be added or accessed.

    Returns:
        Union[AppVariantOutput, Any]: New variant details or exception.
    """
    try:
        logger.debug("Initiating process to add a variant based on a previous one.")
        logger.debug(f"Received payload: {payload}")

        # Find the previous variant in the database
        app_variant_db = await new_db_manager.find_previous_variant_from_base_id(
            payload.base_id
        )
        if app_variant_db is None:
            logger.error("Failed to find the previous app variant in the database.")
            raise HTTPException(
                status_code=500, detail="Previous app variant not found"
            )
        logger.debug(f"Located previous variant: {app_variant_db}")

        # Get user and organization data
        user_org_data: dict = await get_user_and_org_id(stoken_session)
        logger.debug(f"Retrieved user and organization data: {user_org_data}")

        # Check user access permissions
        access = await check_user_org_access(
            user_org_data, app_variant_db.organization_id.id
        )
        if not access:
            logger.error(
                "User does not have the required permissions to access this app variant."
            )
            raise HTTPException(
                status_code=500,
                detail="You do not have permission to access this app variant",
            )
        logger.debug("User has required permissions to access this app variant.")

        # Add new variant based on the previous one
        db_app_variant = await new_db_manager.add_variant_based_on_previous(
            previous_app_variant=app_variant_db,
            new_variant_name=payload.new_variant_name,
            parameters=payload.parameters,
            **user_org_data,
        )
        logger.debug(f"Successfully added new variant: {db_app_variant}")

        return app_variant_db_to_output(db_app_variant)
    except Exception as e:
        logger.error(f"An exception occurred while adding the new variant: {e}")
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

        app_variant_db = await new_db_manager.fetch_app_variant_by_name_and_appid(
            app_variant.variant_name, app_variant.app_id
        )
        url = await new_app_manager.start_variant(app_variant_db, envvars, **kwargs)
        return url
    except Exception as e:
        variant_from_db = await db_manager.get_variant_from_db(app_variant, **kwargs)
        if variant_from_db is not None:
            await app_manager.remove_app_variant(app_variant, **kwargs)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/list_images/", response_model=List[Image])
async def list_images(
    stoken_session: SessionContainer = Depends(verify_session()),
):
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
    variant: Variant,
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

        access_app = await check_access_to_variant(
            kwargs, variant_id=variant.variant_id, check_owner=True
        )

        if not access_app:
            error_msg = f"You do not have permission to delete app variant: {variant.variant_id}"
            logger.error(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=400,
            )
        else:
            await new_app_manager.remove_app_variant(
                app_variant_id=variant.variant_id, **kwargs
            )
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
    if app.app_id is None:
        raise HTTPException(
            status_code=500,
            detail="App id is required",
        )
    try:
        kwargs: dict = await get_user_and_org_id(stoken_session)
        access_app = await check_access_to_app(
            kwargs, app_id=app.app_id, check_owner=True
        )

        if not access_app:
            error_msg = f"You do not have permission to delete app: {app.app_name}"
            logger.error(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=400,
            )
        else:
            await new_app_manager.remove_app(app_id=app.app_id, **kwargs)
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
    payload: UpdateVariantParameterPayload,
    stoken_session: SessionContainer = Depends(verify_session()),
):
    """Updates the parameters for an app variant

    Arguments:
        app_variant -- Appvariant to update
    """
    if payload.variant_id is None:
        raise HTTPException(
            status_code=500,
            detail="Variant id is required",
        )
    if payload.parameters is None:
        raise HTTPException(
            status_code=500,
            detail="Parameters are required",
        )
    try:
        kwargs: dict = await get_user_and_org_id(stoken_session)
        access_variant = await check_access_to_variant(
            kwargs=kwargs, variant_id=payload.variant_id
        )

        if not access_variant:
            error_msg = f"You do not have permission to update app variant: {payload.variant_id}"
            logger.error(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=400,
            )
        else:
            await new_app_manager.update_variant_parameters(
                app_variant_id=payload.variant_id,
                parameters=payload.parameters,
                **kwargs,
            )
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
                app_variant.app_id, app_variant.variant_name
            )
            app_variant.organization_id = str(app_instance.organization_id.id)

        access_app = await check_access_to_app(
            kwargs, app_id=app_variant.app_id, check_owner=True
        )
        if not access_app:
            error_msg = f"You do not have permission to make an update"
            logger.error(error_msg)
            return JSONResponse(
                {"detail": error_msg},
                status_code=400,
            )
        else:
            await new_app_manager.update_variant_image(app_variant, image, **kwargs)
    except ValueError as e:
        detail = f"Error while trying to update the app variant: {str(e)}"
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
) -> AppVariantOutput:
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
    app = await new_db_manager.fetch_app_by_name_and_organization(
        app_name, organization_id, **kwargs
    )
    if app is None:
        app = await new_db_manager.create_app(app_name, organization_id, **kwargs)
        await new_db_manager.initialize_environments(app_ref=app, **kwargs)
    # Create an Image instance with the extracted image id, and defined image name
    image_name = f"agentaai/templates:{payload.image_tag}"
    # Save variant based on the image to database
    db_app_variant = await new_db_manager.add_variant_based_on_image(
        app_id=app,
        variant_name="app",
        docker_id=payload.image_id,
        tags=f"{image_name}",
        organization_id=organization_id,
        base_name="app",
        config_name="default",
        **kwargs,
    )

    # Inject env vars to docker container
    if os.environ["FEATURE_FLAG"] == "demo":
        # Create testset for apps created
        # await db_manager.add_testset_to_app_variant(db_app_variant, image, **kwargs) #TODO: To reimplement
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

    return app_variant_db_to_output(db_app_variant)
