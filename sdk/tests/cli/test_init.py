import os
import toml
import uuid
from pathlib import Path

import pytest

from .fixtures import *


class TestAgentaInitCommand:
    @pytest.fixture(scope="class", autouse=True)
    def _setup(self, request):
        request.cls.asset_example_folder = "greetings"
        request.cls.assets_folder = str(
            get_assets_folder(example_folder=request.cls.asset_example_folder)
        )
        request.cls.api_key = get_programmatic_access_credentials()

    @pytest.mark.cli_testing
    def test_cloud_blank_app_success(self, cleanup_application_and_files):
        # ARRANGE: Prepare test data
        app_name = f"greetings_{uuid.uuid4().hex[:6]}"
        where_to_run_agenta = "\n"
        use_this_key = "n"
        provide_api_key = self.api_key

        # ACT: Add configuration
        inputs = [
            f"{app_name}\n",
            where_to_run_agenta,
            use_this_key,
            f"{provide_api_key}\n",
        ]
        result = run_agenta_init(inputs, self.asset_example_folder)
        cli_output = next(result)

        # ASSERT: Verify response
        assert cli_output["exit_status"] == 0
        assert "App initialized successfully" in cli_output["output"]

        config_path = Path(f"{self.assets_folder}/config.toml")
        assert config_path.exists()

        config = toml.load(config_path)
        assert config["app_id"] is not None
        assert config["app_name"] == app_name
        assert config["backend_host"] == os.environ.get("AGENTA_HOST")

        agentaignore_path = Path(f"{self.assets_folder}/.agentaignore")
        assert agentaignore_path.exists()

        # CLEANUP: Remove application from backend, db and local filesystem
        cleanup = cleanup_application_and_files(
            self.asset_example_folder, provide_api_key
        )
        assert next(cleanup) == "ok"

    @pytest.mark.cli_testing
    def test_cloud_blank_app_already_exists(self, cleanup_application_and_files):
        # ARRANGE: Prepare test data
        app_name = f"greetings_{uuid.uuid4().hex[:6]}"
        where_to_run_agenta = "\n"
        use_this_key = "N"
        provide_api_key = self.api_key

        # ACT: Add configuration
        inputs = [
            f"{app_name}\n",
            where_to_run_agenta,
            use_this_key,
            f"{provide_api_key}\n",
        ]
        result_1 = run_agenta_init(
            inputs, self.asset_example_folder
        )  # create app the first time
        _ = next(result_1)
        result_2 = run_agenta_init(
            inputs, self.asset_example_folder
        )  # tries to create app with the same name
        cli_output = next(result_2)

        # ASSERT: Verify response
        assert cli_output["exit_status"] == 1
        assert "App with the same name already exists" in cli_output["output"]

        # CLEANUP: Remove application from backend, db and local filesystem
        cleanup = cleanup_application_and_files(
            self.asset_example_folder, provide_api_key
        )
        assert next(cleanup) == "ok"

    @pytest.mark.cli_testing
    def test_cloud_blank_app_with_invalid_credential(self):
        # ARRANGE: Prepare test data
        app_name = f"greetings_{uuid.uuid4().hex[:6]}"
        where_to_run_agenta = "\n"
        provide_api_key = "dummy_key\n"
        environ_keys = os.environ.copy()
        os.environ["AGENTA_API_KEY"] = "dummy_key"

        # ACT: Add configuration
        inputs = [
            f"{app_name}\n",
            where_to_run_agenta,
            f"{provide_api_key}\n",
        ]
        result = run_agenta_init(inputs, self.asset_example_folder)
        cli_output = next(result)

        # ASSERT: Verify response
        assert (
            cli_output["exit_status"] == 1
        )  # Ensure non-zero exit status indicating failure
        assert "Unauthorized" in cli_output["output"]

        config_path = Path(f"{self.assets_folder}/config.toml")
        assert not config_path.exists()

        agentaignore_path = Path(f"{self.assets_folder}/.agentaignore")
        assert not agentaignore_path.exists()

        # CLEANUP: Reset environment variables
        os.environ.clear()
        os.environ.update(environ_keys)
