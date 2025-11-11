import pytest_asyncio


@pytest_asyncio.fixture(scope="session")
async def get_production_environment_revision(
    http_client, get_completion_app_from_list
):
    app_id = get_completion_app_from_list.get("app_id", None)
    response = await http_client.get(f"apps/{app_id}/revisions/production")
    response.raise_for_status()
    response_data = response.json()
    return response_data
