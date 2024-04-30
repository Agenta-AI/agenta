import httpx
from cachetools import TTLCache, cached


class CacheMiddleware(httpx.Middleware):
    def __init__(self, cache: TTLCache):
        self.cache = cache

    async def __call__(self, request: httpx.Request, get_response: httpx.GetResponse):
        cache_key = f"{request.method}-{request.url}"

        if cache_key in self.cache:
            return self.cache[cache_key]

        response = await get_response(request)

        if response.status_code == 200:
            self.cache[cache_key] = response
        return response


cache = TTLCache(maxsize=100, ttl=300)

cache_middleware = CacheMiddleware(cache)
