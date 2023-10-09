import httpx
import pytest
import logging
from bson import ObjectId

from agenta_backend.routers import app_router
from agenta_backend.models.db_engine import DBEngine
from agenta_backend.services import selectors, db_manager
from agenta_backend.models.db_models import (
    AppDB,
    VariantBaseDB,
    ImageDB,
    ConfigDB,
    AppVariantDB,
)


# Initialize database engine
engine = DBEngine().engine()

# Initialize http client
test_client = httpx.AsyncClient()
timeout = httpx.Timeout(timeout=5, read=None, write=5)

# Generate a new ObjectId
new_object_id = ObjectId()

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

# Set global variables
BACKEND_API_HOST = "http://localhost:8000"


@pytest.mark.asyncio
async def test_create_app(get_first_user_object):
    user = await get_first_user_object
    organization = await selectors.get_user_own_org(user.uid)

    response = await test_client.post(
        f"{BACKEND_API_HOST}/apps/",
        json={
            "app_name": "app_variant_test",
            "organization_id": str(organization.id),
        },
        timeout=timeout,
    )
    assert response.status_code == 200
    assert response.json()["app_name"] == "app_variant_test"


@pytest.mark.asyncio
async def test_list_apps():
    response = await test_client.get(f"{BACKEND_API_HOST}/apps/")

    assert response.status_code == 200
    assert len(response.json()) == 2


@pytest.mark.asyncio
async def test_create_app_variant(get_first_user_object):
    user = await get_first_user_object
    organization = await selectors.get_user_own_org(user.uid)
    app = await engine.find_one(AppDB, AppDB.app_name == "app_variant_test")

    db_image = ImageDB(
        docker_id="sha256:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        tags="agentaai/templates:local_test_prompt",
        user=user,
        organization=organization,
    )
    await engine.save(db_image)

    db_config = ConfigDB(
        config_name="default",
        parameters={},
    )
    await engine.save(db_config)

    db_base = VariantBaseDB(
        base_name="app",
        app=app,
        organization=organization,
        user=user,
        image=db_image,
    )
    await engine.save(db_base)

    appvariant = AppVariantDB(
        app=app,
        variant_name="app",
        image=db_image,
        user=user,
        organization=organization,
        parameters={},
        base_name="app",
        config_name="default",
        base=db_base,
        config=db_config,
    )
    await engine.save(appvariant)

    response = await app_router.list_app_variants(app_id=str(app.id))
    assert len(response) == 1


@pytest.mark.asyncio
async def test_list_app_variants():
    app_db = await engine.find_one(AppDB, AppDB.app_name == "app_variant_test")
    response = await test_client.get(
        f"{BACKEND_API_HOST}/apps/{str(app_db.id)}/variants/"
    )

    assert response.status_code == 200
    assert len(response.json()) == 1


@pytest.mark.asyncio
async def test_delete_app_without_permission(get_second_user_object):
    user2 = await get_second_user_object
    user2_organization = await selectors.get_user_own_org(user2.uid)

    user2_app = AppDB(
        app_name="test_app_by_user2",
        organization=user2_organization,
        user=user2,
    )
    await engine.save(user2_app)

    response = await test_client.delete(
        f"{BACKEND_API_HOST}/apps/{str(user2_app.id)}/",
        timeout=timeout,
    )
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_list_environments():
    app = await engine.find_one(AppDB, AppDB.app_name == "app_variant_test")
    response = await test_client.get(
        f"{BACKEND_API_HOST}/apps/{str(app.id)}/environments/"
    )

    assert response.status_code == 200
    assert len(response.json()) == 3


@pytest.mark.asyncio
async def test_get_variant_by_env(get_first_user_app):
    _, _, _, app, _, _, _ = await get_first_user_app
    environments = await db_manager.list_environments(app_id=str(app.id))

    for environment in environments:
        response = await app_router.get_variant_by_env(
            app_id=str(app.id), environment=environment.name
        )
        assert response == []


@pytest.mark.asyncio
async def test_remove_app():
    app = await engine.find_one(AppDB, AppDB.app_name == "app_variant_test")
    await engine.delete(app)

    app = await engine.find_one(AppDB, AppDB.app_name == "app_variant_test")
    assert app == None
