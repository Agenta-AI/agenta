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
async def test_configs_deploy_success(
    get_app_variant_revision_by_variant_id, get_app_by_name, get_user_from_db
):
    app = await get_app_by_name
    assert app is not None, "App with name :test_prompt_client not found."

    variant_revision = await get_app_variant_revision_by_variant_id
    assert variant_revision is not None, "App variant revision not found."

    user = await get_user_from_db
    assert user is not None, "User not found."

    response = await test_client.post(
        "/api/variants/configs/deploy",
        json={
            "variant_ref": {
                "slug": variant_revision.config_name,
                "version": variant_revision.revision,
                "id": str(variant_revision.id),
            },
            "environment_ref": {"slug": "production", "version": None, "id": None},
            "application_ref": {
                "slug": None,
                "version": None,
                "id": str(app.id),
            },
        },
    )
    assert response.status_code == status.HTTP_200_OK
    assert "params" and "url" in response.json()
    assert "environment_lifecycle" in response.json()
    assert response.json()["environment_lifecycle"]["updated_by"] == user.email


@pytest.mark.asyncio
async def test_configs_deploy_not_found():
    response = await test_client.post(
        "/api/variants/configs/deploy",
        json={
            "variant_ref": {
                "slug": "default.appvariant",
                "version": 3,
                "id": "0192a45d-5ba1-757e-a983-787a66a4e78d",  # non-existent config
            },
            "environment_ref": {"slug": "production", "version": None, "id": None},
        },
    )
    assert response.status_code == status.HTTP_404_NOT_FOUND
    assert response.json()["detail"] == "Config not found."
