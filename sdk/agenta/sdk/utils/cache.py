from typing import Optional, Dict
from os import getenv
from time import time
from collections import OrderedDict
from threading import Lock
from datetime import datetime

CACHE_CAPACITY = int(getenv("AGENTA_MIDDLEWARE_CACHE_CAPACITY", "512"))
CACHE_TTL = int(getenv("AGENTA_MIDDLEWARE_CACHE_TTL", str(60)))  # 1 minute


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

    def put(self, key, value):
        with self.lock:
            try:
                # LRU update
                self.cache.move_to_end(key)

            except KeyError:
                # Capacity check
                if len(self.cache) >= self.capacity:
                    self.cache.popitem(last=False)

            # Put
            self.cache[key] = (value, time() + self.ttl)


# Configuration-specific cache classes
DEFAULT_CONFIG_CACHE_TTL_SECONDS = int(getenv("AGENTA_SDK_CACHE_TTL", "60"))


class ConfigCacheItem:
    """Cache item for configuration responses with TTL expiration."""
    
    def __init__(self, config, ttl_seconds: int):
        self.value = config
        if ttl_seconds <= 0:
            # Immediately expired
            self._expiry = 0
        else:
            self._expiry = ttl_seconds + self.get_epoch_seconds()

    def is_expired(self) -> bool:
        """Check if this cache item has expired."""
        return self.get_epoch_seconds() > self._expiry

    @staticmethod
    def get_epoch_seconds() -> int:
        """Get current time as epoch seconds."""
        return int(datetime.now().timestamp())


class SimpleConfigCache:
    """Simple TTL-based cache for configuration responses."""
    
    def __init__(self):
        self._cache: Dict[str, ConfigCacheItem] = {}
        self._lock = Lock()

    def get(self, key: str) -> Optional[ConfigCacheItem]:
        """Get a cache item by key. Returns None if not found or expired."""
        with self._lock:
            item = self._cache.get(key)
            if item is None:
                return None
            
            if item.is_expired():
                # Remove expired item
                del self._cache[key]
                return None
                
            return item

    def set(self, key: str, config, ttl_seconds: int) -> None:
        """Set a cache item with the given TTL."""
        with self._lock:
            self._cache[key] = ConfigCacheItem(config, ttl_seconds)

    def clear(self, pattern: Optional[str] = None) -> None:
        """Clear cache entries. If pattern provided, clear matching keys."""
        with self._lock:
            if pattern is None:
                self._cache.clear()
            else:
                keys_to_remove = [k for k in self._cache.keys() if pattern in k]
                for key in keys_to_remove:
                    del self._cache[key]

    @staticmethod
    def generate_cache_key(
        app_slug: Optional[str] = None,
        app_id: Optional[str] = None,
        variant_slug: Optional[str] = None,
        variant_version: Optional[int] = None,
        environment_slug: Optional[str] = None,
        environment_version: Optional[int] = None,
    ) -> str:
        """Generate a cache key from configuration parameters."""
        parts = []
        
        if app_slug:
            parts.append(f"app:{app_slug}")
        elif app_id:
            parts.append(f"app_id:{app_id}")
            
        if variant_slug:
            parts.append(f"variant:{variant_slug}")
            if variant_version:
                parts.append(f"v:{variant_version}")
                
        if environment_slug:
            parts.append(f"env:{environment_slug}")
            if environment_version:
                parts.append(f"env_v:{environment_version}")
        
        return "-".join(parts) if parts else "default"
