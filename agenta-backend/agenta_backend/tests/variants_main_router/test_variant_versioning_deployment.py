import os
import httpx
import pytest
import random

from agenta_backend.models.db_models import (
    AppDB,
    TestSetDB,
    AppVariantDB,
)


# Initialize http client
test_client = httpx.AsyncClient()
timeout = httpx.Timeout(timeout=5, read=None, write=5)

# Set global variables
APP_NAME = "evaluation_in_backend"
ENVIRONMENT = os.environ.get("ENVIRONMENT")
VARIANT_DEPLOY_ENVIRONMENTS = ["development", "staging", "production"]
OPEN_AI_KEY = os.environ.get("OPENAI_API_KEY")
if ENVIRONMENT == "development":
    BACKEND_API_HOST = "http://host.docker.internal/api"
elif ENVIRONMENT == "github":
    BACKEND_API_HOST = "http://agenta-backend-test:8000"


@pytest.mark.asyncio
async def test_update_app_variant_parameters(app_variant_parameters_updated):
    app = await AppDB.find_one(AppDB.app_name == APP_NAME)
    testset = await TestSetDB.find_one(TestSetDB.app.id == app.id)
    app_variant = await AppVariantDB.find_one(
        AppVariantDB.app.id == app.id, AppVariantDB.variant_name == "app.default"
    )
    for _ in VARIANT_DEPLOY_ENVIRONMENTS:
        parameters = app_variant_parameters_updated
        parameters["temperature"] = random.uniform(0.9, 1.5)
        parameters["frequence_penalty"] = random.uniform(0.9, 1.5)
        parameters["frequence_penalty"] = random.uniform(0.9, 1.5)
        parameters["inputs"] = [{"name": list(testset.csvdata[0].keys())[0]}]
        payload = {"parameters": parameters}

        response = await test_client.put(
            f"{BACKEND_API_HOST}/variants/{str(app_variant.id)}/parameters/",
            json=payload,
        )
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_deploy_to_environment(deploy_to_environment_payload):
    app = await AppDB.find_one(AppDB.app_name == APP_NAME)
    app_variant = await AppVariantDB.find_one(AppVariantDB.app.id == app.id)
    list_of_response_status_codes = []
    for environment in VARIANT_DEPLOY_ENVIRONMENTS:
        payload = deploy_to_environment_payload
        payload["variant_id"] = str(app_variant.id)
        payload["environment_name"] = environment

        response = await test_client.post(
            f"{BACKEND_API_HOST}/environments/deploy/", json=payload, timeout=timeout
        )
        list_of_response_status_codes.append(response.status_code)

    assert (
        list_of_response_status_codes.count(200) == 3
    ), "The list does not contain 3 occurrences of 200 status code"


@pytest.mark.asyncio
async def test_list_app_environment_revisions():
    app = await AppDB.find_one(AppDB.app_name == APP_NAME)
    list_of_response_data = []
    list_of_response_status_codes = []
    for environment in VARIANT_DEPLOY_ENVIRONMENTS:
        response = await test_client.get(
            f"{BACKEND_API_HOST}/apps/{str(app.id)}/revisions/{environment}"
        )
        list_of_response_data.append(response.json())
        list_of_response_status_codes.append(response.status_code)
    assert (
        list_of_response_status_codes.count(200) == 3
    ), "The list does not container 3 occurrences of 200 status code"
    assert len(list_of_response_data) == 3, "The list does not contain 3 response data"


@pytest.mark.asyncio
async def test_get_config_deployment_revision():
    app = await AppDB.find_one(AppDB.app_name == APP_NAME)
    app_environment_revisions_response = await test_client.get(
        f"{BACKEND_API_HOST}/apps/{str(app.id)}/revisions/{VARIANT_DEPLOY_ENVIRONMENTS[0]}"
    )

    if app_environment_revisions_response.status_code == 200:
        revisions = app_environment_revisions_response.json()["revisions"]
        config_deployment_revision_response = await test_client.get(
            f"{BACKEND_API_HOST}/configs/deployment/{revisions[0]['id']}"
        )
        assert config_deployment_revision_response.status_code == 200
        assert config_deployment_revision_response.json() is not None
    else:
        assert False, "App environment revisions response is not 200"


@pytest.mark.asyncio
async def test_revert_deployment_revision():
    app = await AppDB.find_one(AppDB.app_name == APP_NAME)
    app_environment_revisions_response = await test_client.get(
        f"{BACKEND_API_HOST}/apps/{str(app.id)}/revisions/{VARIANT_DEPLOY_ENVIRONMENTS[0]}"
    )

    if app_environment_revisions_response.status_code == 200:
        revisions = app_environment_revisions_response.json()["revisions"]
        revert_deployment_revision_response = await test_client.post(
            f"{BACKEND_API_HOST}/configs/deployment/{revisions[0]['id']}/revert/"
        )
        assert revert_deployment_revision_response.status_code == 200
    else:
        assert False, "App environment revisions response is not 200"
