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
async def test_configs_fork_by_variant_ref(
    get_app_variant_revision_by_variant_id, get_app_by_name, get_user_from_db
):
    app = await get_app_by_name
    assert app is not None, "App with name :test_prompt_client not found."

    variant_revision = await get_app_variant_revision_by_variant_id
    assert variant_revision is not None, "App variant revision not found."

    user = await get_user_from_db
    assert user is not None, "User not found."

    response = await test_client.post(
        "/api/variants/configs/fork",
        json={  # type: ignore
            "variant_ref": {
                "slug": variant_revision.config_name,
                "version": variant_revision.revision,
                "id": str(variant_revision.id),
            },
            "application_ref": {
                "slug": None,
                "version": None,
                "id": str(app.id),
            },
        },
    )
    assert response.status_code == status.HTTP_200_OK
    assert "application_ref" in response.json()
    assert isinstance(response.json(), dict)
    assert isinstance(response.json()["application_ref"], dict)
    assert "variant_lifecycle" in response.json()
    assert response.json()["variant_lifecycle"]["updated_by"] == user.email


@pytest.mark.asyncio
async def test_configs_fork_invalid_environment():
    response = await test_client.post(
        "/api/variants/configs/fork",
        json={"environment_ref": {"slug": "", "version": None, "id": "invalid-id"}},
    )
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
