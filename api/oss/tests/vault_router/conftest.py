import os

import pytest
import pytest_asyncio
from httpx import AsyncClient, Timeout


AGENTA_HOST = os.environ.get("AGENTA_HOST", "http://localhost")
API_BASE_URL = f"{AGENTA_HOST}/api/vault/v1/"


@pytest.fixture
def api_base_url():
    """
    Fixture for the base API URL.
    """

    return API_BASE_URL


@pytest.fixture
def api_key():
    """
    Fixture for the API key.
    """

    return os.environ.get("API_KEY")


@pytest_asyncio.fixture
async def async_client(api_base_url, api_key):
    """
    Fixture to create an AsyncClient for API testing.
    """

    assert api_key, "API_KEY environment variable is not set"
    async with AsyncClient(
        base_url=api_base_url,
        timeout=Timeout(timeout=6, read=None, write=5),
        headers={
            "Authorization": f"ApiKey {api_key}",
            "Content-Type": "application/json",
        },
    ) as client:
        yield client


@pytest.fixture
def valid_secret_payload():
    """
    Fixture for a valid secret payload.
    """

    return {
        "header": {"name": "OpenAI", "description": "Lorem Ipsum"},
        "secret": {
            "kind": "provider_key",
            "data": {"provider": "openai", "key": "sk-xxxxxxxxxxxx"},
        },
    }


@pytest.fixture
def invalid_secret_payload():
    """
    Fixture for an invalid secret payload.
    """

    return {"header": {}, "secret": {}}
