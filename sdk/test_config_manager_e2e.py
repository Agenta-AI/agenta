#!/usr/bin/env python3
"""
End-to-end test for ConfigManager caching functionality.
This tests the complete user-facing API with caching enabled.
"""

import sys
import asyncio
from unittest.mock import MagicMock, patch
from typing import Dict, Any

# Add the current directory to the path so we can import agenta modules
sys.path.insert(0, '.')

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


def test_config_manager_basic_caching():
    """Test basic ConfigManager caching functionality."""
    print("Testing ConfigManager basic caching...")
    
    with patch('agenta.api') as mock_api:
        from agenta.sdk.managers.config import ConfigManager
        
        # Mock API response
        mock_api.variants.configs_fetch.return_value = create_mock_config_response(
            prompt="Hello {{name}}", model="gpt-3.5-turbo"
        )
        
        # Clear cache before test
        ConfigManager.clear_cache()
        
        # First call - should hit API
        config1 = ConfigManager.get_from_registry(app_slug="test-app")
        assert mock_api.variants.configs_fetch.call_count == 1
        assert config1["prompt"] == "Hello {{name}}"
        assert config1["model"] == "gpt-3.5-turbo"
        print("✓ First call hit API and returned correct data")
        
        # Second call - should use cache
        config2 = ConfigManager.get_from_registry(app_slug="test-app")
        assert mock_api.variants.configs_fetch.call_count == 1  # No additional API calls
        assert config1 == config2
        print("✓ Second call used cache")


def test_config_manager_with_schema():
    """Test ConfigManager with Pydantic schema.""" 
    print("Testing ConfigManager with schema...")
    
    from pydantic import BaseModel
    
    class MyConfig(BaseModel):
        prompt: str
        model: str
        temperature: float = 0.7
    
    with patch('agenta.api') as mock_api:
        from agenta.sdk.managers.config import ConfigManager
        
        mock_api.variants.configs_fetch.return_value = create_mock_config_response(
            prompt="Hello world", model="gpt-4", temperature=0.8
        )
        
        ConfigManager.clear_cache()
        
        # First call with schema
        config = ConfigManager.get_from_registry(
            schema=MyConfig,
            app_slug="test-app"
        )
        
        assert isinstance(config, MyConfig)
        assert config.prompt == "Hello world"
        assert config.model == "gpt-4"
        assert config.temperature == 0.8
        print("✓ Schema validation and instantiation works")


def test_config_manager_cache_ttl():
    """Test ConfigManager cache TTL functionality."""
    print("Testing ConfigManager cache TTL...")
    
    with patch('agenta.api') as mock_api:
        from agenta.sdk.managers.config import ConfigManager
        
        mock_api.variants.configs_fetch.return_value = create_mock_config_response(
            test="ttl_test"
        )
        
        ConfigManager.clear_cache()
        
        # Test cache disabled (TTL = 0)
        config1 = ConfigManager.get_from_registry(
            app_slug="test-app-ttl", 
            cache_ttl_seconds=0
        )
        config2 = ConfigManager.get_from_registry(
            app_slug="test-app-ttl", 
            cache_ttl_seconds=0
        )
        assert mock_api.variants.configs_fetch.call_count == 2  # Both calls hit API
        print("✓ Cache disabled (TTL=0) works")
        
        # Test custom TTL
        ConfigManager.clear_cache()
        config3 = ConfigManager.get_from_registry(
            app_slug="test-app-ttl2", 
            cache_ttl_seconds=300
        )
        config4 = ConfigManager.get_from_registry(
            app_slug="test-app-ttl2", 
            cache_ttl_seconds=300
        )
        assert mock_api.variants.configs_fetch.call_count == 3  # Only one additional call
        print("✓ Custom TTL works")


def test_config_manager_fallback():
    """Test ConfigManager fallback functionality."""
    print("Testing ConfigManager fallback...")
    
    with patch('agenta.api') as mock_api:
        from agenta.sdk.managers.config import ConfigManager
        
        # Make API fail
        mock_api.variants.configs_fetch.side_effect = Exception("API Down")
        
        fallback = {
            "params": {
                "prompt": "Default prompt",
                "model": "gpt-3.5-turbo"
            }
        }
        
        config = ConfigManager.get_from_registry(
            app_slug="test-app",
            fallback_config=fallback
        )
        
        assert config["prompt"] == "Default prompt"
        assert config["model"] == "gpt-3.5-turbo"
        print("✓ Fallback configuration works")


def test_config_manager_complex_parameters():
    """Test ConfigManager with complex parameter combinations."""
    print("Testing ConfigManager with complex parameters...")
    
    with patch('agenta.api') as mock_api:
        from agenta.sdk.managers.config import ConfigManager
        
        mock_api.variants.configs_fetch.return_value = create_mock_config_response(
            variant="complex", environment="staging"
        )
        
        ConfigManager.clear_cache()
        
        # Test with variant and environment
        config1 = ConfigManager.get_from_registry(
            app_slug="complex-app",
            variant_slug="my-variant",
            variant_version=2,
            environment_slug="staging",
            cache_ttl_seconds=120
        )
        assert mock_api.variants.configs_fetch.call_count == 1
        assert config1["variant"] == "complex"
        
        # Same parameters should use cache
        config2 = ConfigManager.get_from_registry(
            app_slug="complex-app",
            variant_slug="my-variant", 
            variant_version=2,
            environment_slug="staging",
            cache_ttl_seconds=120
        )
        assert mock_api.variants.configs_fetch.call_count == 1  # No additional call
        
        # Different parameters should hit API
        config3 = ConfigManager.get_from_registry(
            app_slug="complex-app",
            variant_slug="my-variant",
            variant_version=3,  # Different version
            environment_slug="staging"
        )
        assert mock_api.variants.configs_fetch.call_count == 2  # New API call
        print("✓ Complex parameter combinations work correctly")


def test_config_manager_cache_clearing():
    """Test ConfigManager cache clearing."""
    print("Testing ConfigManager cache clearing...")
    
    with patch('agenta.api') as mock_api:
        from agenta.sdk.managers.config import ConfigManager
        
        mock_api.variants.configs_fetch.return_value = create_mock_config_response(
            test="clear_test"
        )
        
        ConfigManager.clear_cache()
        
        # Populate cache
        config1 = ConfigManager.get_from_registry(app_slug="app1")
        config2 = ConfigManager.get_from_registry(app_slug="app2")
        assert mock_api.variants.configs_fetch.call_count == 2
        
        # Verify cache is working
        config3 = ConfigManager.get_from_registry(app_slug="app1")
        assert mock_api.variants.configs_fetch.call_count == 2  # No additional call
        
        # Clear cache
        ConfigManager.clear_cache()
        
        # Should hit API again
        config4 = ConfigManager.get_from_registry(app_slug="app1")
        assert mock_api.variants.configs_fetch.call_count == 3
        print("✓ Cache clearing works")
        
        # Test pattern-based clearing
        ConfigManager.get_from_registry(app_slug="test-app-1")
        ConfigManager.get_from_registry(app_slug="test-app-2")
        ConfigManager.get_from_registry(app_slug="other-app")
        assert mock_api.variants.configs_fetch.call_count == 6
        
        # Clear only test-app entries
        ConfigManager.clear_cache("test-app")
        
        # test-app entries should hit API, other-app should use cache
        ConfigManager.get_from_registry(app_slug="test-app-1")  # Should hit API
        ConfigManager.get_from_registry(app_slug="other-app")    # Should use cache
        assert mock_api.variants.configs_fetch.call_count == 7  # Only one additional call
        print("✓ Pattern-based cache clearing works")


def test_async_config_manager():
    """Test async ConfigManager functionality."""
    print("Testing async ConfigManager...")
    
    async def run_async_test():
        with patch('agenta.async_api') as mock_async_api:
            from agenta.sdk.managers.config import ConfigManager
            
            # Mock async API - make it awaitable and track calls
            call_count = [0]
            
            async def mock_async_fetch(*args, **kwargs):
                call_count[0] += 1
                return create_mock_config_response(async_test="works")
            
            mock_async_api.variants.configs_fetch = mock_async_fetch
            
            ConfigManager.clear_cache()
            
            # First async call
            config1 = await ConfigManager.aget_from_registry(app_slug="async-app")
            assert call_count[0] == 1
            assert config1["async_test"] == "works"
            
            # Second call should use cache
            config2 = await ConfigManager.aget_from_registry(app_slug="async-app")
            assert call_count[0] == 1  # No additional call
            assert config1 == config2
            
            # Test with fallback
            async def mock_failing_fetch(*args, **kwargs):
                raise Exception("Async API Error")
            
            mock_async_api.variants.configs_fetch = mock_failing_fetch
            
            fallback = {"params": {"fallback": "async_fallback"}}
            config3 = await ConfigManager.aget_from_registry(
                app_slug="failing-app",
                fallback_config=fallback
            )
            assert config3["fallback"] == "async_fallback"
            print("✓ Async ConfigManager works correctly")
    
    asyncio.run(run_async_test())


def main():
    """Run all end-to-end tests."""
    print("Running ConfigManager end-to-end tests...\n")
    
    try:
        test_config_manager_basic_caching()
        print()
        test_config_manager_with_schema()
        print()
        test_config_manager_cache_ttl()
        print()
        test_config_manager_fallback()
        print()
        test_config_manager_complex_parameters()
        print()
        test_config_manager_cache_clearing()
        print()
        test_async_config_manager()
        print()
        print("🎉 All end-to-end tests passed!")
        print("\n✅ **CHECKPOINT 3 COMPLETED**: ConfigManager API works with caching!")
        return 0
    except Exception as e:
        print(f"❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    exit(main())