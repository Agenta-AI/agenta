import pytest
import time
from unittest.mock import MagicMock, patch

# Mock the agenta imports to avoid API connections during testing
with patch('agenta.sdk.utils.preinit.PreInitObject'), \
     patch('agenta.client.backend.types'), \
     patch('agenta.sdk.tracing'), \
     patch('opentelemetry.trace'):
    from agenta.sdk.utils.cache import ConfigCacheItem, SimpleConfigCache


class TestConfigCacheItem:
    def test_cache_item_not_expired_when_fresh(self):
        """Test that a fresh cache item is not expired."""
        config = MagicMock()
        config.params = {"test": "value"}
        
        item = ConfigCacheItem(config, ttl_seconds=60)
        assert not item.is_expired()
        assert item.value == config

    def test_cache_item_expired_after_ttl(self):
        """Test that a cache item expires after its TTL."""
        config = MagicMock()
        config.params = {"test": "value"}
        
        # Create item with 0 TTL (immediately expired)
        item = ConfigCacheItem(config, ttl_seconds=0)
        time.sleep(0.1)  # Small delay to ensure expiry
        assert item.is_expired()

    def test_cache_item_epoch_seconds(self):
        """Test that epoch seconds returns a reasonable timestamp."""
        epoch = ConfigCacheItem.get_epoch_seconds()
        assert isinstance(epoch, int)
        assert epoch > 1600000000  # Sanity check - after 2020


class TestSimpleConfigCache:
    def test_cache_miss_returns_none(self):
        """Test that cache miss returns None."""
        cache = SimpleConfigCache()
        assert cache.get("nonexistent") is None

    def test_cache_hit_returns_value(self):
        """Test that cache hit returns the cached value."""
        cache = SimpleConfigCache()
        config = MagicMock()
        config.params = {"test": "value"}
        
        cache.set("key1", config, 60)
        
        cached_item = cache.get("key1")
        assert cached_item is not None
        assert cached_item.value == config
        assert cached_item.value.params == {"test": "value"}

    def test_expired_item_returns_none(self):
        """Test that expired items are removed and return None."""
        cache = SimpleConfigCache()
        config = MagicMock()
        config.params = {"test": "value"}
        
        # Set with 0 TTL (immediately expired)
        cache.set("key1", config, 0)
        time.sleep(0.1)  # Small delay to ensure expiry
        
        cached_item = cache.get("key1")
        assert cached_item is None
        
        # Verify item was removed from internal cache
        assert "key1" not in cache._cache

    def test_cache_clear_all(self):
        """Test that clear() removes all entries."""
        cache = SimpleConfigCache()
        config1 = MagicMock()
        config2 = MagicMock()
        
        cache.set("key1", config1, 60)
        cache.set("key2", config2, 60)
        
        cache.clear()
        
        assert cache.get("key1") is None
        assert cache.get("key2") is None

    def test_cache_clear_with_pattern(self):
        """Test that clear(pattern) removes only matching entries."""
        cache = SimpleConfigCache()
        config1 = MagicMock()
        config2 = MagicMock()
        config3 = MagicMock()
        
        cache.set("app1-variant1", config1, 60)
        cache.set("app1-variant2", config2, 60)
        cache.set("app2-variant1", config3, 60)
        
        # Clear only app1 entries
        cache.clear("app1")
        
        assert cache.get("app1-variant1") is None
        assert cache.get("app1-variant2") is None
        assert cache.get("app2-variant1") is not None


class TestCacheKeyGeneration:
    def test_generate_cache_key_app_slug_only(self):
        """Test cache key generation with app_slug only."""
        key = SimpleConfigCache.generate_cache_key(app_slug="my-app")
        assert key == "app:my-app"

    def test_generate_cache_key_app_id_only(self):
        """Test cache key generation with app_id only."""
        key = SimpleConfigCache.generate_cache_key(app_id="123")
        assert key == "app_id:123"

    def test_generate_cache_key_full_variant(self):
        """Test cache key generation with variant information."""
        key = SimpleConfigCache.generate_cache_key(
            app_slug="my-app",
            variant_slug="my-variant",
            variant_version=2
        )
        assert key == "app:my-app-variant:my-variant-v:2"

    def test_generate_cache_key_full_environment(self):
        """Test cache key generation with environment information."""
        key = SimpleConfigCache.generate_cache_key(
            app_slug="my-app",
            environment_slug="production",
            environment_version=1
        )
        assert key == "app:my-app-env:production-env_v:1"

    def test_generate_cache_key_all_parameters(self):
        """Test cache key generation with all parameters."""
        key = SimpleConfigCache.generate_cache_key(
            app_slug="my-app",
            variant_slug="my-variant",
            variant_version=2,
            environment_slug="staging",
            environment_version=1
        )
        expected = "app:my-app-variant:my-variant-v:2-env:staging-env_v:1"
        assert key == expected

    def test_generate_cache_key_app_slug_preferred_over_id(self):
        """Test that app_slug is preferred over app_id when both provided."""
        key = SimpleConfigCache.generate_cache_key(
            app_slug="my-app",
            app_id="123"
        )
        assert key == "app:my-app"
        assert "app_id:123" not in key

    def test_generate_cache_key_default_when_empty(self):
        """Test that default key is returned when no parameters provided."""
        key = SimpleConfigCache.generate_cache_key()
        assert key == "default"

    def test_generate_cache_key_variant_without_version(self):
        """Test cache key generation with variant but no version."""
        key = SimpleConfigCache.generate_cache_key(
            app_slug="my-app",
            variant_slug="my-variant"
        )
        assert key == "app:my-app-variant:my-variant"
        assert "v:" not in key

    def test_generate_cache_key_environment_without_version(self):
        """Test cache key generation with environment but no version."""
        key = SimpleConfigCache.generate_cache_key(
            app_slug="my-app",
            environment_slug="production"
        )
        assert key == "app:my-app-env:production"
        assert "env_v:" not in key