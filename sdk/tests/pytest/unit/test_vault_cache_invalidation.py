from json import dumps

from agenta.sdk.utils.cache import TTLLRUCache
from agenta.sdk.middlewares.running import vault


def test_ttl_lru_cache_delete_removes_key():
    cache = TTLLRUCache(capacity=2, ttl=60)
    cache.put("k", {"v": 1})

    assert cache.get("k") == {"v": 1}

    cache.delete("k")

    assert cache.get("k") is None


def test_invalidate_secrets_cache_removes_cached_secrets(monkeypatch):
    monkeypatch.setattr(vault, "_CACHE_ENABLED", True)
    test_cache = TTLLRUCache(capacity=10, ttl=60)
    monkeypatch.setattr(vault, "_cache", test_cache)

    credentials = "ApiKey abc123"
    headers = {"Authorization": credentials}
    cache_key = dumps({"headers": headers}, sort_keys=True)

    test_cache.put(cache_key, {"secrets": [{"kind": "provider_key"}]})
    assert test_cache.get(cache_key) is not None

    vault.invalidate_secrets_cache(credentials)

    assert test_cache.get(cache_key) is None
