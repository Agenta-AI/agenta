import requests
import pytest

from uuid import uuid4

from utils.constants import BASE_TIMEOUT


def create_account(ag_env):
    api_url = ag_env["api_url"]
    auth_key = ag_env["auth_key"]

    headers = {"Authorization": f"Access {auth_key}"}
    url = f"{api_url}/admin/simple/accounts/"

    unique_id = uuid4().hex[:12]

    response = requests.post(
        url=url,
        headers=headers,
        json={
            "accounts": {
                "user": {
                    "user": {
                        "email": f"{unique_id}@test.agenta.ai",
                    },
                    "options": {
                        "create_api_keys": True,
                        "return_api_keys": True,
                        # Default-seeded evaluators/environments leak into
                        # query-count assertions in test classes that share
                        # this fixture. Tests that need defaults should
                        # create them explicitly.
                        "seed_defaults": False,
                    },
                }
            }
        },
        timeout=BASE_TIMEOUT,
    )

    assert response is not None, "Response should not be None"
    assert response.status_code == 200, (
        f"Expected 200, got {response.status_code}: {response.text}"
    )

    json_data = response.json()
    assert isinstance(json_data, dict), "Response JSON should not be None"

    accounts = json_data.get("accounts")
    assert accounts, "No accounts in response"

    account = next(iter(accounts.values()))
    api_keys = account.get("api_keys")
    assert api_keys and "key" in api_keys, "No api_keys.key in account"

    raw_key = api_keys["key"]
    assert raw_key, "No value in api_keys.key"

    return {
        "api_url": api_url,
        "credentials": f"ApiKey {raw_key}",
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
