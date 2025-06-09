import os
import uuid
from pathlib import Path

import pytest
import pytest_asyncio

from agenta_backend.tests.testsets.fixtures import *


DATASETS_DIRECTORY = Path(__file__).parent
ASSETS_DIRECTORY = os.path.join(str(DATASETS_DIRECTORY), "/datasets/assets")


class TestDatasetsCreation:
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

    # @pytest.mark.asyncio
    # @pytest.mark.typical
    # @pytest.mark.happy
    # @pytest.mark.functional
    # async def test_upload_file_success(self, http_client):
    #     # Arrange
    #     expected_status = 200
    #     testset_name = f"testset_{uuid.uuid4().hex[:8]}"
    #     description = "Upload file successfully"
    #     headers = {"Authorization": self.owner_scope_response.get("credentials", "")}

    #     # Act
    #     with open(f"{ASSETS_DIRECTORY}/baby_names.csv", "rb") as file:
    #         files = {
    #             "upload_type": (None, ""),
    #             "file": (
    #                 "baby_names.csv",
    #                 file,
    #                 "text/csv",
    #             ),
    #             "testset_name": (None, testset_name),
    #         }
    #         response = await http_client.put(
    #             f"/testsets/upload", headers=headers, files=files
    #         )

    #     response.raise_for_status()
    #     response_data = response.json()

    #     # Assert
    #     assert (
    #         response.status_code == expected_status
    #     ), f"Failed for case: {description}"
    #     assert "id" in response_data, f"Failed for case: {description}"

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.functional
    async def test_upload_file_validation_failure(self, http_client):
        # Arrange
        expected_status = 422
        description = "Upload file with invalid format"
        headers = {"Authorization": self.owner_scope_response.get("credentials", "")}
        invalid_file_data = {"csv_file": ("invalidfile.txt", b"Invalid data")}

        # Act
        response = await http_client.post(
            "/testsets/upload", headers=headers, files=invalid_file_data
        )

        # Assert
        assert (
            response.status_code == expected_status
        ), f"Failed for case: {description}"

    # @pytest.mark.asyncio
    # @pytest.mark.typical
    # @pytest.mark.grumpy
    # @pytest.mark.security
    # async def test_upload_file_non_member_access(self, http_client):
    #     # Arrange
    #     expected_status = 403
    #     testset_name = f"testset_{uuid.uuid4().hex[:8]}"
    #     description = "Non-member tries to upload a file"
    #     non_member_headers = {
    #         "Authorization": self.non_member_scope_response.get("credentials", "")
    #     }

    #     # Act
    #     # with open(f"{DATASETS_DIRECTORY}/assets/baby_names.csv", "rb") as file:
    #     files = {
    #         "file": open(f"{DATASETS_DIRECTORY}/assets/baby_names.csv", "rb"),
    #         "testset_name": (None, testset_name),
    #     }
    #     response = await http_client.post(
    #         "/testsets/upload", headers=non_member_headers, files=files
    #     )

    #     # Assert
    #     assert (
    #         response.status_code == expected_status
    #     ), f"Failed for case: {description}"

    # @pytest.mark.asyncio
    # @pytest.mark.typical
    # @pytest.mark.grumpy
    # @pytest.mark.security
    # async def test_upload_file_non_owner_access(self, http_client):
    #     # Arrange
    #     expected_status = 403
    #     description = "Non-owner tries to upload a file"
    #     non_owner_headers = {
    #         "Authorization": self.all_members_scope_response.get("credentials", "")
    #     }
    #     file_data = {"file": ("testfile.csv", b"Test data")}

    #     # Act
    #     response = await http_client.post(
    #         "/testsets/upload", headers=non_owner_headers, files=file_data
    #     )

    #     # Assert
    #     assert (
    #         response.status_code == expected_status
    #     ), f"Failed for case: {description}"

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.happy
    @pytest.mark.security
    async def test_get_testset_owner_access(self, http_client):
        # Arrange
        expected_status = 200
        description = "Owner accesses testset details"
        headers = {"Authorization": self.owner_scope_response.get("credentials", "")}
        testset_name = f"testset_{uuid.uuid4().hex[:8]}"
        testset = await create_testset(http_client, testset_name, headers)

        # Act
        response = await http_client.get(f"/testsets/{testset['id']}", headers=headers)

        # Assert
        assert (
            response.status_code == expected_status
        ), f"Failed for case: {description}"
        assert "id" in response.json(), f"Failed for case: {description}"

        # Cleanup
        await delete_testset(http_client, testset["id"], headers)

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.happy
    @pytest.mark.functional
    async def test_create_testset_success(self, http_client):
        # Arrange
        expected_status = 200
        description = "Create testset successfully"
        headers = {"Authorization": self.owner_scope_response.get("credentials", "")}
        data = {
            "name": f"testset_{uuid.uuid4().hex[:8]}",
            "csvdata": [
                {
                    "country": "Comoros",
                    "correct_answer": "The capital of Comoros is Moroni",
                },
                {
                    "country": "Kyrgyzstan",
                    "correct_answer": "The capital of Kyrgyzstan is Bishkek",
                },
                {
                    "country": "Azerbaijan",
                    "correct_answer": "The capital of Azerbaijan is Baku",
                },
            ],
        }

        # Act
        response = await http_client.post("/testsets", headers=headers, json=data)
        response_data = response.json()

        # Cleanup
        await delete_testset(http_client, response_data["id"], headers)

        # Assert
        assert (
            response.status_code == expected_status
        ), f"Failed for case: {description}"
        assert "id" in response_data, f"Failed for case: {description}"

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.functional
    async def test_create_testset_validation_failure(self, http_client):
        # Arrange
        expected_status = 422
        description = "Create testset with invalid data"
        headers = {"Authorization": self.owner_scope_response.get("credentials", "")}
        invalid_data = {"testset_name": ""}

        # Act
        response = await http_client.post(
            "/testsets", headers=headers, json=invalid_data
        )

        # Assert
        assert (
            response.status_code == expected_status
        ), f"Failed for case: {description}"

    @pytest.mark.asyncio
    @pytest.mark.typical
    @pytest.mark.grumpy
    @pytest.mark.security
    async def test_create_testset_non_member_access(self, http_client):
        # Arrange
        expected_status = 403
        description = "Non-member tries to create a testset"
        owner_scope_response = self.owner_scope_response
        non_member_api_credentials = self.non_member_scope_response.get(
            "credentials", ""
        )
        non_member_headers = {"Authorization": non_member_api_credentials}
        owner_project_id = owner_scope_response.get("project", {}).get("id")
        data = {"name": f"testset_{uuid.uuid4().hex[:8]}", "csvdata": []}

        # Act
        response = await http_client.post(
            f"/testsets?project_id={owner_project_id}",
            headers=non_member_headers,
            json=data,
        )

        # Assert
        assert (
            response.status_code == expected_status
        ), f"Failed for case: {description}"

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
