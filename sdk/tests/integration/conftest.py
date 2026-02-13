"""
Shared fixtures for Agenta SDK integration tests.

These fixtures provide:
- API credentials management with environment variable support
- SDK initialization
- Test resource creation and cleanup (apps, variants)
"""

import os
from uuid import uuid4
from typing import Generator, Tuple, Optional, Any

import pytest

import agenta as ag
from agenta.sdk.managers.apps import AppManager
from agenta.sdk.managers.shared import SharedManager


DEFAULT_HOST = "https://cloud.agenta.ai"


def get_api_credentials() -> Tuple[str, Optional[str]]:
    """
    Get API credentials from environment variables.

    Returns:
        Tuple of (host, api_key). api_key may be None if missing.
    """
    host = os.getenv("AGENTA_HOST", DEFAULT_HOST)
    api_key = os.getenv("AGENTA_API_KEY")
    return host, api_key


def credentials_available() -> bool:
    """Check if credentials are available from environment variables."""
    host, api_key = get_api_credentials()
    return bool(api_key)


@pytest.fixture(autouse=True)
def _skip_integration_if_missing_credentials(request):
    if request.node.get_closest_marker("integration") and not credentials_available():
        pytest.skip("API credentials not available (set AGENTA_API_KEY)")


# Skip marker for tests that require credentials
requires_credentials = pytest.mark.skipif(
    not credentials_available(),
    reason="API credentials not available (set AGENTA_API_KEY; AGENTA_HOST optional)",
)


@pytest.fixture(scope="session")
def api_credentials() -> Tuple[str, str]:
    """
    Fixture that provides API credentials.

    Returns:
        Tuple of (host, api_key)

    Skips the test if no credentials are available.
    """
    host, api_key = get_api_credentials()
    if not api_key or not api_key.strip():
        pytest.skip("API credentials not available (set AGENTA_API_KEY)")
    assert api_key is not None
    return host, api_key


@pytest.fixture(scope="session")
def deterministic_testset_name() -> str:
    """Deterministic name to avoid proliferating testsets."""
    return "sdk-it-testset-v1"


@pytest.fixture(scope="session")
def deterministic_evaluator_slug() -> str:
    """Deterministic slug to avoid proliferating evaluators."""
    return "sdk-it-evaluator-v1"


@pytest.fixture(scope="session")
def deterministic_legacy_application_slug() -> str:
    """Deterministic slug to avoid proliferating legacy applications."""
    return "sdk-it-legacy-app-v1"


def make_otlp_flat_span(
    *, trace_id: str, span_id: str, span_name: str, attributes: dict
) -> Any:
    """Create a minimal Fern OTelFlatSpanInput."""
    from agenta.client.backend.types import OTelFlatSpanInput

    return OTelFlatSpanInput(
        trace_id=trace_id,
        span_id=span_id,
        span_name=span_name,
        attributes=attributes,
    )


@pytest.fixture(scope="session")
def otlp_flat_span_factory():
    return make_otlp_flat_span


def _force_reinit_sdk(host: str, api_key: str) -> None:
    """
    Force re-initialization of the SDK by resetting the singleton state.

    This is needed because the async httpx client gets bound to a specific
    event loop, and when pytest-asyncio creates a new loop for async tests,
    the old client reference becomes stale.
    """
    from agenta.sdk.agenta_init import AgentaSingleton
    from agenta.client.backend.client import AgentaApi, AsyncAgentaApi

    singleton = AgentaSingleton()

    # Force reset the API clients (this will create new httpx clients)
    singleton.api = AgentaApi(
        base_url=f"{host}/api",
        api_key=api_key,
    )
    singleton.async_api = AsyncAgentaApi(
        base_url=f"{host}/api",
        api_key=api_key,
    )

    # Update the module-level references
    ag.api = singleton.api
    ag.async_api = singleton.async_api


@pytest.fixture(scope="function")
def agenta_init(api_credentials: Tuple[str, str]) -> Generator[None, None, None]:
    """
    Initialize the Agenta SDK with test credentials.

    This fixture initializes the SDK for each test function to avoid
    event loop issues between sync and async tests.
    """
    host, api_key = api_credentials

    # First call to init (may have already been done)
    ag.init(host=host, api_key=api_key)

    # Force reinit to ensure fresh httpx clients bound to current event loop
    _force_reinit_sdk(host, api_key)

    yield


@pytest.fixture
def unique_app_slug() -> str:
    """Generate a unique app slug for testing."""
    return f"test-app-{uuid4().hex[:8]}"


@pytest.fixture
def unique_variant_slug() -> str:
    """Generate a unique variant slug for testing."""
    return f"test-variant-{uuid4().hex[:8]}"


@pytest.fixture
def test_app(agenta_init, unique_app_slug: str) -> Generator[dict, None, None]:
    """
    Create a test app and clean it up after the test.

    Yields:
        Dict with 'app_id' and 'app_slug' keys
    """
    app_id = None
    app_slug = unique_app_slug

    try:
        result = AppManager.create(app_slug=app_slug)
        if result and hasattr(result, "app_id"):
            app_id = result.app_id
            yield {"app_id": app_id, "app_slug": app_slug, "response": result}
        else:
            pytest.fail(f"Failed to create test app: {result}")
    finally:
        # Cleanup: delete the app if it was created
        if app_id:
            try:
                AppManager.delete(app_id=app_id)
            except Exception as e:
                # Log but don't fail the test on cleanup errors
                print(f"Warning: Failed to cleanup test app {app_id}: {e}")


@pytest.fixture
def test_variant(
    agenta_init, test_app: dict, unique_variant_slug: str
) -> Generator[dict, None, None]:
    """
    Create a test variant for an app and clean it up after the test.

    Yields:
        Dict with variant info including 'variant_slug', 'variant_id', 'app_id'
    """
    app_id = test_app["app_id"]
    variant_slug = unique_variant_slug
    variant_id = None

    try:
        result = SharedManager.add(variant_slug=variant_slug, app_id=app_id)
        if result and hasattr(result, "variant_id"):
            variant_id = result.variant_id
            yield {
                "variant_slug": variant_slug,
                "variant_id": variant_id,
                "app_id": app_id,
                "app_slug": test_app["app_slug"],
                "response": result,
            }
        else:
            pytest.fail(f"Failed to create test variant: {result}")
    finally:
        # Cleanup: delete the variant if it was created
        if variant_id:
            try:
                SharedManager.delete(variant_id=variant_id, app_id=app_id)
            except Exception as e:
                # Log but don't fail the test on cleanup errors
                print(f"Warning: Failed to cleanup test variant {variant_id}: {e}")


def cleanup_app_safe(app_id: str) -> None:
    """
    Safely cleanup an app, catching and logging any errors.

    Args:
        app_id: The ID of the app to delete
    """
    try:
        AppManager.delete(app_id=app_id)
    except Exception as e:
        print(f"Warning: Failed to cleanup app {app_id}: {e}")


def cleanup_variant_safe(
    variant_id: Optional[str] = None,
    variant_slug: Optional[str] = None,
    app_id: Optional[str] = None,
) -> None:
    """
    Safely cleanup a variant, catching and logging any errors.

    Args:
        variant_id: The ID of the variant to delete
        variant_slug: The slug of the variant to delete
        app_id: The app ID (required if using variant_slug)
    """
    try:
        SharedManager.delete(
            variant_id=variant_id, variant_slug=variant_slug, app_id=app_id
        )
    except Exception as e:
        print(f"Warning: Failed to cleanup variant {variant_id or variant_slug}: {e}")
