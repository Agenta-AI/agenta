import pytest

from agenta_backend.tests.conftest import delete_application


@pytest.mark.asyncio
async def test_completion_openapi_endpoint(http_client, create_app_and_variant):
    # ARRANGE
    app_variant_response = create_app_and_variant
    print("Response: ", app_variant_response)
    service_url = app_variant_response.get("variant", {}).get("uri", None)
    headers = {"Authorization": app_variant_response.get("credentials", None)}

    # ACT
    response = await http_client.get(
        url=f"{service_url}/openapi.json",
        headers=headers,
    )
    print("Service URL: ", service_url)
    print("Response (text): ", response.text)
    response_data = response.json()
    print("Response (data): ", response_data)

    # ASSERT
    assert response.status_code == 200, "Openapi.json endpoint failed"
    assert "openapi" and "info" and "paths" in response_data

    # CLEANUP
    app_id = app_variant_response.get("app", {}).get("app_id", None)
    await delete_application(http_client, app_id, headers)


@pytest.mark.asyncio
async def test_chat_openapi_endpoint(http_client, create_chat_app_and_variant):
    # ARRANGE
    app_variant_response = create_chat_app_and_variant
    service_url = app_variant_response.get("variant", {}).get("uri", None)
    headers = {"Authorization": app_variant_response.get("credentials", None)}

    # ACT
    response = await http_client.get(
        url=f"{service_url}/openapi.json",
        headers=headers,
    )
    response_data = response.json()

    # ASSERT
    assert response.status_code == 200, "Openapi.json endpoint failed"
    assert "openapi" and "info" and "paths" in response_data

    # CLEANUP
    app_id = app_variant_response.get("app", {}).get("app_id", None)
    await delete_application(http_client, app_id, headers)
