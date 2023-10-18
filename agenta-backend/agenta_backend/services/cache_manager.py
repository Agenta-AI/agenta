import json
import redis
from typing import List, Dict, Any

from agenta_backend.config import settings
from agenta_backend.services.container_manager import (
    retrieve_templates_from_dockerhub,
    get_templates_info_from_s3,
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


async def retrieve_templates_info_from_s3(
    cache: bool,
) -> Dict[str, Dict[str, Any]]:
    """Retrieves templates information from s3 and caches the data in Redis for future use.

    Args:
        cache: A boolean value that indicates whether to use the cached data or not.

    Returns:
        Information about organization in s3 (cached or network-call)
    """

    r = redis_connection()
    if cache:
        cached_data = r.get("temp_data")
        if cached_data is not None:
            print("Using cache...")
            return json.loads(cached_data.decode("utf-8"))

    # If not cached, fetch data from Docker Hub and cache it in Redis
    response = await get_templates_info_from_s3(
        "https://llm-app-json.s3.eu-central-1.amazonaws.com/llm_info.json"
    )

    # Cache the data in Redis for 60 minutes
    r.set("temp_data", response, ex=900)
    print("Using network call...")
    return response
