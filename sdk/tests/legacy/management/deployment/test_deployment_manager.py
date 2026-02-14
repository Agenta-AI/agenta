import uuid

import pytest

from tests.management.deployment.fixtures import *  # noqa: F403


@pytest.mark.usefixtures("create_app_from_template")
class TestDeploymentManager:
    @pytest.mark.asyncio
    @pytest.mark.deployment_manager
    async def test_configs_deploy_success(
        self, http_client, get_completion_app_from_list, get_variant_revisions
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
            "variants/configs/deploy",
            json={
                "variant_ref": {
                    "slug": variant_revision_config_name,
                    "version": variant_revision_version,
                    "id": variant_revision_id,
                },
                "environment_ref": {"slug": "production", "version": None, "id": None},
                "application_ref": {
                    "slug": None,
                    "version": None,
                    "id": app_id,
                },
            },
        )

        # ASSERT: Verify response
        assert response.status_code == 200
        assert "params" and "url" in response.json()
        assert "environment_lifecycle" in response.json()

    @pytest.mark.asyncio
    @pytest.mark.deployment_manager
    async def test_configs_deploy_not_found(self, http_client):
        # ACT: Add configuration
        response = await http_client.post(
            "variants/configs/deploy",
            json={
                "variant_ref": {
                    "slug": "default.appvariant",
                    "version": 3,
                    "id": str(uuid.uuid4()),  # non-existent config
                },
                "environment_ref": {"slug": "production", "version": None, "id": None},
            },
        )

        # ASSERT: Verify response
        assert response.status_code == 404
        assert response.json()["detail"] == "Config not found."
