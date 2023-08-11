import uuid
import secrets
import asyncio
from typing import List
from pathlib import Path
from requests.exceptions import HTTPError
from fastapi import UploadFile, APIRouter
from fastapi.responses import JSONResponse
from agenta_backend.config import settings
from aiodocker.exceptions import DockerError
from concurrent.futures import ThreadPoolExecutor
from agenta_backend.services.app_manager import (
    start_variant,
    update_variant_image,
)
from agenta_backend.services.db_manager import (
    get_templates,
    add_variant_based_on_image,
    get_variant_from_db,
)
from agenta_backend.models.api.api_models import (
    Image,
    Template,
    AppVariant,
    CreateAppVariant,
)
from agenta_backend.services.container_manager import (
    build_image_job,
    get_image_details_from_docker_hub,
    pull_image_from_docker_hub,
)


router = APIRouter()


@router.post("/build_image/")
async def build_image(
    app_name: str, variant_name: str, tar_file: UploadFile
) -> Image:
    """Takes a tar file and builds a docker image from it

    Arguments:
        app_name -- The `app_name` parameter is a string that represents the name of \
            the application for which the docker image is being built
        variant_name -- The `variant_name` parameter is a string that represents the \
            name or type of the variant for which the docker image is being built.
        tar_file -- The `tar_file` parameter is of type `UploadFile`. It represents the \
            uploaded tar file that will be used to build the Docker image

    Returns:
        an object of type `Image`.
    """

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

    image_name = (
        f"agenta-server/{app_name.lower()}_{variant_name.lower()}:latest"
    )

    # Use the thread pool to run the build_image_job function in a separate thread
    future = loop.run_in_executor(
        thread_pool,
        build_image_job,
        *(app_name, variant_name, tar_path, image_name, temp_dir),
    )

    # Return immediately while the image build is in progress
    image_result = await asyncio.wrap_future(future)
    return image_result


@router.get("/templates/")
async def container_templates() -> List[Template]:
    """Returns a list of container templates.

    Returns:
        a list of `Template` objects.
    """
    templates = get_templates()
    return templates


@router.get("/templates/{image_name}/images/")
async def pull_image(image_name: str) -> dict:
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
    return JSONResponse(
        {"image_tag": image_tag_name, "image_id": image_id}, 200
    )


@router.post("/variants/create/")
async def create_app_variant_from_image(payload: CreateAppVariant):
    #  Use response from image to create an app_variant and image instance(s)
    variant_name = secrets.token_hex(3)
    app_variant: AppVariant = AppVariant(
        app_name=payload.app_name,
        variant_name=f"default_{variant_name}",
    )

    image_name = f"agentaai/templates:{payload.image_tag}"
    image: Image = Image(
        docker_id=payload.image_id.split(":")[-1], tags=f"{image_name}"
    )

    variant_exist = get_variant_from_db(app_variant)
    if variant_exist is None:
        # Save variant based on the image to database
        add_variant_based_on_image(app_variant, image)
    else:
        # Update variant based on the image
        update_variant_image(app_variant, image)

    # Start variant
    try:
        variant_url = start_variant(app_variant)
    except Exception as ext:
        print("Exception => ", type(ext))

    return {
        "message": "Variant created and running!",
        "data": {
            "url": variant_url["url"],
            "playground": f"http://localhost:3000/apps/{payload.app_name}/playground",
        },
    }
