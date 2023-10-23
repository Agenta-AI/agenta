import shutil
import logging
from pathlib import Path
from typing import List, Union, Dict, Any
from asyncio.exceptions import CancelledError

from fastapi import HTTPException

from agenta_backend.models.api.api_models import Image

import httpx
import docker
import backoff
from aiodocker import Docker, exceptions
from httpx import ConnectError, TimeoutException


client = docker.from_env()


logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


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
        image, build_log = client.images.build(
            path=str(temp_dir),
            tag=image_name,
            buildargs={"ROOT_PATH": f"/{organization_id}/{app_name}/{base_name}"},
            rm=True,
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


@backoff.on_exception(backoff.expo, (ConnectError, CancelledError), max_tries=5)
async def retrieve_templates_from_dockerhub(
    url: str, repo_owner: str, repo_name: str
) -> Union[List[dict], dict]:
    """
    Business logic to retrieve templates from DockerHub.

    Args:
        url (str): The URL endpoint for retrieving templates. Should contain placeholders `{}`
            for the `repo_owner` and `repo_name` values to be inserted. For example:
            `https://hub.docker.com/v2/repositories/{}/{}/tags`.
        repo_owner (str): The owner or organization of the repository from which templates are to be retrieved.
        repo_name (str): The name of the repository where the templates are located.

    Returns:
        tuple: A tuple containing two values.
    """

    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{url.format(repo_owner, repo_name)}/tags", timeout=10
        )
        if response.status_code == 200:
            response_data = response.json()
            return response_data

        response_data = response.json()
        return response_data


@backoff.on_exception(
    backoff.expo, (ConnectError, TimeoutException, CancelledError), max_tries=5
)
async def get_templates_info_from_s3(url: str) -> Dict[str, Dict[str, Any]]:
    """
    Business logic to retrieve templates information from S3.

    Args:
        url (str): The URL endpoint for retrieving templates info.

    Returns:
        response_data (Dict[str, Dict[str, Any]]): A dictionary \
            containing dictionaries of templates information.
    """

    async with httpx.AsyncClient() as client:
        response = await client.get(url, timeout=10)
        if response.status_code == 200:
            response_data = response.json()
            return response_data

        response_data = response.json()
        return response_data


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
