import os
import uuid
import logging
from json import loads
from traceback import format_exc
from typing import Optional, Any

import httpx
import boto3
from dotenv import load_dotenv


# Load environment variables
load_dotenv("../.env")

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


def http_client():
    access_key = fetch_secret(
        secret_arn=AGENTA_SECRET_ARN, secret_key=AGENTA_SECRET_KEY
    )
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
