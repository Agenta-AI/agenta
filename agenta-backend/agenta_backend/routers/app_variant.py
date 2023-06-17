"""Routes for image-related operations (push, remove).
Does not deal with the instanciation of the images
"""
import logging
from typing import Any, Dict, List, Optional

from agenta_backend.config import settings
from agenta_backend.models.api.api_models import URI, App, AppVariant, Image
from agenta_backend.services import app_manager, db_manager, docker_utils
from docker.errors import DockerException
from fastapi import APIRouter, Body, HTTPException
from sqlalchemy.exc import SQLAlchemyError

router = APIRouter()
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


@router.get("/list_variants/", response_model=List[AppVariant])
async def list_app_variants(app_name: Optional[str] = None):
    """Lists the app variants from our repository.

    Arguments:
        app_name -- If specified, only returns the app variants for the specified app
    Raises:
        HTTPException: _description_

    Returns:
        List[AppVariant]
    """
    try:
        app_variants = db_manager.list_app_variants(app_name=app_name)
        return app_variants
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/list_apps/", response_model=List[App])
async def list_apps() -> List[App]:
    """Lists the apps from our repository.

    Raises:
        HTTPException: _description_

    Returns:
        List[App]
    """
    try:
        apps = db_manager.list_apps()
        return apps
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/add/from_image/")
async def add_variant_from_image(app_variant: AppVariant, image: Image):
    """Add a variant to the server based on an image.

    Arguments:
        app_variant -- AppVariant to add
        image -- The image tags should start with the registry name (agenta-server) and end with :latest

    Raises:
        HTTPException: If image tag doesn't start with registry name
        HTTPException: If image not found in docker utils list
        HTTPException: If there is a problem adding the app variant
    """


    if not image.tags.startswith(settings.registry):
        raise HTTPException(
            status_code=500, detail="Image should have a tag starting with the registry name (agenta-server)")
    elif image not in docker_utils.list_images():
        raise HTTPException(status_code=500, detail="Image not found")


    try:
        db_manager.add_variant_based_on_image(app_variant, image)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/add/from_previous/")
async def add_variant_from_previous(previous_app_variant: AppVariant, new_variant_name: str = Body(...), parameters: Dict[str, Any] = Body(...)):
    """Add a variant to the server based on a previous variant.

    Arguments:
        app_variant -- AppVariant to add
        previous_app_variant -- Previous AppVariant to use as a base
        parameters -- parameters for the variant

    Raises:
        HTTPException: If there is a problem adding the app variant
    """
    print(f"previous_app_variant: {previous_app_variant}, type: {type(previous_app_variant)}")
    print(f"new_variant_name: {new_variant_name}, type: {type(new_variant_name)}")
    print(f"parameters: {parameters}, type: {type(parameters)}")
    try:
        db_manager.add_variant_based_on_previous(previous_app_variant, new_variant_name, parameters)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/start/")
async def start_variant(app_variant: AppVariant) -> URI:
    try:
        return app_manager.start_variant(app_variant)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/stop/")
async def stop_variant(app_variant: AppVariant):
    assert NotImplementedError("Not implemented yet")


@router.get("/list_images/", response_model=List[Image])
async def list_images():
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
async def remove_variant(app_variant: AppVariant):
    """Remove a variant from the server.
    In the case it's the last variant using the image, stop the container and remove the image.

    Arguments:
        app_variant -- AppVariant to remove

    Raises:
        HTTPException: If there is a problem removing the app variant
    """
    try:
        app_manager.remove_app_variant(app_variant)
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
async def remove_app(app: App):
    """Remove app, all its variant, containers and images

    Arguments:
        app -- App to remove
    """
    try:
        app_manager.remove_app(app)
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
async def update_variant_parameters(app_variant: AppVariant):
    """Updates the parameters for an app variant

    Arguments:
        app_variant -- Appvariant to update
    """
    try:
        app_manager.update_variant_parameters(app_variant)
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
async def update_variant_image(app_variant: AppVariant, image: Image):
    """Updates the image used in an app variant

    Arguments:
        app_variant -- the app variant to update
        image -- the image information
    """
    try:
        app_manager.update_variant_image(app_variant, image)
    except ValueError as e:
        detail = f"Error while trying to update the app variant: {str(e)}"
        raise HTTPException(status_code=500, detail=str(e))
    except SQLAlchemyError as e:
        detail = f"Database error while trying to update the app variant: {str(e)}"
        raise HTTPException(status_code=500, detail=str(e))
    except DockerException as e:
        detail = f"Docker error while trying to update the app variant: {str(e)}"
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        detail = f"Unexpected error while trying to update the app variant: {str(e)}"
        raise HTTPException(status_code=500, detail=str(e))
