import os
import uuid

import pytest
import pytest_asyncio


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
            "Secret deletion cannot be successful. Given that apikey belongs to a user with 'viewer' role."
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


class TestCustomNamedSecretsAPI:
    """CRUD + validation for user-named `custom_secret` vault entries."""

    @staticmethod
    def _payload(name, fmt, content):
        return {
            "header": {"name": name, "description": ""},
            "secret": {
                "kind": "custom_secret",
                "data": {"secret": {"format": fmt, "content": content}},
            },
        }

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_text_custom_secret_round_trip(self, async_client):
        payload = self._payload("GITHUB_TOKEN", "text", "ghp_abc123")

        create_response = await async_client.post("secrets", json=payload)
        assert create_response.status_code == 200, "text custom_secret creation failed"
        secret_id = create_response.json()["id"]

        get_response = await async_client.get(f"secrets/{secret_id}")
        assert get_response.status_code == 200
        data = get_response.json()["secret"]["data"]
        assert data["secret"]["format"] == "text"
        assert data["secret"]["content"] == "ghp_abc123"

        delete_response = await async_client.delete(f"secrets/{secret_id}")
        assert delete_response.status_code == 204

    @pytest.mark.asyncio
    @pytest.mark.integration
    async def test_json_custom_secret_round_trip(self, async_client):
        content = {"A": "1", "B": 2, "C": True}
        payload = self._payload("DB_CONFIG", "json", content)

        create_response = await async_client.post("secrets", json=payload)
        assert create_response.status_code == 200, "json custom_secret creation failed"
        secret_id = create_response.json()["id"]

        get_response = await async_client.get(f"secrets/{secret_id}")
        assert get_response.status_code == 200
        data = get_response.json()["secret"]["data"]
        assert data["secret"]["format"] == "json"
        assert data["secret"]["content"] == content

        await async_client.delete(f"secrets/{secret_id}")

    @pytest.mark.asyncio
    @pytest.mark.error_handling
    async def test_json_custom_secret_rejects_nesting(self, async_client):
        payload = self._payload("BAD", "json", {"A": {"nested": 1}})

        response = await async_client.post("secrets", json=payload)
        assert response.status_code == 422, "Nested json custom_secret must be rejected"

    @pytest.mark.asyncio
    @pytest.mark.error_handling
    async def test_text_custom_secret_rejects_non_string(self, async_client):
        payload = self._payload("BAD", "text", {"a": 1})

        response = await async_client.post("secrets", json=payload)
        assert response.status_code == 422, (
            "Non-string text custom_secret must be rejected"
        )


class TestProviderConnectionsAPI:
    """Named `provider_key` connections: stable slug, assigned display name, independence.

    The tests use a provider family the rest of the suite never touches and clear that family
    first, so the assigned names are exact rather than "whatever the project had already".
    """

    PROVIDER = "alephalpha"
    TITLE = "Aleph Alpha"

    @classmethod
    def _payload(cls, *, name=None, models=None, harnesses=None, key="sk-conn"):
        data = {"kind": cls.PROVIDER, "provider": {"key": key}}
        if models is not None:
            data["models"] = [{"slug": slug} for slug in models]
        if harnesses is not None:
            data["harnesses"] = harnesses
        return {
            "header": {"name": name} if name else {},
            "secret": {"kind": "provider_key", "data": data},
        }

    @classmethod
    async def _clear(cls, async_client):
        response = await async_client.get("secrets")
        for secret in response.json():
            if (
                secret["secret"]["kind"] == "provider_key"
                and secret["secret"]["data"]["kind"] == cls.PROVIDER
            ):
                await async_client.delete(f"secrets/{secret['id']}")

    @pytest_asyncio.fixture(autouse=True)
    async def clean_provider(self, async_client):
        await self._clear(async_client)
        yield
        await self._clear(async_client)

    @pytest.mark.asyncio
    @pytest.mark.secret_creation
    @pytest.mark.integration
    async def test_unnamed_connections_are_numbered_per_provider(self, async_client):
        first = await async_client.post("secrets", json=self._payload())
        second = await async_client.post("secrets", json=self._payload())

        assert first.status_code == 200 and second.status_code == 200
        assert first.json()["header"]["name"] == self.TITLE
        assert second.json()["header"]["name"] == f"{self.TITLE} 2"

    @pytest.mark.asyncio
    @pytest.mark.secret_creation
    @pytest.mark.integration
    async def test_connections_get_distinct_stable_slugs(self, async_client):
        first = (await async_client.post("secrets", json=self._payload())).json()
        second = (await async_client.post("secrets", json=self._payload())).json()

        assert first["slug"] and second["slug"]
        assert first["slug"] != second["slug"]

        # The slug addresses the exact record, so two keys of one provider stay selectable.
        by_slug = await async_client.get(f"secrets/{second['slug']}")
        assert by_slug.status_code == 200
        assert by_slug.json()["id"] == second["id"]

    @pytest.mark.asyncio
    @pytest.mark.secret_creation
    @pytest.mark.integration
    async def test_a_supplied_name_is_kept(self, async_client):
        response = await async_client.post(
            "secrets", json=self._payload(name="Research budget")
        )

        assert response.json()["header"]["name"] == "Research budget"
        assert response.json()["slug"].startswith("research-budget-")

    @pytest.mark.asyncio
    @pytest.mark.secret_retrieval
    @pytest.mark.integration
    async def test_models_and_harnesses_round_trip(self, async_client):
        created = (
            await async_client.post(
                "secrets",
                json=self._payload(
                    models=["luminous-base", "luminous-supreme"],
                    harnesses=["pi_core"],
                ),
            )
        ).json()

        for record in (
            created,
            (await async_client.get(f"secrets/{created['id']}")).json(),
        ):
            data = record["secret"]["data"]
            assert [model["slug"] for model in data["models"]] == [
                "luminous-base",
                "luminous-supreme",
            ]
            assert data["harnesses"] == ["pi_core"]

        listed = [
            secret
            for secret in (await async_client.get("secrets")).json()
            if secret["id"] == created["id"]
        ]
        assert listed and listed[0]["secret"]["data"]["harnesses"] == ["pi_core"]

    @pytest.mark.asyncio
    @pytest.mark.secret_retrieval
    @pytest.mark.integration
    async def test_a_connection_without_the_new_fields_still_reads(self, async_client):
        created = (await async_client.post("secrets", json=self._payload())).json()

        data = (await async_client.get(f"secrets/{created['id']}")).json()["secret"][
            "data"
        ]
        assert data["provider"]["key"] == "sk-conn"
        assert "models" not in data
        assert "harnesses" not in data

    @pytest.mark.asyncio
    @pytest.mark.secret_update
    @pytest.mark.integration
    async def test_updating_one_connection_leaves_the_other_untouched(
        self, async_client
    ):
        first = (
            await async_client.post(
                "secrets", json=self._payload(key="sk-first", models=["luminous-base"])
            )
        ).json()
        second = (
            await async_client.post(
                "secrets",
                json=self._payload(key="sk-second", models=["luminous-supreme"]),
            )
        ).json()

        update = await async_client.put(
            f"secrets/{first['id']}",
            json=self._payload(
                name="Primary", key="sk-first-rotated", models=["luminous-extended"]
            ),
        )
        assert update.status_code == 200

        unchanged = (await async_client.get(f"secrets/{second['id']}")).json()
        assert unchanged["header"]["name"] == f"{self.TITLE} 2"
        assert unchanged["slug"] == second["slug"]
        assert unchanged["secret"]["data"]["provider"]["key"] == "sk-second"
        assert [model["slug"] for model in unchanged["secret"]["data"]["models"]] == [
            "luminous-supreme"
        ]

        rotated = (await async_client.get(f"secrets/{first['id']}")).json()
        assert rotated["secret"]["data"]["provider"]["key"] == "sk-first-rotated"
        assert rotated["slug"] == first["slug"]
