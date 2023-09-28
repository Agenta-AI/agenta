import httpx
import pytest
from bson import ObjectId
from odmantic import query
from fastapi import HTTPException
from agenta_backend.models.db_engine import DBEngine
from agenta_backend.tests.app_variant_router_fixture import get_first_user_object

from agenta_backend.models.db_models import (
    AppDB,
    UserDB,
    BaseDB,
    ImageDB,
    ConfigDB,
    AppVariantDB,
    OrganizationDB,
)
from agenta_backend.routers import (
    app_router,
)

from agenta_backend.services import (
    app_manager,
    db_manager,
    docker_utils,
    new_db_manager,
    new_app_manager,
)

from agenta_backend.models.api.api_models import (
    App,
    Variant,
    AppVariantOutput,
)

from agenta_backend.services import (
    new_app_manager,
)

from agenta_backend.services.auth_helper import (
    SessionContainer,
)

# Initialize database engine
engine = DBEngine().engine()

# Initialize http client
test_client = httpx.AsyncClient()

# Generate a new ObjectId
new_object_id = ObjectId()


@pytest.mark.asyncio
async def test_list_empty_apps():
    response = await app_router.list_app_variants()
    assert response == []
    
@pytest.mark.asyncio
async def test_create_app(get_first_user_object):
    user = await get_first_user_object
    organization = await new_db_manager.get_user_own_org(user.uid)
    
    app = AppDB(
        app_name="test_app",
        organization_id=organization,
        user_id=user,
    )
    
    await engine.save(app)
    
    response = await app_router.list_apps()
    assert len(response) == 1
    
    org_app_response = await app_router.list_apps(str(organization.id))
    assert len(org_app_response) == 1