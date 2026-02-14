import uuid

import pytest

from tests.management.deployment.fixtures import *  # noqa: F403


@pytest.mark.usefixtures("create_app_from_template")
class TestVariantManager:
    @pytest.mark.asyncio
    @pytest.mark.variant_manager
    async def test_configs_add_success(self, http_client, get_completion_app_from_list):
        # ARRANGE: Prepare test data
        test_variant_slug = "from_pytest"
        app_id = get_completion_app_from_list.get("app_id", None)

        # ACT: Add configuration
        response = await http_client.post(
            "variants/configs/add",
            json={
                "variant_ref": {"slug": test_variant_slug, "version": None, "id": None},
                "application_ref": {"slug": None, "version": None, "id": app_id},
            },
        )

        # ASSERT: Verify response
        assert response.status_code == 200, (
            f"Failed to add config for variant {test_variant_slug}"
        )
        response_data = response.json()
        assert "params" in response_data, "Response missing 'params'"
        assert "url" in response_data, "Response missing 'url'"

    @pytest.mark.asyncio
    @pytest.mark.variant_manager
    async def test_configs_add_duplicate(
        self, http_client, get_completion_app_from_list
    ):
        # ARRANGE: Prepare test data for an existing configuration
        existing_variant_slug = "default"
        app_id = get_completion_app_from_list.get("app_id", None)

        # ACT: Attempt to add duplicate configuration
        response = await http_client.post(
            "variants/configs/add",
            json={
                "variant_ref": {
                    "slug": existing_variant_slug,
                    "version": None,
                    "id": None,
                },
                "application_ref": {"slug": None, "version": None, "id": app_id},
            },
        )

        # ASSERT: Verify error response for duplicate
        assert response.status_code == 400, "Expected 400 error for duplicate config"
        assert response.json()["detail"] == "Config already exists.", (
            "Incorrect error message for duplicate config"
        )

    @pytest.mark.asyncio
    @pytest.mark.variant_manager
    async def test_configs_nonexistent_app(self, http_client):
        # ARRANGE: Prepare test data with non-existent application
        non_existent_app_id = str(uuid.uuid4())

        # ACT: Attempt to add config for non-existent application
        response = await http_client.post(
            "variants/configs/add",
            json={
                "variant_ref": {"slug": "default", "version": None, "id": None},
                "application_ref": {
                    "slug": None,
                    "version": None,
                    "id": non_existent_app_id,
                },
            },
        )

        # ASSERT: Verify error response for non-existent application
        assert response.status_code == 404, (
            "Expected 404 error for non-existent application"
        )
        assert response.json()["detail"] == "Config not found.", (
            "Incorrect error message for non-existent application"
        )

    @pytest.mark.asyncio
    @pytest.mark.variant_manager
    async def test_configs_add_invalid_data(self, http_client):
        # ARRANGE: Prepare invalid test data
        invalid_variant_data = {
            "variant_ref": {
                "slug": "non-existent",
                "version": 3,
                "id": "non-existent-id",
            },
            "application_ref": {"slug": None, "version": None, "id": None},
        }

        # ACT: Attempt to add configuration with invalid data
        response = await http_client.post(
            "variants/configs/add", json=invalid_variant_data
        )

        # ASSERT: Verify validation error
        assert response.status_code == 422, "Expected 422 validation error"

    @pytest.mark.asyncio
    @pytest.mark.variant_manager
    async def test_configs_commit_success(
        self,
        http_client,
        get_variant_revisions,
        get_completion_app_from_list,
    ):
        # ARRANGE: Prepare test data
        app_id = get_completion_app_from_list.get("app_id", None)
        variant_revision = get_variant_revisions[0]
        variant_revision_id = variant_revision.get("id", None)
        variant_revision_config_name = variant_revision.get("config", {}).get(
            "config_name", None
        )
        variant_revision_version = variant_revision.get("revision")

        # ACT: Add configuration
        response = await http_client.post(
            "variants/configs/commit",
            json={
                "config": {
                    "params": {
                        "model": "gpt-4",
                        "top_p": 1,
                        "inputs": [{"name": "country"}],
                        "force_json": 0,
                        "max_tokens": 1000,
                        "prompt_user": "What is the capital of {country}?",
                        "temperature": 0.65,
                        "prompt_system": "You are an expert in geography.",
                        "presence_penalty": 0,
                        "frequence_penalty": 0,
                    },
                    "application_ref": {
                        "slug": None,
                        "version": None,
                        "id": app_id,
                    },
                    "service_ref": None,
                    "variant_ref": {
                        "slug": variant_revision_config_name,
                        "version": variant_revision_version,
                        "id": variant_revision_id,
                    },
                    "environment_ref": None,
                }
            },
        )

        # ASSERT: Verify response
        assert response.status_code == 200
        assert "params" and "url" in response.json()
        assert "variant_lifecycle" in response.json()

    @pytest.mark.asyncio
    @pytest.mark.variant_manager
    async def test_configs_commit_missing_data(
        self, http_client, get_completion_app_from_list
    ):
        # ARRANGE: Prepare test data
        app_id = get_completion_app_from_list.get("app_id", None)

        # ACT: Add configuration
        response = await http_client.post(
            "variants/configs/commit",
            json={
                "params": {},
                "url": "",
                "application_ref": {
                    "slug": "test",
                    "version": None,
                    "id": app_id,
                },
            },
        )

        # ASSERT: Verify response
        assert response.status_code == 422

    @pytest.mark.asyncio
    @pytest.mark.variant_manager
    async def test_configs_delete_success(
        self, http_client, get_completion_app_from_list, list_app_variants
    ):
        # ARRANGE: Prepare test data
        app_name = get_completion_app_from_list.get("app_name", None)
        app_variant = list_app_variants[0]

        # ACT: Add configuration
        variant_response = await http_client.post(
            "variants/from-base",
            json={
                "base_id": app_variant.get("base_id"),
                "new_variant_name": "from_pytest_for_deletion",
                "new_config_name": "from_base_config",
                "parameters": {},
            },
        )
        variant_response.raise_for_status()

        response = await http_client.post(
            "variants/configs/delete",
            json={
                "variant_ref": {
                    "slug": "from_pytest_for_deletion",
                    "version": None,
                    "id": None,
                },
                "application_ref": {
                    "slug": app_name,
                    "version": None,
                    "id": None,
                },
            },
        )

        # ASSERT: Verify response
        assert response.status_code == 200
        assert 204 == response.json()

    @pytest.mark.asyncio
    @pytest.mark.variant_manager
    async def test_configs_delete_not_found(
        self, http_client, get_completion_app_from_list
    ):
        # ARRANGE: Prepare test data
        app_name = get_completion_app_from_list.get("app_name", None)

        # ACT: Add configuration
        response = await http_client.post(
            "variants/configs/delete",
            json={
                "variant_ref": {
                    "slug": "non-existent-variant",
                    "version": None,
                    "id": None,
                },
                "application_ref": {
                    "slug": app_name,
                    "version": None,
                    "id": None,
                },
            },
        )

        # ASSERT: Verify response
        assert 204 == response.json()

    @pytest.mark.asyncio
    @pytest.mark.variant_manager
    async def test_configs_list_success(
        self, http_client, get_completion_app_from_list
    ):
        # ARRANGE: Prepare test data
        app_name = get_completion_app_from_list.get("app_name", None)

        # ACT: Add configuration
        response = await http_client.post(
            "variants/configs/list",
            json={
                "application_ref": {
                    "slug": app_name,
                    "version": None,
                    "id": None,
                }
            },
        )

        # ASSERT: Verify response
        assert response.status_code == 200
        assert isinstance(response.json(), list)
        assert len(response.json()) > 0

    @pytest.mark.asyncio
    @pytest.mark.variant_manager
    async def test_configs_list_not_found(self, http_client):
        # ACT: Add configuration
        response = await http_client.post(
            "variants/configs/list",
            json={
                "application_ref": {
                    "slug": "non_existent_app",
                    "version": None,
                    "id": None,
                }
            },
        )

        # ASSERT: Verify response
        assert response.status_code == 200
        assert [] == response.json()

    @pytest.mark.asyncio
    @pytest.mark.variant_manager
    async def test_configs_history_by_slug_and_appid_success(
        self,
        http_client,
        get_completion_app_from_list,
        get_variant_revisions,
    ):
        # ARRANGE: Prepare test data
        app_id = get_completion_app_from_list.get("app_id", None)
        variant_revision = get_variant_revisions[0]
        variant_revision_config_name = variant_revision.get("config", {}).get(
            "config_name", None
        )

        # ACT: Add configuration
        response = await http_client.post(
            "variants/configs/history",
            json={
                "application_ref": {
                    "slug": None,
                    "version": None,
                    "id": app_id,
                },
                "variant_ref": {
                    "slug": variant_revision_config_name,
                    "version": None,
                    "id": None,
                },
            },
        )

        # ASSERT: Verify response
        assert response.status_code == 200
        assert isinstance(response.json(), list)
        assert len(response.json()) >= 1

    @pytest.mark.asyncio
    @pytest.mark.variant_manager
    async def test_configs_history_by_id_success(self, http_client, list_app_variants):
        # ARRANGE: Prepare test data
        app_variant = list_app_variants[0]

        # ACT: Add configuration
        response = await http_client.post(
            "variants/configs/history",
            json={
                "variant_ref": {
                    "slug": None,
                    "version": None,
                    "id": app_variant.get("variant_id", None),
                },
            },
        )

        # ASSERT: Verify response
        assert response.status_code == 200
        assert isinstance(response.json(), list)
        assert len(response.json()) > 0

    @pytest.mark.asyncio
    @pytest.mark.variant_manager
    async def test_configs_history_not_found(self, http_client):
        # ACT: Add configuration
        app_not_found_response = await http_client.post(
            "variants/configs/history",
            json={
                "variant_ref": {
                    "slug": "non_existent_app",
                    "version": None,
                    "id": None,
                }
            },
        )
        variant_not_found_response = await http_client.post(
            "variants/configs/history",
            json={
                "variant_ref": {
                    "slug": None,
                    "version": None,
                    "id": str(uuid.uuid4()),
                }
            },
        )

        # ASSERT: Verify response
        assert app_not_found_response.status_code == 200
        assert variant_not_found_response.status_code == 200
        assert [] == (
            app_not_found_response.json() and variant_not_found_response.json()
        )
