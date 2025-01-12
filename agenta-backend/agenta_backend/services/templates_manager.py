import os
import json
import httpx
import backoff

from typing import Any, Dict, List, Union
from asyncio.exceptions import CancelledError
from httpx import ConnectError, TimeoutException
from agenta_backend.utils import redis_utils
from agenta_backend.services import db_manager
from agenta_backend.utils.common import isCloud, isOss

from datetime import datetime, timezone

from agenta_backend.services.helpers import convert_to_utc_datetime

from agenta_backend.resources.templates.templates import templates

if isCloud() or isOss():
    from agenta_backend.services import container_manager


agenta_template_repo = os.getenv("AGENTA_TEMPLATE_REPO")
docker_hub_url = os.getenv("DOCKER_HUB_URL")


async def update_and_sync_templates(cache: bool = True) -> None:
    """
    Updates and synchronizes templates by retrieving templates from DockerHub and S3, adding new templates to the database,
    and removing old templates from the database.

    Args:
        cache (bool): A boolean flag indicating whether to use cached templates or not. Defaults to True.

    Returns:
        None
    """
    docker_templates = await retrieve_templates_from_dockerhub_cached(cache)

    templates_ids_not_to_remove = []

    for temp in docker_templates:
        if temp["name"] in list(templates.keys()):
            templates_ids_not_to_remove.append(int(temp["id"]))
            temp_info = templates[temp["name"]]
            last_pushed = convert_to_utc_datetime(temp.get("last_pushed"))

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
                    "last_pushed": last_pushed,
                }
            )
            print(f"Template {template_id} added to the database.")

            # Pull image from DockerHub
            image_res = await container_manager.pull_docker_image(
                repo_name=f"{agenta_template_repo}", tag=temp["name"]
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
        docker_hub_url,
        agenta_template_repo,
    )
    response_data = response["results"]

    # Cache the data in Redis for 60 minutes
    r.set("templates_data", json.dumps(response_data), ex=900)
    return response_data


@backoff.on_exception(backoff.expo, (ConnectError, CancelledError), max_tries=5)
async def retrieve_templates_from_dockerhub(
    url: str, repo_name: str
) -> Union[List[dict], dict]:
    """
    Business logic to retrieve templates from DockerHub.

    Args:
        url (str): The URL endpoint for retrieving templates. Should contain placeholders `{}`
            for the `repo_owner` and `repo_name` values to be inserted. For example:
            `https://hub.docker.com/v2/repositories/{}/{}/tags`.
        repo_name (str): The name of the repository where the templates are located.

    Returns:
        tuple: A tuple containing two values.
    """

    async with httpx.AsyncClient() as client:
        response = await client.get(f"{url}/{repo_name}/tags", timeout=90)
        if response.status_code == 200:
            response_data = response.json()
            return response_data

        response_data = response.json()
        return response_data
