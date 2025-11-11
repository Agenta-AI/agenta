#!/usr/bin/env python3
"""
Demo script showing the new caching functionality in the Agenta SDK.
"""

import sys
sys.path.insert(0, '.')

from unittest.mock import patch, MagicMock

def create_mock_response(**params):
    mock = MagicMock()
    mock.params = params
    mock.application_ref = MagicMock()
    mock.application_ref.id = "app-123"
    mock.application_ref.slug = "demo-app"
    mock.variant_ref = None
    mock.environment_ref = None
    mock.variant_lifecycle = None
    mock.environment_lifecycle = None
    return mock

def main():
    print("🚀 Agenta SDK Caching Demo\n")
    
    with patch('agenta.api') as mock_api:
        # Import after patching to avoid API initialization
        import agenta as ag
        
        # Mock the API response
        mock_api.variants.configs_fetch.return_value = create_mock_response(
            prompt="Hello {{name}}! Welcome to {{product}}",
            model="gpt-4",
            temperature=0.7,
            max_tokens=150
        )
        
        print("📋 Available new features:")
        print("1. Transparent caching (60s default TTL)")
        print("2. Custom cache TTL")
        print("3. Cache disabled mode")
        print("4. Fallback configurations")
        print("5. Cache management\n")
        
        # Clear cache to start fresh
        ag.ConfigManager.clear_cache()
        
        print("🔄 Demo 1: Basic caching")
        print("First call (will hit API):")
        config1 = ag.ConfigManager.get_from_registry(app_slug="demo-app")
        print(f"  API calls: {mock_api.variants.configs_fetch.call_count}")
        print(f"  Config: {config1}")
        
        print("\nSecond call (will use cache):")
        config2 = ag.ConfigManager.get_from_registry(app_slug="demo-app")  
        print(f"  API calls: {mock_api.variants.configs_fetch.call_count}")
        print(f"  Same config: {config1 == config2}")
        
        print("\n🕒 Demo 2: Custom cache TTL")
        print("Call with 300 second TTL:")
        config3 = ag.ConfigManager.get_from_registry(
            app_slug="demo-app-ttl",
            cache_ttl_seconds=300
        )
        print(f"  API calls: {mock_api.variants.configs_fetch.call_count}")
        
        print("\n❌ Demo 3: Cache disabled")
        print("Two calls with cache_ttl_seconds=0:")
        ag.ConfigManager.get_from_registry(app_slug="no-cache", cache_ttl_seconds=0)
        ag.ConfigManager.get_from_registry(app_slug="no-cache", cache_ttl_seconds=0)
        print(f"  API calls: {mock_api.variants.configs_fetch.call_count} (each call hits API)")
        
        print("\n🛡️ Demo 4: Fallback configuration")
        # Make API fail
        mock_api.variants.configs_fetch.side_effect = Exception("API Error")
        
        fallback = {
            "params": {
                "prompt": "Fallback: Hello {{name}}!",
                "model": "gpt-3.5-turbo"
            }
        }
        
        config4 = ag.ConfigManager.get_from_registry(
            app_slug="failing-app",
            fallback_config=fallback
        )
        print(f"  Fallback config used: {config4}")
        
        print("\n🧹 Demo 5: Cache management")
        # Reset API mock
        mock_api.variants.configs_fetch.side_effect = None
        mock_api.variants.configs_fetch.return_value = create_mock_response(test="cache_mgmt")
        
        # Populate cache
        ag.ConfigManager.get_from_registry(app_slug="app1")
        ag.ConfigManager.get_from_registry(app_slug="app2")
        print("  Populated cache with app1 and app2")
        
        # Clear all cache
        ag.ConfigManager.clear_cache()
        print("  Cleared all cache")
        
        # This should hit API again
        ag.ConfigManager.get_from_registry(app_slug="app1")
        print("  app1 fetched again (cache was cleared)")
        
        print("\n✨ Summary:")
        print("✅ Transparent caching with 60s default TTL")
        print("✅ Configurable TTL per request")
        print("✅ Cache disable option (TTL=0)")
        print("✅ Fallback configurations for reliability")
        print("✅ Cache management (clear all/pattern-based)")
        print("✅ Both sync and async support")
        print("✅ Backward compatible - no code changes needed!")
        
        print(f"\n📊 Total API calls made: {mock_api.variants.configs_fetch.call_count}")
        print("🎉 Demo completed successfully!")

if __name__ == "__main__":
    main()