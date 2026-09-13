"""
Tests for ``AgentaSingleton.init()`` API URL / host parsing.

Regression test for issue #6787: the old ``_api_url.rsplit("/api", 1)[0]`` was an
unanchored string split, so it matched the ``//api`` inside the hostname itself
(``http://api:8000``), corrupting the host (dropping the port) and breaking the
OTLP traces endpoint that is built from ``self.host``. The host must now only
have a trailing ``/api`` PATH segment stripped — the scheme/host/port
(``parts.netloc``) must never be touched, no matter what the host is named.
"""

import agenta as ag  # noqa: F401  (bootstraps the package-level singleton)
import pytest
from agenta.sdk.engines.tracing import Tracing
from agenta.sdk.utils.init import AgentaSingleton
from agenta.sdk.utils.singleton import Singleton


@pytest.fixture
def reset_singleton(monkeypatch):
    """Reset the AgentaSingleton (and Tracing) state around each test.

    AgentaSingleton caches everything in class attributes (``_instance``,
    ``_initialized``, ``tracing``, ``api``, ``async_api``) and ``init()`` has an
    idempotency guard (``if self.tracing and self.api and self.async_api: return``),
    so a freshly created ``AgentaSingleton()`` would still skip re-initialization
    unless those class attributes are reset too. ``Tracing`` is also a metaclass
    singleton (``agenta.sdk.utils.singleton.Singleton``), so its instance cache is
    cleared as well — otherwise ``Tracing(url=...)`` returns the first-created
    instance with the first test's URL.

    The pre-test state is restored at teardown so the module-level singletons
    (``agenta.DEFAULT_AGENTA_SINGLETON_INSTANCE``) behave normally for any test
    that runs after this module.
    """
    from opentelemetry.trace import get_tracer_provider, set_tracer_provider

    snapshot = {
        "_instance": AgentaSingleton._instance,
        "_initialized": AgentaSingleton._initialized,
        "config": AgentaSingleton.config,
        "tracing": AgentaSingleton.tracing,
        "api": AgentaSingleton.api,
        "async_api": AgentaSingleton.async_api,
    }
    tracing_instance = Singleton._instances.get(Tracing)
    tracer_provider = get_tracer_provider()

    # Force a fresh, uninitialized singleton for each test case.
    AgentaSingleton._instance = None
    AgentaSingleton._initialized = False
    AgentaSingleton.config = None
    AgentaSingleton.tracing = None
    AgentaSingleton.api = None
    AgentaSingleton.async_api = None
    Singleton._instances.pop(Tracing, None)

    # Keep the parser deterministic: parse_url rewrites localhost to
    # host.docker.internal when DOCKER_NETWORK_MODE=bridge, and the ambient
    # AGENTA_* variables must not leak into the explicitly-passed api_url.
    for var in (
        "DOCKER_NETWORK_MODE",
        "AGENTA_HOST",
        "AGENTA_API_URL",
        "AGENTA_API_INTERNAL_URL",
        "AGENTA_API_KEY",
        "AGENTA_SCOPE_TYPE",
        "AGENTA_SCOPE_ID",
    ):
        monkeypatch.delenv(var, raising=False)

    yield

    # Restore the pre-test state.
    AgentaSingleton._instance = snapshot["_instance"]
    AgentaSingleton._initialized = snapshot["_initialized"]
    AgentaSingleton.config = snapshot["config"]
    AgentaSingleton.tracing = snapshot["tracing"]
    AgentaSingleton.api = snapshot["api"]
    AgentaSingleton.async_api = snapshot["async_api"]
    if tracing_instance is None:
        Singleton._instances.pop(Tracing, None)
    else:
        Singleton._instances[Tracing] = tracing_instance
    set_tracer_provider(tracer_provider)


@pytest.mark.parametrize(
    ("api_url", "expected_host"),
    [
        ("http://api:8000", "http://api:8000"),
        ("http://api:8000/api", "http://api:8000"),
        ("http://agenta-api:8000", "http://agenta-api:8000"),
        ("http://agenta-api:8000/api", "http://agenta-api:8000"),
        ("https://cloud.agenta.ai/api", "https://cloud.agenta.ai"),
        ("http://localhost:8000/api/", "http://localhost:8000"),
    ],
)
def test_init_api_url_host_parsing(reset_singleton, api_url, expected_host):
    singleton = AgentaSingleton()
    singleton.init(api_url=api_url)

    assert singleton.host == expected_host
    # Tracing stores the url passed to `Tracing(url=...)` as `otlp_url`.
    assert singleton.tracing.otlp_url == f"{expected_host}/api/otlp/v1/traces"
