import os
import httpx
import pytest

from bson import ObjectId

from sqlalchemy.future import select

from oss.src.utils.logging import get_module_logger
from oss.src.routers import app_router
from oss.src.services import db_manager
from oss.src.models.db_models import (
    AppDB,
)

from oss.src.dbs.postgres.shared.engine import engine


# Initialize http client
test_client = httpx.AsyncClient()
timeout = httpx.Timeout(timeout=5, read=None, write=5)

# Generate a new ObjectId
new_object_id = ObjectId()

log = get_module_logger(__name__)

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
async def test_create_app_for_renaming():
    response = await test_client.post(
        f"{BACKEND_API_HOST}/apps/",
        json={
            "app_name": "app_test",
        },
        timeout=timeout,
    )
    assert response.status_code == 200
    assert response.json()["app_name"] == "app_test"


@pytest.mark.asyncio
async def test_update_app():
    async with engine.core_session() as session:
        result = await session.execute(select(AppDB).filter_by(app_name="app_test"))
        app = result.scalars().first()

    response = await test_client.patch(
        f"{BACKEND_API_HOST}/apps/{str(app.id)}/",
        json={
            "app_name": "test_app",
        },
        timeout=timeout,
    )
    assert response.status_code == 200
    assert response.json()["app_id"] == str(app.id)
    assert response.json()["app_name"] == "test_app"


# @pytest.mark.asyncio
# async def test_update_app_does_not_exist():
#     APP_ID_NOT_FOUND = "5da3bfe7-bc4b-4713-928e-48275126a1c2"
#     response = await test_client.patch(
#         f"{BACKEND_API_HOST}/apps/{APP_ID_NOT_FOUND}/",
#         json={
#             "app_name": "test_app",
#         },
#         timeout=timeout,
#     )
#     assert response.status_code == 404
#     assert response.json()["detail"] == f"App with {APP_ID_NOT_FOUND} not found"


# @pytest.mark.asyncio
# async def test_list_apps():
#     response = await test_client.get(f"{BACKEND_API_HOST}/apps/")

#     assert response.status_code == 200
#     assert len(response.json()) == 3


@pytest.mark.asyncio
async def test_list_app_variants():
    async with engine.core_session() as session:
        result = await session.execute(
            select(AppDB).filter_by(app_name="app_variant_test")
        )
        app = result.scalars().first()

    response = await test_client.get(f"{BACKEND_API_HOST}/apps/{str(app.id)}/variants/")

    assert response.status_code == 200
    assert len(response.json()) == 1


@pytest.mark.asyncio
async def test_list_environments():
    async with engine.core_session() as session:
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
