import os
import uuid
import asyncio

import httpx
import pytest
import pytest_asyncio
from pytest_asyncio import is_async_test

from tests.legacy.conftest import get_admin_user_credentials, API_BASE_URL


OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", None)


def pytest_collection_modifyitems(items):
    """
    Mark all tests to run inside the same event loop.

    NOTE: remove as soon as a solution for https://github.com/pytest-dev/pytest-asyncio/issues/793 is proposed and the issue closes
    """

    pytest_asyncio_tests = (item for item in items if is_async_test(item))
    session_scope_marker = pytest.mark.asyncio(loop_scope="session")
    for async_test in pytest_asyncio_tests:
        async_test.add_marker(session_scope_marker, append=False)


@pytest_asyncio.fixture(scope="session")
async def http_client():
    """
    Create an HTTP client for API testing.
    """

    programmatic_access = get_admin_user_credentials()
    async with httpx.AsyncClient(
        base_url=API_BASE_URL,
        timeout=httpx.Timeout(timeout=6, read=None, write=5),
        headers={
            "Authorization": f"{programmatic_access}",
            "Content-Type": "application/json",
        },
    ) as client:
        yield client


@pytest_asyncio.fixture(scope="session")
async def fetch_templates(http_client):
    """
    Fetch available templates.
    """

    response = await http_client.get("containers/templates/")
    return response.json()


@pytest_asyncio.fixture(scope="session")
async def fetch_completion_template(fetch_templates):
    """
    Find the chat_openai template.
    """

    return next(
        (temp for temp in fetch_templates if temp["image"]["name"] == "chat_openai"),
        None,
    )


def get_random_name():
    return f"completion_{uuid.uuid4().hex[:8]}"


@pytest_asyncio.fixture(scope="session")
async def app_from_template_payload(fetch_completion_template):
    """
    Prepare payload for creating an app from a template.
    """

    return {
        "app_name": get_random_name(),
        "env_vars": {"OPENAI_API_KEY": OPENAI_API_KEY},
        "template_id": fetch_completion_template.get("id", None),
    }


@pytest_asyncio.fixture(scope="session")
async def get_completion_app_from_list(http_client):
    """
    Retrieve the first available application.
    """

    list_app_response = await http_client.get("apps/")
    list_app_response.raise_for_status()

    apps_response = list_app_response.json()
    if not apps_response:
        raise ValueError("No applications found")

    return apps_response[0]


@pytest_asyncio.fixture(scope="session")
async def create_app_from_template(app_from_template_payload, http_client):
    # Create app
    create_app_response = await http_client.post(
        "apps/app_and_variant_from_template", json=app_from_template_payload
    )
    create_app_response.raise_for_status()

    # Small delay to ensure app is ready
    await asyncio.sleep(3)

    # Get response data
    app_response = create_app_response.json()
    try:
        # Yield the app for tests to use
        yield app_response
    finally:
        # Cleanup: Delete the app after all tests in the class are complete
        try:
            delete_response = await http_client.delete(
                f"apps/{app_response.get('app_id', None)}"
            )
            delete_response.raise_for_status()
        except Exception as e:
            print(f"Error during app cleanup: {e}")
