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
async def test_configs_history_by_slug_and_appid_success(
    get_app_by_name, get_app_variant_revision_by_variant_id
):
    app = await get_app_by_name
    assert app is not None, "App with name :test_prompt_client not found."

    variant_revision = await get_app_variant_revision_by_variant_id
    assert variant_revision is not None, "App variant revision not found."

    response = await test_client.post(
        "/api/variants/configs/history",
        json={
            "application_ref": {
                "slug": None,
                "version": None,
                "id": str(app.id),
            },
            "variant_ref": {
                "slug": variant_revision.config_name,
                "version": None,
                "id": None,
            },
        },
    )

    assert response.status_code == status.HTTP_200_OK
    assert isinstance(response.json(), list)
    assert len(response.json()) > 0


@pytest.mark.asyncio
async def test_configs_history_by_id_success(get_app_variant_by_slug):
    variant = await get_app_variant_by_slug
    assert variant is not None, "App variant not found."

    response = await test_client.post(
        "/api/variants/configs/history",
        json={
            "variant_ref": {
                "slug": None,
                "version": None,
                "id": str(variant.id),
            },
        },
    )

    assert response.status_code == status.HTTP_200_OK
    assert isinstance(response.json(), list)
    assert len(response.json()) > 0


@pytest.mark.asyncio
async def test_configs_history_not_found(get_app_by_name):
    app = await get_app_by_name
    assert app is not None, "App with name :test_prompt_client not found."

    app_not_found_response = await test_client.post(
        "/api/variants/configs/history",
        json={
            "slug": "non_existent_app",
            "version": None,
            "id": None,
        },
    )
    variant_not_found_response = await test_client.post(
        "/api/variants/configs/history",
        json={
            "slug": None,
            "version": None,
            "id": "f7c93215-b728-4b24-ae8d-2a611c68cdb2",
        },
    )

    assert app_not_found_response.status_code == status.HTTP_404_NOT_FOUND
    assert variant_not_found_response.status_code == status.HTTP_404_NOT_FOUND
    assert "No configs found for the specified variant or application." in (
        app_not_found_response.json()["detail"]
        and variant_not_found_response.json()["detail"]
    )
