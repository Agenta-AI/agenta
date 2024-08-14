import os
import httpx
import pytest
import logging
from bson import ObjectId

from agenta_backend.routers import app_router
from agenta_backend.services import db_manager
from agenta_backend.models.db.postgres_engine import db_engine
from agenta_backend.models.shared_models import ConfigDB
from agenta_backend.models.db_models import (
    AppDB,
    DeploymentDB,
    VariantBaseDB,
    ImageDB,
    AppVariantDB,
)

from sqlalchemy.future import select


# Initialize http client
test_client = httpx.AsyncClient()
timeout = httpx.Timeout(timeout=5, read=None, write=5)

# Generate a new ObjectId
new_object_id = ObjectId()

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

# Set global variables
ENVIRONMENT = os.environ.get("ENVIRONMENT")
if ENVIRONMENT == "development":
    BACKEND_API_HOST = "http://host.docker.internal/api"
elif ENVIRONMENT == "github":
    BACKEND_API_HOST = "http://agenta-backend-test:8000"


@pytest.mark.asyncio
async def test_create_app():
    response = await test_client.post(
        f"{BACKEND_API_HOST}/apps/",
        json={
            "app_name": "app_variant_test",
        },
        timeout=timeout,
    )
    assert response.status_code == 200
    assert response.json()["app_name"] == "app_variant_test"


@pytest.mark.asyncio
async def test_list_apps():
    response = await test_client.get(f"{BACKEND_API_HOST}/apps/")

    assert response.status_code == 200
    assert len(response.json()) == 1


@pytest.mark.asyncio
async def test_create_app_variant(get_first_user_object):
    user = await get_first_user_object

    async with db_engine.get_session() as session:
        result = await session.execute(
            select(AppDB).filter_by(app_name="app_variant_test")
        )
        app = result.scalars().first()

        db_image = ImageDB(
            docker_id="sha256:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
            tags="agentaai/templates_v2:local_test_prompt",
            user_id=user.id,
        )
        session.add(db_image)
        await session.commit()

        db_config = ConfigDB(
            config_name="default",
            parameters={},
        )

        db_deployment = DeploymentDB(
            app_id=app.id,
            user_id=user.id,
            container_name="container_a_test",
            container_id="w243e34red",
            uri="http://localhost/app/w243e34red",
            status="stale",
        )
        session.add(db_deployment)
        await session.commit()

        db_base = VariantBaseDB(
            base_name="app",
            app_id=app.id,
            user_id=user.id,
            image_id=db_image.id,
            deployment_id=db_deployment.id,
        )
        session.add(db_base)
        await session.commit()

        appvariant = AppVariantDB(
            app_id=app.id,
            variant_name="app",
            image_id=db_image.id,
            user_id=user.id,
            config_parameters={},
            base_name="app",
            config_name="default",
            revision=0,
            modified_by_id=user.id,
            base_id=db_base.id,
        )
        session.add(appvariant)
        await session.commit()

    response = await test_client.get(f"{BACKEND_API_HOST}/apps/{str(app.id)}/variants/")
    assert response.status_code == 200
    assert len(response.json()) == 1


@pytest.mark.asyncio
async def test_list_app_variants():
    async with db_engine.get_session() as session:
        result = await session.execute(
            select(AppDB).filter_by(app_name="app_variant_test")
        )
        app = result.scalars().first()

    response = await test_client.get(f"{BACKEND_API_HOST}/apps/{str(app.id)}/variants/")

    assert response.status_code == 200
    assert len(response.json()) == 1


@pytest.mark.asyncio
async def test_list_environments():
    async with db_engine.get_session() as session:
        result = await session.execute(
            select(AppDB).filter_by(app_name="app_variant_test")
        )
        app = result.scalars().first()

    response = await test_client.get(
        f"{BACKEND_API_HOST}/apps/{str(app.id)}/environments/"
    )

    assert response.status_code == 200
    assert len(response.json()) == 3


@pytest.mark.asyncio
async def test_get_variant_by_env(get_first_user_app):
    _, _, app, _, _, _ = await get_first_user_app
    environments = await db_manager.list_environments(app_id=str(app.id))

    for environment in environments:
        response = await app_router.get_variant_by_env(
            app_id=str(app.id), environment=environment.name
        )
        assert response == []
