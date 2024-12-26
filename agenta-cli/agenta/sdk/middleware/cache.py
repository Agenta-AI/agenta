from os import getenv
from time import time
from collections import OrderedDict

CACHE_CAPACITY = int(getenv("AGENTA_MIDDLEWARE_CACHE_CAPACITY", "512"))
CACHE_TTL = int(getenv("AGENTA_MIDDLEWARE_CACHE_TTL", str(5 * 60)))  # 5 minutes


class TTLLRUCache:
    def __init__(self, capacity: int, ttl: int):
        self.cache = OrderedDict()
        self.capacity = capacity
        self.ttl = ttl

    def get(self, key):
        # CACHE
        if key not in self.cache:
            return None

        value, expiry = self.cache[key]
        # -----

        # TTL
        if time() > expiry:
            del self.cache[key]

            return None
        # ---

        # LRU
        self.cache.move_to_end(key)
        # ---

        return value

    def put(self, key, value):
        # CACHE
        if key in self.cache:
            del self.cache[key]
        # CACHE & LRU
        elif len(self.cache) >= self.capacity:
            self.cache.popitem(last=False)
        # -----------

        # TTL
        self.cache[key] = (value, time() + self.ttl)
        # ---
