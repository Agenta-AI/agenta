import os
import uuid
import logging
import json
from traceback import format_exc
from typing import Optional, Any

import httpx
import pytest
import agenta as ag
import pytest_asyncio
from dotenv import load_dotenv
from httpx import AsyncClient, Timeout
from pytest_asyncio import is_async_test


AGENTA_HOST = os.getenv("AGENTA_HOST", "http://localhost")
API_BASE_URL = f"{AGENTA_HOST}/api/"


def pytest_addoption(parser):
    """Register the --env-file option."""

    parser.addoption(
        "--env-file", action="store", default=".env", help="Path to the .env file"
    )


def pytest_configure(config):
    """Load the environment variables from the specified .env file."""
    env_file = config.getoption("--env-file")
    print(f"Loading environment variables from: {env_file}")
    load_dotenv(dotenv_path=env_file)


@pytest.fixture
def sample_testset_endpoint_json():
    return f"{API_BASE_URL}testsets/sample"


# Set global variables
AGENTA_SECRET_KEY = os.getenv("_SECRET_KEY", "AGENTA_AUTH_KEY")
AGENTA_SECRET_ARN = os.getenv("AGENTA_AUTH_KEY_SECRET_ARN", None)
AGENTA_HOST = os.getenv("AGENTA_HOST", "http://localhost")
API_BASE_URL = f"{AGENTA_HOST}/api/"
API_KEYS_MAPPING = {
    "OPENAI_API_KEY": "openai",
    "MISTRAL_API_KEY": "mistral",
    "MISTRALAI_API_KEY": "mistralai",
    "COHERE_API_KEY": "cohere",
    "ANTHROPIC_API_KEY": "anthropic",
    "ANYSCALE_API_KEY": "anyscale",
    "PERPLEXITYAI_API_KEY": "perplexityai",
    "DEEPINFRA_API_KEY": "deepinfra",
    "TOGETHERAI_API_KEY": "togetherai",
    "ALEPHALPHA_API_KEY": "alephalpha",
    "OPENROUTER_API_KEY": "openrouter",
    "GROQ_API_KEY": "groq",
    "GEMINI_API_KEY": "gemini",
}


logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


def pytest_collection_modifyitems(items):
    """
    Mark all tests to run inside the same event loop.

    NOTE: remove as soon as a solution for https://github.com/pytest-dev/pytest-asyncio/issues/793 is proposed and the issue closes
    """

    pytest_asyncio_tests = (item for item in items if is_async_test(item))
    session_scope_marker = pytest.mark.asyncio(loop_scope="class")
    for async_test in pytest_asyncio_tests:
        async_test.add_marker(session_scope_marker, append=False)


def fetch_secret() -> Optional[Any]:
    try:
        secret = os.getenv("AWS_SECRET_KEY")
        return secret

    except Exception:  # pylint: disable=bare-except
        logger.error("Failed to fetch secrets with: %s", format_exc())
        return None


async def ahttp_client():
    access_key = fetch_secret()
    async with AsyncClient(
        base_url=API_BASE_URL,
        timeout=httpx.Timeout(timeout=6, read=None, write=5),
        headers={"Authorization": f"Access {access_key}"},
    ) as client:
        yield client


@pytest_asyncio.fixture(scope="class")
async def http_client():
    """
    Fixture to create an AsyncClient for API testing.
    """

    async with AsyncClient(
        base_url=API_BASE_URL,
        timeout=Timeout(timeout=6, read=None, write=5),
    ) as client:
        yield client


@pytest_asyncio.fixture(scope="class")
async def create_programmatic_owner_user(ahttp_client):
    client = ahttp_client
    randomness = uuid.uuid4().hex[:8]
    user_name = f"programmatic_test_user_{randomness}"
    user_email = f"{user_name}@agenta.ai"
    response = await client.post(
        "admin/accounts",
        json={
            "users": {
                f"{user_email}": {
                    "name": user_name,
                    "email": f"{user_email}",
                }
            },
            "organizations": {
                f"{user_email}": {
                    "name": f"{user_name}'s Organization",
                    "description": f"Organization belonging to {user_name}",
                    "is_paying": True,
                }
            },
            "workspaces": {
                f"{user_email}": {
                    "name": f"{user_name}'s Workspace",
                    "description": f"Workspace belonging to {user_name}",
                    "is_default": True,
                    "organization_ref": {"slug": f"{user_email}"},
                }
            },
            "projects": {
                f"{user_email}": {
                    "name": f"{user_name}'s Project",
                    "description": f"Project belonging to {user_name}",
                    "is_default": True,
                    "workspace_ref": {"slug": f"{user_email}"},
                    "organization_ref": {"slug": f"{user_email}"},
                }
            },
            "organization_memberships": {
                f"{user_email}": {
                    "role": "owner",
                    "is_demo": True,
                    "user_ref": {"slug": f"{user_email}"},
                    "organization_ref": {"slug": f"{user_email}"},
                }
            },
            "workspace_memberships": {
                f"{user_email}": {
                    "role": "owner",
                    "is_demo": True,
                    "user_ref": {"slug": f"{user_email}"},
                    "workspace_ref": {"slug": f"{user_email}"},
                }
            },
            "project_memberships": {
                f"{user_email}": {
                    "role": "owner",
                    "is_demo": True,
                    "user_ref": {"slug": f"{user_email}"},
                    "project_ref": {"slug": f"{user_email}"},
                }
            },
        },
    )
    response.raise_for_status()
    return response.json().get("projects", {}).get(user_email, {}).get(user_email, {})


@pytest_asyncio.fixture(scope="class")
async def create_programmatic_non_owner_user(ahttp_client):
    client = ahttp_client
    randomness = uuid.uuid4().hex[:8]
    user_name = f"programmatic_test_user_{randomness}"
    user_email = f"{user_name}@agenta.ai"
    response = await client.post(
        "admin/accounts",
        json={
            "users": {f"{user_email}": {"name": {user_name}, "email": f"{user_email}"}},
            "organizations": {
                f"{user_email}": {
                    "name": f"{user_name}'s Organization",
                    "description": f"Organization belonging to {user_name}",
                    "is_paying": True,
                }
            },
            "workspaces": {
                f"{user_email}": {
                    "name": f"{user_name}'s Workspace",
                    "description": f"Workspace belonging to {user_name}",
                    "is_default": True,
                    "organization_ref": {"slug": f"{user_email}"},
                }
            },
            "projects": {
                f"{user_email}": {
                    "name": f"{user_name}'s Project",
                    "description": f"Project belonging to {user_name}",
                    "is_default": True,
                    "workspace_ref": {"slug": f"{user_email}"},
                    "organization_ref": {"slug": f"{user_email}"},
                }
            },
            "organization_memberships": {
                f"{user_email}": {
                    "role": "owner",
                    "is_demo": True,
                    "user_ref": {"slug": f"{user_email}"},
                    "organization_ref": {"slug": f"{user_email}"},
                }
            },
            "workspace_memberships": {
                f"{user_email}": {
                    "role": "owner",
                    "is_demo": True,
                    "user_ref": {"slug": f"{user_email}"},
                    "workspace_ref": {"slug": f"{user_email}"},
                }
            },
            "project_memberships": {
                f"{user_email}": {
                    "role": "owner",
                    "is_demo": True,
                    "user_ref": {"slug": f"{user_email}"},
                    "project_ref": {"slug": f"{user_email}"},
                }
            },
        },
    )
    response.raise_for_status()
    return response.json().get("projects", {}).get(user_email, {}).get(user_email, {})


@pytest_asyncio.fixture(scope="class")
async def create_programmatic_non_paying_user(ahttp_client):
    client = ahttp_client
    randomness = uuid.uuid4().hex[:8]
    user_name = f"programmatic_test_user_{randomness}"
    user_email = f"{user_name}@agenta.ai"
    response = await client.post(
        "admin/accounts",
        json={
            "users": {
                f"{user_email}": {
                    "name": user_name,
                    "email": f"{user_email}",
                }
            },
            "organizations": {
                f"{user_email}": {
                    "name": f"{user_name}'s Organization",
                    "description": f"Organization belonging to {user_name}",
                    "is_paying": False,
                }
            },
            "workspaces": {
                f"{user_email}": {
                    "name": f"{user_name}'s Workspace",
                    "description": f"Workspace belonging to {user_name}",
                    "is_default": True,
                    "organization_ref": {"slug": f"{user_email}"},
                }
            },
            "projects": {
                f"{user_email}": {
                    "name": f"{user_name}'s Project",
                    "description": f"Project belonging to {user_name}",
                    "is_default": True,
                    "workspace_ref": {"slug": f"{user_email}"},
                    "organization_ref": {"slug": f"{user_email}"},
                }
            },
            "organization_memberships": {
                f"{user_email}": {
                    "role": "owner",
                    "is_demo": True,
                    "user_ref": {"slug": f"{user_email}"},
                    "organization_ref": {"slug": f"{user_email}"},
                }
            },
            "workspace_memberships": {
                f"{user_email}": {
                    "role": "owner",
                    "is_demo": True,
                    "user_ref": {"slug": f"{user_email}"},
                    "workspace_ref": {"slug": f"{user_email}"},
                }
            },
            "project_memberships": {
                f"{user_email}": {
                    "role": "owner",
                    "is_demo": True,
                    "user_ref": {"slug": f"{user_email}"},
                    "project_ref": {"slug": f"{user_email}"},
                }
            },
        },
    )
    response.raise_for_status()
    return response.json().get("projects", {}).get(user_email, {}).get(user_email, {})


@pytest_asyncio.fixture(scope="class")
async def create_programmatic_non_member_user(ahttp_client):
    client = ahttp_client
    randomness = uuid.uuid4().hex[:8]
    user_name = f"programmatic_test_user_{randomness}"
    user_email = f"{user_name}@agenta.ai"
    response = await client.post(
        "admin/accounts",
        json={
            "users": {
                f"{user_email}": {
                    "name": user_name,
                    "email": f"{user_email}",
                }
            },
            "organizations": {
                f"{user_email}": {
                    "name": f"{user_name}'s Organization",
                    "description": f"Organization belonging to {user_name}",
                    "is_paying": False,
                }
            },
            "workspaces": {
                f"{user_email}": {
                    "name": f"{user_name}'s Workspace",
                    "description": f"Workspace belonging to {user_name}",
                    "is_default": True,
                    "organization_ref": {"slug": f"{user_email}"},
                }
            },
            "projects": {
                f"{user_email}": {
                    "name": f"{user_name}'s Project",
                    "description": f"Project belonging to {user_name}",
                    "is_default": True,
                    "workspace_ref": {"slug": f"{user_email}"},
                    "organization_ref": {"slug": f"{user_email}"},
                }
            },
            "organization_memberships": {
                f"{user_email}": {
                    "role": "owner",
                    "is_demo": True,
                    "user_ref": {"slug": f"{user_email}"},
                    "organization_ref": {"slug": f"{user_email}"},
                }
            },
            "workspace_memberships": {
                f"{user_email}": {
                    "role": "owner",
                    "is_demo": True,
                    "user_ref": {"slug": f"{user_email}"},
                    "workspace_ref": {"slug": f"{user_email}"},
                }
            },
            "project_memberships": {
                f"{user_email}": {
                    "role": "owner",
                    "is_demo": True,
                    "user_ref": {"slug": f"{user_email}"},
                    "project_ref": {"slug": f"{user_email}"},
                }
            },
        },
    )
    response.raise_for_status()
    return response.json().get("projects", {}).get(user_email, {}).get(user_email, {})


@pytest_asyncio.fixture(scope="class")
async def create_programmatic_all_users(ahttp_client):
    client = ahttp_client
    users_data = {}

    roles = [
        "owner",
        "editor",
        "workspace_admin",
    ]
    for i in range(0, 3):
        randomness = uuid.uuid4().hex[:8]
        user_name = f"programmatic_test_user_{randomness}_{i}"
        user_email = f"{user_name}@agenta.ai"

        users_data[user_email] = {
            "user_name": user_name,
            "user_email": user_email,
            "organization": {
                "name": f"{user_name}'s Organization",
                "description": f"Organization belonging to {user_name}",
                "is_paying": True,
            },
            "workspace": {
                "name": f"{user_name}'s Workspace",
                "description": f"Workspace belonging to {user_name}",
                "is_default": True,
                "organization_ref": {"slug": user_email},
            },
            "project": {
                "name": f"{user_name}'s Project",
                "description": f"Project belonging to {user_name}",
                "is_default": True,
                "workspace_ref": {"slug": user_email},
                "organization_ref": {"slug": user_email},
            },
            "organization_membership": {
                "role": roles[i],
                "is_demo": True,
                "user_ref": {"slug": user_email},
                "organization_ref": {"slug": user_email},
            },
            "workspace_membership": {
                "role": roles[i],
                "is_demo": True,
                "user_ref": {"slug": user_email},
                "workspace_ref": {"slug": user_email},
            },
            "project_membership": {
                "role": roles[i],
                "is_demo": True,
                "user_ref": {"slug": user_email},
                "project_ref": {"slug": user_email},
            },
        }

    json_payload = {
        "users": {
            email: {"name": data["user_name"], "email": data["user_email"]}
            for email, data in users_data.items()
        },
        "organizations": {
            email: {
                "name": data["organization"]["name"],
                "description": data["organization"]["description"],
                "is_paying": data["organization"]["is_paying"],
            }
            for email, data in users_data.items()
        },
        "workspaces": {
            email: {
                "name": data["workspace"]["name"],
                "description": data["workspace"]["description"],
                "is_default": data["workspace"]["is_default"],
                "organization_ref": data["workspace"]["organization_ref"],
            }
            for email, data in users_data.items()
        },
        "projects": {
            email: {
                "name": data["project"]["name"],
                "description": data["project"]["description"],
                "is_default": data["project"]["is_default"],
                "workspace_ref": data["project"]["workspace_ref"],
                "organization_ref": data["project"]["organization_ref"],
            }
            for email, data in users_data.items()
        },
        "organization_memberships": {
            email: {
                "role": data["organization_membership"]["role"],
                "is_demo": data["organization_membership"]["is_demo"],
                "user_ref": data["organization_membership"]["user_ref"],
                "organization_ref": data["organization_membership"]["organization_ref"],
            }
            for email, data in users_data.items()
        },
        "workspace_memberships": {
            email: {
                "role": data["workspace_membership"]["role"],
                "is_demo": data["workspace_membership"]["is_demo"],
                "user_ref": data["workspace_membership"]["user_ref"],
                "workspace_ref": data["workspace_membership"]["workspace_ref"],
            }
            for email, data in users_data.items()
        },
        "project_memberships": {
            email: {
                "role": data["project_membership"]["role"],
                "is_demo": data["project_membership"]["is_demo"],
                "user_ref": data["project_membership"]["user_ref"],
                "project_ref": data["project_membership"]["project_ref"],
            }
            for email, data in users_data.items()
        },
    }

    response = await client.post("admin/accounts", json=json_payload)
    response.raise_for_status()
    return {
        email: response.json().get("projects", {}).get(email, {}).get(email, {})
        for email in users_data
    }


async def get_user_profile(client: AsyncClient):
    response = await client.get("profile")

    response.raise_for_status()
    return response.json()


async def get_project(client: AsyncClient):
    response = await client.get("projects")

    response.raise_for_status()
    return response.json()[0]


def get_mock_response():
    mock_response = os.getenv("AUTH_IN_TESTS", "false").lower() == "false"
    return mock_response


async def mocked_programmatic_user():
    mock_response = get_mock_response()
    if mock_response:
        profile_response = await get_user_profile(client=http_client)
        project_response = await get_project(client=http_client)
        return True, {
            "project_id": project_response.get("project_id"),
            "credentials": "ApiKey ",
            "email": profile_response.get("email"),
            "name": profile_response.get("name"),
        }

    return False, {}


@pytest_asyncio.fixture(scope="class")
async def programmatic_user():
    is_mocked, mock_data = await mocked_programmatic_user()
    if is_mocked:
        return mock_data

    client = await ahttp_client().__anext__()
    randomness = uuid.uuid4().hex[:8]
    user_name = f"programmatic_test_user_{randomness}"
    user_email = f"{user_name}@agenta.ai"
    response = await client.post(
        "admin/accounts",
        json={
            "users": {
                f"{user_email}": {
                    "name": user_name,
                    "email": f"{user_email}",
                }
            },
            "organizations": {
                f"{user_email}": {
                    "name": f"{user_name}'s Organization",
                    "description": f"Organization belonging to {user_name}",
                    "is_paying": True,
                }
            },
            "workspaces": {
                f"{user_email}": {
                    "name": f"{user_name}'s Workspace",
                    "description": f"Workspace belonging to {user_name}",
                    "is_default": True,
                    "organization_ref": {"slug": f"{user_email}"},
                }
            },
            "projects": {
                f"{user_email}": {
                    "name": f"{user_name}'s Project",
                    "description": f"Project belonging to {user_name}",
                    "is_default": True,
                    "workspace_ref": {"slug": f"{user_email}"},
                    "organization_ref": {"slug": f"{user_email}"},
                }
            },
            "organization_memberships": {
                f"{user_email}": {
                    "role": "owner",
                    "is_demo": True,
                    "user_ref": {"slug": f"{user_email}"},
                    "organization_ref": {"slug": f"{user_email}"},
                }
            },
            "workspace_memberships": {
                f"{user_email}": {
                    "role": "owner",
                    "is_demo": True,
                    "user_ref": {"slug": f"{user_email}"},
                    "workspace_ref": {"slug": f"{user_email}"},
                }
            },
            "project_memberships": {
                f"{user_email}": {
                    "role": "owner",
                    "is_demo": True,
                    "user_ref": {"slug": f"{user_email}"},
                    "project_ref": {"slug": f"{user_email}"},
                }
            },
        },
    )
    response.raise_for_status()
    return response.json().get("projects", {}).get(user_email, {}).get(user_email, {})


@pytest_asyncio.fixture(scope="class")
async def programmatic_non_member_user():
    is_mocked, mock_data = await mocked_programmatic_user()
    if is_mocked:
        return mock_data

    client = await ahttp_client().__anext__()
    randomness = uuid.uuid4().hex[:8]
    user_name = f"programmatic_test_user_{randomness}"
    user_email = f"{user_name}@agenta.ai"
    response = await client.post(
        "admin/accounts",
        json={
            "users": {
                f"{user_email}": {
                    "name": user_name,
                    "email": f"{user_email}",
                }
            },
            "organizations": {
                f"{user_email}": {
                    "name": f"{user_name}'s Organization",
                    "description": f"Organization belonging to {user_name}",
                    "is_paying": True,
                }
            },
            "workspaces": {
                f"{user_email}": {
                    "name": f"{user_name}'s Workspace",
                    "description": f"Workspace belonging to {user_name}",
                    "is_default": True,
                    "organization_ref": {"slug": f"{user_email}"},
                }
            },
            "projects": {
                f"{user_email}": {
                    "name": f"{user_name}'s Project",
                    "description": f"Project belonging to {user_name}",
                    "is_default": True,
                    "workspace_ref": {"slug": f"{user_email}"},
                    "organization_ref": {"slug": f"{user_email}"},
                }
            },
            "organization_memberships": {
                f"{user_email}": {
                    "role": "owner",
                    "is_demo": True,
                    "user_ref": {"slug": f"{user_email}"},
                    "organization_ref": {"slug": f"{user_email}"},
                }
            },
            "workspace_memberships": {
                f"{user_email}": {
                    "role": "owner",
                    "is_demo": True,
                    "user_ref": {"slug": f"{user_email}"},
                    "workspace_ref": {"slug": f"{user_email}"},
                }
            },
            "project_memberships": {
                f"{user_email}": {
                    "role": "owner",
                    "is_demo": True,
                    "user_ref": {"slug": f"{user_email}"},
                    "project_ref": {"slug": f"{user_email}"},
                }
            },
        },
    )
    response.raise_for_status()
    return response.json().get("projects", {}).get(user_email, {}).get(user_email, {})


async def create_app(client: AsyncClient, payload: dict, headers: dict):
    response = await client.post(
        "apps",
        json=payload,
        headers=headers,
    )
    response.raise_for_status()

    response_data = response.json()
    return response_data


async def create_variant(
    client: AsyncClient, app_id: str, payload: dict, headers: dict
):
    response = await client.post(
        f"apps/{app_id}/variant/from-template",
        json=payload,
        headers=headers,
    )
    response.raise_for_status()

    response_data = response.json()
    return response_data


async def update_variant_parameters(
    client: AsyncClient, variant_id: str, headers: dict
):
    response = await client.put(
        f"variants/{variant_id}/parameters",
        json={
            "parameters": {
                "prompt": {
                    "input_keys": ["country"],
                    "llm_config": {
                        "frequency_penalty": 0,
                        "model": "gpt-3.5-turbo",
                        "presence_penalty": 0,
                        "temperature": 0.2,
                        "top_p": 0.5,
                    },
                    "messages": [
                        {
                            "content": "You are an expert in geographyfc",
                            "role": "system",
                        },
                        {
                            "content": "What is the capital of {country}?",
                            "role": "user",
                        },
                    ],
                    "template_format": "fstring",
                }
            }
        },
        headers=headers,
    )
    response.raise_for_status()


async def deploy_variant_to_environment(
    client: AsyncClient, variant_id: str, environment_name: str, headers: dict
):
    response = await client.post(
        "environments/deploy",
        json={"environment_name": environment_name, "variant_id": variant_id},
        headers=headers,
    )
    response.raise_for_status()


async def delete_application(client: AsyncClient, app_id: str, headers: dict):
    response = await client.delete(url=f"apps/{app_id}", headers=headers)
    response.raise_for_status()

    return response.status_code


@pytest_asyncio.fixture(scope="class")
async def create_app_and_variant(
    http_client, programmatic_user, programmatic_non_member_user
):
    app_payload = {
        "app_name": f"app_{uuid.uuid4().hex[:8]}",
        "template_key": "SERVICE:completion",
    }
    variant_payload = {
        "variant_name": "app.key",
        "key": "SERVICE:completion",
        "base_name": "app",
        "config_name": "key",
    }

    user_scope_credentials = programmatic_user.get("credentials", None)
    non_member_scope_credentials = programmatic_non_member_user.get("credentials", None)
    headers = {"Authorization": user_scope_credentials}

    app_response = await create_app(
        client=http_client, payload=app_payload, headers=headers
    )
    variant_response = await create_variant(
        client=http_client,
        app_id=app_response.get("app_id", None),
        payload=variant_payload,
        headers=headers,
    )
    await update_variant_parameters(
        http_client, variant_response.get("variant_id"), headers
    )
    await deploy_variant_to_environment(
        http_client,
        variant_response.get("variant_id"),
        "production",
        headers,
    )
    yield {
        "app": app_response,
        "variant": variant_response,
        "scope_project_id": programmatic_user.get("project", {}).get("id", ""),
        "non_member_project_id": programmatic_non_member_user.get("project", {}).get(
            "id", ""
        ),
        "credentials": user_scope_credentials,
        "non_member_credentials": non_member_scope_credentials,
    }

    await delete_application(http_client, app_response.get("app_id"), headers)


@pytest_asyncio.fixture(scope="class")
async def create_chat_app_and_variant(http_client, programmatic_user):
    app_payload = {
        "app_name": f"app_{uuid.uuid4().hex[:8]}",
        "template_key": "SERVICE:completion",
    }
    variant_payload = {
        "variant_name": "app.key",
        "key": "SERVICE:completion",
        "base_name": "app",
        "config_name": "key",
    }

    user_scope_credentials = programmatic_user.get("credentials", None)
    headers = {"Authorization": user_scope_credentials}

    app_response = await create_app(
        client=http_client, payload=app_payload, headers=headers
    )
    variant_response = await create_variant(
        client=http_client,
        app_id=app_response.get("app_id", None),
        payload=variant_payload,
        headers=headers,
    )
    yield {
        "app": app_response,
        "variant": variant_response,
        "credentials": user_scope_credentials,
    }

    await delete_application(http_client, app_response.get("app_id"), headers)


async def reset_llm_keys(client: AsyncClient, headers: dict):
    is_mocked, mock_data = await mocked_programmatic_user()
    if is_mocked:
        return mock_data.get("credentials", None), mock_data.get("project_id", None)

    response = await client.get("vault/v1/secrets/", headers=headers)
    response.raise_for_status()

    response_data = response.json()

    for secret in response_data:
        delete_response = await client.delete(
            f"vault/v1/secrets/{secret.get('id', '')}"
        )
        delete_response.raise_for_status()


async def set_valid_llm_keys(client: AsyncClient, headers: dict):
    is_mocked, mock_data = await mocked_programmatic_user()
    if is_mocked:
        return

    for api_key_name in list(API_KEYS_MAPPING.keys()):
        response = await client.post(
            "vault/v1/secrets/",
            json={
                "header": {"name": API_KEYS_MAPPING[api_key_name], "description": ""},
                "secret": {
                    "kind": "provider_key",
                    "data": {
                        "provider": API_KEYS_MAPPING[api_key_name],
                        "key": os.environ[api_key_name],
                    },
                },
            },
            headers=headers,
        )
        response.raise_for_status()


async def set_invalid_llm_keys(client: AsyncClient, headers: dict):
    is_mocked, mock_data = await mocked_programmatic_user()
    if is_mocked:
        return

    response = await client.get("vault/v1/secrets/", headers=headers)
    response.raise_for_status()

    response_data = response.json()

    for secret in response_data:
        provider_name = secret.get("secret", {}).get("data", {}).get("provider")
        response = await client.put(
            f"vault/v1/secrets/{secret.get('id', '')}",
            json={
                "header": {"name": provider_name, "description": ""},
                "secret": {
                    "kind": "provider_key",
                    "data": {
                        "provider": provider_name,
                        "key": str(uuid.uuid4().hex[:14]),
                    },
                },
            },
            headers=headers,
        )
        response.raise_for_status()


@pytest.fixture
def get_all_supported_models():
    supported_llm_models = {
        "Mistral AI": [
            "mistral/mistral-tiny",
            "mistral/mistral-small",
            "mistral/mistral-medium",
            "mistral/mistral-large-latest",
        ],
        "Open AI": [
            "gpt-3.5-turbo-1106",
            "gpt-3.5-turbo",
            "gpt-4",
            "gpt-4o",
            "gpt-4o-mini",
            "gpt-4-1106-preview",
        ],
        "Gemini": [
            "gemini/gemini-2.5-flash-preview-05-20",
            "gemini/gemini-2.5-flash-preview-04-17",
            "gemini/gemini-2.0-flash-001",
            "gemini/gemini-2.5-pro-preview-05-06",
            "gemini/gemini-2.0-flash-lite-preview-02-05",
            "gemini/gemini-2.5-pro",
            "gemini/gemini-2.5-flash",
            "gemini/gemini-2.5-flash-preview-09-2025",
            "gemini/gemini-2.5-flash-lite",
            "gemini/gemini-2.5-flash-lite-preview-09-2025",
            "gemini/gemini-2.0-flash",
            "gemini/gemini-2.0-flash-lite",
        ],
        "Cohere": [
            "cohere/command-light",
            "cohere/command-r-plus",
            "cohere/command-nightly",
        ],
        "Anthropic": [
            "anthropic/claude-3-5-sonnet-20240620",
            "anthropic/claude-3-opus-20240229",
            "anthropic/claude-3-sonnet-20240229",
            "anthropic/claude-3-haiku-20240307",
            "anthropic/claude-2.1",
            "anthropic/claude-2",
            "anthropic/claude-instant-1.2",
            "anthropic/claude-instant-1",
        ],
        "Perplexity AI": [
            "perplexity/llama-3.1-sonar-small-128k-online",
            "perplexity/llama-3.1-sonar-large-128k-online",
            "perplexity/llama-3.1-sonar-huge-128k-online",
        ],
        "DeepInfra": [
            "deepinfra/meta-llama/Llama-2-70b-chat-hf",
            "deepinfra/meta-llama/Llama-2-13b-chat-hf",
            "deepinfra/codellama/CodeLlama-34b-Instruct-hf",
            "deepinfra/mistralai/Mistral-7B-Instruct-v0.1",
            "deepinfra/jondurbin/airoboros-l2-70b-gpt4-1.4.1",
        ],
        "Together AI": [
            "together_ai/meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
            "together_ai/meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
        ],
        "OpenRouter": [
            "openrouter/openai/gpt-3.5-turbo",
            "openrouter/openai/gpt-3.5-turbo-16k",
            "openrouter/google/palm-2-chat-bison",
            "openrouter/google/palm-2-codechat-bison",
            "openrouter/meta-llama/llama-2-13b-chat",
        ],
        "Groq": [
            "groq/llama-3.1-8b-instant",
            "groq/llama-3.1-70b-versatile",
            "groq/llama3-8b-8192",
            "groq/llama3-70b-8192",
            "groq/mixtral-8x7b-32768",
        ],
    }
    flattened_models = [
        model for models in supported_llm_models.values() for model in models
    ]
    return flattened_models


async def fetch_trace_by_trace_id(client: AsyncClient, headers: dict, project_id: str):
    response = await client.get(
        f"observability/v1/traces?project_id={project_id}", headers=headers
    )
    response.raise_for_status()

    return response.json()


async def fetch_variant_revision(client: AsyncClient, headers: dict, variant_id: str):
    response = await client.get(
        f"variants/{variant_id}/revisions",
        headers=headers,
    )
    response.raise_for_status()

    response_data = response.json()
    return response_data[-1]


async def fetch_app_environment_revisions(
    client: AsyncClient, app_id: str, environment_name: str, headers: dict
):
    response = await client.get(
        f"apps/{app_id}/revisions/{environment_name}",
        headers=headers,
    )
    response.raise_for_status()

    return response.json()


@pytest.fixture
def valid_run_generate_payload():
    return {
        "ag_config": {
            "prompt": {
                "llm_config": {
                    "model": "gpt-4",
                    "max_tokens": 200,
                    "response_format": {"type": "text"},
                },
                "messages": [
                    {
                        "content": "You are an expert in geography.",
                        "role": "system",
                    },
                    {
                        "content": "What is the capital of {country}?",
                        "role": "user",
                    },
                ],
                "template_format": "fstring",
            }
        },
        "inputs": {"country": "France"},
    }


@pytest.fixture
def invalid_run_generate_payload():
    return {
        "ag_config": {
            "prompt": {
                "llm_configs": {
                    "model": "gpt-4",
                    "response_format": {"type": "text"},
                },
                "messages": [
                    {
                        "content": "You are an expert in geography.",
                        "role": "system",
                    },
                    {
                        "content": "What is the capital of {country}?",
                        "role": "user",
                    },
                ],
                "template_format": "fstring",
            }
        },
        "input": {"country": "France"},
    }


@pytest.fixture
def valid_parameters_payload():
    return {
        "prompt": {
            "messages": [
                {"role": "system", "content": "You are an expert in geographyfc"},
                {"role": "user", "content": "What is the capital of {country}?"},
            ],
            "input_keys": ["country"],
            "llm_config": {
                "model": "gpt-3.5-turbo",
                "top_p": 0.5,
                "temperature": 0.2,
                "presence_penalty": 0,
                "frequency_penalty": 0,
            },
            "template_format": "fstring",
        }
    }


def exclude_lifecycle(data):
    """
    Recursively exclude the 'lifecycle' field with its 'created_at' value.
    """

    if isinstance(data, dict):
        # Check if the 'lifecycle' field is present and remove it
        if "lifecycle" in data:
            del data["lifecycle"]
        # Recursively apply to all key-value pairs
        return {k: exclude_lifecycle(v) for k, v in data.items()}
    elif isinstance(data, list):
        # Recursively apply to all list items
        return [exclude_lifecycle(item) for item in data]
    return data


def exact_match(obj1, obj2):
    """
    Compares two JSON-like objects for exact match by normalizing their key order.
    """

    obj1_normalized = json.dumps(obj1, sort_keys=True)
    obj2_normalized = json.dumps(obj2, sort_keys=True)

    return obj1_normalized == obj2_normalized


def initialize_agenta(
    api_key: str,
):
    ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.api_key = None
    ag.init(api_key=api_key)
