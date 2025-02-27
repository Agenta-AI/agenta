import os
import redis
from redis.exceptions import ConnectionError


def redis_connection() -> redis.Redis:
    """Returns a client object for connecting to a Redis service specified \
        by the REDIS_URL environment variable.

    :return: a Redis client object.
    """

    try:
        redis_client = redis.from_url(url=os.environ.get("REDIS_URL", None))
    except ConnectionRefusedError:
        raise ConnectionRefusedError(
            "Refuse connecting to redis service. Kindly check redis url."
        )
    except ConnectionError:
        raise ConnectionError("Could not connect to redis service.")
    return redis_client
