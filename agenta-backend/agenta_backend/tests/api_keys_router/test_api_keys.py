import httpx
import pytest
import logging
from agenta_backend.models.db_engine import DBEngine
from agenta_backend.models.db_models import APIKeyDB
from agenta_backend.ee.services.auth_helper import APIKeyManager

# Initialize database engine
engine = DBEngine().engine()

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

# Initialize http client
test_client = httpx.AsyncClient()
timeout = httpx.Timeout(timeout=5, read=None, write=5)

api_key_manager = APIKeyManager()

# Set global variables
BACKEND_API_HOST = "http://localhost:8000"


@pytest.mark.asyncio
async def test_create_api_key(get_first_user_and_apikey):
    user, user_api_key = await get_first_user_and_apikey

    headers = {"Authorization": user_api_key}

    response = await test_client.post(
        f"{BACKEND_API_HOST}/keys/",
        headers=headers,
        timeout=timeout,
    )

    assert response.status_code == 200
    created_api_key = response.json()
    assert isinstance(created_api_key, str)
    assert len(created_api_key.split(".")) == 2


@pytest.mark.asyncio
async def test_list_api_key(get_first_user_and_apikey):
    user, user_api_key = await get_first_user_and_apikey

    headers = {"Authorization": user_api_key}

    response = await test_client.get(
        f"{BACKEND_API_HOST}/keys/",
        headers=headers,
        timeout=timeout,
    )

    assert response.status_code == 200
    assert len(response.json()) == 3


@pytest.mark.asyncio
async def test_delete_api_key(get_first_user_and_apikey):
    user, user_api_key = await get_first_user_and_apikey
    prefix = user_api_key.split(".")[0]

    headers = {"Authorization": user_api_key}
    response = await test_client.delete(
        f"{BACKEND_API_HOST}/keys/{prefix}/",
        headers=headers,
        timeout=timeout,
    )
    api_key = await engine.find_one(APIKeyDB, APIKeyDB.prefix == prefix)

    assert response.status_code == 200
    assert api_key is None
