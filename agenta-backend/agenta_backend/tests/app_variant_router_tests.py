import httpx
from odmantic import query
import pytest
from agenta_backend.models.db_engine import DBEngine
from agenta_backend.models.db_models import (
    UserDB,
    OrganizationDB,
)
from agenta_backend.routers.app_variant import add_app_variant_from_template
from agenta_backend.tests.app_variant_router_fixture import get_first_user_object

# Initialize database engine
engine = DBEngine(mode="test").engine()

# Initialize http client
test_client = httpx.AsyncClient()


@pytest.mark.asyncio
async def test_successfully_creates_new_app_variant(get_first_user_object):
    user = await get_first_user_object
    query_expression = (OrganizationDB.type == "default") & (
        OrganizationDB.owner == str(user.id)
    )
    user_organization = await engine.find_one(OrganizationDB, query_expression)

    # Prepare test data
    payload = {
        "app_name": "myapp",
        "image_id": "12345",
        "image_tag": "latest",
        "env_vars": {"ENV_VAR1": "value1", "ENV_VAR2": "value2"},
        "organization_id": str(user_organization.id),
    }

    # Invoke the function
    response = await add_app_variant_from_template(payload=payload)

    # Assertions
    assert response.status_code == 200
    assert response == {
        "app_id": "12345",
        "variant_id": "13579",
        "variant_name": "app",
        "parameters": {},
        "previous_variant_name": None,
        "organization_id": str(user_organization.id),
        "user_id": "54321",
        "base_name": "app",
        "base_id": None,
        "config_name": "default",
        "config_id": None,
    }
