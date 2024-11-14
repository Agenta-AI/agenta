import os
import uuid

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
async def test_conftest_to_create_app_variant_is_successful(
    create_app_variant_for_prompt_management,
):
    app_variant = await create_app_variant_for_prompt_management
    assert isinstance(app_variant.id, uuid.UUID)


@pytest.mark.asyncio
async def test_configs_add_success(get_app_by_name):
    app = await get_app_by_name
    assert app is not None, "App with name :test_prompt_client not found."

    response = await test_client.post(
        "/api/variants/configs/add",
        json={
            "variant_ref": {"slug": "from_pytest", "version": None, "id": None},
            "application_ref": {
                "slug": None,
                "version": None,
                "id": str(app.id),
            },
        },
    )
    assert response.status_code == status.HTTP_200_OK
    assert "params" and "url" in response.json()


@pytest.mark.asyncio
async def test_configs_add_success_for_deletion(get_app_by_name):
    app = await get_app_by_name
    assert app is not None, "App with name :test_prompt_client not found."

    response = await test_client.post(
        "/api/variants/configs/add",
        json={
            "variant_ref": {
                "slug": "from_pytest_for_deletion",
                "version": None,
                "id": None,
            },
            "application_ref": {
                "slug": None,
                "version": None,
                "id": str(app.id),
            },
        },
    )
    assert response.status_code == status.HTTP_200_OK
    assert "params" and "url" in response.json()


@pytest.mark.asyncio
async def test_configs_add_already_exists(get_app_by_name):
    app = await get_app_by_name
    assert app is not None, "App with name :test_prompt_client not found."

    response = await test_client.post(
        "/api/variants/configs/add",
        json={
            "variant_ref": {"slug": "default", "version": None, "id": None},
            "application_ref": {
                "slug": None,
                "version": None,
                "id": str(app.id),
            },
        },
    )
    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert response.json()["detail"] == "Config already exists."


@pytest.mark.asyncio
async def test_configs_does_not_exist():
    response = await test_client.post(
        "/api/variants/configs/add",
        json={
            "variant_ref": {"slug": "default", "version": None, "id": None},
            "application_ref": {
                "slug": None,
                "version": None,
                "id": "0192a45d-511e-7d1a-aaca-20280c936b1f",
            },
        },
    )
    assert response.status_code == status.HTTP_404_NOT_FOUND
    assert response.json()["detail"] == "Config not found."


@pytest.mark.asyncio
async def test_configs_add_invalid_data():
    response = await test_client.post(
        "/api/variants/configs/add",
        json={
            "variant_ref": {
                "slug": "non-existent",
                "version": 3,
                "id": "non-existent-id",
            },
            "application_ref": {"slug": None, "version": None, "id": None},
        },
    )
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
