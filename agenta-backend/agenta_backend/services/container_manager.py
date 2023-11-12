import asyncio
import logging
import os
import shutil
import uuid
from asyncio.exceptions import CancelledError
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Dict, List, Union

import backoff
import docker
import httpx
from aiodocker import Docker, exceptions
from fastapi import HTTPException, UploadFile
from httpx import ConnectError, TimeoutException

from agenta_backend.models.api.api_models import Image
from agenta_backend.models.db_models import (
    AppDB,
)
from agenta_backend.services import docker_utils

client = docker.from_env()


logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


async def build_image(app_db: AppDB, base_name: str, tar_file: UploadFile) -> Image:
    app_name = app_db.app_name
    organization_id = str(app_db.organization.id)

    image_name = f"agentaai/{app_name.lower()}_{base_name.lower()}:latest"
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
    image_result = await asyncio.wrap_future(future)
    return image_result


def build_image_job(
    app_name: str,
    base_name: str,
    organization_id: str,
    tar_path: Path,
    image_name: str,
    temp_dir: Path,
) -> Image:
    """Business logic for building a docker image from a tar file

    TODO: This should be a background task

    Arguments:
        app_name --  The `app_name` parameter is a string that represents the name of the application
        base_name --  The `base_name` parameter is a string that represents the variant of the \
            application. It could be a specific version, configuration, or any other distinguishing \
                factor for the application
        organization_id -- The id of the organization the app belongs to
        tar_path --  The `tar_path` parameter is the path to the tar file that contains the source code \
            or files needed to build the Docker image
        image_name --  The `image_name` parameter is a string that represents the name of the Docker \
            image that will be built. It is used as the tag for the image
        temp_dir --  The `temp_dir` parameter is a `Path` object that represents the temporary directory
            where the contents of the tar file will be extracted

    Raises:
        HTTPException: _description_
        HTTPException: _description_

    Returns:
        an instance of the `Image` class.
    """

    # Extract the tar file
    shutil.unpack_archive(tar_path, temp_dir)

    try:
        if os.environ["FEATURE_FLAG"] in ["cloud"]:
            dockerfile = "Dockerfile.cloud"
        else:
            dockerfile = "Dockerfile"
        image, build_log = client.images.build(
            path=str(temp_dir),
            tag=image_name,
            buildargs={"ROOT_PATH": f"/{organization_id}/{app_name}/{base_name}"},
            rm=True,
            dockerfile=dockerfile,
            pull=True,
        )
        for line in build_log:
            logger.info(line)
        return Image(
            docker_id=image.id,
            tags=image.tags[0],
            organization_id=organization_id,
        )
    except docker.errors.BuildError as ex:
        log = "Error building Docker image:\n"
        log += str(ex) + "\n"
        logger.error(log)
        raise HTTPException(status_code=500, detail=str(ex))
    except Exception as ex:
        raise HTTPException(status_code=500, detail=str(ex))


async def check_docker_arch() -> str:
    """Checks the architecture of the Docker system.

    Returns:
        The architecture mapping for the Docker system.
    """
    async with Docker() as docker:
        info = await docker.system.info()
        arch_mapping = {
            "x86_64": "amd",
            "amd64": "amd",
            "aarch64": "arm",
            "arm64": "arm",
            "armhf": "arm",
            "ppc64le": "ppc",
            "s390x": "s390",
            # Add more mappings as needed
        }
        return arch_mapping.get(info["Architecture"], "unknown")


@backoff.on_exception(
    backoff.expo,
    (ConnectError, TimeoutException, CancelledError, exceptions.DockerError),
    max_tries=5,
)
async def pull_docker_image(repo_name: str, tag: str) -> dict:
    """Business logic to asynchronously pull an image from  either Docker Hub or ECR.

    Args:
        repo_name (str): The name of the repository from which the image is to be pulled.
            Typically follows the format `username/repository_name`.
        tag (str): Specifies a specific version or tag of the image to pull from the repository.

    Returns:
        Image: An image object.
    """

    async with Docker() as docker:
        image = await docker.images.pull(repo_name, tag=tag)
        return image


async def get_image_details_from_docker_hub(
    repo_owner: str, repo_name: str, image_name: str
) -> str:
    """Retrieves the image details (specifically the image ID) from Docker Hub.

    Args:
        repo_owner (str): The owner or organization of the repository from which image details are to be retrieved.
        repo_name (str): The name of the repository.
        image_name (str): The name of the Docker image for which details are to be retrieved.

    Returns:
        str: The "Id" of the image details obtained from Docker Hub.
    """
    async with Docker() as docker:
        image_details = await docker.images.inspect(
            f"{repo_owner}/{repo_name}:{image_name}"
        )
        return image_details["Id"]


def restart_container(container_id: str):
    """Restart docker container.

    Args:
        container_id (str): The id of the container to restart.
    """
    docker_utils.restart_container(container_id)
