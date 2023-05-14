"""Routes for image-related operations (push, remove).
Does not deal with the instanciation of the images
"""
from typing import List

from deploy_server.models.api_models import AppVariant, Image, URI
from deploy_server.services import docker_utils
from deploy_server.services import db_manager
from fastapi import APIRouter, HTTPException

router = APIRouter()

# Add route handlers for image-related operations


@router.get("/list/", response_model=List[AppVariant])
async def list_app_variants():
    """Lists the images from our repository

    Raises:
        HTTPException: _description_

    Returns:
        List[AppVariant]
    """
    try:
        app_variants = db_manager.list_app_variants()
        return app_variants
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/add/")
async def add_variant(app_variant: AppVariant, image: Image):
    # checks if the image is already in the registry
    db_manager.add_app_variant(app_variant, image)
    try:
        if image not in docker_utils.list_images():
            return HTTPException(status_code=500, detail="Image not found")
        else:
            db_manager.add_app_variant(app_variant, image)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/start/")
async def start_variant(app_variant: AppVariant) -> URI:
    # try:
    image: Image = db_manager.get_image(app_variant)
    uri: URI = docker_utils.start_container(image)
    return uri
    # except Exception as e:
    #     raise HTTPException(status_code=500, detail=str(e))


@router.post("/stop/")
async def stop_variant(app_variant: AppVariant):
    try:
        image: Image = db_manager.get_image(app_variant)
        docker_utils.stop_container(image)
        docker_utils.delete_container(image)
        return {"detail": "Container stopped and deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
