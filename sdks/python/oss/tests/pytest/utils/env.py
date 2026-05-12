import os
import pytest


def get_ag_env():
    api_url = os.getenv("AGENTA_API_URL")
    auth_key = os.getenv("AGENTA_AUTH_KEY")

    assert api_url, "AGENTA_API_URL must be set"
    assert auth_key, "AGENTA_AUTH_KEY must be set"

    return {
        "api_url": api_url,
        "auth_key": auth_key,
    }


@pytest.fixture(scope="session")
def ag_env():
    return get_ag_env()
