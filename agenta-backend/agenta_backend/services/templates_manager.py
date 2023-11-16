import json
import backoff
from typing import Any, Dict, List
import httpx
import os
from agenta_backend.config import settings
from agenta_backend.services import db_manager
from agenta_backend.utils import redis_utils
from httpx import ConnectError, TimeoutException
from asyncio.exceptions import CancelledError

if os.environ["FEATURE_FLAG"] in ["oss", "cloud"]:
    from agenta_backend.services import container_manager

from typing import Union


async def update_and_sync_templates(cache: bool = True) -> None:
    """
    Updates and synchronizes templates by retrieving templates from DockerHub and S3, adding new templates to the database,
    and removing old templates from the database.

    Args:
        cache (bool): A boolean flag indicating whether to use cached templates or not. Defaults to True.

    Returns:
        None
    """
    templates = await retrieve_templates_from_dockerhub_cached(cache)

    templates_ids_not_to_remove = []
    templates_info = await retrieve_templates_info_from_s3(cache)
    for temp in templates:
        if temp["name"] in list(templates_info.keys()):
            templates_ids_not_to_remove.append(int(temp["id"]))
            temp_info = templates_info[temp["name"]]
            template_id = await db_manager.add_template(
                **{
                    "tag_id": int(temp["id"]),
                    "name": temp["name"],
                    "repo_name": temp.get("last_updater_username", "repo_name"),
                    "title": temp_info["name"],
                    "description": temp_info["description"],
                    "size": (
                        temp["images"][0]["size"]
                        if not temp.get("size", None)
                        else temp["size"]
                    ),
                    "digest": temp["digest"],
                    "last_pushed": (
                        temp["images"][0]["last_pushed"]
                        if not temp.get("last_pushed", None)
                        else temp["last_pushed"]
                    ),
                }
            )
            print(f"Template {template_id} added to the database.")

            # Get docker hub config
            repo_owner = settings.docker_hub_repo_owner
            repo_name = settings.docker_hub_repo_name

            # Pull image from DockerHub
            image_res = await container_manager.pull_docker_image(
                repo_name=f"{repo_owner}/{repo_name}", tag=temp["name"]
            )
            print(f"Template Image {image_res[0]['id']} pulled from DockerHub.")

    # Remove old templates from database
    await db_manager.remove_old_template_from_db(templates_ids_not_to_remove)


async def retrieve_templates_from_dockerhub_cached(cache: bool) -> List[dict]:
    """Retrieves templates from Docker Hub and caches the data in Redis for future use.
    Args:
        cache: A boolean value that indicates whether to use the cached data or not.
    Returns:
        List of tags data (cached or network-call)
    """
    r = redis_utils.redis_connection()
    if cache:
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
    r.set("templates_data", json.dumps(response_data), ex=900)
    return response_data


async def retrieve_templates_info_from_s3(
    cache: bool,
) -> Dict[str, Dict[str, Any]]:
    """Retrieves templates information from s3 and caches the data in Redis for future use.

    Args:
        cache: A boolean value that indicates whether to use the cached data or not.

    Returns:
        Information about organization in s3 (cached or network-call)
    """

    r = redis_utils.redis_connection()
    if cache:
        cached_data = r.get("temp_data")
        if cached_data is not None:
            print("Using cache...")
            return json.loads(cached_data)

    # If not cached, fetch data from Docker Hub and cache it in Redis
    response = await get_templates_info_from_s3(
        "https://llm-app-json.s3.eu-central-1.amazonaws.com/llm_info.json"
    )

    # Cache the data in Redis for 60 minutes
    r.set("temp_data", json.dumps(response), ex=900)
    print("Using network call...")
    return response


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
