import os
import redis
from redis.exceptions import ConnectionError


def redis_connection() -> redis.Redis:
    """Returns a Redis client object connected to a Redis server specified
        by the `redis_url` setting.

    Returns:
        A Redis client object.
    """

    try:
        redis_client = redis.from_url(url=os.environ.get("REDIS_URL", None))
    except (ConnectionRefusedError, ConnectionError):
        raise RuntimeError("Could not connect to redis service.")
    return redis_client
