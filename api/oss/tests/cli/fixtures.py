import os
import uuid
import toml
import shutil
import pexpect
from typing import List
from pathlib import Path

import httpx
import pytest

from tests.conftest import AGENTA_HOST, API_BASE_URL


def agenta_executable():
    """
    Fixture to provide the current Agenta executable.
    """

    executable_path = shutil.which("agenta")
    return executable_path


def get_assets_folder(asset_folder: str):
    parent_folder = Path(__file__).parent
    assets_folder = Path(f"{parent_folder}/assets/{asset_folder}/")
    return assets_folder


def retrieve_app_id_from_path_and_remove_application(
    assets_dir: Path, access_token: str
):
    """
    Retrieve the app_id from the config.toml file and remove the application
    """

    config_file = assets_dir / "config.toml"
    if config_file.exists():
        config = toml.load(config_file)
        app_id = config["app_id"]

        # Delete application
        response = httpx.delete(
            f"{API_BASE_URL}apps/{app_id}",
            headers={"Authorization": f"ApiKey {access_token}"},
            timeout=httpx.Timeout(timeout=6, read=None, write=5),
        )
        response.raise_for_status()


def cleanup_created_test_files(assets_dir: Path):
    """
    Clean up the test directory
    """

    if assets_dir.exists():
        # Remove .agentaignore file if it exists
        agentaignore_file = assets_dir / ".agentaignore"
        if agentaignore_file.exists():
            agentaignore_file.unlink()
            print(f"Removed: {agentaignore_file}")

        # Remove config.toml file if it exists
        config_file = assets_dir / "config.toml"
        if config_file.exists():
            config_file.unlink()
            print(f"Removed: {config_file}")


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
        "admin/account",
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


def get_programmatic_access_credentials():
    """
    Retrieve the admin user's credentials for API testing.
    """

    user_credentials = get_admin_user_credentials()
    return str(user_credentials).split("ApiKey ")[-1]


@pytest.fixture
def cleanup_application_and_files():
    """
    Factory fixture to ensure the application and test files are cleaned up after each test class, with support for dynamic folder input.
    """

    def _cleanup_application_and_files(folder_name, access_token):
        assets_dir = get_assets_folder(folder_name)
        retrieve_app_id_from_path_and_remove_application(assets_dir, access_token)
        cleanup_created_test_files(assets_dir)

        yield "ok"

    return _cleanup_application_and_files


@pytest.fixture(scope="class")
def set_agenta_to_run_on_host():
    executable_path = agenta_executable()
    child = pexpect.spawn(
        command=f"{executable_path} config set-host {AGENTA_HOST}",
        encoding="utf-8",
        timeout=10,
    )

    # Give it time to finish
    child.wait()

    yield child.exitstatus


def run_agenta_init(user_inputs: List[str], asset_folder: str):
    """
    Run agenta init in assets/greetings directory with the given inputs using pexpect
    """

    # Ensure the directory exists
    assets_dir = get_assets_folder(asset_folder)
    os.chdir(assets_dir)

    # Construct the command with the provided inputs
    executable_path = agenta_executable()
    child = pexpect.spawn(
        command=f"{executable_path} init", encoding="utf-8", timeout=10
    )

    for input in user_inputs:
        child.send(input)

    # Give it time to finish
    child.wait()

    # Capture the final output after the process finishes
    output = child.read()
    child.close()

    yield {"output": str(output).strip(" "), "exit_status": child.exitstatus}


def run_variant_serve(user_inputs: List[str], asset_folder: str):
    """
    Run agenta variant serve in assets/greetings directory with the given inputs using pexpect
    """

    # Ensure the directory exists
    assets_dir = get_assets_folder(asset_folder)
    os.chdir(assets_dir)

    # Construct the command with the provided inputs
    executable_path = agenta_executable()
    child = pexpect.spawn(
        command=f"{executable_path} variant serve app.py", encoding="utf-8", timeout=10
    )

    for input in user_inputs:
        child.send(input)

    # Give it time to finish
    child.wait()

    # Capture the final output after the process finishes
    output = child.read()
    child.close()

    yield {"output": str(output).strip(" "), "exit_status": child.exitstatus}


def check_and_create_env_file(asset_folder: str):
    # Ensure the directory exists
    assets_dir = get_assets_folder(asset_folder)
    os.chdir(assets_dir)

    # Check if .env file exists, otherwise create it
    env_file = assets_dir / ".env"
    if not env_file.exists():
        openai_api_key = os.getenv("OPENAI_API_KEY", "")
        env_file.write_text(f"OPENAI_API_KEY={openai_api_key}")
        print(f"Created: {env_file}")
