import pytest

from tests.management.config.fixtures import *  # noqa: F403
from tests.management.deployment.fixtures import *  # noqa: F403


@pytest.mark.usefixtures("create_app_from_template")
class TestDConfigManager:
    @pytest.mark.asyncio
    @pytest.mark.config_manager
    async def test_configs_fetch_by_variant_ref(
        self, http_client, get_variant_revisions
    ):
        # ARRANGE: Prepare test data
        variant_revision = get_variant_revisions[0]
        variant_revision_id = variant_revision.get("id", None)
        variant_revision_config_name = variant_revision.get("config", {}).get(
            "config_name", None
        )
        variant_revision_version = variant_revision.get("revision")

        # ACT: Add configuration
        response = await http_client.post(
            url="variants/configs/fetch",
            json={
                "variant_ref": {
                    "slug": variant_revision_config_name,
                    "version": variant_revision_version,
                    "id": variant_revision_id,
                }
            },
        )

        # ASSERT: Verify response
        assert response.status_code == 200
        assert "params" in response.json()
        assert "application_ref" in response.json()
        assert "variant_ref" in response.json()
        assert "service_ref" in response.json()
        assert "environment_ref" in response.json()
        assert "variant_lifecycle" in response.json()

    @pytest.mark.asyncio
    @pytest.mark.config_manager
    async def test_configs_fetch_by_environment_and_application_ref(
        self, http_client, get_completion_app_from_list
    ):
        # ARRANGE: Prepare test data
        app_id = get_completion_app_from_list.get("app_id", None)

        # ACT: Add configuration
        response = await http_client.post(
            url="variants/configs/fetch",
            json={  # type: ignore
                "environment_ref": {"slug": "production", "version": 1, "id": None},
                "application_ref": {
                    "slug": None,
                    "version": None,
                    "id": app_id,
                },
            },
        )

        # ASSERT: Verify response
        assert response.status_code == 200
        assert "params" in response.json()
        assert "application_ref" in response.json()
        assert "variant_ref" in response.json()
        assert "service_ref" in response.json()
        assert "environment_ref" in response.json()
        assert "variant_lifecycle" in response.json()

    @pytest.mark.asyncio
    @pytest.mark.config_manager
    async def test_configs_fetch_by_environment_ref(
        self, http_client, get_production_environment_revision
    ):
        # ARRANGE: Prepare test data
        environment_revision = get_production_environment_revision.get("revisions", [])[
            0
        ]

        # ACT: Add configuration
        response = await http_client.post(
            url="variants/configs/fetch",
            json={  # type: ignore
                "environment_ref": {
                    "slug": None,
                    "version": None,
                    "id": environment_revision.get("id", None),
                }
            },
        )

        # ASSERT: Verify response
        assert response.status_code == 200
        assert "params" in response.json()
        assert "application_ref" in response.json()
        assert "variant_ref" in response.json()
        assert "service_ref" in response.json()
        assert "environment_ref" in response.json()
        assert "variant_lifecycle" in response.json()

    @pytest.mark.asyncio
    @pytest.mark.config_manager
    async def test_configs_fetch_not_found(self, http_client):
        # ACT: Add configuration
        response = await http_client.post(
            url="variants/configs/fetch",
            params={  # type: ignore
                "variant_ref": {
                    "slug": "non-existent",
                    "version": 1,
                    "id": "non-existent-id",
                }
            },
        )

        # ASSERT: Verify response
        assert response.status_code == 404
        assert response.json()["detail"] == "Config not found."
