import uuid

import pytest
import agenta as ag
from agenta.client.core.api_error import ApiError

from tests.legacy.conftest import *  # noqa: F403


class TestAppsManagerCoverage:
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
    async def test_create_app_successfully(self, http_client, setup_class_fixture):
        # ARRANGE
        app_name = str(uuid.uuid4())
        scope_project_id = setup_class_fixture["app_variant_response"].get(
            "scope_project_id", None
        )
        scope_credentials = setup_class_fixture["app_variant_response"].get(
            "credentials"
        )
        scope_api_key = scope_credentials.strip("ApiKey ")
        initialize_agenta(api_key=scope_api_key)  # noqa: F405

        # ACT
        response = await ag.AppManager.acreate(
            app_name=app_name,
            project_id=scope_project_id,
        )

        # ASSERT
        assert response.app_name == app_name
        assert isinstance(response.model_dump(), dict), (
            "Response data is not a dictionary."
        )

        # CLEANUP
        await delete_application(  # noqa: F405
            http_client, response.app_id, {"Authorization": scope_credentials}
        )

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.functional
    async def test_create_app_unsuccessfully_due_to_invalid_payload(
        self, setup_class_fixture
    ):
        # ARRANGE
        scope_project_id = setup_class_fixture["app_variant_response"].get(
            "scope_project_id", None
        )
        scope_credentials = setup_class_fixture["app_variant_response"].get(
            "credentials", ""
        )
        scope_api_key = scope_credentials.strip("ApiKey ")
        initialize_agenta(api_key=scope_api_key)  # noqa: F405

        # ACT
        with pytest.raises(TypeError):
            response = await ag.AppManager.acreate(
                project_id=scope_project_id,
            )

            # ASSERT
            assert (
                response
                == "TypeError: AppManager.create() missing 1 required keyword-only argument: 'app_name'"
            )

    # @pytest.mark.asyncio
    # @pytest.mark.grumpy
    # @pytest.mark.typical
    # @pytest.mark.security
    # async def test_create_app_unsuccessfully_due_to_invalid_scope(
    #     self, setup_class_fixture
    # ):
    #     # ARRANGE
    #     app_name = str(uuid.uuid4())
    #     scope_project_id = setup_class_fixture["app_variant_response"].get(
    #         "scope_project_id", None
    #     )
    #     non_member_credentials = setup_class_fixture["app_variant_response"].get(
    #         "non_member_credentials", ""
    #     )
    #     ag.init(api_key=non_member_credentials.strip("ApiKey "))

    #     # ACT
    #     with pytest.raises(ApiError) as exc_info:
    #         await ag.AppManager.acreate(
    #             app_name=app_name,
    #             project_id=scope_project_id,
    #         )

    #     # ASSERT
    #     assert exc_info.value.status_code == 403
    #     assert exc_info.value.body == {
    #         "detail": "You do not have access to perform this action. Please contact your organization admin."
    #     }

    @pytest.mark.asyncio
    @pytest.mark.grumpy
    @pytest.mark.typical
    @pytest.mark.functional
    async def test_create_app_unsuccessfully_due_to_invalid_credentials(
        self, setup_class_fixture
    ):
        # ARRANGE
        app_name = str(uuid.uuid4())
        scope_project_id = setup_class_fixture["app_variant_response"].get(
            "scope_project_id", None
        )
        ag.init(api_key="xxxxx")

        # ACT
        with pytest.raises(ApiError) as exc_info:
            await ag.AppManager.acreate(
                app_name=app_name,
                project_id=scope_project_id,
            )

        # ASSERT
        assert exc_info.value.status_code == 401
        assert exc_info.value.body == "Unauthorized"

    @pytest.mark.asyncio
    @pytest.mark.happy
    @pytest.mark.functional
    @pytest.mark.typical
    async def test_list_apps_successfully(self, http_client, setup_class_fixture):
        # ARRANGE
        app_name = str(uuid.uuid4())
        scope_project_id = setup_class_fixture["app_variant_response"].get(
            "scope_project_id", None
        )
        scope_credentials = setup_class_fixture["app_variant_response"].get(
            "credentials"
        )
        ag.init(api_key=scope_credentials.strip("ApiKey "))
        await ag.AppManager.acreate(
            app_name=app_name,
            project_id=scope_project_id,
        )

        # ACT
        list_apps_response = await ag.AppManager.alist()

        # ASSERT
        assert len(list_apps_response) >= 1
        assert isinstance(list_apps_response, list)

        # CLEANUP
        for app_response in list_apps_response:
            await delete_application(  # noqa: F405
                http_client, app_response.app_id, {"Authorization": scope_credentials}
            )

    # @pytest.mark.asyncio
    # @pytest.mark.grumpy
    # @pytest.mark.typical
    # @pytest.mark.security
    # async def test_list_apps_unsuccessfully_due_to_invalid_scope(
    #     self, http_client, setup_class_fixture
    # ):
    #     # ARRANGE
    #     scope_project_id = setup_class_fixture["app_variant_response"].get(
    #         "scope_project_id", None
    #     )
    #     non_member_credentials = setup_class_fixture["app_variant_response"].get(
    #         "non_scope_credentials", None
    #     )
    #     non_member_headers = {"Authorization": non_member_credentials}

    #     # ACT
    #     response = await http_client.get(
    #         f"apps/?project_id={scope_project_id}",
    #         headers=non_member_headers,
    #     )
    #     response_data = response.json()

    #     # ASSERT
    #     assert response.status_code == 403
    #     assert (
    #         response_data["detail"]
    #         == "You do not have access to perform this action. Please contact your organization admin."
    #     )

    @pytest.mark.asyncio
    @pytest.mark.grumpy
    @pytest.mark.typical
    @pytest.mark.security
    async def test_list_apps_unsuccessfully_due_to_invalid_credentials(self):
        # ARRANGE
        ag.init(api_key="xxxxx")

        # ACT
        with pytest.raises(ApiError) as exc_info:
            await ag.AppManager.alist()

        # ASSERT
        assert exc_info.value.status_code == 401
        assert exc_info.value.body == "Unauthorized"

    @pytest.mark.asyncio
    @pytest.mark.happy
    @pytest.mark.functional
    @pytest.mark.typical
    async def test_update_app_successfully(self, setup_class_fixture):
        # ARRANGE
        app_name = f"updated_{str(uuid.uuid4().hex[:8])}"
        app_id = (
            setup_class_fixture["app_variant_response"]
            .get("app", {})
            .get("app_id", None)
        )
        scope_credentials = setup_class_fixture["app_variant_response"].get(
            "credentials", ""
        )
        scope_api_key = scope_credentials.strip("ApiKey ")
        initialize_agenta(api_key=scope_api_key)  # noqa: F405

        # ACT
        response = await ag.AppManager.aupdate(
            app_id=app_id,
            app_name=app_name,
        )

        # ASSERT
        assert response.app_name == app_name
        assert isinstance(response.model_dump(), dict)

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.functional
    async def test_update_app_unsuccessfully_due_to_invalid_payload(
        self, setup_class_fixture
    ):
        # ARRANGE
        app_id = setup_class_fixture["app_variant_response"].get("app_id", None)
        scope_credentials = setup_class_fixture["app_variant_response"].get(
            "credentials", ""
        )
        scope_api_key = scope_credentials.strip("ApiKey ")
        initialize_agenta(api_key=scope_api_key)  # noqa: F405

        # ACT
        with pytest.raises(TypeError):
            response = await ag.AppManager.aupdate(
                application_id=app_id,
            )

            # ASSERT
            assert (
                response
                == "TypeError: AppManager.aupdate() got an unexpected keyword argument 'application_id'"
            )

    # @pytest.mark.asyncio
    # @pytest.mark.grumpy
    # @pytest.mark.typical
    # @pytest.mark.security
    # async def test_update_app_unsuccessfully_due_to_invalid_scope(
    #     self, setup_class_fixture
    # ):
    #     # ARRANGE
    #     app_name = f"updated_{str(uuid.uuid4().hex[:8])}"
    #     app_id = setup_class_fixture["app_variant_response"].get("app_id", None)
    #     non_member_credentials = setup_class_fixture["app_variant_response"].get(
    #         "non_scope_credentials", None
    #     )
    #     initialize_agenta(api_key=non_member_credentials.strip("ApiKey "))

    #     # ACT
    #     with pytest.raises(ApiError) as exc_info:
    #         await ag.AppManager.aupdate(
    #             app_id=app_id,
    #             app_name=app_name,
    #         )

    #     # ASSERT
    #     assert exc_info.value.status_code == 403
    #     assert exc_info.value.body == {
    #         "detail": "You do not have access to perform this action. Please contact your organization admin."
    #     }

    @pytest.mark.asyncio
    @pytest.mark.grumpy
    @pytest.mark.typical
    @pytest.mark.security
    async def test_update_app_unsuccessfully_due_to_invalid_credentials(
        self, setup_class_fixture
    ):
        # ARRANGE
        app_name = f"updated_{str(uuid.uuid4().hex[:8])}"
        app_id = setup_class_fixture["app_variant_response"].get("app_id", None)
        initialize_agenta(api_key="xxxxx")  # noqa: F405

        # ACT
        with pytest.raises(ApiError) as exc_info:
            await ag.AppManager.aupdate(
                app_id=app_id,
                app_name=app_name,
            )

        # ASSERT
        assert exc_info.value.status_code == 401
        assert exc_info.value.body == "Unauthorized"

    @pytest.mark.asyncio
    @pytest.mark.grumpy
    @pytest.mark.functional
    @pytest.mark.typical
    async def test_update_app_unsuccessfully_due_to_invalid_app_id(
        self, setup_class_fixture
    ):
        # ARRANGE
        app_name = f"updated_{str(uuid.uuid4().hex[:8])}"
        invalid_app_id = str(uuid.uuid4())
        scope_credentials = setup_class_fixture["app_variant_response"].get(
            "credentials", ""
        )
        scope_api_key = scope_credentials.strip("ApiKey ")
        initialize_agenta(api_key=scope_api_key)  # noqa: F405

        # ACT
        with pytest.raises(ApiError) as exc_info:
            await ag.AppManager.aupdate(
                app_id=invalid_app_id,
                app_name=app_name,
            )

        # ASSERT
        assert exc_info.value.status_code == 404
        assert exc_info.value.body == {
            "detail": f"No application with ID '{invalid_app_id}' found"
        }

    @pytest.mark.asyncio
    @pytest.mark.happy
    @pytest.mark.functional
    @pytest.mark.typical
    async def test_delete_app_successfully(self, setup_class_fixture):
        # ARRANGE
        app_id = (
            setup_class_fixture["app_variant_response"]
            .get("app", {})
            .get("app_id", None)
        )
        scope_credentials = setup_class_fixture["app_variant_response"].get(
            "credentials", ""
        )
        scope_api_key = scope_credentials.strip("ApiKey ")
        initialize_agenta(api_key=scope_api_key)  # noqa: F405

        # ACT
        response = await ag.AppManager.adelete(
            app_id=app_id,
        )

        # ASSERT
        assert response is None

    # @pytest.mark.asyncio
    # @pytest.mark.grumpy
    # @pytest.mark.typical
    # @pytest.mark.security
    # async def test_delete_app_unsuccessfully_due_to_invalid_scope(
    #     self, setup_class_fixture
    # ):
    #     # ARRANGE
    #     app_id = setup_class_fixture["app_variant_response"].get("app_id", None)
    #     non_member_credentials = setup_class_fixture["app_variant_response"].get(
    #         "non_scope_credentials", None
    #     )
    #     initialize_agenta(api_key=non_member_credentials.strip("ApiKey "))

    #     # ACT
    #     with pytest.raises(ApiError) as exc_info:
    #         await ag.AppManager.adelete(
    #             app_id=app_id,
    #         )

    #     # ASSERT
    #     assert exc_info.value.status_code == 403
    #     assert exc_info.value.body == {
    #         "detail": "You do not have access to perform this action. Please contact your organization admin."
    # }

    @pytest.mark.asyncio
    @pytest.mark.grumpy
    @pytest.mark.typical
    @pytest.mark.functional
    async def test_delete_app_unsuccessfully_due_to_invalid_app_id(
        self, setup_class_fixture
    ):
        # ARRANGE
        invalid_app_id = str(uuid.uuid4())
        scope_credentials = setup_class_fixture["app_variant_response"].get(
            "credentials", ""
        )
        scope_api_key = scope_credentials.strip("ApiKey ")
        initialize_agenta(api_key=scope_api_key)  # noqa: F405

        # ACT
        with pytest.raises(ApiError) as exc_info:
            await ag.AppManager.adelete(
                app_id=invalid_app_id,
            )

        # ASSERT
        assert exc_info.value.status_code == 404
        assert exc_info.value.body == {
            "detail": f"No application with ID '{invalid_app_id}' found"
        }
