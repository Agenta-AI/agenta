import json
from typing import Any, Dict, List

from agenta_backend.config import settings
from agenta_backend.services import container_manager, db_manager
from agenta_backend.utils import redis_utils


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

    templates_ids = []
    templates_info = await retrieve_templates_info_from_s3(cache)
    for temp in templates:
        # Append the template id in the list of templates_ids
        # We do this to remove old templates from database
        templates_ids.append(int(temp["tag_id"]))
        for temp_info_key in templates_info:
            temp_info = templates_info[temp_info_key]
            if str(temp["name"]).startswith(temp_info_key):
                await db_manager.add_template(
                    **{
                        "tag_id": int(temp["tag_id"]),
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
                print(f"Template {temp['tag_id']} added to the database.")

                # Get docker hub config
                repo_owner = settings.docker_hub_repo_owner
                repo_name = settings.docker_hub_repo_name

                # Pull image from DockerHub
                image_res = await container_manager.pull_docker_image(
                    repo_name=f"{repo_owner}/{repo_name}", tag=temp["name"]
                )
                print(f"Template Image {image_res[0]['id']} pulled from DockerHub.")
                # TODO create image object
                # TODO connect image object to Template object

    # Remove old templates from database
    await db_manager.remove_old_template_from_db(templates_ids)


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
    response = await container_manager.retrieve_templates_from_dockerhub(
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
    response = await container_manager.get_templates_info_from_s3(
        "https://llm-app-json.s3.eu-central-1.amazonaws.com/llm_info.json"
    )

    # Cache the data in Redis for 60 minutes
    r.set("temp_data", json.dumps(response), ex=900)
    print("Using network call...")
    return response
