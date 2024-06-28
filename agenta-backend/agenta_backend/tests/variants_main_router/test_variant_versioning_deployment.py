import os
import httpx
import pytest
import random

from sqlalchemy.future import select

from agenta_backend.models.db_engine import db_engine
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
    async with db_engine.get_session() as session:
        result = await session.execute(select(AppDB).filter_by(app_name=APP_NAME))
        app = result.scalars().first()

        testset_result = await session.execute(
            select(TestSetDB).filter_by(app_id=app.id)
        )
        testset = testset_result.scalars().first()

        app_variant_result = await session.execute(
            select(AppVariantDB).filter_by(app_id=app.id, variant_name="app.default")
        )
        app_variant = app_variant_result.scalars().first()

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
    async with db_engine.get_session() as session:
        result = await session.execute(select(AppDB).filter_by(app_name=APP_NAME))
        app = result.scalars().first()

        app_variant_result = await session.execute(
            select(AppVariantDB).filter_by(app_id=app.id)
        )
        app_variant = app_variant_result.scalars().first()

        list_of_response_status_codes = []
        for environment in VARIANT_DEPLOY_ENVIRONMENTS:
            payload = deploy_to_environment_payload
            payload["variant_id"] = str(app_variant.id)
            payload["environment_name"] = environment

            response = await test_client.post(
                f"{BACKEND_API_HOST}/environments/deploy/",
                json=payload,
                timeout=timeout,
            )
            list_of_response_status_codes.append(response.status_code)

        assert (
            list_of_response_status_codes.count(200) == 3
        ), "The list does not contain 3 occurrences of 200 status code"
