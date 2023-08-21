import json
import redis
from typing import List
from agenta_backend.config import settings
from agenta_backend.services.container_manager import (
    retrieve_templates_from_dockerhub,
    get_templates_info,
)


def redis_connection() -> redis.Redis:
    """Returns a Redis client object connected to a Redis server specified
        by the `redis_url` setting.

    Returns:
        A Redis client object.
    """

    redis_client = redis.from_url(url=settings.redis_url)
    return redis_client


async def retrieve_templates_from_dockerhub_cached(cache: bool) -> List[dict]:
    """Retrieves templates from Docker Hub and caches the data in Redis for future use.
    Args:
        cache: A boolean value that indicates whether to use the cached data or not.
    Returns:
        List of tags data (cached or network-call)
    """
    r = redis_connection()
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


async def retrieve_templates_info_from_dockerhub_cached(cache: bool) -> List[dict]:
    """Retrieves templates information from Docker Hub and caches the data in Redis for future use.
    Args:
        cache: A boolean value that indicates whether to use the cached data or not.
    Returns:
        Information about organization in DockerHub (cached or network-call)
    """
    r = redis_connection()
    if cache:
        cached_data = r.get("org_data")
        if cached_data is not None:
            print("Using cache...")
            return json.loads(cached_data.decode("utf-8"))

    # If not cached, fetch data from Docker Hub and cache it in Redis
    response = await get_templates_info(
        settings.docker_hub_url,
        settings.docker_hub_repo_owner,
        settings.docker_hub_repo_name,
    )
    response_data = response["full_description"]

    # Cache the data in Redis for 60 minutes
    r.set("org_data", json.dumps(response_data), ex=900)
    print("Using network call...")
    return response_data
