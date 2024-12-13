import pytest
import httpx
import pytest_asyncio

# Configure pytest-asyncio to use strict mode
def pytest_configure(config):
    config.option.asyncio_mode = "strict"

@pytest.fixture
def chat_url():
    return "http://localhost/chat-live-sdk"  # Adjust this if your services run on different ports

@pytest.fixture
def completion_url():
    return "http://localhost/completion-live-sdk"

@pytest_asyncio.fixture
async def async_client():
    async with httpx.AsyncClient() as client:
        yield client
