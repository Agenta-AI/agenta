import pytest


@pytest.mark.happy
@pytest.mark.typical
@pytest.mark.functional
@pytest.mark.asyncio
async def test_completion_health_endpoint(http_client, create_app_and_variant):
    # ARRANGE
    app_variant_response = create_app_and_variant
    service_url = app_variant_response.get("variant", {}).get("uri", None)
    headers = {"Authorization": app_variant_response.get("credentials", "")}

    # ACT
    response = await http_client.get(
        url=f"{service_url}/health",
        headers=headers,
    )
    response_data = response.json()

    # ASSERT
    assert response.status_code == 200, "Health endpoint failed"
    assert response_data == {"status": "ok"}


@pytest.mark.happy
@pytest.mark.typical
@pytest.mark.functional
@pytest.mark.asyncio
async def test_chat_health_endpoint(http_client, create_chat_app_and_variant):
    # ARRANGE
    app_variant_response = create_chat_app_and_variant
    service_url = app_variant_response.get("variant", {}).get("uri", None)
    headers = {"Authorization": app_variant_response.get("credentials", "")}

    # ACT
    response = await http_client.get(
        url=f"{service_url}/health",
        headers=headers,
    )
    response_data = response.json()

    # ASSERT
    assert response.status_code == 200, "Health endpoint failed"
    assert response_data == {"status": "ok"}
