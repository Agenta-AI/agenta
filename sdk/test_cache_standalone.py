#!/usr/bin/env python3
"""
Standalone test for config cache functionality.
This bypasses the pytest conftest to avoid API dependencies.
"""

import sys
import time
from unittest.mock import MagicMock

# Add the current directory to the path so we can import agenta modules
sys.path.insert(0, '.')

# Direct import of our cache classes
from agenta.sdk.utils.cache import ConfigCacheItem, SimpleConfigCache


def test_config_cache_item():
    """Test ConfigCacheItem basic functionality."""
    print("Testing ConfigCacheItem...")
    
    # Test fresh item
    config = MagicMock()
    config.params = {"test": "value"}
    
    item = ConfigCacheItem(config, ttl_seconds=60)
    assert not item.is_expired(), "Fresh item should not be expired"
    assert item.value == config, "Item value should match input"
    print("✓ Fresh cache item test passed")
    
    # Test expired item
    expired_item = ConfigCacheItem(config, ttl_seconds=0)
    time.sleep(0.1)  # Small delay to ensure expiry
    assert expired_item.is_expired(), "Item with 0 TTL should be expired"
    print("✓ Expired cache item test passed")
    
    # Test epoch seconds
    epoch = ConfigCacheItem.get_epoch_seconds()
    assert isinstance(epoch, int), "Epoch should be integer"
    assert epoch > 1600000000, "Epoch should be reasonable timestamp"
    print("✓ Epoch seconds test passed")


def test_simple_config_cache():
    """Test SimpleConfigCache basic functionality."""
    print("Testing SimpleConfigCache...")
    
    cache = SimpleConfigCache()
    
    # Test cache miss
    assert cache.get("nonexistent") is None, "Cache miss should return None"
    print("✓ Cache miss test passed")
    
    # Test cache hit
    config = MagicMock()
    config.params = {"test": "value"}
    
    cache.set("key1", config, 60)
    cached_item = cache.get("key1")
    assert cached_item is not None, "Cache hit should return item"
    assert cached_item.value == config, "Cached value should match"
    print("✓ Cache hit test passed")
    
    # Test expired item removal
    cache.set("expired_key", config, 0)
    time.sleep(0.1)
    cached_item = cache.get("expired_key")
    assert cached_item is None, "Expired item should return None"
    assert "expired_key" not in cache._cache, "Expired item should be removed"
    print("✓ Expired item removal test passed")
    
    # Test cache clear
    cache.set("key1", config, 60)
    cache.set("key2", config, 60)
    cache.clear()
    assert cache.get("key1") is None, "All items should be cleared"
    assert cache.get("key2") is None, "All items should be cleared"
    print("✓ Cache clear test passed")
    
    # Test pattern-based clear
    cache.set("app1-variant1", config, 60)
    cache.set("app1-variant2", config, 60)
    cache.set("app2-variant1", config, 60)
    
    cache.clear("app1")
    assert cache.get("app1-variant1") is None, "Pattern match should be cleared"
    assert cache.get("app1-variant2") is None, "Pattern match should be cleared"
    assert cache.get("app2-variant1") is not None, "Non-match should remain"
    print("✓ Pattern-based clear test passed")


def test_cache_key_generation():
    """Test cache key generation."""
    print("Testing cache key generation...")
    
    # Test basic cases
    key = SimpleConfigCache.generate_cache_key(app_slug="my-app")
    assert key == "app:my-app", f"Expected 'app:my-app', got '{key}'"
    print("✓ Basic app slug test passed")
    
    key = SimpleConfigCache.generate_cache_key(app_id="123")
    assert key == "app_id:123", f"Expected 'app_id:123', got '{key}'"
    print("✓ Basic app id test passed")
    
    # Test complex case
    key = SimpleConfigCache.generate_cache_key(
        app_slug="my-app",
        variant_slug="my-variant",
        variant_version=2,
        environment_slug="staging",
        environment_version=1
    )
    expected = "app:my-app-variant:my-variant-v:2-env:staging-env_v:1"
    assert key == expected, f"Expected '{expected}', got '{key}'"
    print("✓ Complex key generation test passed")
    
    # Test app_slug preference over app_id
    key = SimpleConfigCache.generate_cache_key(app_slug="my-app", app_id="123")
    assert key == "app:my-app", f"Expected 'app:my-app', got '{key}'"
    assert "app_id:123" not in key, "app_id should not appear when app_slug present"
    print("✓ App slug preference test passed")
    
    # Test default when empty
    key = SimpleConfigCache.generate_cache_key()
    assert key == "default", f"Expected 'default', got '{key}'"
    print("✓ Default key test passed")


def main():
    """Run all tests."""
    print("Running standalone cache tests...\n")
    
    try:
        test_config_cache_item()
        print()
        test_simple_config_cache()
        print()
        test_cache_key_generation()
        print()
        print("🎉 All tests passed!")
        return 0
    except Exception as e:
        print(f"❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    exit(main())