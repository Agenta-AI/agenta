import os
import toml
import uuid
from pathlib import Path

import pytest

from tests.cli.fixtures import *


class TestAgentaCLIWorkflow:
    @pytest.fixture(scope="class", autouse=True)
    def _setup(self, request):
        request.cls.asset_example_folder = "greetings"
        request.cls.assets_folder = str(
            get_assets_folder(asset_folder=request.cls.asset_example_folder)
        )
        request.cls.api_key = get_programmatic_access_credentials()

    @pytest.mark.cli
    @pytest.mark.typical
    @pytest.mark.happy
    @pytest.mark.functional
    @pytest.mark.slow
    def test_initialize_blank_app_success(self, cleanup_application_and_files):
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
        assert config["backend_host"] == os.getenv("AGENTA_HOST")

        agentaignore_path = Path(f"{self.assets_folder}/.agentaignore")
        assert agentaignore_path.exists()

        # CLEANUP: Remove application from backend, db and local filesystem
        cleanup = cleanup_application_and_files(
            self.asset_example_folder, provide_api_key
        )
        assert next(cleanup) == "ok"

    @pytest.mark.cli
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.functional
    @pytest.mark.slow
    def test_initialize_blank_app_already_exists(self, cleanup_application_and_files):
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
        result_1 = run_agenta_init(
            inputs,
            self.asset_example_folder,
        )  # create app the first time
        cli_output_1 = next(result_1)
        assert cli_output_1["exit_status"] == 0
        assert "App initialized successfully" in cli_output_1["output"]

        result_2 = run_agenta_init(
            inputs,
            self.asset_example_folder,
        )  # tries to create app with the same name
        cli_output_2 = next(result_2)

        # ASSERT: Verify response
        assert cli_output_2["exit_status"] == 1
        assert "App with the same name already exists" in cli_output_2["output"]

        # CLEANUP: Remove application from backend, db and local filesystem
        cleanup = cleanup_application_and_files(
            self.asset_example_folder, provide_api_key
        )
        assert next(cleanup) == "ok"

    @pytest.mark.cli
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.security
    @pytest.mark.slow
    def test_initialize_blank_app_with_invalid_credentials(self):
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

    @pytest.mark.cli
    @pytest.mark.typical
    @pytest.mark.happy
    @pytest.mark.functional
    @pytest.mark.slow
    def test_custom_workflow_serve_success(self, cleanup_application_and_files):
        # ARRANGE: Prepare test data
        app_name = f"greetings_{uuid.uuid4().hex[:6]}"
        where_to_run_agenta = "\n"
        use_this_key = "n"
        provide_api_key = self.api_key
        check_and_create_env_file(self.asset_example_folder)

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

    @pytest.mark.cli
    @pytest.mark.typical
    @pytest.mark.happy
    @pytest.mark.functional
    @pytest.mark.slow
    def test_custom_workflow_reserve_success(self, cleanup_application_and_files):
        # ARRANGE: Prepare test data
        app_name = f"greetings_{uuid.uuid4().hex[:6]}"
        where_to_run_agenta = "\n"
        use_this_key = "n"
        provide_api_key = self.api_key
        check_and_create_env_file(self.asset_example_folder)
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

        # ACT: Add configuration
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

    @pytest.mark.cli
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.functional
    @pytest.mark.slow
    def test_custom_workflow_serve_with_no_env_file(
        self, cleanup_application_and_files
    ):
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

    @pytest.mark.cli
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.functional
    @pytest.mark.slow
    def test_custom_workflow_serve_with_no_requirements_file(
        self, cleanup_application_and_files
    ):
        # ARRANGE: Prepare test data
        app_name = f"greetings_{uuid.uuid4().hex[:6]}"
        where_to_run_agenta = "\n"
        use_this_key = "n"
        provide_api_key = self.api_key
        if Path(f"{self.assets_folder}/requirements.txt").exists():
            os.rename(
                f"{self.assets_folder}/requirements.txt",
                f"{self.assets_folder}/requirements.temp.txt",
            )
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

        # ACT: Add configuration
        serve_inputs = ["\n", "\n"]  # No .env file found! Are you sure you [...]
        result = run_variant_serve(serve_inputs, self.asset_example_folder)
        cli_serve_output = next(result)

        # ASSERT: Verify response
        assert cli_serve_output["exit_status"] == 1
        assert "Error while building image:" in cli_serve_output["output"]
        assert (
            "'COPY failed: file not found in build context"
            in cli_serve_output["output"]
        )
        assert (
            ".dockerignore: stat requirements.txt: file does not exist"
            in cli_serve_output["output"]
        )

        # CLEANUP:
        # i). Remove application from backend, db and local filesystem
        cleanup = cleanup_application_and_files(
            self.asset_example_folder, provide_api_key
        )
        assert next(cleanup) == "ok"

        # ii). Rename the requirements.temp.txt back to requirements.txt if it exists
        if Path(f"{self.assets_folder}/requirements.temp.txt").exists():
            os.rename(
                f"{self.assets_folder}/requirements.temp.txt",
                f"{self.assets_folder}/requirements.txt",
            )
