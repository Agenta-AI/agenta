import os
import uuid
import logging

import httpx
from dotenv import load_dotenv


# Load environment variables
load_dotenv("../.env")

# Set global variables
AGENTA_SECRET_ARN = os.environ.get("AGENTA_AUTH_KEY_SECRET_ARN", None)
AGENTA_HOST = os.environ.get("AGENTA_HOST", "http://localhost")
API_BASE_URL = f"{AGENTA_HOST}/api/"

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)


def http_client():
    access_key = os.getenv("AGENTA_AUTH_KEY")
    client = httpx.Client(
        base_url=API_BASE_URL,
        timeout=httpx.Timeout(timeout=6, read=None, write=5),
        headers={"Authorization": f"Access {access_key}"},
    )
    return client


def create_programmatic_user():
    client = http_client()
    randomness = uuid.uuid4().hex[:8]
    response = client.post(
        "admin/accounts",
        json={
            "user": {
                "name": f"Test_{randomness}",
                "email": f"test_{randomness}@agenta.ai",
            },
            "scope": {"name": "tests"},
        },
    )
    response.raise_for_status()
    return response.json()


def get_admin_user_credentials():
    programmatic_user = create_programmatic_user()
    scopes = programmatic_user.get("scopes", [])
    credentials = scopes[0].get("credentials", None)
    return credentials
