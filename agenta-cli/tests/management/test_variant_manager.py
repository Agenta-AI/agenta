import uuid

import pytest


@pytest.mark.usefixtures("create_app_from_template")
class TestVariantManager:
    @pytest.mark.asyncio
    @pytest.mark.variant_management
    async def test_configs_add_success(self, http_client, get_completion_app_from_list):
        # ARRANGE: Prepare test data
        test_variant_slug = "from_pytest"
        app_id = get_completion_app_from_list.get("app_id", None)

        # ACT: Add configuration
        response = await http_client.post(
            "/api/variants/configs/add",
            json={
                "variant_ref": {"slug": test_variant_slug, "version": None, "id": None},
                "application_ref": {"slug": None, "version": None, "id": app_id},
            },
        )

        # ASSERT: Verify response
        assert (
            response.status_code == 200
        ), f"Failed to add config for variant {test_variant_slug}"
        response_data = response.json()
        assert "params" in response_data, "Response missing 'params'"
        assert "url" in response_data, "Response missing 'url'"

    @pytest.mark.asyncio
    @pytest.mark.variant_management
    async def test_configs_add_duplicate(
        self, http_client, get_completion_app_from_list
    ):
        # ARRANGE: Prepare test data for an existing configuration
        existing_variant_slug = "default"
        app_id = get_completion_app_from_list.get("app_id", None)

        # ACT: Attempt to add duplicate configuration
        response = await http_client.post(
            "/api/variants/configs/add",
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
        assert (
            response.json()["detail"] == "Config already exists."
        ), "Incorrect error message for duplicate config"

    @pytest.mark.asyncio
    @pytest.mark.variant_management
    async def test_configs_nonexistent_app(self, http_client):
        # ARRANGE: Prepare test data with non-existent application
        non_existent_app_id = str(uuid.uuid4())

        # ACT: Attempt to add config for non-existent application
        response = await http_client.post(
            "/api/variants/configs/add",
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
        assert (
            response.status_code == 404
        ), "Expected 404 error for non-existent application"
        assert (
            response.json()["detail"] == "Config not found."
        ), "Incorrect error message for non-existent application"

    @pytest.mark.asyncio
    @pytest.mark.variant_management
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
            "/api/variants/configs/add", json=invalid_variant_data
        )

        # ASSERT: Verify validation error
        assert response.status_code == 422, "Expected 422 validation error"
