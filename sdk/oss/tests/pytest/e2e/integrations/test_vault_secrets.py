"""
Integration tests for Vault/Secrets functionality.

These tests verify:
1. Permissions verification via access_control.verify_permissions()
2. Secrets CRUD via secrets.list_secrets(), create_secret(), read_secret(), delete_secret()

The vault middleware uses these endpoints during workflow execution to:
- Verify the user has permission to use local secrets
- Fetch secrets from the vault API
"""

import pytest

import agenta as ag
from agenta.client.backend.types import (
    SecretDto,
    StandardProviderDto,
    StandardProviderSettingsDto,
    Header,
)


pytestmark = [pytest.mark.e2e]


class TestAccessControlPermissions:
    """Test access control permission verification."""

    def test_verify_permissions_for_local_secrets(self, agenta_init):
        """
        Test that verify_permissions works for local_secrets resource.

        This is the same call the vault middleware makes to check if
        a user can use local (env var) secrets during workflow execution.
        """
        result = ag.api.access_control.verify_permissions(
            action="view_secret",
            resource_type="local_secrets",
        )

        # The response should indicate the permission effect
        assert result is not None
        assert isinstance(result, dict)
        assert "effect" in result
        # Effect should be "allow" or "deny"
        assert result["effect"] in ("allow", "deny")

    def test_verify_permissions_returns_allow_for_valid_user(self, agenta_init):
        """
        Test that a valid API key gets 'allow' effect for view_secret.
        """
        result = ag.api.access_control.verify_permissions(
            action="view_secret",
            resource_type="local_secrets",
        )

        assert result is not None
        # A valid API key should have permission to view secrets
        assert result.get("effect") == "allow"


class TestSecretsListAndRead:
    """Test secrets listing and reading (non-destructive operations)."""

    def test_list_secrets(self, agenta_init):
        """
        Test that list_secrets returns a list.

        This is the core call used by get_secrets() in the vault middleware.
        """
        result = ag.api.secrets.list_secrets()

        assert result is not None
        assert isinstance(result, list)
        # Each item should be a SecretResponseDto-like object
        for secret in result:
            assert hasattr(secret, "id") or "id" in (
                secret if isinstance(secret, dict) else {}
            )

    def test_list_secrets_structure(self, agenta_init):
        """
        Test the structure of secrets returned by list_secrets.
        """
        result = ag.api.secrets.list_secrets()

        assert isinstance(result, list)

        if len(result) > 0:
            secret = result[0]
            # Should have id and kind at minimum
            assert hasattr(secret, "id")
            assert hasattr(secret, "kind")
            # kind should be provider_key or custom_provider
            assert secret.kind in ("provider_key", "custom_provider")


class TestSecretsLifecycle:
    """
    Test full secrets CRUD lifecycle.

    These tests create, read, and delete secrets. They clean up after themselves.
    """

    def test_create_read_delete_secret(self, agenta_init):
        """
        Test the full lifecycle of a secret: create, read, delete.

        This exercises all the CRUD operations the Fern client provides.
        """
        secret_id = None

        try:
            # Create a test secret
            # Note: We use a fake API key since this is just testing the CRUD operations
            secret_dto = SecretDto(
                kind="provider_key",
                data=StandardProviderDto(
                    kind="openai",
                    provider=StandardProviderSettingsDto(
                        key="sk-test-fake-key-for-integration-test"
                    ),
                ),
            )

            created = ag.api.secrets.create_secret(
                header=Header(name="SDK Integration Test Secret (OpenAI)"),
                secret=secret_dto,
            )

            assert created is not None
            assert hasattr(created, "id")
            secret_id = created.id
            assert secret_id is not None

            # Read the secret back
            read_result = ag.api.secrets.read_secret(secret_id=secret_id)
            assert read_result is not None
            assert read_result.id == secret_id
            assert read_result.kind == "provider_key"

            # Verify it appears in the list
            all_secrets = ag.api.secrets.list_secrets()
            secret_ids = [s.id for s in all_secrets]
            assert secret_id in secret_ids

        finally:
            # Clean up: delete the secret
            if secret_id:
                try:
                    ag.api.secrets.delete_secret(secret_id=secret_id)
                except Exception as e:
                    print(f"Warning: Failed to delete test secret during cleanup: {e}")

    def test_create_and_delete_secret_removes_from_list(self, agenta_init):
        """
        Test that deleting a secret removes it from the list.
        """
        secret_id = None

        try:
            # Create
            secret_dto = SecretDto(
                kind="provider_key",
                data=StandardProviderDto(
                    kind="anthropic",
                    provider=StandardProviderSettingsDto(
                        key="sk-ant-test-fake-key-for-integration-test"
                    ),
                ),
            )

            created = ag.api.secrets.create_secret(
                header=Header(name="SDK Integration Test Secret (Anthropic)"),
                secret=secret_dto,
            )
            secret_id = created.id

            # Delete
            ag.api.secrets.delete_secret(secret_id=secret_id)

            # Verify it's gone from the list
            all_secrets = ag.api.secrets.list_secrets()
            secret_ids = [s.id for s in all_secrets]
            assert secret_id not in secret_ids

            # Mark as cleaned up
            secret_id = None

        finally:
            if secret_id:
                try:
                    ag.api.secrets.delete_secret(secret_id=secret_id)
                except Exception:
                    pass


class TestSecretsResponseSerialization:
    """Test that secret responses serialize correctly."""

    def test_secret_response_model_dump(self, agenta_init):
        """
        Test that SecretResponseDto can be serialized with model_dump().
        """
        secrets = ag.api.secrets.list_secrets()

        if len(secrets) > 0:
            secret = secrets[0]
            # Should be able to serialize
            if hasattr(secret, "model_dump"):
                dumped = secret.model_dump()
                assert isinstance(dumped, dict)
                assert "id" in dumped
                assert "kind" in dumped

    def test_secret_dto_types_import(self, agenta_init):
        """
        Test that the Fern types used by vault.py import correctly.
        """
        # These imports are used by sdk/agenta/sdk/middlewares/running/vault.py
        from agenta.client.backend.types import SecretDto
        from agenta.client.backend.types import StandardProviderKind
        from agenta.client.backend.types import StandardProviderDto
        from agenta.client.backend.types import StandardProviderSettingsDto

        assert SecretDto is not None
        assert StandardProviderKind is not None
        assert StandardProviderDto is not None
        assert StandardProviderSettingsDto is not None

        # Verify StandardProviderKind has expected values
        # This is used by vault.py to iterate over provider types
        assert hasattr(StandardProviderKind, "__args__")
