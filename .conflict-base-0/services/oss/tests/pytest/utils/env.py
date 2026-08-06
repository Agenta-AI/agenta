import os
from urllib.parse import urlsplit, urlunsplit

import pytest


def derive_services_url(api_url: str) -> str:
    parsed = urlsplit(api_url)
    path = parsed.path.rstrip("/")
    if path.endswith("/api"):
        path = path[: -len("/api")]
    services_path = f"{path}/services" if path else "/services"
    return urlunsplit((parsed.scheme, parsed.netloc, services_path, "", ""))


def get_ag_env():
    api_url = os.getenv("AGENTA_API_URL")
    auth_key = os.getenv("AGENTA_AUTH_KEY")

    assert api_url, "AGENTA_API_URL must be set"
    assert auth_key, "AGENTA_AUTH_KEY must be set"

    return {
        "api_url": api_url,
        "auth_key": auth_key,
        "services_url": derive_services_url(api_url),
    }


@pytest.fixture(scope="session")
def ag_env():
    env_vars = get_ag_env()
    yield env_vars
