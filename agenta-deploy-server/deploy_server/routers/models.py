"""Routes for image-related operations (push, remove).
Does not deal with the instanciation of the images
"""
from typing import List

from deploy_server.models.image import Image
from deploy_server.models.model import Model
from deploy_server.models.container import Container
from deploy_server.services import docker_runtime
from fastapi import APIRouter, HTTPException

router = APIRouter()

# Add route handlers for image-related operations


@router.get("/", response_model=List[Image])
async def list_models():
    """Lists the images from our repository

    Raises:
        HTTPException: _description_

    Returns:
        List[Image]
    """
    try:
        images = docker_runtime.list_images()
        return images
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/start/")
async def start_model(model: Model):
    # try:
    container = docker_runtime.start_container(model.model_name, model.tag)
    return container
    # except Exception as e:
    #     raise HTTPException(status_code=500, detail=str(e))
