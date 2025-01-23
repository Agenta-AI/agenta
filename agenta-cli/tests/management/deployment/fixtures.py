import pytest_asyncio


@pytest_asyncio.fixture(scope="session")
async def list_app_variants(http_client, get_completion_app_from_list):
    app_id = get_completion_app_from_list.get("app_id", None)
    response = await http_client.get(f"apps/{app_id}/variants")
    response.raise_for_status()
    response_data = response.json()
    return response_data


@pytest_asyncio.fixture(scope="session")
async def get_variant_revisions(http_client, list_app_variants):
    app_variant = list_app_variants[0]
    response = await http_client.get(
        f"variants/{app_variant.get('variant_id', '')}/revisions"
    )
    response.raise_for_status()
    response_data = response.json()
    return response_data
