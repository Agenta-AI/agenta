import uuid

import pytest
import pytest_asyncio

from agenta_backend.deprecated_tests.testsets.fixtures import *


class TestDatasetsUpdateDelete:
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
    async def test_update_success(self, http_client):
        # Arrange
        expected_status = 200
        description = "Update testset successfully"
        headers = {"Authorization": self.owner_scope_response.get("credentials", "")}
        testset_name = f"testset_{uuid.uuid4().hex[:8]}"
        testset = await create_testset(http_client, testset_name, headers)
        payload = {"name": f"updated_{testset_name}", "csvdata": []}

        # Act
        response = await http_client.put(
            f"testsets/{testset['id']}", headers=headers, json=payload
        )
        response_data = response.json()

        # Assert
        assert (
            response.status_code == expected_status
        ), f"Failed for case: {description}"
        assert response_data["_id"] == testset["id"], f"Failed for case: {description}"

        # Cleanup
        await delete_testset(http_client, testset["id"], headers)

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.functional
    async def test_update_validation_failure(self, http_client):
        # Arrange
        expected_status = 422
        description = "Update testset with invalid data"
        headers = {"Authorization": self.owner_scope_response.get("credentials", "")}
        testset_name = f"testset_{uuid.uuid4().hex[:8]}"
        testset = await create_testset(http_client, testset_name, headers)
        invalid_update_data = {"test_name": ""}

        # Act
        response = await http_client.put(
            f"testsets/{testset['id']}", headers=headers, json=invalid_update_data
        )

        # Assert
        assert (
            response.status_code == expected_status
        ), f"Failed for case: {description}"

        # Cleanup
        await delete_testset(http_client, testset["id"], headers)

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.security
    async def test_update_non_member_access(self, http_client):
        # Arrange
        expected_status = 403
        description = "Non-member tries to update a testset"
        api_credentials = self.owner_scope_response.get("credentials", "")
        member_headers = {"Authorization": api_credentials}
        testset_name = f"testset_{uuid.uuid4().hex[:8]}"
        testset = await create_testset(http_client, testset_name, member_headers)
        update_data = {"name": f"updated_{testset_name}", "csvdata": []}
        non_member_headers = {
            "Authorization": self.non_member_scope_response.get("credentials", "")
        }

        # Act
        response = await http_client.put(
            f"testsets/{testset['id']}", headers=non_member_headers, json=update_data
        )

        # Assert
        assert (
            response.status_code == expected_status
        ), f"Failed for case: {description}"

        # Cleanup
        await delete_testset(http_client, testset["id"], member_headers)

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.happy
    @pytest.mark.functional
    async def test_delete_success(self, http_client):
        # Arrange
        expected_status = 200
        description = "Delete testset successfully"
        headers = {"Authorization": self.owner_scope_response.get("credentials", "")}
        testset_name = f"testset_{uuid.uuid4().hex[:8]}"
        testset = await create_testset(http_client, testset_name, headers)

        # Act
        response = await http_client.request(
            "DELETE",
            f"testsets",
            headers=headers,
            json={"testset_ids": [testset["id"]]},
        )

        # Assert
        assert (
            response.status_code == expected_status
        ), f"Failed for case: {description}"

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.functional
    async def test_delete_validation_failure(self, http_client):
        # Arrange
        expected_status = 422
        description = "Delete testset with invalid ID"
        headers = {"Authorization": self.owner_scope_response.get("credentials", "")}
        invalid_testset_id = str(uuid.uuid4())

        # Act
        response = await http_client.request(
            "DELETE",
            f"testsets",
            headers=headers,
            json={"testsets_ids": [invalid_testset_id]},
        )

        # Assert
        assert (
            response.status_code == expected_status
        ), f"Failed for case: {description}"

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.functional
    async def test_delete_non_existent(self, http_client):
        # Arrange
        expected_status = 500
        description = "Delete testset with non-existent ID"
        headers = {"Authorization": self.owner_scope_response.get("credentials", "")}
        nonexistent_testset_id = str(uuid.uuid4())

        # Act
        response = await http_client.request(
            "DELETE",
            f"testsets",
            headers=headers,
            json={"testset_ids": [nonexistent_testset_id]},
        )

        # Assert
        assert (
            response.status_code == expected_status
        ), f"Failed for case: {description}"
