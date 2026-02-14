import pytest

import agenta as ag
from agenta.client.core.api_error import ApiError

from tests.legacy.conftest import *  # noqa: F403


class TestDeploymentManagerCoverage:
    @pytest.fixture(autouse=True, scope="class")
    async def setup_class_fixture(self, create_app_and_variant):
        app_variant_response = create_app_and_variant
        service_url = app_variant_response.get("variant", {}).get("uri", None)
        headers = {"Authorization": app_variant_response.get("credentials", None)}

        return {
            "app_variant_response": app_variant_response,
            "headers": headers,
            "service_url": service_url,
        }

    @pytest.mark.asyncio
    @pytest.mark.happy
    @pytest.mark.functional
    @pytest.mark.typical
    async def test_deploy_success_with_variant_ref_slug(self, setup_class_fixture):
        # ARRANGE
        variant_slug = (
            setup_class_fixture["app_variant_response"]
            .get("variant", {})
            .get("config_name")
        )
        application_name = (
            setup_class_fixture["app_variant_response"]
            .get("app", {})
            .get("app_name", None)
        )
        scope_credentials = setup_class_fixture["app_variant_response"].get(
            "credentials", ""
        )
        scope_api_key = scope_credentials.strip("ApiKey ")
        initialize_agenta(api_key=scope_api_key)  # noqa: F405

        # ACT
        response = await ag.DeploymentManager.adeploy(
            variant_slug=variant_slug,
            environment_slug="production",
            app_slug=application_name,
        )
        response_data = response.model_dump()

        # ASSERT
        assert response is not None
        assert isinstance(response_data, dict)
        assert variant_slug == response_data["variant_slug"]
        assert application_name == response_data["app_slug"]

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.functional
    async def test_deploy_not_successful_due_to_invalid_payload(
        self, http_client, setup_class_fixture
    ):
        # ARRANGE
        headers = setup_class_fixture["headers"]
        variant_id = (
            setup_class_fixture["app_variant_response"]
            .get("variant", {})
            .get("variant_id", None)
        )
        variant_revision = await fetch_variant_revision(  # noqa: F405
            http_client, headers, variant_id
        )
        scope_credentials = setup_class_fixture["app_variant_response"].get(
            "credentials", ""
        )
        scope_api_key = scope_credentials.strip("ApiKey ")
        initialize_agenta(api_key=scope_api_key)  # noqa: F405

        # ACT
        with pytest.raises(TypeError):
            response = await ag.DeploymentManager.adeploy(
                variant_slug=variant_revision.get("config_name"),
            )

            # ASSERT
            assert (
                response
                == "TypeError: DeploymentManager.adeploy() missing 1 required keyword-only argument: 'environment_slug'"
            )

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.functional
    async def test_deploy_not_successful_due_to_no_config(self, setup_class_fixture):
        # ARRANGE
        scope_credentials = setup_class_fixture["app_variant_response"].get(
            "credentials", ""
        )
        scope_api_key = scope_credentials.strip("ApiKey ")
        initialize_agenta(api_key=scope_api_key)  # noqa: F405

        # ACT
        with pytest.raises(ApiError) as exc_info:
            await ag.DeploymentManager.adeploy(
                variant_slug="default.appvariant",
                variant_version=3,
                environment_slug="production",
            )

        # ASSERT
        assert exc_info.value.status_code == 404
        assert exc_info.value.body == {"detail": "Config not found."}

    # @pytest.mark.asyncio
    # @pytest.mark.grumpy
    # @pytest.mark.typical
    # @pytest.mark.security
    # async def test_deploy_not_successful_due_to_invalid_scope(
    #     self, http_client, setup_class_fixture
    # ):
    #     # ARRANGE
    #     variant_id = (
    #         setup_class_fixture["app_variant_response"]
    #         .get("variant", {})
    #         .get("variant_id", None)
    #     )
    #     headers = setup_class_fixture["headers"]
    #     variant_revision = fetch_variant_revision(http_client, headers, variant_id)
    #     scope_project_id = setup_class_fixture["app_variant_response"].get(
    #         "scope_project_id", None
    #     )
    #     non_member_credentials = setup_class_fixture["app_variant_response"].get(
    #         "non_scope_credentials", None
    #     )
    #     ag.init(api_key=non_member_credentials.strip("ApiKey "))

    #     # ACT
    #     with pytest.raises(ApiError) as exc_info:
    #         await ag.DeploymentManager.adeploy(
    #             variant_slug=variant_revision.get("config_name"),
    #             variant_version=variant_revision.get("revision", None),
    #             environment_slug="production",
    #             # scope arguments
    #             project_id=scope_project_id,
    #         )

    #     # ASSERT
    #     assert exc_info.value.status_code == 403
    #     assert exc_info.value.body == {
    #         "detail": "You do not have access to perform this action. Please contact your organization admin."
    #     }
