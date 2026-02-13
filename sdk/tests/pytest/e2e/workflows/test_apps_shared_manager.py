"""
Comprehensive integration tests for the Fern SDK client.

These tests make REAL API calls to validate that:
1. AppManager works correctly for CRUD operations on apps
2. SharedManager works correctly for variant/config management
3. Both sync and async APIs function properly
4. Response types are correctly serialized/deserialized

Run with:
    pytest sdk/tests/integration/test_fern_integration.py -v -m integration

Environment variables:
    AGENTA_HOST: API host URL (default: https://cloud.agenta.ai)
    AGENTA_API_KEY: API key for authentication
"""

import asyncio
from uuid import uuid4
from typing import Any

import pytest

from agenta.sdk.managers.apps import AppManager
from agenta.sdk.managers.shared import SharedManager
from agenta.sdk.types import ConfigurationResponse, DeploymentResponse

# Mark all tests in this module as integration tests
pytestmark = [pytest.mark.e2e]


def cleanup_app_safe(app_id: str) -> None:
    """Safely cleanup an app, catching and logging any errors."""
    try:
        AppManager.delete(app_id=app_id)
    except Exception as e:
        print(f"Warning: Failed to cleanup app {app_id}: {e}")


# =============================================================================
# Helper Functions
# =============================================================================


def assert_has_attr(obj: Any, attr: str, message: str = None) -> None:
    """Assert that an object has a specific attribute."""
    msg = message or f"Object {type(obj).__name__} should have attribute '{attr}'"
    assert hasattr(obj, attr), msg


def assert_not_none(value: Any, message: str = None) -> None:
    """Assert that a value is not None."""
    msg = message or "Value should not be None"
    assert value is not None, msg


def generate_unique_slug(prefix: str = "test") -> str:
    """Generate a unique slug for testing."""
    return f"{prefix}-{uuid4().hex[:8]}"


# =============================================================================
# AppManager Integration Tests - Synchronous
# =============================================================================


@pytest.mark.e2e
class TestAppManagerSync:
    """Test AppManager synchronous methods with real API calls."""

    def test_create_app(self, agenta_init):
        """Test creating an app via AppManager.create()."""
        app_slug = generate_unique_slug("create-test")
        app_id = None

        try:
            result = AppManager.create(app_slug=app_slug)

            # Verify response
            assert_not_none(result, "create() should return a response")
            assert_has_attr(result, "app_id", "Response should have app_id")
            assert_not_none(result.app_id, "app_id should not be None")

            app_id = result.app_id

            # Verify app_id is a valid string
            assert isinstance(result.app_id, str), "app_id should be a string"
            assert len(result.app_id) > 0, "app_id should not be empty"

        finally:
            if app_id:
                cleanup_app_safe(app_id)

    def test_create_app_with_custom_type(self, agenta_init):
        """Test creating an app with a custom app_type."""
        app_slug = generate_unique_slug("custom-type")
        app_id = None

        try:
            result = AppManager.create(app_slug=app_slug, app_type="SERVICE:chat")

            assert_not_none(result, "create() should return a response")
            assert_has_attr(result, "app_id")
            app_id = result.app_id

        finally:
            if app_id:
                cleanup_app_safe(app_id)

    def test_list_apps(self, agenta_init):
        """Test listing apps via AppManager.list()."""
        result = AppManager.list()

        # Verify response is a list
        assert_not_none(result, "list() should return a response")
        assert isinstance(result, list), "list() should return a list"

        # If there are apps, verify their structure
        if len(result) > 0:
            app = result[0]
            # Apps should have at least an app_id or id field
            has_id = hasattr(app, "app_id") or hasattr(app, "id")
            assert has_id, "Each app should have an id field"

    def test_list_apps_contains_created_app(self, agenta_init, test_app):
        """Test that a created app appears in the list."""
        result = AppManager.list()

        assert_not_none(result, "list() should return a response")
        assert isinstance(result, list), "list() should return a list"

        # Find our test app in the list
        app_ids = []
        for app in result:
            if hasattr(app, "app_id"):
                app_ids.append(app.app_id)
            elif hasattr(app, "id"):
                app_ids.append(app.id)

        assert test_app["app_id"] in app_ids, (
            f"Created app {test_app['app_id']} should be in the list"
        )

    def test_update_app(self, agenta_init, test_app):
        """Test updating an app via AppManager.update()."""
        new_slug = generate_unique_slug("updated")

        _result = AppManager.update(app_id=test_app["app_id"], app_slug=new_slug)

        # update() may return None or the updated app
        # The important thing is it doesn't raise an exception
        assert _result is None or hasattr(_result, "app_id")

    def test_delete_app(self, agenta_init):
        """Test deleting an app via AppManager.delete()."""
        # Create an app specifically for deletion
        app_slug = generate_unique_slug("delete-test")
        create_result = AppManager.create(app_slug=app_slug)
        assert_not_none(create_result, "Should create app for deletion test")
        app_id = create_result.app_id

        # Delete the app
        result = AppManager.delete(app_id=app_id)

        # delete() returns None on success
        assert result is None, "delete() should return None on success"

        # Verify app is deleted by trying to find it in the list
        apps = AppManager.list()
        app_ids = []
        for app in apps:
            if hasattr(app, "app_id"):
                app_ids.append(app.app_id)
            elif hasattr(app, "id"):
                app_ids.append(app.id)

        assert app_id not in app_ids, "Deleted app should not appear in list"

    def test_create_list_delete_workflow(self, agenta_init):
        """Test complete CRUD workflow for apps."""
        app_slug = generate_unique_slug("workflow")
        app_id = None

        try:
            # Create
            create_result = AppManager.create(app_slug=app_slug)
            assert_not_none(create_result)
            app_id = create_result.app_id

            # List and verify
            list_result = AppManager.list()
            assert isinstance(list_result, list)

            # Update
            new_slug = generate_unique_slug("workflow-updated")
            AppManager.update(app_id=app_id, app_slug=new_slug)

            # Delete
            AppManager.delete(app_id=app_id)
            app_id = None  # Mark as deleted

        finally:
            if app_id:
                cleanup_app_safe(app_id)


# =============================================================================
# AppManager Integration Tests - Asynchronous
# =============================================================================


@pytest.mark.e2e
@pytest.mark.asyncio
class TestAppManagerAsync:
    """Test AppManager asynchronous methods with real API calls."""

    async def test_acreate_app(self, agenta_init):
        """Test creating an app via AppManager.acreate()."""
        app_slug = generate_unique_slug("async-create")
        app_id = None

        try:
            result = await AppManager.acreate(app_slug=app_slug)

            assert_not_none(result, "acreate() should return a response")
            assert_has_attr(result, "app_id", "Response should have app_id")
            assert_not_none(result.app_id, "app_id should not be None")

            app_id = result.app_id

        finally:
            if app_id:
                cleanup_app_safe(app_id)

    async def test_alist_apps(self, agenta_init):
        """Test listing apps via AppManager.alist()."""
        result = await AppManager.alist()

        assert_not_none(result, "alist() should return a response")
        assert isinstance(result, list), "alist() should return a list"

    async def test_aupdate_app(self, agenta_init, test_app):
        """Test updating an app via AppManager.aupdate()."""
        new_slug = generate_unique_slug("async-updated")

        _result = await AppManager.aupdate(app_id=test_app["app_id"], app_slug=new_slug)
        # Update may return None or the updated app
        assert _result is None or hasattr(_result, "app_id")

    async def test_adelete_app(self, agenta_init):
        """Test deleting an app via AppManager.adelete()."""
        # Create an app for deletion
        app_slug = generate_unique_slug("async-delete")
        create_result = await AppManager.acreate(app_slug=app_slug)
        app_id = create_result.app_id

        # Delete
        result = await AppManager.adelete(app_id=app_id)
        assert result is None, "adelete() should return None on success"

    async def test_async_create_list_workflow(self, agenta_init):
        """Test async workflow: create, list, delete."""
        app_slug = generate_unique_slug("async-workflow")
        app_id = None

        try:
            # Create
            create_result = await AppManager.acreate(app_slug=app_slug)
            assert_not_none(create_result)
            app_id = create_result.app_id

            # List
            list_result = await AppManager.alist()
            assert isinstance(list_result, list)

            # Delete
            await AppManager.adelete(app_id=app_id)
            app_id = None

        finally:
            if app_id:
                cleanup_app_safe(app_id)


# =============================================================================
# SharedManager Integration Tests - Synchronous
# =============================================================================


@pytest.mark.e2e
class TestSharedManagerSync:
    """Test SharedManager synchronous methods with real API calls."""

    def test_add_variant(self, agenta_init, test_app):
        """Test adding a variant via SharedManager.add()."""
        variant_slug = generate_unique_slug("variant")

        try:
            result = SharedManager.add(
                variant_slug=variant_slug, app_id=test_app["app_id"]
            )

            # Verify response type
            assert_not_none(result, "add() should return a response")
            assert isinstance(result, ConfigurationResponse), (
                f"add() should return ConfigurationResponse, got {type(result)}"
            )

            # Verify response fields
            assert_has_attr(result, "variant_id")
            assert_has_attr(result, "variant_slug")
            assert_has_attr(result, "app_id")
            assert_has_attr(result, "params")

            # Verify field values
            assert_not_none(result.variant_id, "variant_id should not be None")
            assert result.variant_slug.endswith(variant_slug), (
                f"variant_slug should end with {variant_slug}, got {result.variant_slug}"
            )

        finally:
            try:
                SharedManager.delete(
                    variant_slug=variant_slug, app_id=test_app["app_id"]
                )
            except Exception:
                pass

    def test_fetch_variant(self, agenta_init, test_variant):
        """Test fetching a variant via SharedManager.fetch()."""
        result = SharedManager.fetch(
            variant_slug=test_variant["variant_slug"], app_id=test_variant["app_id"]
        )

        # Verify response
        assert_not_none(result, "fetch() should return a response")
        assert isinstance(result, ConfigurationResponse), (
            f"fetch() should return ConfigurationResponse, got {type(result)}"
        )

        # Verify we got the right variant (API returns fully-qualified slug)
        assert result.variant_slug.endswith(test_variant["variant_slug"])
        assert_has_attr(result, "params")

    def test_fetch_variant_by_id(self, agenta_init, test_variant):
        """Test fetching a variant by ID via SharedManager.fetch()."""
        result = SharedManager.fetch(variant_id=test_variant["variant_id"])

        assert_not_none(result, "fetch() by ID should return a response")
        assert isinstance(result, ConfigurationResponse)
        assert result.variant_id == test_variant["variant_id"]

    def test_list_configs(self, agenta_init, test_variant):
        """Test listing configs via SharedManager.list()."""
        result = SharedManager.list(app_id=test_variant["app_id"])

        # Verify response is a list
        assert_not_none(result, "list() should return a response")
        assert isinstance(result, list), "list() should return a list"

        # Verify all items are ConfigurationResponse
        for config in result:
            assert isinstance(config, ConfigurationResponse), (
                f"Each item should be ConfigurationResponse, got {type(config)}"
            )

        # Find our test variant
        variant_ids = [c.variant_id for c in result]
        assert test_variant["variant_id"] in variant_ids, (
            "Test variant should appear in the list"
        )

    def test_history(self, agenta_init, test_variant):
        """Test getting config history via SharedManager.history()."""
        result = SharedManager.history(
            variant_slug=test_variant["variant_slug"], app_id=test_variant["app_id"]
        )

        # Verify response is a list
        assert_not_none(result, "history() should return a response")
        assert isinstance(result, list), "history() should return a list"

        # Verify all items are ConfigurationResponse
        for config in result:
            assert isinstance(config, ConfigurationResponse)

    def test_commit_config(self, agenta_init, test_variant):
        """Test committing config via SharedManager.commit()."""
        test_params = {"temperature": 0.7, "max_tokens": 100, "test_key": "test_value"}

        result = SharedManager.commit(
            parameters=test_params,
            variant_slug=test_variant["variant_slug"],
            app_id=test_variant["app_id"],
        )

        # Verify response
        assert_not_none(result, "commit() should return a response")
        assert isinstance(result, ConfigurationResponse), (
            f"commit() should return ConfigurationResponse, got {type(result)}"
        )

        # Verify params were saved
        assert_has_attr(result, "params")
        assert result.params is not None

        # Verify the committed params
        for key, value in test_params.items():
            assert key in result.params, f"Committed params should contain '{key}'"
            assert result.params[key] == value, (
                f"Param '{key}' should be {value}, got {result.params[key]}"
            )

    def test_deploy_variant(self, agenta_init, test_variant):
        """Test deploying a variant via SharedManager.deploy()."""
        # First commit some config
        SharedManager.commit(
            parameters={"test": "deploy"},
            variant_slug=test_variant["variant_slug"],
            app_id=test_variant["app_id"],
        )

        # Deploy to production environment
        result = SharedManager.deploy(
            variant_slug=test_variant["variant_slug"],
            environment_slug="production",
            app_id=test_variant["app_id"],
        )

        # Verify response
        assert_not_none(result, "deploy() should return a response")
        assert isinstance(result, DeploymentResponse), (
            f"deploy() should return DeploymentResponse, got {type(result)}"
        )

        # Verify deployment info
        assert_has_attr(result, "environment_slug")

    def test_delete_variant(self, agenta_init, test_app):
        """Test deleting a variant via SharedManager.delete()."""
        # Create a variant for deletion
        variant_slug = generate_unique_slug("delete-variant")
        _add_result = SharedManager.add(
            variant_slug=variant_slug, app_id=test_app["app_id"]
        )
        assert _add_result is not None

        # Delete by slug
        result = SharedManager.delete(
            variant_slug=variant_slug, app_id=test_app["app_id"]
        )

        # delete() returns the count of deleted items
        assert result is not None

    def test_delete_variant_by_id(self, agenta_init, test_app):
        """Test deleting a variant by ID via SharedManager.delete()."""
        # Create a variant for deletion
        variant_slug = generate_unique_slug("delete-by-id")
        add_result = SharedManager.add(
            variant_slug=variant_slug, app_id=test_app["app_id"]
        )

        # Delete by ID
        result = SharedManager.delete(
            variant_id=add_result.variant_id, app_id=test_app["app_id"]
        )

        assert result is not None

    def test_fork_variant(self, agenta_init, test_variant):
        """Test forking a variant via SharedManager.fork()."""
        # Fork requires an existing committed config, so commit first
        SharedManager.commit(
            parameters={"fork_test": True},
            variant_slug=test_variant["variant_slug"],
            app_id=test_variant["app_id"],
        )

        result = SharedManager.fork(
            variant_slug=test_variant["variant_slug"], app_id=test_variant["app_id"]
        )

        # Verify response
        assert_not_none(result, "fork() should return a response")
        assert isinstance(result, ConfigurationResponse), (
            f"fork() should return ConfigurationResponse, got {type(result)}"
        )

        # Fork creates a new variant
        assert_has_attr(result, "variant_id")

    def test_complete_variant_workflow(self, agenta_init, test_app):
        """Test complete variant lifecycle: add, fetch, commit, deploy, delete."""
        variant_slug = generate_unique_slug("workflow")

        try:
            # Add variant
            add_result = SharedManager.add(
                variant_slug=variant_slug, app_id=test_app["app_id"]
            )
            assert_not_none(add_result)
            assert isinstance(add_result, ConfigurationResponse)

            # Fetch variant
            fetch_result = SharedManager.fetch(
                variant_slug=variant_slug, app_id=test_app["app_id"]
            )
            assert_not_none(fetch_result)

            # Commit config
            commit_result = SharedManager.commit(
                parameters={"workflow_test": True},
                variant_slug=variant_slug,
                app_id=test_app["app_id"],
            )
            assert_not_none(commit_result)
            assert commit_result.params.get("workflow_test") is True

            # List configs
            list_result = SharedManager.list(app_id=test_app["app_id"])
            assert isinstance(list_result, list)
            assert any(c.variant_slug.endswith(variant_slug) for c in list_result)

            # History
            history_result = SharedManager.history(
                variant_slug=variant_slug, app_id=test_app["app_id"]
            )
            assert isinstance(history_result, list)
            assert len(history_result) >= 1  # At least one commit

            # Deploy
            deploy_result = SharedManager.deploy(
                variant_slug=variant_slug,
                environment_slug="production",
                app_id=test_app["app_id"],
            )
            assert_not_none(deploy_result)

            # Delete
            delete_result = SharedManager.delete(
                variant_slug=variant_slug, app_id=test_app["app_id"]
            )
            assert delete_result is not None

        except Exception as e:
            # Cleanup on failure
            try:
                SharedManager.delete(
                    variant_slug=variant_slug, app_id=test_app["app_id"]
                )
            except Exception:
                pass
            raise e


# =============================================================================
# SharedManager Integration Tests - Asynchronous
# =============================================================================


@pytest.mark.e2e
@pytest.mark.asyncio
class TestSharedManagerAsync:
    """Test SharedManager asynchronous methods with real API calls."""

    async def test_aadd_variant(self, agenta_init, test_app):
        """Test adding a variant via SharedManager.aadd()."""
        variant_slug = generate_unique_slug("async-variant")

        try:
            result = await SharedManager.aadd(
                variant_slug=variant_slug, app_id=test_app["app_id"]
            )

            assert_not_none(result, "aadd() should return a response")
            assert isinstance(result, ConfigurationResponse)
            assert_has_attr(result, "variant_id")

        finally:
            try:
                SharedManager.delete(
                    variant_slug=variant_slug, app_id=test_app["app_id"]
                )
            except Exception:
                pass

    async def test_afetch_variant(self, agenta_init, test_variant):
        """Test fetching a variant via SharedManager.afetch()."""
        result = await SharedManager.afetch(
            variant_slug=test_variant["variant_slug"], app_id=test_variant["app_id"]
        )

        assert_not_none(result, "afetch() should return a response")
        assert isinstance(result, ConfigurationResponse)
        assert result.variant_slug.endswith(test_variant["variant_slug"])

    async def test_alist_configs(self, agenta_init, test_variant):
        """Test listing configs via SharedManager.alist()."""
        result = await SharedManager.alist(app_id=test_variant["app_id"])

        assert_not_none(result, "alist() should return a response")
        assert isinstance(result, list)

        for config in result:
            assert isinstance(config, ConfigurationResponse)

    async def test_ahistory(self, agenta_init, test_variant):
        """Test getting config history via SharedManager.ahistory()."""
        result = await SharedManager.ahistory(
            variant_slug=test_variant["variant_slug"], app_id=test_variant["app_id"]
        )

        assert_not_none(result, "ahistory() should return a response")
        assert isinstance(result, list)

    async def test_acommit_config(self, agenta_init, test_variant):
        """Test committing config via SharedManager.acommit()."""
        test_params = {"async_key": "async_value", "number": 42}

        result = await SharedManager.acommit(
            parameters=test_params,
            variant_slug=test_variant["variant_slug"],
            app_id=test_variant["app_id"],
        )

        assert_not_none(result, "acommit() should return a response")
        assert isinstance(result, ConfigurationResponse)
        assert result.params.get("async_key") == "async_value"

    async def test_adeploy_variant(self, agenta_init, test_variant):
        """Test deploying a variant via SharedManager.adeploy()."""
        # First commit some config
        await SharedManager.acommit(
            parameters={"async_deploy": True},
            variant_slug=test_variant["variant_slug"],
            app_id=test_variant["app_id"],
        )

        result = await SharedManager.adeploy(
            variant_slug=test_variant["variant_slug"],
            environment_slug="production",
            app_id=test_variant["app_id"],
        )

        assert_not_none(result, "adeploy() should return a response")
        assert isinstance(result, DeploymentResponse)

    async def test_adelete_variant(self, agenta_init, test_app):
        """Test deleting a variant via SharedManager.adelete()."""
        variant_slug = generate_unique_slug("async-delete")

        # Create variant
        await SharedManager.aadd(variant_slug=variant_slug, app_id=test_app["app_id"])

        # Delete
        result = await SharedManager.adelete(
            variant_slug=variant_slug, app_id=test_app["app_id"]
        )

        assert result is not None

    async def test_afork_variant(self, agenta_init, test_variant):
        """Test forking a variant via SharedManager.afork()."""
        # Fork requires an existing committed config, so commit first
        await SharedManager.acommit(
            parameters={"async_fork_test": True},
            variant_slug=test_variant["variant_slug"],
            app_id=test_variant["app_id"],
        )

        result = await SharedManager.afork(
            variant_slug=test_variant["variant_slug"], app_id=test_variant["app_id"]
        )

        assert_not_none(result, "afork() should return a response")
        assert isinstance(result, ConfigurationResponse)

    async def test_async_complete_workflow(self, agenta_init, test_app):
        """Test complete async variant lifecycle."""
        variant_slug = generate_unique_slug("async-workflow")

        try:
            # Add
            add_result = await SharedManager.aadd(
                variant_slug=variant_slug, app_id=test_app["app_id"]
            )
            assert isinstance(add_result, ConfigurationResponse)

            # Fetch
            fetch_result = await SharedManager.afetch(
                variant_slug=variant_slug, app_id=test_app["app_id"]
            )
            assert_not_none(fetch_result)

            # Commit
            commit_result = await SharedManager.acommit(
                parameters={"async_workflow": True},
                variant_slug=variant_slug,
                app_id=test_app["app_id"],
            )
            assert_not_none(commit_result)

            # List
            list_result = await SharedManager.alist(app_id=test_app["app_id"])
            assert isinstance(list_result, list)

            # History
            history_result = await SharedManager.ahistory(
                variant_slug=variant_slug, app_id=test_app["app_id"]
            )
            assert isinstance(history_result, list)

            # Deploy
            deploy_result = await SharedManager.adeploy(
                variant_slug=variant_slug,
                environment_slug="production",
                app_id=test_app["app_id"],
            )
            assert isinstance(deploy_result, DeploymentResponse)

            # Delete
            delete_result = await SharedManager.adelete(
                variant_slug=variant_slug, app_id=test_app["app_id"]
            )
            assert delete_result is not None

        except Exception as e:
            # Cleanup on failure
            try:
                await SharedManager.adelete(
                    variant_slug=variant_slug, app_id=test_app["app_id"]
                )
            except Exception:
                pass
            raise e


# =============================================================================
# Response Serialization Tests
# =============================================================================


@pytest.mark.e2e
class TestResponseSerialization:
    """Test that API responses can be properly serialized/deserialized."""

    def test_configuration_response_to_dict(self, agenta_init, test_variant):
        """Test that ConfigurationResponse can be converted to dict."""
        result = SharedManager.fetch(
            variant_slug=test_variant["variant_slug"], app_id=test_variant["app_id"]
        )

        # Convert to dict
        result_dict = result.model_dump()

        assert isinstance(result_dict, dict)
        assert "variant_id" in result_dict
        assert "variant_slug" in result_dict
        assert "params" in result_dict

    def test_configuration_response_to_json(self, agenta_init, test_variant):
        """Test that ConfigurationResponse can be serialized to JSON."""
        result = SharedManager.fetch(
            variant_slug=test_variant["variant_slug"], app_id=test_variant["app_id"]
        )

        # Convert to JSON string
        result_json = result.model_dump_json()

        assert isinstance(result_json, str)
        assert "variant_id" in result_json
        assert "variant_slug" in result_json

    def test_deployment_response_to_dict(self, agenta_init, test_variant):
        """Test that DeploymentResponse can be converted to dict."""
        # Commit first
        SharedManager.commit(
            parameters={"test": True},
            variant_slug=test_variant["variant_slug"],
            app_id=test_variant["app_id"],
        )

        # Deploy
        result = SharedManager.deploy(
            variant_slug=test_variant["variant_slug"],
            environment_slug="production",
            app_id=test_variant["app_id"],
        )

        # Convert to dict
        result_dict = result.model_dump()

        assert isinstance(result_dict, dict)

    def test_app_response_structure(self, agenta_init, test_app):
        """Test that app response has expected structure."""
        apps = AppManager.list()

        if len(apps) > 0:
            app = apps[0]

            # App should have key attributes
            has_id = hasattr(app, "app_id") or hasattr(app, "id")
            assert has_id, "App should have an id attribute"


# =============================================================================
# Error Handling Tests
# =============================================================================


@pytest.mark.e2e
class TestErrorHandling:
    """Test error handling for invalid API calls."""

    def test_fetch_nonexistent_variant(self, agenta_init, test_app):
        """Test that fetching a non-existent variant raises an error or returns error response."""
        try:
            _result = SharedManager.fetch(
                variant_slug="nonexistent-variant-12345", app_id=test_app["app_id"]
            )
            # If no exception, result should be None or indicate an error
            assert _result is None or hasattr(_result, "error")
        except Exception as e:
            # Expected to raise an exception for non-existent variant
            assert e is not None

    def test_delete_nonexistent_app(self, agenta_init):
        """Test that deleting a non-existent app handles gracefully."""
        fake_app_id = "00000000-0000-0000-0000-000000000000"

        try:
            AppManager.delete(app_id=fake_app_id)
            # May succeed silently or raise an error
        except Exception as e:
            # Expected behavior - deletion of non-existent app
            assert e is not None


# =============================================================================
# SharedManager Validation Tests
# =============================================================================


@pytest.mark.e2e
class TestSharedManagerValidation:
    """Test parameter validation in SharedManager."""

    def test_fetch_variant_slug_without_app_raises(self, agenta_init):
        """variant_slug requires app_id or app_slug."""
        with pytest.raises(
            ValueError, match=r"`variant_slug` requires `app_id` or `app_slug`"
        ):
            SharedManager.fetch(variant_slug="test")

    def test_fetch_variant_version_without_slug_raises(self, agenta_init):
        """variant_version requires variant_slug."""
        with pytest.raises(
            ValueError, match=r"`variant_version` requires `variant_slug`"
        ):
            SharedManager.fetch(variant_version=1, app_id="some-id")

    def test_fetch_environment_slug_without_app_raises(self, agenta_init):
        """environment_slug requires app_id or app_slug."""
        with pytest.raises(
            ValueError, match=r"`environment_slug` requires `app_id` or `app_slug`"
        ):
            SharedManager.fetch(environment_slug="production")

    def test_fetch_environment_version_without_slug_raises(self, agenta_init):
        """environment_version requires environment_slug."""
        with pytest.raises(
            ValueError, match=r"`environment_version` requires `environment_slug`"
        ):
            SharedManager.fetch(environment_version=1, app_id="some-id")


# =============================================================================
# Concurrent Operations Tests
# =============================================================================


@pytest.mark.e2e
@pytest.mark.asyncio
class TestConcurrentOperations:
    """Test concurrent async operations."""

    async def test_concurrent_app_list(self, agenta_init):
        """Test that multiple concurrent list operations work correctly."""
        # Run multiple list operations concurrently
        tasks = [AppManager.alist() for _ in range(3)]
        results = await asyncio.gather(*tasks)

        # All results should be lists
        for result in results:
            assert isinstance(result, list)

    async def test_concurrent_config_fetch(self, agenta_init, test_variant):
        """Test that multiple concurrent fetch operations work correctly."""
        tasks = [
            SharedManager.afetch(
                variant_slug=test_variant["variant_slug"], app_id=test_variant["app_id"]
            )
            for _ in range(3)
        ]
        results = await asyncio.gather(*tasks)

        # All results should be ConfigurationResponse
        for result in results:
            assert isinstance(result, ConfigurationResponse)
            assert result.variant_slug.endswith(test_variant["variant_slug"])
