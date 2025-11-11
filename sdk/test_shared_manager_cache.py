#!/usr/bin/env python3
"""
Integration test for SharedManager caching functionality.
This tests the cache integration without requiring a real API.
"""

import sys
from unittest.mock import MagicMock, patch
from typing import Dict, Any

# Add the current directory to the path so we can import agenta modules
sys.path.insert(0, '.')

# Mock the agenta types and API
mock_config_response = MagicMock()
mock_config_response.params = {"test": "value"}
mock_config_response.application_ref = MagicMock()
mock_config_response.application_ref.id = "app-123"
mock_config_response.application_ref.slug = "test-app"
mock_config_response.variant_ref = None
mock_config_response.environment_ref = None
mock_config_response.variant_lifecycle = None
mock_config_response.environment_lifecycle = None

def create_mock_config_response(**params):
    """Create a mock ConfigResponseModel with given params."""
    mock_response = MagicMock()
    mock_response.params = params
    mock_response.application_ref = MagicMock()
    mock_response.application_ref.id = "app-123"
    mock_response.application_ref.slug = "test-app"
    mock_response.variant_ref = None
    mock_response.environment_ref = None
    mock_response.variant_lifecycle = None
    mock_response.environment_lifecycle = None
    return mock_response


def test_cache_integration():
    """Test SharedManager cache integration."""
    print("Testing SharedManager cache integration...")
    
    # Mock the API client
    with patch('agenta.api') as mock_api:
        # Import SharedManager after patching
        from agenta.sdk.managers.shared import SharedManager
        
        # Mock API response
        mock_api.variants.configs_fetch.return_value = create_mock_config_response(
            test="value", model="gpt-3.5-turbo"
        )
        
        # Clear cache before test
        SharedManager.clear_cache()
        
        # First call - should hit API
        config1 = SharedManager.fetch(app_slug="test-app")
        assert mock_api.variants.configs_fetch.call_count == 1
        assert config1.params["test"] == "value"
        print("✓ First fetch hit API")
        
        # Second call with same parameters - should use cache
        config2 = SharedManager.fetch(app_slug="test-app")
        assert mock_api.variants.configs_fetch.call_count == 1  # No additional API calls
        assert config1.params == config2.params
        print("✓ Second fetch used cache")
        
        # Different parameters - should hit API again
        config3 = SharedManager.fetch(app_slug="test-app", variant_slug="variant1")
        assert mock_api.variants.configs_fetch.call_count == 2  # New API call
        print("✓ Different parameters hit API")


def test_cache_disabled():
    """Test cache disabled functionality."""
    print("Testing cache disabled functionality...")
    
    with patch('agenta.api') as mock_api:
        from agenta.sdk.managers.shared import SharedManager
        
        mock_api.variants.configs_fetch.return_value = create_mock_config_response(
            test="value1"
        )
        
        SharedManager.clear_cache()
        
        # Both calls should hit API when cache is disabled
        config1 = SharedManager.fetch(app_slug="test-app", cache_ttl_seconds=0)
        config2 = SharedManager.fetch(app_slug="test-app", cache_ttl_seconds=0)
        
        assert mock_api.variants.configs_fetch.call_count == 2
        print("✓ Cache disabled calls both hit API")


def test_fallback_config():
    """Test fallback configuration functionality."""
    print("Testing fallback configuration...")
    
    with patch('agenta.api') as mock_api:
        from agenta.sdk.managers.shared import SharedManager
        
        # Make API call fail
        mock_api.variants.configs_fetch.side_effect = Exception("API Error")
        
        fallback = {"params": {"prompt": "fallback prompt", "model": "gpt-3.5-turbo"}}
        
        # Should return fallback config on API failure
        config = SharedManager.fetch(
            app_slug="test-app",
            fallback_config=fallback
        )
        
        assert config.params == fallback["params"]
        print("✓ Fallback configuration used on API failure")


def test_cache_ttl():
    """Test custom cache TTL."""
    print("Testing custom cache TTL...")
    
    with patch('agenta.api') as mock_api:
        from agenta.sdk.managers.shared import SharedManager
        import time
        
        mock_api.variants.configs_fetch.return_value = create_mock_config_response(
            test="ttl_value"
        )
        
        SharedManager.clear_cache()
        
        # Set very short TTL (using negative to immediately expire)
        config1 = SharedManager.fetch(app_slug="test-app-ttl", cache_ttl_seconds=0)
        assert mock_api.variants.configs_fetch.call_count == 1
        
        # Should hit API again as cache was disabled (ttl=0)
        config2 = SharedManager.fetch(app_slug="test-app-ttl", cache_ttl_seconds=0)
        assert mock_api.variants.configs_fetch.call_count == 2
        
        # Now test with short but valid TTL
        SharedManager.clear_cache()
        config3 = SharedManager.fetch(app_slug="test-app-ttl2", cache_ttl_seconds=60)
        assert mock_api.variants.configs_fetch.call_count == 3
        
        # Should use cache
        config4 = SharedManager.fetch(app_slug="test-app-ttl2", cache_ttl_seconds=60)  
        assert mock_api.variants.configs_fetch.call_count == 3  # No additional call
        print("✓ Custom TTL respected")


def test_cache_clearing():
    """Test cache clearing functionality."""
    print("Testing cache clearing...")
    
    with patch('agenta.api') as mock_api:
        from agenta.sdk.managers.shared import SharedManager
        
        mock_api.variants.configs_fetch.return_value = create_mock_config_response(
            test="clear_value"
        )
        
        SharedManager.clear_cache()
        
        # Populate cache
        config1 = SharedManager.fetch(app_slug="app1")
        config2 = SharedManager.fetch(app_slug="app2")
        assert mock_api.variants.configs_fetch.call_count == 2
        
        # Clear cache
        SharedManager.clear_cache()
        
        # Should hit API again after cache clear
        config3 = SharedManager.fetch(app_slug="app1")
        assert mock_api.variants.configs_fetch.call_count == 3
        print("✓ Cache clearing works")


def test_async_cache_integration():
    """Test async SharedManager cache integration.""" 
    print("Testing async SharedManager cache integration...")
    
    import asyncio
    
    async def run_async_test():
        with patch('agenta.async_api') as mock_async_api:
            from agenta.sdk.managers.shared import SharedManager
            
            # Mock async API response - need to make it awaitable and track calls
            call_count = [0]  # Use list to allow modification in nested function
            
            async def mock_async_fetch(*args, **kwargs):
                call_count[0] += 1
                return create_mock_config_response(test="async_value")
            
            mock_async_api.variants.configs_fetch = mock_async_fetch
            
            SharedManager.clear_cache()
            
            # First async call - should hit API
            config1 = await SharedManager.afetch(app_slug="test-app")
            assert call_count[0] == 1
            
            # Second call - should use cache
            config2 = await SharedManager.afetch(app_slug="test-app")
            assert call_count[0] == 1  # No additional calls
            assert config1.params == config2.params
            print("✓ Async cache integration works")
    
    asyncio.run(run_async_test())


def main():
    """Run all integration tests."""
    print("Running SharedManager cache integration tests...\n")
    
    try:
        test_cache_integration()
        print()
        test_cache_disabled()
        print()
        test_fallback_config()
        print()
        test_cache_ttl()
        print()
        test_cache_clearing()
        print()
        test_async_cache_integration()
        print()
        print("🎉 All integration tests passed!")
        return 0
    except Exception as e:
        print(f"❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    exit(main())