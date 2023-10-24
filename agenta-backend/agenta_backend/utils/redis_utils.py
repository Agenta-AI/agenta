import redis
from agenta_backend.config import settings


def redis_connection() -> redis.Redis:
    """Returns a Redis client object connected to a Redis server specified
        by the `redis_url` setting.

    Returns:
        A Redis client object.
    """

    redis_client = redis.from_url(url=settings.redis_url)
    return redis_client
