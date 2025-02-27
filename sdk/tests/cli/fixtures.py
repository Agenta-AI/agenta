import sys
import os
import toml
import shutil
import pexpect
from typing import List
from pathlib import Path

import httpx
import pytest

from tests.conftest import get_admin_user_credentials, API_BASE_URL


def agenta_executable():
    """
    Fixture to provide the current Agenta executable.
    """

    executable_path = shutil.which("agenta")
    return executable_path


def get_assets_folder(example_folder: str):
    parent_folder = Path(__file__).parent
    assets_folder = Path(f"{parent_folder}/assets/{example_folder}/")
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


def get_programmatic_access_credentials():
    """
    Retrieve the admin user's credentials for API testing.
    """

    user_credentials = get_admin_user_credentials()
    return str(user_credentials).strip("ApiKey ")


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


def run_agenta_init(user_inputs: List[str], example_folder: str):
    """
    Run agenta init in assets/greetings directory with the given inputs using pexpect
    """

    # Ensure the directory exists
    assets_dir = get_assets_folder(example_folder)
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


def run_variant_serve(user_inputs: List[str], example_folder: str):
    """
    Run agenta variant serve in assets/greetings directory with the given inputs using pexpect
    """

    # Ensure the directory exists
    assets_dir = get_assets_folder(example_folder)
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
