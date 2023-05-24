"""Routes for image-related operations (push, remove).
Does not deal with the instanciation of the images
"""
from typing import List

from agenta_backend.models.api.api_models import AppVariant, Image, URI, App
from agenta_backend.services import docker_utils
from agenta_backend.services import db_manager
from fastapi import APIRouter, HTTPException
from agenta_backend.config import settings
from typing import Optional

router = APIRouter()

# Add route handlers for image-related operations


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
        apps = db_manager.list_app_names()
        return apps
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/add/")
async def add_variant(app_variant: AppVariant, image: Image):
    """Add a variant to the server.

    Arguments:
        app_variant -- _description_
        image -- The image tags should start with the registry name (agenta-server) and end with :latest

    Raises:
        HTTPException: _description_
        HTTPException: _description_
        HTTPException: _description_
    """

    if not image.tags.startswith(settings.registry):
        raise HTTPException(
            status_code=500, detail="Image should have a tag starting with the registry name (agenta-server)")
    elif image not in docker_utils.list_images():
        raise HTTPException(status_code=500, detail="Image not found")

    try:
        db_manager.add_app_variant(app_variant, image)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/start/")
async def start_variant(app_variant: AppVariant) -> URI:
    try:
        image: Image = db_manager.get_image(app_variant)
        uri: URI = docker_utils.start_container(
            image_name=image.tags, app_name=app_variant.app_name, variant_name=app_variant.variant_name)
        return uri
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/stop/")
async def stop_variant(app_variant: AppVariant):
    try:
        image: Image = db_manager.get_image(app_variant)
        docker_utils.stop_container(image)
        docker_utils.delete_container(image)
        return {"detail": "Container stopped and deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


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
