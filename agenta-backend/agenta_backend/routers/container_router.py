import os
import uuid
import asyncio
from pathlib import Path
from typing import List, Union, Optional

from fastapi.responses import JSONResponse
from fastapi import UploadFile, APIRouter, Depends

from agenta_backend.config import settings
from aiodocker.exceptions import DockerError
from concurrent.futures import ThreadPoolExecutor
from agenta_backend.services.docker_utils import restart_container
from agenta_backend.models.api.api_models import (
    Image,
    RestartAppContainer,
    Template,
    URI,
)
from agenta_backend.services.db_manager import get_templates
from agenta_backend.services import db_manager
from agenta_backend.services.container_manager import (
    build_image_job,
    get_image_details_from_docker_hub,
    pull_image_from_docker_hub,
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
import logging

logger = logging.getLogger(__name__)

logger.setLevel(logging.DEBUG)

router = APIRouter()


@router.post("/build_image/")
async def build_image(
    app_id: str,
    base_name: str,
    tar_file: UploadFile,
    stoken_session: SessionContainer = Depends(verify_session()),
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
    user_org_data: dict = await get_user_and_org_id(stoken_session)

    # Check app access
    app_db = await db_manager.fetch_app_and_check_access(
        app_id=app_id, user_org_data=user_org_data
    )
    app_name = app_db.app_name
    organization_id = str(app_db.organization.id)
    # Get event loop
    loop = asyncio.get_event_loop()

    # Create a ThreadPoolExecutor for running threads
    thread_pool = ThreadPoolExecutor(max_workers=4)

    # Create a unique temporary directory for each upload
    temp_dir = Path(f"/tmp/{uuid.uuid4()}")
    temp_dir.mkdir(parents=True, exist_ok=True)

    # Save uploaded file to the temporary directory
    tar_path = temp_dir / tar_file.filename
    with tar_path.open("wb") as buffer:
        buffer.write(await tar_file.read())

    image_name = f"agentaai/{app_name.lower()}_{base_name.lower()}:latest"

    # Use the thread pool to run the build_image_job function in a separate thread
    future = loop.run_in_executor(
        thread_pool,
        build_image_job,
        *(
            app_name,
            base_name,
            organization_id,
            tar_path,
            image_name,
            temp_dir,
        ),
    )

    # Return immediately while the image build is in progress
    image_result = await asyncio.wrap_future(future)
    return image_result


@router.post("/restart_container/")
async def restart_docker_container(
    payload: RestartAppContainer,
    stoken_session: SessionContainer = Depends(verify_session()),
) -> dict:
    """Restart docker container.

    Args:
        payload (RestartAppContainer) -- the required data (app_name and variant_name)
    """
    logger.debug(f"Restarting container for variant {payload.variant_id}")
    # Get user and org id
    user_org_data: dict = await get_user_and_org_id(stoken_session)
    app_variant_db = await db_manager.fetch_app_variant_and_check_access(
        app_variant_id=payload.variant_id, user_org_data=user_org_data
    )
    try:
        deployment = await db_manager.get_deployment_by_objectid(
            app_variant_db.base.deployment
        )
        container_id = deployment.container_id

        logger.debug(f"Restarting container with id: {container_id}")
        restart_container(container_id)
        return {"message": "Please wait a moment. The container is now restarting."}
    except Exception as ex:
        return JSONResponse({"message": str(ex)}, status_code=500)


@router.get("/templates/")
async def container_templates(
    stoken_session: SessionContainer = Depends(verify_session()),
) -> Union[List[Template], str]:
    """
    Returns a list of templates available for creating new containers.

    Parameters:
    stoken_session (SessionContainer): The session container for the user.

    Returns:

    Union[List[Template], str]: A list of templates or an error message.
    """
    templates = await get_templates()
    return templates


@router.get("/templates/{image_name}/images/")
async def pull_image(
    image_name: str,
    stoken_session: SessionContainer = Depends(verify_session()),
) -> dict:
    """
    Pulls a Docker image from Docker Hub with the provided configuration.

    Args:
        image_name (str): The name of the Docker image to pull.
        stoken_session (SessionContainer, optional): The session container to use for authentication. Defaults to Depends(verify_session()).

    Returns:
        dict: A JSON response containing the image tag and ID.
    """
    # Get docker hub config
    repo_owner = settings.docker_hub_repo_owner
    repo_name = settings.docker_hub_repo_name

    # Pull image from docker hub with provided config
    try:
        image_res = await pull_image_from_docker_hub(
            f"{repo_owner}/{repo_name}", image_name
        )
    except DockerError as ext:
        return JSONResponse(
            {"message": "Image with tag does not exist", "meta": str(ext)}, 404
        )

    # Get data from image response
    image_tag_name = image_res[0]["id"]
    image_id = await get_image_details_from_docker_hub(
        repo_owner, repo_name, image_tag_name
    )
    return JSONResponse({"image_tag": image_tag_name, "image_id": image_id}, 200)


@router.get("/container_url/")
async def construct_app_container_url(
    base_id: Optional[str] = None,
    variant_id: Optional[str] = None,
    stoken_session: SessionContainer = Depends(verify_session()),
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
    user_org_data: dict = await get_user_and_org_id(stoken_session)
    if base_id:
        base_db = await db_manager.fetch_base_and_check_access(
            base_id=base_id, user_org_data=user_org_data
        )
        # TODO: Add status check if base_db.status == "running"
        if base_db.deployment:
            deployment = await db_manager.get_deployment_by_objectid(base_db.deployment)
            uri = deployment.uri_path
        else:
            uri = None

        return URI(uri=uri)
    elif variant_id:
        variant_db = await db_manager.fetch_app_variant_and_check_access(
            app_variant_id=variant_id, user_org_data=user_org_data
        )
        deployment = await db_manager.get_deployment_by_objectid(
            variant_db.base.deployment
        )
        return URI(uri=deployment.uri_path)
    else:
        return JSONResponse(
            {"detail": "Please provide either base_id or variant_id"},
            status_code=400,
        )
