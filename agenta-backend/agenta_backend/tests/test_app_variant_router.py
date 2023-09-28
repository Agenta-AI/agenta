import httpx
import pytest
from odmantic import query
from fastapi import HTTPException
from agenta_backend.models.db_engine import DBEngine
from agenta_backend.models.db_models import (
    UserDB,
    OrganizationDB,
)
from agenta_backend.routers.app_variant import (
    add_app_variant_from_template,
    list_app_variants,
)

from agenta_backend.models.api.api_models import (
    AppVariantOutput,
)

# Initialize database engine
engine = DBEngine().engine()

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
        "env_vars": {
            "ENV_VAR1": "value1",
            "ENV_VAR2": "value2"
        },
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
        "config_id": None
    }
    

@pytest.mark.asyncio
async def test_returns_list_with_valid_app_id(mocker):
    
    """
    Returns a list of AppVariantOutput objects when called with a valid app_id
    """
    
    # Mock dependencies
    mock_list_app_variants = mocker.patch('agenta_backend.routers.app_variant.list_app_variants')
    mock_list_app_variants.return_value = [AppVariantOutput()]

    # Invoke function
    response = await list_app_variants(app_id='12345')

    # Assert
    assert isinstance(response, list)
    assert isinstance(response[0], AppVariantOutput)


@pytest.mark.asyncio
async def test_returns_empty_list_with_no_variants(mocker):
    
    """
    Returns an empty list when called with an app_id that has no variants
    """
    
    # Mock dependencies
    mock_list_app_variants = mocker.patch('agenta_backend.routers.app_variant.list_app_variants')
    mock_list_app_variants.return_value = []

    # Invoke function
    response = await list_app_variants(app_id='12345')

    # Assert
    assert isinstance(response, list)
    assert len(response) == 0
    
    
@pytest.mark.asyncio
async def test_returns_list_with_no_arguments(mocker):
    
    """
    Returns a list of AppVariantOutput objects when called with no arguments
    """
    
    # Mock dependencies
    mock_list_app_variants = mocker.patch('agenta_backend.routers.app_variant.list_app_variants')
    mock_list_app_variants.return_value = [AppVariantOutput()]

    # Invoke function
    response = await list_app_variants()

    # Assert
    assert isinstance(response, list)
    assert isinstance(response[0], AppVariantOutput)

    
@pytest.mark.asyncio
async def test_raises_http_exception_on_exception(mocker):
    
    """
    Raises HTTPException with status_code 500 when an exception is raised
    """
    
    # Mock dependencies
    mocker.patch('agenta_backend.routers.app_variant.list_app_variants', side_effect=Exception())

    # Invoke and assert
    with pytest.raises(HTTPException) as e:
        await list_app_variants()
    assert e.value.status_code == 500
    
    
@pytest.mark.asyncio
async def test_raises_http_exception_on_no_access(mocker):
    
    """
    Raises HTTPException with status_code 400 when user does not have access to specified app_id
    """
    
    # Mock dependencies
    mocker.patch('agenta_backend.routers.app_variant.check_access_to_app', return_value=False)

    # Invoke and assert
    with pytest.raises(HTTPException) as e:
        await list_app_variants(app_id='12345')
    assert e.value.status_code == 400