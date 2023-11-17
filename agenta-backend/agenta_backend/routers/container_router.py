import os
from typing import List, Optional, Union
from agenta_backend.models.api.api_models import (
    URI,
    Image,
    RestartAppContainer,
    Template,
)
from agenta_backend.services import db_manager
from fastapi import APIRouter, Request, UploadFile, HTTPException
from fastapi.responses import JSONResponse

if os.environ["FEATURE_FLAG"] in ["cloud", "ee"]:
    from agenta_backend.cloud.services.selectors import (
        get_user_and_org_id,
    )  # noqa pylint: disable-all
else:
    from agenta_backend.services.selectors import get_user_and_org_id

if os.environ["FEATURE_FLAG"] in ["cloud"]:
    from agenta_backend.cloud.services import container_manager
elif os.environ["FEATURE_FLAG"] in ["ee"]:
    from agenta_backend.ee.services import container_manager
else:
    from agenta_backend.services import container_manager

import logging

logger = logging.getLogger(__name__)

logger.setLevel(logging.DEBUG)

router = APIRouter()


# TODO: We need to improve this to use the introduced abstraction to also use start and stop service
@router.post("/build_image/")
async def build_image(
    app_id: str,
    base_name: str,
    tar_file: UploadFile,
    request: Request,
) -> Image:
    """
    Builds a Docker image from a tar file containing the application code.

    Args:
        app_id (str): The ID of the application to build the image for.
        base_name (str): The base name of the image to build.
        tar_file (UploadFile): The tar file containing the application code.
        stoken_session (SessionContainer): The session container for the user making the request.

    Returns:
        Image: The Docker image that was built.
    """
    # Get user and org id
    user_org_data: dict = await get_user_and_org_id(request.state.user_id)

    # Check app access
    app_db = await db_manager.fetch_app_and_check_access(
        app_id=app_id, user_org_data=user_org_data
    )

    image_result = await container_manager.build_image(
        app_db=app_db,
        base_name=base_name,
        tar_file=tar_file,
    )

    return image_result


@router.post("/restart_container/")
async def restart_docker_container(
    payload: RestartAppContainer,
    request: Request,
) -> dict:
    """Restart docker container.

    Args:
        payload (RestartAppContainer) -- the required data (app_name and variant_name)
    """
    logger.debug(f"Restarting container for variant {payload.variant_id}")
    # Get user and org id
    user_org_data: dict = await get_user_and_org_id(request.state.user_id)
    app_variant_db = await db_manager.fetch_app_variant_and_check_access(
        app_variant_id=payload.variant_id, user_org_data=user_org_data
    )
    try:
        deployment = await db_manager.get_deployment_by_objectid(
            app_variant_db.base.deployment
        )
        container_id = deployment.container_id

        logger.debug(f"Restarting container with id: {container_id}")
        container_manager.restart_container(container_id)
        return {"message": "Please wait a moment. The container is now restarting."}
    except Exception as ex:
        return JSONResponse({"message": str(ex)}, status_code=500)


@router.get("/templates/")
async def container_templates(
    request: Request,
) -> Union[List[Template], str]:
    """
    Returns a list of templates available for creating new containers.

    Parameters:
    stoken_session (SessionContainer): The session container for the user.

    Returns:

    Union[List[Template], str]: A list of templates or an error message.
    """
    try:
        templates = await db_manager.get_templates()
    except Exception as e:
        return JSONResponse({"message": str(e)}, status_code=500)
    return templates


@router.get("/container_url/")
async def construct_app_container_url(
    request: Request,
    base_id: Optional[str] = None,
    variant_id: Optional[str] = None,
) -> URI:
    """
    Constructs the URL for an app container based on the provided base_id or variant_id.

    Args:
        base_id (Optional[str]): The ID of the base to use for the app container.
        variant_id (Optional[str]): The ID of the variant to use for the app container.
        stoken_session (SessionContainer): The session container for the user.

    Returns:
        URI: The URI for the app container.

    Raises:
        HTTPException: If the base or variant cannot be found or the user does not have access.
    """
    user_org_data: dict = await get_user_and_org_id(request.state.user_id)
    if base_id:
        base_db = await db_manager.fetch_base_and_check_access(
            base_id=base_id, user_org_data=user_org_data
        )
        # TODO: Add status check if base_db.status == "running"
        if base_db.deployment:
            deployment = await db_manager.get_deployment_by_objectid(base_db.deployment)
            uri = deployment.uri
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Base {base_id} does not have a deployment",
            )

        return URI(uri=uri)
    elif variant_id:
        variant_db = await db_manager.fetch_app_variant_and_check_access(
            app_variant_id=variant_id, user_org_data=user_org_data
        )
        deployment = await db_manager.get_deployment_by_objectid(
            variant_db.base.deployment
        )
        assert deployment and deployment.uri, "Deployment not found"
        return URI(uri=deployment.uri)
    else:
        return JSONResponse(
            {"detail": "Please provide either base_id or variant_id"},
            status_code=400,
        )
