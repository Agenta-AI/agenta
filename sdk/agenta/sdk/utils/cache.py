from typing import Optional
from os import getenv
from time import time
from collections import OrderedDict
from threading import Lock

CACHE_CAPACITY = int(getenv("AGENTA_MIDDLEWARE_CACHE_CAPACITY", "512"))
CACHE_TTL = int(getenv("AGENTA_MIDDLEWARE_CACHE_TTL", str(5 * 60)))  # 5 minutes


class TTLLRUCache:
    def __init__(
        self,
        capacity: Optional[int] = CACHE_CAPACITY,
        ttl: Optional[int] = CACHE_TTL,
    ):
        self.cache = OrderedDict()
        self.capacity = capacity
        self.ttl = ttl
        self.lock = Lock()

    def get(self, key):
        with self.lock:
            # Get
            value, expiry = self.cache.get(key, (None, None))

            # Null check
            if value is None:
                return None

            # TTL check
            if time() > expiry:
                del self.cache[key]
                return None

            # LRU update
            self.cache.move_to_end(key)

            return value

    def put(self, key, value, ttl: Optional[int] = None):
        with self.lock:
            try:
                # LRU update
                self.cache.move_to_end(key)

            except KeyError:
                # Capacity check
                if len(self.cache) >= self.capacity:
                    self.cache.popitem(last=False)

            # Put
            self.cache[key] = (value, time() + (ttl if ttl is not None else self.ttl))
