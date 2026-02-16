from unittest.mock import patch

import pytest
from agenta.sdk.client import Agenta


@pytest.fixture
def agenta_client():
    # Set up the Agenta client with a mock API key
    with patch.dict(
        "os.environ",
        {"AGENTA_API_KEY": "mock_api_key", "AGENTA_HOST": "https://mock.agenta.ai"},
    ):
        client = Agenta()
    return client


def test_get_config_with_caching(agenta_client):
    """
    Test the caching mechanism of the get_config method to ensure it returns cached data.

    Args:
        agenta_client: The fixture providing an instance of the Agenta client.
    """
    # Setup the mock to return a predefined configuration
    with patch.object(
        agenta_client.client.configs,
        "get_config",
        return_value={"parameters": "something"},
    ) as mock_get_config:
        # Retrieve configuration to store in cache
        response = agenta_client.get_config("base123", "production")
        assert response == {"parameters": "something"}, (
            "First response should match the mock data."
        )

        # Modify the return value of the mock
        mock_get_config.return_value = {"parameters": "something else"}

        # Attempt to retrieve configuration again, expecting cached data
        response = agenta_client.get_config("base123", "production")
        assert response == {"parameters": "something"}, (
            "Second response should return cached data, not new mock data."
        )


def test_get_config_without_caching(agenta_client):
    """
    Test the get_config method without caching to ensure it always fetches new data.

    Args:
        agenta_client: The fixture providing an instance of the Agenta client.
    """
    # Setup the mock to return a predefined configuration
    with patch.object(
        agenta_client.client.configs,
        "get_config",
        return_value={"parameters": "something"},
    ) as mock_get_config:
        # Retrieve configuration with caching disabled
        response = agenta_client.get_config("base123", "production", cache_timeout=0)
        assert response == {"parameters": "something"}, (
            "First response should match the mock data."
        )

        # Modify the return value of the mock
        mock_get_config.return_value = {"parameters": "something else"}

        # Retrieve new configuration with caching disabled
        response = agenta_client.get_config("base123", "production", cache_timeout=0)
        assert response == {"parameters": "something else"}, (
            "Second response should match the new mock data."
        )
