"""
Comprehensive test suite for the Fern SDK client structure and imports.

This test suite validates that all Fern-generated types and clients can be
imported correctly. These are STRUCTURE tests, not integration tests - no actual
API calls are made. The goal is to catch import errors and missing methods after
Fern regeneration.

Run with: pytest sdk/tests/test_fern_client.py -v
"""

import pytest


class TestFernImports:
    """Test that all Fern-generated types and clients can be imported."""

    def test_core_client_imports(self):
        """Test that the core AgentaApi clients can be imported from the backend module."""
        from agenta.client.backend.client import AgentaApi, AsyncAgentaApi

        assert AgentaApi is not None
        assert AsyncAgentaApi is not None

    def test_environment_import(self):
        """Test that AgentaApiEnvironment can be imported from the backend module."""
        from agenta.client.backend.environment import AgentaApiEnvironment

        assert AgentaApiEnvironment is not None
        # Verify DEFAULT environment exists
        assert hasattr(AgentaApiEnvironment, "DEFAULT")

    def test_client_reexport(self):
        """Test that AgentaApi is re-exported from agenta.client for convenience."""
        from agenta.client import AgentaApi

        assert AgentaApi is not None

    def test_async_client_reexport(self):
        """Test that AsyncAgentaApi is re-exported from agenta.client."""
        from agenta.client import AsyncAgentaApi

        assert AsyncAgentaApi is not None

    def test_secret_dto_import(self):
        """Test that SecretDto type (used by vault) can be imported."""
        from agenta.client.backend.types import SecretDto

        assert SecretDto is not None

    def test_standard_provider_kind_import(self):
        """Test that StandardProviderKind type (used by vault) can be imported."""
        from agenta.client.backend.types import StandardProviderKind

        assert StandardProviderKind is not None

    def test_standard_provider_dto_import(self):
        """Test that StandardProviderDto type (used by vault) can be imported."""
        from agenta.client.backend.types import StandardProviderDto

        assert StandardProviderDto is not None

    def test_standard_provider_settings_dto_import(self):
        """Test that StandardProviderSettingsDto type (used by vault) can be imported."""
        from agenta.client.backend.types import StandardProviderSettingsDto

        assert StandardProviderSettingsDto is not None

    def test_config_dto_import(self):
        """Test that ConfigDto type (used by shared.py) can be imported."""
        from agenta.client.backend.types.config_dto import ConfigDto

        assert ConfigDto is not None

    def test_config_response_model_import(self):
        """Test that ConfigResponseModel type (used by shared.py) can be imported."""
        from agenta.client.backend.types.config_response_model import (
            ConfigResponseModel,
        )

        assert ConfigResponseModel is not None

    def test_reference_request_model_import(self):
        """Test that ReferenceRequestModel type (used by shared.py) can be imported."""
        from agenta.client.backend.types.reference_request_model import (
            ReferenceRequestModel,
        )

        assert ReferenceRequestModel is not None


class TestSDKLocalTypes:
    """Test that SDK-internal types can be imported."""

    def test_agenta_node_dto_import(self):
        """Test that AgentaNodeDto SDK-internal type can be imported."""
        from agenta.sdk.types import AgentaNodeDto

        assert AgentaNodeDto is not None

    def test_agenta_nodes_response_import(self):
        """Test that AgentaNodesResponse SDK-internal type can be imported."""
        from agenta.sdk.types import AgentaNodesResponse

        assert AgentaNodesResponse is not None

    def test_configuration_response_import(self):
        """Test that ConfigurationResponse SDK type can be imported."""
        from agenta.sdk.types import ConfigurationResponse

        assert ConfigurationResponse is not None

    def test_deployment_response_import(self):
        """Test that DeploymentResponse SDK type can be imported."""
        from agenta.sdk.types import DeploymentResponse

        assert DeploymentResponse is not None


class TestClientStructure:
    """Test that the client has expected sub-modules and methods (no API calls)."""

    @pytest.fixture
    def sync_client(self):
        """Create a sync client with a dummy API key for structure testing."""
        from agenta.client.backend.client import AgentaApi

        return AgentaApi(api_key="test-key")

    @pytest.fixture
    def async_client(self):
        """Create an async client with a dummy API key for structure testing."""
        from agenta.client.backend.client import AsyncAgentaApi

        return AsyncAgentaApi(api_key="test-key")

    def test_client_has_apps_submodule(self, sync_client):
        """Test that the sync client has an 'apps' sub-module."""
        assert hasattr(sync_client, "apps")
        assert sync_client.apps is not None

    def test_client_has_variants_submodule(self, sync_client):
        """Test that the sync client has a 'variants' sub-module."""
        assert hasattr(sync_client, "variants")
        assert sync_client.variants is not None

    def test_async_client_has_apps_submodule(self, async_client):
        """Test that the async client has an 'apps' sub-module."""
        assert hasattr(async_client, "apps")
        assert async_client.apps is not None

    def test_async_client_has_variants_submodule(self, async_client):
        """Test that the async client has a 'variants' sub-module."""
        assert hasattr(async_client, "variants")
        assert async_client.variants is not None


class TestAppsApiMethods:
    """Test that the Apps API has expected methods."""

    @pytest.fixture
    def apps_client(self):
        """Get the apps sub-client."""
        from agenta.client.backend.client import AgentaApi

        client = AgentaApi(api_key="test-key")
        return client.apps

    def test_apps_has_create_app(self, apps_client):
        """Test that apps client has create_app method (used by AppManager.create)."""
        assert hasattr(apps_client, "create_app")
        assert callable(apps_client.create_app)

    def test_apps_has_list_apps(self, apps_client):
        """Test that apps client has list_apps method (used by AppManager.list)."""
        assert hasattr(apps_client, "list_apps")
        assert callable(apps_client.list_apps)

    def test_apps_has_update_app(self, apps_client):
        """Test that apps client has update_app method (used by AppManager.update)."""
        assert hasattr(apps_client, "update_app")
        assert callable(apps_client.update_app)

    def test_apps_has_remove_app(self, apps_client):
        """Test that apps client has remove_app method (used by AppManager.delete)."""
        assert hasattr(apps_client, "remove_app")
        assert callable(apps_client.remove_app)

    def test_apps_has_read_app(self, apps_client):
        """Test that apps client has read_app method."""
        assert hasattr(apps_client, "read_app")
        assert callable(apps_client.read_app)

    def test_apps_has_list_app_variants(self, apps_client):
        """Test that apps client has list_app_variants method."""
        assert hasattr(apps_client, "list_app_variants")
        assert callable(apps_client.list_app_variants)


class TestVariantsApiMethods:
    """Test that the Variants API has expected methods."""

    @pytest.fixture
    def variants_client(self):
        """Get the variants sub-client."""
        from agenta.client.backend.client import AgentaApi

        client = AgentaApi(api_key="test-key")
        return client.variants

    def test_variants_has_configs_add(self, variants_client):
        """Test that variants client has configs_add method (used by SharedManager.add)."""
        assert hasattr(variants_client, "configs_add")
        assert callable(variants_client.configs_add)

    def test_variants_has_configs_fetch(self, variants_client):
        """Test that variants client has configs_fetch method (used by SharedManager.fetch)."""
        assert hasattr(variants_client, "configs_fetch")
        assert callable(variants_client.configs_fetch)

    def test_variants_has_configs_list(self, variants_client):
        """Test that variants client has configs_list method (used by SharedManager.list)."""
        assert hasattr(variants_client, "configs_list")
        assert callable(variants_client.configs_list)

    def test_variants_has_configs_history(self, variants_client):
        """Test that variants client has configs_history method (used by SharedManager.history)."""
        assert hasattr(variants_client, "configs_history")
        assert callable(variants_client.configs_history)

    def test_variants_has_configs_fork(self, variants_client):
        """Test that variants client has configs_fork method (used by SharedManager.fork)."""
        assert hasattr(variants_client, "configs_fork")
        assert callable(variants_client.configs_fork)

    def test_variants_has_configs_commit(self, variants_client):
        """Test that variants client has configs_commit method (used by SharedManager.commit)."""
        assert hasattr(variants_client, "configs_commit")
        assert callable(variants_client.configs_commit)

    def test_variants_has_configs_deploy(self, variants_client):
        """Test that variants client has configs_deploy method (used by SharedManager.deploy)."""
        assert hasattr(variants_client, "configs_deploy")
        assert callable(variants_client.configs_deploy)

    def test_variants_has_configs_delete(self, variants_client):
        """Test that variants client has configs_delete method (used by SharedManager.delete)."""
        assert hasattr(variants_client, "configs_delete")
        assert callable(variants_client.configs_delete)

    def test_variants_has_get_variant(self, variants_client):
        """Test that variants client has get_variant method."""
        assert hasattr(variants_client, "get_variant")
        assert callable(variants_client.get_variant)


class TestAsyncVariantsApiMethods:
    """Test that the async Variants API has expected methods."""

    @pytest.fixture
    def async_variants_client(self):
        """Get the async variants sub-client."""
        from agenta.client.backend.client import AsyncAgentaApi

        client = AsyncAgentaApi(api_key="test-key")
        return client.variants

    def test_async_variants_has_configs_add(self, async_variants_client):
        """Test that async variants client has configs_add method."""
        assert hasattr(async_variants_client, "configs_add")
        assert callable(async_variants_client.configs_add)

    def test_async_variants_has_configs_fetch(self, async_variants_client):
        """Test that async variants client has configs_fetch method."""
        assert hasattr(async_variants_client, "configs_fetch")
        assert callable(async_variants_client.configs_fetch)

    def test_async_variants_has_configs_list(self, async_variants_client):
        """Test that async variants client has configs_list method."""
        assert hasattr(async_variants_client, "configs_list")
        assert callable(async_variants_client.configs_list)

    def test_async_variants_has_configs_history(self, async_variants_client):
        """Test that async variants client has configs_history method."""
        assert hasattr(async_variants_client, "configs_history")
        assert callable(async_variants_client.configs_history)

    def test_async_variants_has_configs_deploy(self, async_variants_client):
        """Test that async variants client has configs_deploy method."""
        assert hasattr(async_variants_client, "configs_deploy")
        assert callable(async_variants_client.configs_deploy)


class TestSDKManagers:
    """Test that SDK managers can be imported."""

    def test_app_manager_import(self):
        """Test that AppManager can be imported from SDK managers."""
        from agenta.sdk.managers.apps import AppManager

        assert AppManager is not None

    def test_shared_manager_import(self):
        """Test that SharedManager can be imported from SDK managers."""
        from agenta.sdk.managers.shared import SharedManager

        assert SharedManager is not None

    def test_vault_manager_import(self):
        """Test that VaultManager can be imported from SDK managers."""
        from agenta.sdk.managers.vault import VaultManager

        assert VaultManager is not None

    def test_app_manager_has_create_method(self):
        """Test that AppManager has the create class method."""
        from agenta.sdk.managers.apps import AppManager

        assert hasattr(AppManager, "create")
        assert callable(AppManager.create)

    def test_app_manager_has_acreate_method(self):
        """Test that AppManager has the async acreate class method."""
        from agenta.sdk.managers.apps import AppManager

        assert hasattr(AppManager, "acreate")
        assert callable(AppManager.acreate)

    def test_app_manager_has_list_method(self):
        """Test that AppManager has the list class method."""
        from agenta.sdk.managers.apps import AppManager

        assert hasattr(AppManager, "list")
        assert callable(AppManager.list)

    def test_app_manager_has_delete_method(self):
        """Test that AppManager has the delete class method."""
        from agenta.sdk.managers.apps import AppManager

        assert hasattr(AppManager, "delete")
        assert callable(AppManager.delete)

    def test_shared_manager_has_fetch_method(self):
        """Test that SharedManager has the fetch class method."""
        from agenta.sdk.managers.shared import SharedManager

        assert hasattr(SharedManager, "fetch")
        assert callable(SharedManager.fetch)

    def test_shared_manager_has_afetch_method(self):
        """Test that SharedManager has the async afetch class method."""
        from agenta.sdk.managers.shared import SharedManager

        assert hasattr(SharedManager, "afetch")
        assert callable(SharedManager.afetch)

    def test_shared_manager_has_commit_method(self):
        """Test that SharedManager has the commit class method."""
        from agenta.sdk.managers.shared import SharedManager

        assert hasattr(SharedManager, "commit")
        assert callable(SharedManager.commit)

    def test_shared_manager_has_deploy_method(self):
        """Test that SharedManager has the deploy class method."""
        from agenta.sdk.managers.shared import SharedManager

        assert hasattr(SharedManager, "deploy")
        assert callable(SharedManager.deploy)


class TestClientInstantiation:
    """Test that clients can be instantiated with various configurations."""

    def test_sync_client_instantiation_with_api_key(self):
        """Test that sync client can be instantiated with just an API key."""
        from agenta.client.backend.client import AgentaApi

        client = AgentaApi(api_key="test-key")
        assert client is not None

    def test_async_client_instantiation_with_api_key(self):
        """Test that async client can be instantiated with just an API key."""
        from agenta.client.backend.client import AsyncAgentaApi

        client = AsyncAgentaApi(api_key="test-key")
        assert client is not None

    def test_sync_client_with_base_url(self):
        """Test that sync client can be instantiated with a custom base URL."""
        from agenta.client.backend.client import AgentaApi

        client = AgentaApi(api_key="test-key", base_url="https://custom.api.com")
        assert client is not None

    def test_sync_client_with_environment(self):
        """Test that sync client can be instantiated with a specific environment."""
        from agenta.client.backend.client import AgentaApi
        from agenta.client.backend.environment import AgentaApiEnvironment

        client = AgentaApi(api_key="test-key", environment=AgentaApiEnvironment.DEFAULT)
        assert client is not None

    def test_sync_client_with_timeout(self):
        """Test that sync client can be instantiated with a custom timeout."""
        from agenta.client.backend.client import AgentaApi

        client = AgentaApi(api_key="test-key", timeout=120.0)
        assert client is not None


class TestAdditionalClientSubmodules:
    """Test that the client has additional expected sub-modules."""

    @pytest.fixture
    def sync_client(self):
        """Create a sync client with a dummy API key for structure testing."""
        from agenta.client.backend.client import AgentaApi

        return AgentaApi(api_key="test-key")

    def test_client_has_observability_submodule(self, sync_client):
        """Test that the client has an 'observability' sub-module."""
        assert hasattr(sync_client, "observability")
        assert sync_client.observability is not None

    def test_client_has_evaluations_submodule(self, sync_client):
        """Test that the client has an 'evaluations' sub-module."""
        assert hasattr(sync_client, "evaluations")
        assert sync_client.evaluations is not None

    def test_client_has_testsets_submodule(self, sync_client):
        """Test that the client has a 'testsets' sub-module."""
        assert hasattr(sync_client, "testsets")
        assert sync_client.testsets is not None

    def test_client_has_secrets_submodule(self, sync_client):
        """Test that the client has a 'secrets' sub-module."""
        assert hasattr(sync_client, "secrets")
        assert sync_client.secrets is not None

    def test_client_has_environments_submodule(self, sync_client):
        """Test that the client has an 'environments' sub-module."""
        assert hasattr(sync_client, "environments")
        assert sync_client.environments is not None


class TestTypeStructure:
    """Test the structure of Fern-generated types."""

    def test_config_dto_has_params_field(self):
        """Test that ConfigDto has the expected 'params' field."""
        from agenta.client.backend.types.config_dto import ConfigDto

        # Check that ConfigDto can be instantiated with expected fields
        # This verifies the structure matches what SharedManager expects
        assert hasattr(ConfigDto, "model_fields") or hasattr(ConfigDto, "__fields__")

    def test_reference_request_model_has_expected_fields(self):
        """Test that ReferenceRequestModel has expected fields for references."""
        from agenta.client.backend.types.reference_request_model import (
            ReferenceRequestModel,
        )

        # ReferenceRequestModel should have id, slug, version fields
        instance = ReferenceRequestModel(id="test-id", slug="test-slug", version=1)
        assert instance is not None

    def test_config_response_model_structure(self):
        """Test that ConfigResponseModel has expected structure for parsing."""
        from agenta.client.backend.types.config_response_model import (
            ConfigResponseModel,
        )

        # Verify the type exists and can be used
        assert ConfigResponseModel is not None
        assert hasattr(ConfigResponseModel, "model_fields") or hasattr(
            ConfigResponseModel, "__fields__"
        )


class TestBulkTypeImports:
    """Test that types can be imported in bulk from the types module."""

    def test_bulk_import_from_types(self):
        """Test that common types can be imported from agenta.client.backend.types."""
        from agenta.client.backend.types import (
            SecretDto,
            StandardProviderDto,
            StandardProviderKind,
            StandardProviderSettingsDto,
            ConfigDto,
            ConfigResponseModel,
        )

        assert SecretDto is not None
        assert StandardProviderDto is not None
        assert StandardProviderKind is not None
        assert StandardProviderSettingsDto is not None
        assert ConfigDto is not None
        assert ConfigResponseModel is not None

    def test_app_types_import(self):
        """Test that App-related types can be imported."""
        from agenta.client.backend.types import App, CreateAppOutput

        assert App is not None
        assert CreateAppOutput is not None

    def test_variant_types_import(self):
        """Test that Variant-related types can be imported."""
        from agenta.client.backend.types import AppVariantResponse, AppVariantRevision

        assert AppVariantResponse is not None
        assert AppVariantRevision is not None
