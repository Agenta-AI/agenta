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

    response = await test_client.post(
        "/api/variants/configs/delete",
        json={
            "variant_ref": {
                "slug": "from_pytest_for_deletion",
                "version": None,
                "id": None,
            },
            "application_ref": {
                "slug": app.app_name,
                "version": None,
                "id": None,
            },
        },
    )
    assert response.status_code == 200
    assert status.HTTP_204_NO_CONTENT == response.json()


@pytest.mark.asyncio
async def test_configs_delete_not_found(get_app_by_name):
    app = await get_app_by_name
    assert app is not None, "App with name :test_prompt_client not found."

    response = await test_client.post(
        "/api/variants/configs/delete",
        json={
            "variant_ref": {
                "slug": "non-existent-variant",
                "version": None,
                "id": None,
            },
            "application_ref": {
                "slug": app.app_name,
                "version": None,
                "id": None,
            },
        },
    )
    assert response.status_code == status.HTTP_200_OK
    assert 204 == response.json()
