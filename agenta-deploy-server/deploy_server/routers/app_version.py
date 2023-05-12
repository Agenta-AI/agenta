"""Routes for image-related operations (push, remove).
Does not deal with the instanciation of the images
"""
from typing import List

from deploy_server.models.api_models import AppVersion, Image, URI
from deploy_server.services import docker_utils
from deploy_server.services import db_manager
from fastapi import APIRouter, HTTPException

router = APIRouter()

# Add route handlers for image-related operations


@router.get("/list/", response_model=List[AppVersion])
async def list_app_versions():
    """Lists the images from our repository

    Raises:
        HTTPException: _description_

    Returns:
        List[AppVersion]
    """
    try:
        app_versions = db_manager.list_app_versions()
        return app_versions
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/add/")
async def add_model(app_version: AppVersion, image: Image):
    # checks if the image is already in the registry
    try:
        if image not in docker_utils.list_images():
            return HTTPException(status_code=500, detail="Image not found")
        else:
            db_manager.add_app_version(app_version, image)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/start/")
async def start_model(app_version: AppVersion) -> URI:
    # try:
    image: Image = db_manager.get_image(app_version)
    uri: URI = docker_utils.start_container(image)
    return uri
    # except Exception as e:
    #     raise HTTPException(status_code=500, detail=str(e))


@router.post("/stop/")
async def stop_model(app_version: AppVersion):
    try:
        image: Image = db_manager.get_image(app_version)
        docker_utils.stop_container(image)
        docker_utils.delete_container(image)
        return {"detail": "Container stopped and deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
