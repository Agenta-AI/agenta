from agenta.sdk.utils.cache import TTLLRUCache
from agenta.sdk.middlewares.running import vault


def test_ttl_lru_cache_pop_returns_and_removes_item():
    cache = TTLLRUCache(capacity=10, ttl=60)

    cache.put("k1", {"value": 1})

    assert cache.pop("k1") == {"value": 1}
    assert cache.get("k1") is None


def test_invalidate_secrets_cache_roundtrip(monkeypatch):
    test_cache = TTLLRUCache(capacity=10, ttl=60)
    monkeypatch.setattr(vault, "_cache", test_cache)

    credentials = "ApiKey test-key"

    assert vault.get_secrets_cache(credentials) is None

    payload = vault.pack_secrets_cache_payload(
        secrets=[{"kind": "provider_key"}],
        vault_secrets=[{"kind": "provider_key"}],
        local_secrets=[],
    )
    vault.set_secrets_cache(credentials, payload)

    cached = vault.get_secrets_cache(credentials)
    assert cached is not None
    assert cached["secrets"] == [{"kind": "provider_key"}]
    assert vault.unpack_secrets_cache_payload(cached) == (
        [{"kind": "provider_key"}],
        [{"kind": "provider_key"}],
        [],
    )

    invalidated = vault.invalidate_secrets_cache(credentials)
    assert invalidated is not None
    assert invalidated["vault_secrets"] == [{"kind": "provider_key"}]
    assert vault.get_secrets_cache(credentials) is None


def test_unpack_secrets_cache_payload_defaults_missing_lists():
    assert vault.unpack_secrets_cache_payload(
        {"secrets": [{"kind": "provider_key"}]}
    ) == (
        [{"kind": "provider_key"}],
        [],
        [],
    )


def test_has_invalid_secrets_error_detection_from_status_type():
    class Status:
        type = "https://agenta.ai/docs/errors#v0:schemas:invalid-secrets"
        message = "some message"

    class Response:
        status = Status()

    assert vault._has_invalid_secrets_error(Response()) is True


def test_has_invalid_secrets_error_detection_from_message():
    class Status:
        type = "https://agenta.ai/docs/errors#v0:schemas:other"
        message = "No API key found for model 'gpt-4'."

    class Response:
        status = Status()

    assert vault._has_invalid_secrets_error(Response()) is True
