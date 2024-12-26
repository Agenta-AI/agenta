import os
import toml
import uuid
from pathlib import Path

import pytest

from .fixtures import *


class TestAgentaVariantServeCommand:
    @pytest.fixture(scope="class", autouse=True)
    def _setup(self, request):
        request.cls.asset_example_folder = "salutations"
        request.cls.assets_folder = str(
            get_assets_folder(example_folder=request.cls.asset_example_folder)
        )
        request.cls.api_key = get_programmatic_access_credentials()

    @pytest.mark.cli_testing
    def test_variant_serve_success(self, cleanup_application_and_files):
        # ARRANGE: Prepare test data
        app_name = f"greetings_{uuid.uuid4().hex[:6]}"
        where_to_run_agenta = "\n"
        use_this_key = "n"
        provide_api_key = self.api_key

        # ACT: Add configuration
        init_inputs = [
            f"{app_name}\n",
            where_to_run_agenta,
            use_this_key,
            f"{provide_api_key}\n",
        ]
        result = run_agenta_init(init_inputs, self.asset_example_folder)
        cli_output = next(result)

        if cli_output["exit_status"] == 1:
            pytest.fail("Creating an app from the CLI failed.")

        serve_inputs = []
        result = run_variant_serve(serve_inputs, self.asset_example_folder)
        cli_serve_output = next(result)

        # ASSERT: Verify response
        assert cli_serve_output["exit_status"] == 0
        assert "Adding app.default to server..." in cli_serve_output["output"]
        assert "Waiting for the variant to be ready" in cli_serve_output["output"]
        assert "Variant added successfully!" in cli_serve_output["output"]
        assert "Congratulations!" in cli_serve_output["output"]
        assert (
            "Your app has been deployed locally as an API."
            in cli_serve_output["output"]
        )
        assert "Read the API documentation." in cli_serve_output["output"]
        assert (
            "Start experimenting with your app in the playground."
            in cli_serve_output["output"]
        )

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
    def test_variant_reserve_success(self, cleanup_application_and_files):
        # ARRANGE: Prepare test data
        app_name = f"greetings_{uuid.uuid4().hex[:6]}"
        where_to_run_agenta = "\n"
        use_this_key = "n"
        provide_api_key = self.api_key

        # ACT: Add configuration
        init_inputs = [
            f"{app_name}\n",
            where_to_run_agenta,
            use_this_key,
            f"{provide_api_key}\n",
        ]
        result = run_agenta_init(init_inputs, self.asset_example_folder)
        cli_output = next(result)

        if cli_output["exit_status"] == 1:
            pytest.fail("Creating an app from the CLI failed.")

        serve_inputs = []
        serve_result = run_variant_serve(serve_inputs, self.asset_example_folder)
        cli_serve_output = next(serve_result)

        if cli_serve_output["exit_status"] == 1:
            pytest.fail("Serving a variant from the CLI failed.")

        reserve_inputs = ["y\n"]
        reserve_result = run_variant_serve(reserve_inputs, self.asset_example_folder)
        cli_reserve_output = next(reserve_result)

        # ASSERT: Verify response
        assert cli_reserve_output["exit_status"] == 0
        assert (
            f"Variant app.default for App {app_name} updated successfully"
            in cli_reserve_output["output"]
        )

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
    def test_variant_serve_with_no_env_file(self, cleanup_application_and_files):
        # ARRANGE: Prepare test data
        app_name = f"greetings_{uuid.uuid4().hex[:6]}"
        where_to_run_agenta = "\n"
        use_this_key = "n"
        provide_api_key = self.api_key
        if Path(f"{self.assets_folder}/.env").exists():
            os.rename(f"{self.assets_folder}/.env", f"{self.assets_folder}/.env.dummy")

        # ACT: Add configuration
        init_inputs = [
            f"{app_name}\n",
            where_to_run_agenta,
            use_this_key,
            f"{provide_api_key}\n",
        ]
        result = run_agenta_init(init_inputs, self.asset_example_folder)
        cli_output = next(result)

        if cli_output["exit_status"] == 1:
            pytest.fail("Creating an app from the CLI failed.")

        serve_inputs = ["n"]  # No .env file found! Are you sure you [...]
        result = run_variant_serve(serve_inputs, self.asset_example_folder)
        cli_serve_output = next(result)

        # ASSERT: Verify response
        assert cli_serve_output["exit_status"] == 0
        assert "Operation cancelled." in cli_serve_output["output"]

        # CLEANUP:
        # i). Remove application from backend, db and local filesystem
        cleanup = cleanup_application_and_files(
            self.asset_example_folder, provide_api_key
        )
        assert next(cleanup) == "ok"

        # ii). Rename the.env.dummy back to.env if it exists
        if Path(f"{self.assets_folder}/.env.dummy").exists():
            os.rename(f"{self.assets_folder}/.env.dummy", f"{self.assets_folder}/.env")
