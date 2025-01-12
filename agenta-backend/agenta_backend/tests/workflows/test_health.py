import pytest


@pytest.mark.asyncio
async def test_health_endpoint(http_client, create_app_and_variant):
    # ARRANGE
    response = await create_app_and_variant
    service_url = response.get("uri", None)
    headers = {"Authorization": response.get("credentials", None)}

    # ACT
    response = await http_client.get(
        base_url=service_url,
        url="health",
        headers=headers,
    )

    # ASSERT
    assert response.status_code == 200, "Health endpoint failed"
    assert response.json() == {"status": "ok"}
