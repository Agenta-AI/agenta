import os
import uuid

import pytest


class TestVaultSecretsAPI:
    """
    Comprehensive test suite for the Vault Secrets API with categorized pytest markers.
    """

    @pytest.mark.asyncio
    @pytest.mark.secret_creation
    @pytest.mark.integration
    async def test_create_secret_success(self, async_client, valid_secret_payload):
        create_response = await async_client.post(
            "secrets",
            json=valid_secret_payload,
        )

        assert create_response.status_code == 200, "Secret creation failed"

        created_secret = create_response.json()
        assert (
            created_secret["header"]["name"] == valid_secret_payload["header"]["name"]
        )
        assert (
            created_secret["secret"]["kind"] == valid_secret_payload["secret"]["kind"]
        )
        assert isinstance(created_secret["id"], str), "Secret ID not generated"

    @pytest.mark.asyncio
    @pytest.mark.secret_creation
    @pytest.mark.integration
    async def test_create_secret_with_viewer_role(
        self, async_client, valid_secret_payload
    ):
        create_response = await async_client.post(
            "secrets",
            headers={"Authorization": f"ApiKey {os.environ.get('VIEWER_API_KEY', '')}"},
            json=valid_secret_payload,
        )

        assert create_response.status_code == 403, (
            "Secret creation cannot be successful. Given that apikey belongs to a user with 'viewer' role."
        )

        created_secret_message = create_response.json()["detail"]
        assert (
            created_secret_message
            == "You do not have access to perform this action. Please contact your organization admin."
        )

    @pytest.mark.asyncio
    @pytest.mark.secret_creation
    @pytest.mark.error_handling
    async def test_create_secret_with_missing_header_payload(self, async_client):
        invalid_payload = {
            "secret": {
                "kind": "provider_key",
                "data": {"provider": "openai", "key": "sk-xxxxxxxxxxxx"},
            }
        }

        response = await async_client.post(
            "secrets",
            json=invalid_payload,
        )
        assert response.status_code == 422, "Should reject payload with missing header"

    @pytest.mark.asyncio
    @pytest.mark.secret_creation
    @pytest.mark.error_handling
    async def test_create_secret_with_invalid_secret_kind(self, async_client):
        invalid_payload = {
            "header": {"name": "OpenAI", "description": "Lorem Ipsum"},
            "secret": {
                "kind": "invalid_kind",
                "data": {"provider": "openai", "key": "sk-xxxxxxxxxxxx"},
            },
        }

        response = await async_client.post(
            "secrets",
            json=invalid_payload,
        )
        assert response.status_code == 422, (
            "Should reject payload with invalid secret kind"
        )

    @pytest.mark.asyncio
    @pytest.mark.secret_creation
    @pytest.mark.error_handling
    async def test_create_secret_with_invalid_provider_kind(self, async_client):
        invalid_payload = {
            "header": {"name": "OpenAI", "description": "Lorem Ipsum"},
            "secret": {
                "kind": "invalid_kind",
                "data": {"provider": "openapi", "key": "sk-xxxxxxxxxxxx"},
            },
        }

        response = await async_client.post(
            "secrets",
            json=invalid_payload,
        )
        assert response.status_code == 422, (
            "Should reject payload with invalid secret provider kind"
        )

    @pytest.mark.asyncio
    @pytest.mark.secret_retrieval
    @pytest.mark.integration
    async def test_get_secret_success(self, async_client, valid_secret_payload):
        create_response = await async_client.post(
            "secrets",
            json=valid_secret_payload,
        )
        created_secret = create_response.json()
        secret_id = created_secret["id"]

        get_response = await async_client.get(f"secrets/{secret_id}")
        assert get_response.status_code == 200, "Failed to retrieve secret"

        retrieved_secret = get_response.json()
        assert str(retrieved_secret["id"]) == secret_id
        assert (
            retrieved_secret["header"]["name"] == valid_secret_payload["header"]["name"]
        )

    @pytest.mark.asyncio
    @pytest.mark.secret_retrieval
    @pytest.mark.error_handling
    async def test_get_nonexistent_secret(self, async_client):
        non_existent_id = str(uuid.uuid4())
        response = await async_client.get(f"secrets/{non_existent_id}")
        assert response.status_code == 404, "Should return 404 for non-existent secret"

    @pytest.mark.asyncio
    @pytest.mark.secret_retrieval
    @pytest.mark.integration
    async def test_list_secrets(self, async_client, valid_secret_payload):
        for _ in range(3):
            await async_client.post(
                "secrets",
                json=valid_secret_payload,
            )

        list_response = await async_client.get("secrets")
        assert list_response.status_code == 200, "Failed to list secrets"

        secrets_list = list_response.json()
        assert isinstance(secrets_list, list), "List response should be an array"

        secrets_list_json = [secret for secret in secrets_list]
        assert len(secrets_list_json) > 0, "Secrets list should not be empty"

    @pytest.mark.asyncio
    @pytest.mark.secret_update
    @pytest.mark.integration
    async def test_update_secret(self, async_client, valid_secret_payload):
        create_response = await async_client.post(
            "secrets",
            json=valid_secret_payload,
        )
        created_secret = create_response.json()
        secret_id = created_secret["id"]

        update_payload = {
            "header": {"name": "Updated OpenAI", "description": "Updated Description"},
            "secret": valid_secret_payload["secret"],
        }

        update_response = await async_client.put(
            f"secrets/{secret_id}",
            json=update_payload,
        )
        assert update_response.status_code == 200, "Failed to update secret"

        updated_secret = update_response.json()
        assert updated_secret["header"]["name"] == "Updated OpenAI"
        assert updated_secret["header"]["description"] == "Updated Description"

    @pytest.mark.asyncio
    @pytest.mark.secret_update
    @pytest.mark.integration
    async def test_update_secret_with_viewer_role(
        self, async_client, valid_secret_payload
    ):
        create_response = await async_client.post(
            "secrets",
            json=valid_secret_payload,
        )
        created_secret = create_response.json()
        secret_id = created_secret["id"]

        update_payload = {
            "header": {"name": "Updated OpenAI", "description": "Updated Description"},
            "secret": valid_secret_payload["secret"],
        }
        update_response = await async_client.put(
            f"secrets/{secret_id}",
            headers={"Authorization": f"ApiKey {os.environ.get('VIEWER_API_KEY', '')}"},
            json=update_payload,
        )

        assert update_response.status_code == 403, (
            "Secret update cannot be successful. Given that apikey belongs to a user with 'viewer' role."
        )

        update_response_message = update_response.json()["detail"]
        assert (
            update_response_message
            == "You do not have access to perform this action. Please contact your organization admin."
        )

    @pytest.mark.asyncio
    @pytest.mark.secret_deletion
    @pytest.mark.integration
    async def test_delete_secret(self, async_client, valid_secret_payload):
        create_response = await async_client.post(
            "secrets",
            json=valid_secret_payload,
        )
        created_secret = create_response.json()
        secret_id = created_secret["id"]

        delete_response = await async_client.delete(
            f"secrets/{secret_id}",
        )
        assert delete_response.status_code == 204, "Failed to delete secret"

        get_response = await async_client.get(
            f"secrets/{secret_id}",
        )
        assert get_response.status_code == 404, (
            "Deleted secret should not be retrievable"
        )

    @pytest.mark.asyncio
    @pytest.mark.secret_deletion
    @pytest.mark.integration
    async def test_delete_secret_with_viewer_role(
        self, async_client, valid_secret_payload
    ):
        create_response = await async_client.post(
            "secrets",
            json=valid_secret_payload,
        )
        created_secret = create_response.json()
        secret_id = created_secret["id"]

        delete_response = await async_client.delete(
            f"secrets/{secret_id}",
            headers={"Authorization": f"ApiKey {os.environ.get('VIEWER_API_KEY', '')}"},
        )
        assert delete_response.status_code == 403, (
            "Secret update cannot be successful. Given that apikey belongs to a user with 'viewer' role."
        )

        delete_response_message = delete_response.json()["detail"]
        assert (
            delete_response_message
            == "You do not have access to perform this action. Please contact your organization admin."
        )

    @pytest.mark.asyncio
    @pytest.mark.secret_deletion
    @pytest.mark.error_handling
    async def test_delete_nonexistent_secret(self, async_client):
        non_existent_id = str(uuid.uuid4())
        response = await async_client.delete(
            f"secrets/{non_existent_id}",
        )
        assert response.status_code == 204, (
            "Should always return 204 since the endpoint is idempotent"
        )
