import os
import uuid
import asyncio
import logging
from json import loads
from traceback import format_exc
from typing import Optional, Any

import boto3
import httpx
import pytest
import pytest_asyncio
from dotenv import load_dotenv
from httpx import AsyncClient, Timeout


AGENTA_HOST = os.getenv("AGENTA_HOST", "http://localhost")
API_BASE_URL = f"{AGENTA_HOST}/api/"


# Load environment variables
load_dotenv("../.env")


@pytest.fixture
def sample_testset_endpoint_json():
    return f"{API_BASE_URL}testsets/sample"


# Set global variables
AGENTA_SECRET_KEY = os.getenv("_SECRET_KEY", "AGENTA_AUTH_KEY")
AGENTA_AWS_PROFILE_NAME = os.getenv("AWS_PROFILE_NAME", "staging")
AGENTA_SECRET_ARN = os.getenv("AGENTA_AUTH_KEY_SECRET_ARN", None)
AGENTA_HOST = os.getenv("AGENTA_HOST", "http://localhost")
API_BASE_URL = f"{AGENTA_HOST}/api/"
API_KEYS_MAPPING = {
    "OPENAI_API_KEY": "openai",
    "MISTRAL_API_KEY": "mistralai",
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


session = boto3.Session(profile_name=AGENTA_AWS_PROFILE_NAME)
sm_client = session.client("secretsmanager")

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


@pytest_asyncio.fixture(scope="class")
def event_loop():
    """
    Override the default event loop fixture to be class-scoped.
    """

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    yield loop
    pending_tasks = asyncio.all_tasks(loop)
    if pending_tasks:
        loop.run_until_complete(asyncio.gather(*pending_tasks))
    loop.close()


def fetch_secret(
    secret_arn: str,
    secret_key: Optional[str] = None,
) -> Optional[Any]:
    try:
        response = sm_client.get_secret_value(SecretId=secret_arn)

        secrets = None

        if "SecretString" in response:
            secrets = response["SecretString"]
        elif "SecretBinary" in response:
            secrets = response["SecretBinary"].decode("utf-8")

        if not secrets:
            return None

        secrets = loads(secrets)

        if not secret_key:
            return secrets

        secret = None

        if secret_key:
            secret = secrets.get(secret_key, None)

        return secret

    except:  # pylint: disable=bare-except
        logger.error("Failed to fetch secrets with: %s", format_exc())
        return None


async def ahttp_client():
    access_key = fetch_secret(
        secret_arn=AGENTA_SECRET_ARN, secret_key=AGENTA_SECRET_KEY
    )
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
        headers={
            "Content-Type": "application/json",
        },
    ) as client:
        yield client


async def get_user_profile(client: AsyncClient):
    response = await client.get("profile")

    response.raise_for_status()
    return response.json()


@pytest.fixture(scope="class")
def get_mock_response():
    mock_response = os.getenv("AUTH_IN_TESTS", "").lower() == "false"
    return mock_response


@pytest_asyncio.fixture(scope="class")
async def mocked_programmatic_user(http_client, get_mock_response):
    mock_response = get_mock_response
    if mock_response:
        profile_response = await get_user_profile(client=http_client)
        return True, {
            "credentials": "mocked_user_token",
            "email": profile_response.get("email"),
            "name": profile_response.get("name"),
        }

    return False, {}


@pytest_asyncio.fixture(scope="class")
async def programmatic_user(mocked_programmatic_user):
    is_mocked, mock_data = mocked_programmatic_user
    if is_mocked:
        return mock_data

    client = await ahttp_client()
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
async def programmatic_non_member_user(mocked_programmatic_user):
    is_mocked, mock_data = mocked_programmatic_user
    if is_mocked:
        return mock_data

    client = await ahttp_client()
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
        "template_key": "SERVICE:chat",
    }
    variant_payload = {
        "variant_name": "qa_bot.default",
        "key": "SERVICE:chat",
        "base_name": "qa_bot",
        "config_name": "default",
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
    response = await client.get("vault/v1/secrets", headers=headers)
    response.raise_for_status()

    response_data = response.json()

    for secret in response_data:
        delete_response = await client.delete(
            f"vault/v1/secrets/{secret.get('id', '')}"
        )
        delete_response.raise_for_status()


async def set_valid_llm_keys(client: AsyncClient, headers: dict):
    for api_key_name in list(API_KEYS_MAPPING.keys()):
        response = await client.post(
            "vault/v1/secrets",
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
    for api_key_name in list(API_KEYS_MAPPING.keys()):
        response = await client.post(
            "vault/v1/secrets",
            json={
                "header": {"name": API_KEYS_MAPPING[api_key_name], "description": ""},
                "secret": {
                    "kind": "provider_key",
                    "data": {
                        "provider": API_KEYS_MAPPING[api_key_name],
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
        "Gemini": ["gemini/gemini-1.5-pro-latest", "gemini/gemini-1.5-flash"],
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
