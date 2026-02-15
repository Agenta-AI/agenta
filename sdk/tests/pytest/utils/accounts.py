import requests
import pytest

from tests.pytest.utils.constants import BASE_TIMEOUT


def create_account(ag_env):
    api_url = ag_env["api_url"]
    auth_key = ag_env["auth_key"]

    headers = {"Authorization": f"Access {auth_key}"}
    url = f"{api_url}/admin/account"

    response = requests.post(
        url=url,
        headers=headers,
        json={
            "subscription": {
                "plan": "cloud_v0_business",  # Use BUSINESS plan to avoid quota limits in tests
            },
        },
        timeout=BASE_TIMEOUT,
    )

    assert response is not None, "Response should not be None"
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"

    json_data = response.json()
    assert isinstance(json_data, dict), "Response JSON should not be None"

    scopes = json_data.get("scopes")
    assert scopes and len(scopes) > 0, "No scopes returned in response"

    scope_data = scopes[0]
    assert isinstance(scope_data, dict), "Scope should be a dictionary"

    credentials = scope_data.get("credentials")
    assert credentials, "No credentials in scopes"

    return {
        "api_url": api_url,
        "credentials": credentials,
    }


@pytest.fixture(scope="function")
def foo_account(ag_env):
    account_data = create_account(ag_env)
    yield account_data
    print("Teardown for function-scoped account goes here.")


@pytest.fixture(scope="class")
def cls_account(ag_env):
    account_data = create_account(ag_env)
    yield account_data
    print("Teardown for class-scoped account goes here.")


@pytest.fixture(scope="module")
def mod_account(ag_env):
    account_data = create_account(ag_env)
    yield account_data
    print("Teardown for module-scoped account goes here.")
