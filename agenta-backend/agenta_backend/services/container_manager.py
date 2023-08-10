import json
import redis
import httpx
import shutil
import docker
import logging
import backoff
from pathlib import Path
from typing import List, Union
from httpx import ConnectError
from fastapi import HTTPException
from agenta_backend.config import settings
from asyncio.exceptions import CancelledError
from agenta_backend.models.api.api_models import Image


client = docker.from_env()


logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def redis_connection() -> redis.Redis:
    """Returns a Redis client object connected to a Redis server specified
        by the `redis_url` setting.

    Returns:
        A Redis client object.
    """

    redis_client = redis.from_url(url=settings.redis_url)
    return redis_client


def build_image_job(
    app_name: str,
    variant_name: str,
    tar_path: Path,
    image_name: str,
    temp_dir: Path,
) -> Image:
    """Business logic for building a docker image from a tar file
    
    TODO: This should be a background task
    
    Arguments:
        app_name --  The `app_name` parameter is a string that represents the name of the application
        variant_name --  The `variant_name` parameter is a string that represents the variant of the \
            application. It could be a specific version, configuration, or any other distinguishing \
                factor for the application
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
            buildargs={"ROOT_PATH": f"/{app_name}/{variant_name}"},
            rm=True,
        )
        for line in build_log:
            logger.info(line)
        return Image(docker_id=image.id, tags=image.tags[0])
    except docker.errors.BuildError as ex:
        log = "Error building Docker image:\n"
        log += str(ex) + "\n"
        logger.error(log)
        raise HTTPException(status_code=500, detail=log)
    except Exception as ex:
        raise HTTPException(status_code=500, detail=str(ex))


@backoff.on_exception(
    backoff.expo, (ConnectError, CancelledError), max_tries=5
)
async def retrieve_templates_from_dockerhub(
    url: str, repo_owner: str, repo_name: str
) -> Union[List[dict], dict]:
    """
    Business logic to retrieve templates from DockerHub.
    
    Arguments:
        url -- The `url` parameter is a string that represents the URL endpoint for retrieving \
            templates. It should contain placeholders `{}` for the `repo_owner` and `repo_name` values to be \
            inserted. For example, if the URL endpoint is `https://hub.docker.com/v2/repositories/{}/{}/tags`
        repo_owner -- The `repo_owner` parameter represents the owner or organization of the repository \
            from which you want to retrieve templates
        repo_name -- The `repo_name` parameter is the name of the repository. It is a string that \
            represents the name of the repository where the templates are located
        
    Returns:
        A tuple of containing two values
    """

    async with httpx.AsyncClient() as client:
        response = await client.get(
            url.format(repo_owner, repo_name), timeout=10
        )
        if response.status_code == 200:
            response_data = response.json()
            return response_data

        response_data = response.json()
        return response_data


async def retrieve_templates_from_dockerhub_cached():
    """Retrieves templates from Docker Hub and caches the data in Redis for future use.

    Returns:
        List of tags data (cached or network-call)
    """

    r = redis_connection()

    cached_data = r.get("templates_data")
    if cached_data is not None:
        return json.loads(cached_data.decode("utf-8"))

    # If not cached, fetch data from Docker Hub and cache it in Redis
    response = await retrieve_templates_from_dockerhub(
        settings.docker_hub_url,
        settings.docker_hub_repo_owner,
        settings.docker_hub_repo_name,
    )
    response_data = response["results"]

    # Cache the data in Redis for 60 minutes
    r.set("templates_data", json.dumps(response_data), ex=3600)
    return response_data
