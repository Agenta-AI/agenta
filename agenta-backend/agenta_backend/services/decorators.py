from functools import wraps
from cachetools import TTLCache


def async_lru_cache_with_ttl(maxsize: int, ttl: int):
    """Decorator that adds caching functionality with a
    time-to-live (TTL) feature to an asynchronous function.

    Arguments:
        maxsize -- The `maxsize` parameter specifies the maximum number of items that \
            can be stored in the cache. Once the cache reaches this maximum size, the least \
                recently used items will be evicted to make room for new items
        ttl -- The `ttl` parameter stands for "time to live" and represents the maximum \
            amount of time (in seconds) that an item can remain in the cache before it is \
                considered expired and automatically removed
    
    Returns:
        A decorator function.
    """

    cache = TTLCache(maxsize=maxsize, ttl=ttl)

    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            key = (args, tuple(kwargs.items()))
            if key in cache:
                return cache[key]

            result = await func(*args, **kwargs)
            cache[key] = result
            return result

        return wrapper

    return decorator
