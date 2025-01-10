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
