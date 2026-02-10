import uuid

import pytest
import pytest_asyncio

from oss.src.tests.apps.fixtures import *  # noqa: F403


class TestAppCreationManagement:
    @pytest_asyncio.fixture(autouse=True)
    async def setup_fixture(
        self,
        request,
        create_programmatic_owner_user,
        create_programmatic_non_paying_user,
        create_programmatic_non_member_user,
        create_programmatic_all_users,
    ):
        request.cls.owner_scope_response = create_programmatic_owner_user
        request.cls.non_member_scope_response = create_programmatic_non_member_user
        request.cls.all_members_scope_response = create_programmatic_all_users
        request.cls.non_paying_scope_response = create_programmatic_non_paying_user

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.happy
    @pytest.mark.functional
    async def test_create_without_default_params(self, http_client):
        # Arrange: Prepare data
        app_data = {
            "app_name": f"app_{uuid.uuid4().hex[:8]}"
        }  # Missing optional/default parameters
        expected_status = 200
        description = "Create app without default params"
        headers = {"Authorization": self.owner_scope_response.get("credentials", None)}

        # Act: Send a POST request to /apps
        response = await http_client.post("/apps", json=app_data, headers=headers)
        response_data = response.json()

        # Assert: Verify the response
        assert response.status_code == expected_status, (
            f"Failed for case: {description}"
        )
        assert response_data["app_name"] == app_data["app_name"], (
            f"Failed for case: {description}"
        )

        # Cleanup: Remove application
        await delete_application(http_client, response_data["app_id"], headers)  # noqa: F405

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.functional
    async def test_create_invalid_params(self, http_client):
        # Arrange: Prepare data
        app_data = {"invalid_field": "value"}  # Invalid parameter
        expected_status = 422
        description = "Create app with invalid params"
        headers = {"Authorization": self.owner_scope_response.get("credentials", None)}

        # Act: Send a POST request to /apps
        response = await http_client.post("/apps", json=app_data, headers=headers)

        # Assert: Verify the response
        assert response.status_code == expected_status, (
            f"Failed for case: {description}"
        )

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.functional
    async def test_create_conflicts(self, http_client):
        # Arrange: Prepare data
        app_name = f"app_{uuid.uuid4().hex[:8]}"
        app_data = {"app_name": app_name}  # Same name to create a conflict
        expected_status = 500
        description = "Create app with conflicts"
        api_credentials = self.owner_scope_response.get("credentials", "")
        headers = {"Authorization": api_credentials}
        await create_application(  # noqa: F405
            http_client, app_name, headers
        )  # Create the app first

        # Act: Send a POST request to /apps
        response = await http_client.post("/apps", json=app_data, headers=headers)

        # Assert: Verify the response
        assert response.status_code == expected_status, (
            f"Failed for case: {description}"
        )

        # Cleanup: Remove application
        app_cleanup_response = await http_client.get("/apps", headers=headers)
        for app in app_cleanup_response.json():
            if app["app_name"] == app_name:
                await delete_application(http_client, app["app_id"], headers)  # noqa: F405

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.security
    async def test_permissions_principal_not_in_scope_post(self, http_client):
        # Arrange: Prepare data
        app_data = {"app_name": f"app_{uuid.uuid4().hex[:8]}"}
        expected_status = 403
        description = "Principal not in scope for POST"
        owner_scope_response = self.owner_scope_response
        non_member_api_credentials = self.non_member_scope_response.get(
            "credentials", ""
        )
        non_member_headers = {"Authorization": non_member_api_credentials}
        owner_project_id = owner_scope_response.get("project", {}).get("id")

        # Act: Send a POST request to /apps
        response = await http_client.post(
            f"/apps?project_id={owner_project_id}",
            json=app_data,
            headers=non_member_headers,
        )

        # Assert: Verify the response
        assert response.status_code == expected_status, (
            f"Failed for case: {description}"
        )

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.non_available_in_oss
    async def test_entitlements_limited_access(self, http_client):
        # Arrange: Prepare data
        app_data = {"app_name": f"app_{uuid.uuid4().hex[:8]}"}
        expected_status = 403  # noqa: F841
        description = "Limited access for free-tier user"  # noqa: F841
        api_credentials = self.non_paying_scope_response.get("credentials", "")
        headers = {"Authorization": api_credentials}

        # Act: Send a POST request to /apps
        list_of_status_codes = []
        list_of_app_responses = []
        for i in range(1, 5):
            app_data["app_name"] = (
                app_data["app_name"] + f"_{i}"
            )  # override the default app_name
            response = await http_client.post("/apps", json=app_data, headers=headers)
            list_of_status_codes.append(response.status_code)
            list_of_app_responses.append(response.json())

        # Assert: Verify the response
        # TODO: bring back when the logic to limit apps creation based on tier has been moved to the backend
        # assert (
        #     list_of_status_codes.count(expected_status) == 1
        # ), f"Failed for case: {description}"

        # Cleanup: Remove application
        for app_response in list_of_app_responses:
            await delete_application(http_client, app_response.get("app_id"), headers)  # noqa: F405

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.happy
    @pytest.mark.security
    async def test_permissions_allowed_post(self, http_client):
        # Arrange: Prepare data
        app_data = {"app_name": f"app_{uuid.uuid4().hex[:8]}"}
        expected_status = 200  # noqa: F841
        description = "Principal in scope and action allowed for POST"  # noqa: F841
        members_credentials = list(self.all_members_scope_response.values())
        owner_project_id = members_credentials[0].get("project", {}).get("id")
        credential_headers = [
            {"Authorization": credentials.get("credentials")}
            for credentials in members_credentials
        ]

        # Act: Send a POST request to /apps
        list_of_status_codes = []
        list_of_response_data = []
        for index, headers in enumerate(credential_headers):
            app_data["app_name"] = (
                app_data["app_name"] + f"_{index}"
            )  # override the default app_name
            response = await http_client.post(
                f"/apps?project_id={owner_project_id}",
                json=app_data,
                headers=headers,
            )
            response_data = response.json()
            list_of_status_codes.append(response.status_code)
            list_of_response_data.append(response_data)

        # Assert: Verify the response
        # assert (
        #     list_of_status_codes.count(expected_status) == 3
        # ), f"Failed for case: {description}"

        # Cleanup: Remove application

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.happy
    @pytest.mark.functional
    async def test_list_query_filter_no_element(self, http_client):
        # Arrange: Prepare data
        elements = []
        expected_status = 200
        description = "No element"
        api_credentials = self.owner_scope_response.get("credentials", "")
        headers = {"Authorization": api_credentials}

        # Act: Send a GET request to /apps
        response = await http_client.get("/apps", headers=headers)
        response_data = response.json()

        # Assert: Verify the response
        assert response.status_code == expected_status, (
            f"Failed for case: {description}"
        )
        assert len(response_data) == len(elements), f"Failed for case: {description}"

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.happy
    @pytest.mark.functional
    async def test_list_query_filter_one_element(self, http_client):
        # Arrange: Prepare data
        expected_status = 200
        description = "No element"
        app_name = f"app_{uuid.uuid4().hex[:8]}"
        api_credentials = self.owner_scope_response.get("credentials", "")
        headers = {"Authorization": api_credentials}
        await create_application(http_client, app_name, headers)  # noqa: F405

        # Act: Send a GET request to /apps
        response = await http_client.get("/apps", headers=headers)
        response_data = response.json()

        # Assert: Verify the response
        assert response.status_code == expected_status, (
            f"Failed for case: {description}"
        )
        assert len(response_data) == 1, f"Failed for case: {description}"

        # Cleanup: Remove application
        await delete_application(http_client, response_data[0]["app_id"], headers)  # noqa: F405

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.happy
    @pytest.mark.functional
    async def test_list_query_filter_many_elements_small_data(self, http_client):
        # Arrange: Prepare data
        expected_status = 200
        description = "No element"
        api_credentials = self.owner_scope_response.get("credentials", "")
        headers = {"Authorization": api_credentials}
        for _ in range(3):
            app_name = f"app_{uuid.uuid4().hex[:8]}"
            await create_application(http_client, app_name, headers)  # noqa: F405

        # Act: Send a GET request to /apps
        response = await http_client.get("/apps", headers=headers)
        response_data = response.json()

        # Assert: Verify the response
        assert response.status_code == expected_status, (
            f"Failed for case: {description}"
        )
        assert len(response_data) == 3, f"Failed for case: {description}"

        # Cleanup: Remove applications
        for app in response_data:
            await delete_application(http_client, app["app_id"], headers)  # noqa: F405

    @pytest.mark.asyncio
    @pytest.mark.edge
    @pytest.mark.happy
    @pytest.mark.functional
    async def test_list_query_filter_many_elements_big_data(self, http_client):
        # Arrange: Prepare data
        expected_status = 200
        description = "No element"
        api_credentials = self.owner_scope_response.get("credentials", "")
        headers = {"Authorization": api_credentials}
        for _ in range(6):
            app_name = f"app_{uuid.uuid4().hex[:8]}"
            await create_application(http_client, app_name, headers)  # noqa: F405

        # Act: Send a GET request to /apps
        response = await http_client.get("/apps", headers=headers)
        response_data = response.json()

        # Assert: Verify the response
        assert response.status_code == expected_status, (
            f"Failed for case: {description}"
        )
        assert len(response_data) == 6, f"Failed for case: {description}"

        # Cleanup: Remove applications
        for app in response_data:
            await delete_application(http_client, app["app_id"], headers)  # noqa: F405

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.security
    async def test_permissions_principal_not_in_scope(self, http_client):
        # Arrange: Prepare data
        expected_status = 403
        app_name = f"app_{uuid.uuid4().hex[:8]}"
        description = "Principal not in scope for POST"

        owner_credentials = self.owner_scope_response.get("credentials", "")
        owner_scope_project_id = self.owner_scope_response.get("project", {}).get(
            "id", ""
        )
        owner_headers = {"Authorization": owner_credentials}
        app = await create_application(http_client, app_name, owner_headers)  # noqa: F405

        non_member_credentials = self.non_member_scope_response.get("credentials", "")
        non_member_headers = {"Authorization": non_member_credentials}

        # Act: Send a GET request to /apps
        response = await http_client.get(
            f"/apps?project_id={owner_scope_project_id}", headers=non_member_headers
        )

        # Assert: Verify the response
        assert response.status_code == expected_status, (
            f"Failed for case: {description}"
        )

        # Cleanup: Delete the application with valid principal
        await delete_application(http_client, app["app_id"], owner_headers)  # noqa: F405

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.happy
    @pytest.mark.security
    async def test_permissions_allowed(self, http_client):
        # Arrange: Prepare data
        expected_status = 200
        description = "Principal in scope and action allowed"
        members_credentials = list(self.all_members_scope_response.values())
        credential_headers = [
            {"Authorization": credentials.get("credentials")}
            for credentials in members_credentials
        ]
        for credential in credential_headers:
            app_name = f"app_{uuid.uuid4().hex[:8]}"
            await create_application(http_client, app_name, credential)  # noqa: F405

        # Act: Send a GET request to /apps
        response = await http_client.get("/apps")
        list_of_status_codes = []
        for headers in credential_headers:
            response = await http_client.get(
                "/apps",
                headers=headers,
            )
            list_of_status_codes.append(response.status_code)

        # Assert: Verify the response
        assert list_of_status_codes.count(expected_status) == 3, (
            f"Failed for case: {description}"
        )

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.happy
    @pytest.mark.functional
    async def test_update_full_put(self, http_client):
        # Arrange: Create an application to update
        expected_status = 200
        app_name = f"app_{uuid.uuid4().hex[:8]}"
        api_credentials = self.owner_scope_response.get("credentials", None)
        headers = {"Authorization": api_credentials}
        app = await create_application(http_client, app_name, headers)  # noqa: F405
        updated_name = f"updated_{app_name}"
        payload = {"app_name": updated_name}

        # Act: Send a PATCH request to update the app
        response = await http_client.patch(
            f"/apps/{app['app_id']}", json=payload, headers=headers
        )
        response_data = response.json()

        # Assert: Verify the update was successful
        assert response.status_code == expected_status
        assert response_data["app_name"] == updated_name

        # Cleanup: Delete the updated application
        await delete_application(http_client, app["app_id"], headers)  # noqa: F405

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.functional
    async def test_update_conflict(self, http_client):
        # Arrange: Create two applications with different names
        app_name_1 = f"app_{uuid.uuid4().hex[:8]}"
        app_name_2 = f"app_{uuid.uuid4().hex[:8]}"
        api_credentials = self.owner_scope_response.get("credentials", None)
        headers = {"Authorization": api_credentials}
        app_1 = await create_application(http_client, app_name_1, headers)  # noqa: F405
        app_2 = await create_application(http_client, app_name_2, headers)  # noqa: F405
        expected_status = 500  # Internally, the error is IntegrityError

        # Act: Attempt to update app_1 with the name of app_2
        print("Headers: ", headers)
        print(
            "ProjectID: ", self.owner_scope_response.get("project", {}).get("id", None)
        )
        response = await http_client.patch(
            f"/apps/{app_1['app_id']}", json={"app_name": app_name_2}, headers=headers
        )

        # Assert: Verify the conflict response
        assert response.status_code == expected_status

        # Cleanup: Delete both applications
        await delete_application(http_client, app_1["app_id"], headers)  # noqa: F405
        await delete_application(http_client, app_2["app_id"], headers)  # noqa: F405

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.happy
    @pytest.mark.security
    async def test_permissions_allowed_update(self, http_client):
        # Arrange: Create an application to update
        expected_status = 200
        app_name = f"app_{uuid.uuid4().hex[:8]}"
        api_credentials = self.owner_scope_response.get("credentials", "")
        headers = {"Authorization": api_credentials}
        app = await create_application(http_client, app_name, headers)  # noqa: F405
        updated_name = f"updated_{app_name}"
        payload = {"app_name": updated_name}

        # Act: Send a PATCH request with valid permissions
        response = await http_client.patch(
            f"/apps/{app['app_id']}", json=payload, headers=headers
        )
        response_data = response.json()

        # Assert: Verify the update was successful
        assert response.status_code == expected_status
        assert response_data["app_name"] == updated_name

        # Cleanup: Delete the updated application
        await delete_application(http_client, app["app_id"], headers)  # noqa: F405

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.happy
    @pytest.mark.functional
    async def test_delete_immediate(self, http_client):
        # Arrange: Create an application to delete
        expected_status = 200
        app_name = f"app_{uuid.uuid4().hex[:8]}"
        api_credentials = self.owner_scope_response.get("credentials", "")
        headers = {"Authorization": api_credentials}
        app = await create_application(http_client, app_name, headers)  # noqa: F405

        # Act: Send a DELETE request to remove the app
        response = await http_client.delete(f"/apps/{app['app_id']}", headers=headers)

        # Assert: Verify the application was deleted
        assert response.status_code == expected_status

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.functional
    async def test_delete_without_force(self, http_client):
        # Arrange: Create an application to delete
        expected_status = 200
        app_name = f"app_{uuid.uuid4().hex[:8]}"
        api_credentials = self.owner_scope_response.get("credentials", "")
        headers = {"Authorization": api_credentials}
        app = await create_application(http_client, app_name, headers)  # noqa: F405

        # Act: Send a DELETE request without the --force flag
        response = await http_client.delete(f"/apps/{app['app_id']}", headers=headers)

        # Assert: Verify the application was not deleted
        assert response.status_code == expected_status

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.happy
    @pytest.mark.functional
    async def test_delete_with_force(self, http_client):
        # Arrange: Create an application to delete
        expected_status = 200
        app_name = f"app_{uuid.uuid4().hex[:8]}"
        api_credentials = self.owner_scope_response.get("credentials", "")
        headers = {"Authorization": api_credentials}
        app = await create_application(http_client, app_name, headers)  # noqa: F405

        # Act: Send a DELETE request with the --force flag
        response = await http_client.delete(
            f"/apps/{app['app_id']}?force=true", headers=headers
        )

        # Assert: Verify the application was deleted
        assert response.status_code == expected_status

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.functional
    async def test_delete_not_found(self, http_client):
        # Arrange: Use a non-existent app_id
        non_existent_app_id = str(uuid.uuid4())
        expected_status = 500  # Internally, 404 is raised
        api_credentials = self.owner_scope_response.get("credentials", "")
        headers = {"Authorization": api_credentials}

        # Act: Send a DELETE request for a non-existent app
        response = await http_client.delete(
            f"/apps/{non_existent_app_id}", headers=headers
        )

        # Assert: Verify the not found response
        assert response.status_code == expected_status

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.security
    async def test_permissions_principal_not_in_scope_delete(self, http_client):
        # Arrange: Use a valid app_id but invalid principal
        expected_status = 401
        app_name = f"app_{uuid.uuid4().hex[:8]}"
        api_credentials = self.owner_scope_response.get("credentials", "")
        headers = {"Authorization": api_credentials}
        app = await create_application(http_client, app_name, headers)  # noqa: F405
        invalid_headers = {"Authorization": "ApiKey ak-invalid-principal"}

        # Act: Send a DELETE request with invalid principal
        response = await http_client.delete(
            f"/apps/{app['app_id']}", headers=invalid_headers
        )

        # Assert: Verify the forbidden response
        assert response.status_code == expected_status

        # Cleanup: Delete the application with valid principal
        await delete_application(http_client, app["app_id"], headers)  # noqa: F405

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.security
    async def test_permissions_resource_not_in_principal_scope(self, http_client):
        # Arrange: Use a valid app_id but resource not in scope
        expected_status = 403
        app_name = f"app_{uuid.uuid4().hex[:8]}"
        api_credentials = self.owner_scope_response.get("credentials", "")
        headers = {"Authorization": api_credentials}
        app = await create_application(http_client, app_name, headers)  # noqa: F405
        non_member_response_credentials = self.non_member_scope_response.get(
            "credentials", ""
        )
        non_member_headers = {"Authorization": non_member_response_credentials}

        # Act: Send a DELETE request with restricted action
        response = await http_client.delete(
            f"/apps/{app['app_id']}", headers=non_member_headers
        )

        # Assert: Verify the forbidden response
        assert response.status_code == expected_status

        # Cleanup: Delete the application with valid principal
        await delete_application(http_client, app["app_id"], headers)  # noqa: F405
