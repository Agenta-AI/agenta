import httpx
from cachetools import TTLCache, cachedmethod


class CachingHTTPClient(httpx.Client):
    def __init__(self, cache_ttl_seconds=300, *args, **kwargs):
        print(cache_ttl_seconds)
        super().__init__(*args, **kwargs)
        self.cache = TTLCache(maxsize=100, ttl=cache_ttl_seconds)

    @cachedmethod(lambda self: self.cache)
    def get(self, *args, **kwargs):
        print("Checking cache...")
        return super().get(*args, **kwargs)
