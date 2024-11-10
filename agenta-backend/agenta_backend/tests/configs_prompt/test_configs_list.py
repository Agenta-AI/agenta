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
async def test_configs_list_success(get_app_by_name):
    app = await get_app_by_name
    assert app is not None, "App with name :test_prompt_client not found."

    response = await test_client.post(
        "/api/variants/configs/list",
        json={
            "application_ref": {
                "slug": app.app_name,
                "version": None,
                "id": None,
            }
        },
    )

    assert response.status_code == status.HTTP_200_OK
    assert isinstance(response.json(), list)
    assert len(response.json()) > 0


@pytest.mark.asyncio
async def test_configs_list_not_found(get_app_by_name):
    app = await get_app_by_name
    assert app is not None, "App with name :test_prompt_client not found."

    response = await test_client.post(
        "/api/variants/configs/list",
        json={
            "application_ref": {
                "slug": "non_existent_app",
                "version": None,
                "id": None,
            }
        },
    )

    assert response.status_code == status.HTTP_200_OK
    assert [] == response.json()
