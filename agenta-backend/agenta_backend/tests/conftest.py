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


AGENTA_HOST = os.environ.get("AGENTA_HOST", "http://localhost")
API_BASE_URL = f"{AGENTA_HOST}/api/"


# Load environment variables
load_dotenv("../.env")


@pytest.fixture
def sample_testset_endpoint_json():
    return f"{API_BASE_URL}testsets/sample"


# Set global variables
AGENTA_SECRET_KEY = os.environ.get("_SECRET_KEY", "AGENTA_AUTH_KEY")
AGENTA_AWS_PROFILE_NAME = os.environ.get("AWS_PROFILE_NAME", "staging")
AGENTA_SECRET_ARN = os.environ.get("AGENTA_AUTH_KEY_SECRET_ARN", None)
AGENTA_HOST = os.environ.get("AGENTA_HOST", "http://localhost")
API_BASE_URL = f"{AGENTA_HOST}/api/"


session = boto3.Session(profile_name=AGENTA_AWS_PROFILE_NAME)
sm_client = session.client("secretsmanager")

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


@pytest_asyncio.fixture(scope="session")
def event_loop():
    """
    Override the default event loop fixture to be class-scoped.
    """

    loop = asyncio.new_event_loop()
    yield loop
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


@pytest_asyncio.fixture(scope="class")
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


@pytest_asyncio.fixture(scope="class")
async def programmatic_user(ahttp_client):
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


@pytest_asyncio.fixture(scope="class")
async def create_app_and_variant(http_client, programmatic_user):
    """
    This fixture creates an application using a template and then creates a variant
    for that application. It's designed to be used in test classes to set up
    the necessary test environment.

    Args:
        http_client : AsyncClient
            An asynchronous HTTP client for making API requests.
        programmatic_user : dict
            A dictionary containing user information, including credentials.
    """

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
    return {
        "app": app_response,
        "variant": variant_response,
        "credentials": user_scope_credentials,
    }
