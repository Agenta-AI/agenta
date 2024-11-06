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
async def test_configs_commit_success(
    get_app_variant_revision_by_variant_id, get_app_by_name, get_user_from_db
):
    app = await get_app_by_name
    assert app is not None, "App with name :test_prompt_client not found."

    variant_revision = await get_app_variant_revision_by_variant_id
    assert variant_revision is not None, "App variant revision not found."

    user = await get_user_from_db
    assert user is not None, "User not found."

    response = await test_client.post(
        "/api/variants/configs/commit",
        json={
            "params": {
                "model": "gpt-4",
                "top_p": 1,
                "inputs": [{"name": "country"}],
                "force_json": 0,
                "max_tokens": 1000,
                "prompt_user": "What is the capital of {country}?",
                "temperature": 0.65,
                "prompt_system": "You are an expert in geography.",
                "presence_penalty": 0,
                "frequence_penalty": 0,
            },
            "url": "http://localhost/0192a45c-4630-7130-8d59-7036ec84002f/test/app",
            "application_ref": {
                "slug": None,
                "version": None,
                "id": str(app.id),
            },
            "service_ref": {
                "slug": "app",
                "version": None,
                "id": "0192a45c-4630-7130-8d59-7036ec84002f",
            },
            "variant_ref": {
                "slug": variant_revision.config_name,
                "version": variant_revision.revision,
                "id": str(variant_revision.id),
            },
            "environment_ref": None,
        },
    )
    assert response.status_code == status.HTTP_200_OK
    assert "params" and "url" in response.json()
    assert "variant_lifecycle" in response.json()
    assert response.json()["variant_lifecycle"]["updated_by"] == user.email


@pytest.mark.asyncio
async def test_configs_commit_missing_data(get_app_by_name):
    app = await get_app_by_name
    assert app is not None, "App with name :test_prompt_client not found."

    response = await test_client.post(
        "/api/variants/configs/commit",
        json={
            "params": {},
            "url": "",
            "application_ref": {
                "slug": "test",
                "version": None,
                "id": str(app.id),
            },
        },
    )
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
