import os

import httpx
import pytest
from fastapi import status


# Set global variables
ENVIRONMENT = os.environ.get("ENVIRONMENT")
if ENVIRONMENT == "development":
    BACKEND_API_HOST = "http://host.docker.internal/api"
elif ENVIRONMENT == "github":
    BACKEND_API_HOST = "http://agenta-backend-test:8000"

# Initialize http client
test_client = httpx.AsyncClient(base_url=BACKEND_API_HOST)
timeout = httpx.Timeout(timeout=5, read=None, write=5)


@pytest.mark.asyncio
async def test_configs_delete_success(get_app_by_name):
    app = await get_app_by_name
    assert app is not None, "App with name :test_prompt_client not found."

    response = await test_client.delete(
        "/api/variants/configs/delete",
        params={"variant_slug": "from_pytest_for_deletion", "app_slug": app.app_name},
    )
    assert response.status_code == status.HTTP_200_OK
    assert "Variant deleted successfully." in response.json()


@pytest.mark.asyncio
async def test_configs_delete_not_found(get_app_by_name):
    app = await get_app_by_name
    assert app is not None, "App with name :test_prompt_client not found."

    response = await test_client.delete(
        "/api/variants/configs/delete",
        params={"variant_slug": "non-existent-variant", "app_slug": app.app_name},
    )
    assert response.status_code == status.HTTP_404_NOT_FOUND
    assert "Variant does not exist." in response.json()["detail"]
