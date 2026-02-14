import uuid

import pytest
import agenta as ag
from agenta.client.core.api_error import ApiError

from tests.legacy.conftest import *  # noqa: F403


class TestVariantManagerCoverage:
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
    async def test_create_variant_successfully(
        self, setup_class_fixture, valid_parameters_payload
    ):
        # ARRANGE
        payload = valid_parameters_payload
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
        new_variant_slug = f"{variant_slug}_{uuid.uuid4().hex[:4]}"

        # ACT
        response = await ag.VariantManager.acreate(
            parameters=payload,
            variant_slug=new_variant_slug,
            app_slug=application_name,
        )
        response_data = response.model_dump()

        # ASSERT
        assert response is not None
        assert isinstance(response_data, dict)
        assert new_variant_slug == response_data["variant_slug"]
        assert application_name == response_data["app_slug"]

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.functional
    async def test_create_variant_unsuccessfully_due_to_invalid_payload(
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
            response = await ag.VariantManager.acreate(
                variant_slug=variant_revision.get("config_name"),
            )

            # ASSERT
            assert (
                response
                == "TypeError: VariantManager.acreate() missing 1 required keyword-only argument: 'parameters'"
            )

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.functional
    async def test_create_variant_unsuccessfully_due_to_no_config(
        self, setup_class_fixture
    ):
        # ARRANGE
        scope_credentials = setup_class_fixture["app_variant_response"].get(
            "credentials", ""
        )
        scope_api_key = scope_credentials.strip("ApiKey ")
        initialize_agenta(api_key=scope_api_key)  # noqa: F405

        # ACT
        with pytest.raises(ApiError) as exc_info:
            await ag.VariantManager.acreate(
                parameters={},
                variant_slug="default.appvariant",
                app_id=str(uuid.uuid4().hex),
            )

        # ASSERT
        assert exc_info.value.status_code == 404
        assert exc_info.value.body == {"detail": "Config not found."}

    # @pytest.mark.asyncio
    # @pytest.mark.grumpy
    # @pytest.mark.typical
    # @pytest.mark.security
    # async def test_create_variant_unsuccessfully_due_to_invalid_scope(
    #     self, http_client, setup_class_fixture, valid_parameters_payload
    # ):
    #     # ARRANGE
    #     payload = valid_parameters_payload
    #     variant_id = (
    #         setup_class_fixture["app_variant_response"]
    #         .get("variant", {})
    #         .get("variant_id", None)
    #     )
    #     application_name = (
    #         setup_class_fixture["app_variant_response"]
    #         .get("app", {})
    #         .get("app_name", None)
    #     )
    #     headers = setup_class_fixture["headers"]
    #     variant_revision = await fetch_variant_revision(
    #         http_client, headers, variant_id
    #     )
    #     scope_project_id = setup_class_fixture["app_variant_response"].get(
    #         "scope_project_id", None
    #     )
    #     non_member_credentials = setup_class_fixture["app_variant_response"].get(
    #         "non_scope_credentials", None
    #     )
    #     initialize_agenta(api_key=non_member_credentials.strip("ApiKey "))

    #     # ACT
    #     with pytest.raises(ApiError) as exc_info:
    #         await ag.VariantManager.acreate(
    #             parameters=payload,
    #             variant_slug=variant_revision.get("config_name"),
    #             app_slug=application_name,
    #         )

    #     # ASSERT
    #     assert exc_info.value.status_code == 403
    #     assert exc_info.value.body == {
    #         "detail": "You do not have access to perform this action. Please contact your organization admin."
    #     }

    @pytest.mark.asyncio
    @pytest.mark.happy
    @pytest.mark.functional
    @pytest.mark.typical
    async def test_commit_variant_successfully(
        self, setup_class_fixture, valid_parameters_payload
    ):
        # ARRANGE
        payload = valid_parameters_payload
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
        response = await ag.VariantManager.acommit(
            parameters=payload,
            variant_slug=variant_slug,
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
    async def test_commit_variant_unsuccessfully_due_to_invalid_payload(
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
            response = await ag.VariantManager.acommit(
                variant_slug=variant_revision.get("config_name"),
            )

            # ASSERT
            assert (
                response
                == "TypeError: VariantManager.acommit() missing 1 required keyword-only argument: 'parameters'"
            )

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.functional
    async def test_commit_variant_unsuccessfully_due_to_no_config(
        self, setup_class_fixture
    ):
        # ARRANGE
        scope_credentials = setup_class_fixture["app_variant_response"].get(
            "credentials", ""
        )
        scope_api_key = scope_credentials.strip("ApiKey ")
        initialize_agenta(api_key=scope_api_key)  # noqa: F405

        # ACT
        with pytest.raises(ApiError) as exc_info:
            await ag.VariantManager.acommit(
                parameters={},
                variant_slug="default.appvariant",
                app_id=str(uuid.uuid4().hex),
            )

        # ASSERT
        assert exc_info.value.status_code == 404
        assert exc_info.value.body == {"detail": "Config not found."}

    # @pytest.mark.asyncio
    # @pytest.mark.grumpy
    # @pytest.mark.typical
    # @pytest.mark.security
    # async def test_commit_variant_unsuccessfully_due_to_invalid_scope(
    #     self, http_client, setup_class_fixture
    # ):
    #     # ARRANGE
    #     variant_id = (
    #         setup_class_fixture["app_variant_response"]
    #         .get("variant", {})
    #         .get("variant_id", None)
    #     )
    #     headers = setup_class_fixture["headers"]
    #     variant_revision = await fetch_variant_revision(
    #         http_client, headers, variant_id
    #     )
    #     scope_project_id = setup_class_fixture["app_variant_response"].get(
    #         "scope_project_id", None
    #     )
    #     non_member_credentials = setup_class_fixture["app_variant_response"].get(
    #         "non_scope_credentials", None
    #     )
    #     initialize_agenta(api_key=non_member_credentials.strip("ApiKey "))

    #     # ACT
    #     with pytest.raises(ApiError) as exc_info:
    #         await ag.VariantManager.acommit(
    #             variant_slug=variant_revision.get("config_name"),
    #             variant_version=variant_revision.get("revision", None),
    #             project_id=scope_project_id,
    #         )

    #     # ASSERT
    #     assert exc_info.value.status_code == 403
    #     assert exc_info.value.body == {
    #         "detail": "You do not have access to perform this action. Please contact your organization admin."
    #     }

    @pytest.mark.asyncio
    @pytest.mark.happy
    @pytest.mark.functional
    @pytest.mark.typical
    async def test_list_variants_successfully(self, setup_class_fixture):
        # ARRANGE
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
        response = await ag.VariantManager.alist(
            app_slug=application_name,
        )

        # ASSERT
        assert response is not None
        assert isinstance(response, list)
        assert len(response) >= 1

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.functional
    async def test_list_variants_unsuccessfully_due_to_invalid_payload(
        self, setup_class_fixture
    ):
        # ARRANGE
        scope_credentials = setup_class_fixture["app_variant_response"].get(
            "credentials", ""
        )
        scope_api_key = scope_credentials.strip("ApiKey ")
        initialize_agenta(api_key=scope_api_key)  # noqa: F405

        # ACT
        with pytest.raises(TypeError):
            response = await ag.VariantManager.alist(application_slug="name")

            # ASSERT
            assert (
                response
                == "TypeError: VariantManager.alist() got an unexpected keyword argument 'application_slug'"
            )

    # @pytest.mark.asyncio
    # @pytest.mark.grumpy
    # @pytest.mark.typical
    # @pytest.mark.security
    # async def test_list_variants_unsuccessfully_due_to_invalid_scope(
    #     self, http_client, setup_class_fixture
    # ):
    #     # ARRANGE
    #     variant_id = (
    #         setup_class_fixture["app_variant_response"]
    #         .get("variant", {})
    #         .get("variant_id", None)
    #     )
    #     headers = setup_class_fixture["headers"]
    #     variant_revision = await fetch_variant_revision(
    #         http_client, headers, variant_id
    #     )
    #     scope_project_id = setup_class_fixture["app_variant_response"].get(
    #         "scope_project_id", None
    #     )
    #     non_member_credentials = setup_class_fixture["app_variant_response"].get(
    #         "non_scope_credentials", None
    #     )
    #     initialize_agenta(api_key=non_member_credentials.strip("ApiKey "))

    #     # ACT
    #     with pytest.raises(ApiError) as exc_info:
    #         await ag.VariantManager.alist(
    #             project_id=scope_project_id,
    #         )

    #     # ASSERT
    #     assert exc_info.value.status_code == 403
    #     assert exc_info.value.body == {
    #         "detail": "You do not have access to perform this action. Please contact your organization admin."
    #     }

    @pytest.mark.asyncio
    @pytest.mark.happy
    @pytest.mark.functional
    @pytest.mark.typical
    async def test_delete_variant_successfully(self, setup_class_fixture):
        # ARRANGE
        variant_slug = (
            setup_class_fixture["app_variant_response"]
            .get("variant", {})
            .get("config_name")
        )
        scope_credentials = setup_class_fixture["app_variant_response"].get(
            "credentials", ""
        )
        scope_api_key = scope_credentials.strip("ApiKey ")
        initialize_agenta(api_key=scope_api_key)  # noqa: F405

        # ACT
        response = await ag.VariantManager.adelete(
            variant_slug=variant_slug,
        )

        # ASSERT
        assert response is not None
        assert response == 204

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.functional
    async def test_delete_variant_unsuccessfully_due_to_non_existent_config(
        self, http_client, setup_class_fixture
    ):
        # ARRANGE
        scope_credentials = setup_class_fixture["app_variant_response"].get(
            "credentials", ""
        )
        scope_api_key = scope_credentials.strip("ApiKey ")
        initialize_agenta(api_key=scope_api_key)  # noqa: F405

        # ACT
        response = await ag.VariantManager.adelete(variant_slug=str(uuid.uuid4().hex))

        # ASSERT
        assert response == 204

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.functional
    async def test_delete_variant_unsuccessfully_due_to_invalid_payload(
        self, setup_class_fixture
    ):
        # ARRANGE
        scope_credentials = setup_class_fixture["app_variant_response"].get(
            "credentials", ""
        )
        scope_api_key = scope_credentials.strip("ApiKey ")
        initialize_agenta(api_key=scope_api_key)  # noqa: F405

        # ACT
        with pytest.raises(TypeError):
            response = await ag.VariantManager.adelete()

            # ASSERT
            assert (
                response
                == "TypeError: VariantManager.adelete() missing 1 required keyword-only argument: 'variant_slug'"
            )

    # @pytest.mark.asyncio
    # @pytest.mark.grumpy
    # @pytest.mark.typical
    # @pytest.mark.security
    # async def test_delete_variant_unsuccessfully_due_to_invalid_scope(
    #     self, http_client, setup_class_fixture
    # ):
    #     # ARRANGE
    #     variant_id = (
    #         setup_class_fixture["app_variant_response"]
    #         .get("variant", {})
    #         .get("variant_id", None)
    #     )
    #     headers = setup_class_fixture["headers"]
    #     variant_revision = await fetch_variant_revision(
    #         http_client, headers, variant_id
    #     )
    #     scope_project_id = setup_class_fixture["app_variant_response"].get(
    #         "scope_project_id", None
    #     )
    #     non_member_credentials = setup_class_fixture["app_variant_response"].get(
    #         "non_scope_credentials", None
    #     )
    #     initialize_agenta(api_key=non_member_credentials.strip("ApiKey "))

    #     # ACT
    #     with pytest.raises(ApiError) as exc_info:
    #         await ag.VariantManager.adelete(
    #             variant_slug=variant_revision.get("config_name"),
    #             project_id=scope_project_id,
    #         )

    #     # ASSERT
    #     assert exc_info.value.status_code == 403
    #     assert exc_info.value.body == {
    #         "detail": "You do not have access to perform this action. Please contact your organization admin."
    #     }
