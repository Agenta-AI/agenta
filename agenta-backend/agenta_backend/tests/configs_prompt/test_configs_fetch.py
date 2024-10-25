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
async def test_configs_fetch_by_variant_ref(get_app_variant_revision_by_variant_id):
    variant_revision = await get_app_variant_revision_by_variant_id
    assert variant_revision is not None, "App variant revision not found."

    response = await test_client.request(
        method="GET",
        url="/api/variants/configs/fetch",
        json={
            "variant_ref": {
                "slug": variant_revision.config_name,
                "version": variant_revision.revision,
                "id": str(variant_revision.id),
            }
        },
    )
    assert response.status_code == status.HTTP_200_OK
    assert "params" in response.json()
    assert "application_ref" in response.json()
    assert "variant_ref" in response.json()
    assert "service_ref" in response.json()
    assert "environment_ref" in response.json()


@pytest.mark.asyncio
async def test_configs_fetch_by_environment_and_application_ref(get_app_by_name):
    app = await get_app_by_name
    assert app is not None, "App with name :test_prompt_client not found."

    response = await test_client.request(
        method="GET",
        url="/api/variants/configs/fetch",
        json={  # type: ignore
            "environment_ref": {"slug": "production", "version": 1, "id": None},
            "application_ref": {
                "slug": None,
                "version": None,
                "id": str(app.id),
            },
        },
    )
    assert response.status_code == status.HTTP_200_OK
    assert "params" in response.json()
    assert "application_ref" in response.json()
    assert "variant_ref" in response.json()
    assert "service_ref" in response.json()
    assert "environment_ref" in response.json()


@pytest.mark.asyncio
async def test_configs_fetch_by_environment_ref(
    get_environment_revision_by_environment_id,
):
    environment_revision = await get_environment_revision_by_environment_id
    response = await test_client.request(
        method="GET",
        url="/api/variants/configs/fetch",
        json={  # type: ignore
            "environment_ref": {
                "slug": None,
                "version": None,
                "id": str(environment_revision.id),
            }
        },
    )

    assert response.status_code == status.HTTP_200_OK
    assert "params" in response.json()
    assert "application_ref" in response.json()
    assert "variant_ref" in response.json()
    assert "service_ref" in response.json()
    assert "environment_ref" in response.json()


@pytest.mark.asyncio
async def test_configs_fetch_not_found():
    response = await test_client.request(
        method="GET",
        url="/api/variants/configs/fetch",
        params={  # type: ignore
            "variant_ref": {
                "slug": "non-existent",
                "version": 1,
                "id": "non-existent-id",
            }
        },
    )
    assert response.status_code == status.HTTP_404_NOT_FOUND
    assert response.json()["detail"] == "Config not found."
