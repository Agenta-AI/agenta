from time import time
from collections import OrderedDict


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
