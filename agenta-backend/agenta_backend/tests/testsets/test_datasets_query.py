import uuid

import pytest
import pytest_asyncio

from agenta_backend.tests.testsets.fixtures import *


class TestDatasetsQuery:
    @pytest_asyncio.fixture(autouse=True)
    async def setup_fixture(
        self,
        request,
        create_programmatic_owner_user,
        create_programmatic_non_member_user,
        create_programmatic_all_users,
    ):
        request.cls.owner_scope_response = create_programmatic_owner_user
        request.cls.non_member_scope_response = create_programmatic_non_member_user
        request.cls.all_members_scope_response = create_programmatic_all_users

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.happy
    @pytest.mark.functional
    async def test_no_element(self, http_client):
        # Arrange
        expected_status = 200
        description = "List testsets with no elements"
        headers = {"Authorization": self.owner_scope_response.get("credentials", "")}

        # Act
        response = await http_client.get("/testsets", headers=headers)
        response_data = response.json()

        # Assert
        assert (
            response.status_code == expected_status
        ), f"Failed for case: {description}"
        assert len(response_data) == 0, f"Failed for case: {description}"

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.happy
    @pytest.mark.functional
    async def test_one_element(self, http_client):
        # Arrange
        expected_status = 200
        description = "List testsets with one element"
        headers = {"Authorization": self.owner_scope_response.get("credentials", "")}
        testset_name = f"testset_{uuid.uuid4().hex[:8]}"
        await create_testset(http_client, testset_name, headers)

        # Act
        response = await http_client.get("/testsets", headers=headers)
        response_data = response.json()

        # Assert
        assert (
            response.status_code == expected_status
        ), f"Failed for case: {description}"
        assert len(response_data) == 1, f"Failed for case: {description}"

        # Cleanup
        await delete_testset(http_client, response_data[0]["_id"], headers)

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.happy
    @pytest.mark.functional
    async def test_many_elements_small_data(self, http_client):
        # Arrange
        expected_status = 200
        description = "List testsets with small dataset"
        headers = {"Authorization": self.owner_scope_response.get("credentials", "")}
        for _ in range(3):
            testset_name = f"testset_{uuid.uuid4().hex[:8]}"
            await create_testset(http_client, testset_name, headers)

        # Act
        response = await http_client.get("/testsets", headers=headers)
        response_data = response.json()

        # Assert
        assert (
            response.status_code == expected_status
        ), f"Failed for case: {description}"
        assert len(response_data) == 3, f"Failed for case: {description}"

        # Cleanup
        for testset in response_data:
            await delete_testset(http_client, testset["_id"], headers)

    @pytest.mark.asyncio
    @pytest.mark.edge
    @pytest.mark.happy
    @pytest.mark.functional
    async def test_many_elements_big_data(self, http_client):
        # Arrange
        expected_status = 200
        description = "List testsets with large dataset"
        headers = {"Authorization": self.owner_scope_response.get("credentials", "")}
        for _ in range(6):
            testset_name = f"testset_{uuid.uuid4().hex[:8]}"
            await create_testset(http_client, testset_name, headers)

        # Act
        response = await http_client.get("/testsets", headers=headers)
        response_data = response.json()

        # Assert
        assert (
            response.status_code == expected_status
        ), f"Failed for case: {description}"
        assert len(response_data) == 6, f"Failed for case: {description}"

        # Cleanup
        for testset in response_data:
            await delete_testset(http_client, testset["_id"], headers)

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.security
    async def test_permissions_principal_not_in_scope(self, http_client):
        # Arrange
        expected_status = 403
        description = "Access control for non-member"
        owner_scope_response = self.owner_scope_response
        owner_headers = {"Authorization": owner_scope_response.get("credentials", "")}
        non_member_api_credentials = self.non_member_scope_response.get(
            "credentials", ""
        )
        non_member_headers = {"Authorization": non_member_api_credentials}
        owner_project_id = owner_scope_response.get("project", {}).get("id")
        testset_name = f"testset_{uuid.uuid4().hex[:8]}"
        testset = await create_testset(http_client, testset_name, owner_headers)

        # Act
        response = await http_client.get(
            f"/testsets?project_id={owner_project_id}", headers=non_member_headers
        )

        # Assert
        assert (
            response.status_code == expected_status
        ), f"Failed for case: {description}"

        # Cleanup
        await delete_testset(http_client, testset["id"], owner_headers)

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.happy
    @pytest.mark.security
    async def test_permissions_allowed(self, http_client):
        # Arrange
        expected_status = 200
        description = "Access control for owner"
        owner_headers = {
            "Authorization": self.owner_scope_response.get("credentials", "")
        }

        # Act
        response = await http_client.get("/testsets", headers=owner_headers)

        # Assert
        assert (
            response.status_code == expected_status
        ), f"Failed for case: {description}"
