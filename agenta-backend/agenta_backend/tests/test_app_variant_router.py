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
    remove_app,
    remove_variant,
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
    
    
@pytest.mark.asyncio
async def test_app_id_provided_and_permission(mocker):

    """
    Test Delete App when App id is provided and user has permission to delete it
    """

    # Arrange
    app_id = "12345"
    app = App(app_id=app_id)
    stoken_session = SessionContainer()
    kwargs = {"user_id": "user123", "org_id": "org123"}
    mocker.patch("agenta_backend.routers.app_variant.get_user_and_org_id", return_value=kwargs)
    mocker.patch("agenta_backend.routers.app_variant.check_access_to_app", return_value=True)
    mocker.patch("agenta_backend.routers.app_variant.new_app_manager.remove_app")

    # Act
    await remove_app(app, stoken_session)

    # Assert
    new_app_manager.remove_app.assert_called_once_with(app_id=app_id, **kwargs)


@pytest.mark.asyncio
async def test_successfully_remove_variant(mocker):
    
    """
    Successfully remove a variant
    """
    
    # Mock dependencies
    variant = Variant(variant_id="12345")
    stoken_session = SessionContainer()
    verify_session_mock = mocker.patch("verify_session")
    verify_session_mock.return_value = stoken_session
    get_user_and_org_id_mock = mocker.patch("get_user_and_org_id")
    get_user_and_org_id_mock.return_value = {"user_id": "123", "org_id": "456"}
    check_access_to_variant_mock = mocker.patch("check_access_to_variant")
    check_access_to_variant_mock.return_value = True
    remove_app_variant_mock = mocker.patch("remove_app_variant")

    # Invoke function
    await remove_variant(variant, stoken_session)

    # Assert
    remove_app_variant_mock.assert_called_once_with(app_variant_id="12345", user_id="123", org_id="456")    


@pytest.mark.asyncio
async def test_successfully_remove_variant(mocker):
    
    """
    Successfully remove a variant and its associated image
    """
    
    # Mock dependencies
    variant = Variant(variant_id="12345")
    stoken_session = SessionContainer()
    verify_session_mock = mocker.patch("verify_session")
    verify_session_mock.return_value = stoken_session
    get_user_and_org_id_mock = mocker.patch("get_user_and_org_id")
    get_user_and_org_id_mock.return_value = {"user_id": "123", "org_id": "456"}
    check_access_to_variant_mock = mocker.patch("check_access_to_variant")
    check_access_to_variant_mock.return_value = True
    remove_app_variant_mock = mocker.patch("remove_app_variant")

    # Invoke function
    await remove_variant(variant, stoken_session)

    # Assert
    remove_app_variant_mock.assert_called_once_with(app_variant_id="12345", user_id="123", org_id="456")
    
    
@pytest.mark.asyncio
async def test_no_permission_to_delete_app(mocker):
    
    """
    Test Delete App when User does not have permission to delete app
    """
    
    # Arrange
    app_id = "12345"
    app = App(app_id=app_id)
    stoken_session = SessionContainer()
    kwargs = {"user_id": "user123", "org_id": "org123"}
    mocker.patch("agenta_backend.routers.app_variant.get_user_and_org_id", return_value=kwargs)
    mocker.patch("agenta_backend.routers.app_variant.check_access_to_app", return_value=False)

    # Act & Assert
    response = await remove_app(app, stoken_session)
    assert response.status_code == 400