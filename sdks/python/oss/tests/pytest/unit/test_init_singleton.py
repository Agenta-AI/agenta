"""
Tests for ``AgentaSingleton.init()`` API URL / host parsing.

Regression test for issue #6787: the old ``_api_url.rsplit("/api", 1)[0]`` was an
unanchored string split, so it matched the ``//api`` inside the hostname itself
(``http://api:8000``), corrupting the host (dropping the port) and breaking the
OTLP traces endpoint that is built from ``self.host``. The host must now only
have a trailing ``/api`` PATH segment stripped — the scheme/host/port
(``parts.netloc``) must never be touched, no matter what the host is named.
"""

import agenta as ag
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


def test_get_trace_url_does_not_corrupt_host_named_api(monkeypatch):
    """get_trace_url() builds web_url from api_url; a host literally named
    'api' must survive the '/api' strip instead of being corrupted to 'http://:8000'.

    NOTE: get_trace_url() reads ag.DEFAULT_AGENTA_SINGLETON_INSTANCE, so this
    test must reset and init THAT instance rather than a fresh AgentaSingleton().
    """
    from agenta.sdk.utils.helpers import strip_trailing_api_segment

    # Reset the singleton that get_trace_url() actually reads.
    singleton = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE
    singleton.host = None
    singleton.api_url = None
    singleton.api_key = None
    singleton.scope_type = None
    singleton.scope_id = None
    singleton.organization_id = None
    singleton.workspace_id = None
    singleton.project_id = None
    singleton.tracing = None
    singleton.api = None
    singleton.async_api = None
    Singleton._instances.pop(Tracing, None)

    # Keep the parser deterministic.
    monkeypatch.delenv("DOCKER_NETWORK_MODE", raising=False)
    monkeypatch.delenv("AGENTA_API_URL", raising=False)
    monkeypatch.delenv("AGENTA_API_INTERNAL_URL", raising=False)
    monkeypatch.delenv("AGENTA_API_KEY", raising=False)

    # resolve_scopes() normally hits the network; stub it.
    monkeypatch.setattr(
        singleton,
        "resolve_scopes",
        lambda: ("org-1", "ws-1", "proj-1"),
    )

    singleton.init(api_url="http://api:8000/api")

    trace_url = singleton.tracing.get_trace_url(trace_id="abc123")

    # The host must be preserved, not corrupted by a naive '/api' replace.
    expected_web = strip_trailing_api_segment("http://api:8000/api")
    assert expected_web == "http://api:8000"
    assert "http://api:8000/w/ws-1/p/proj-1" in trace_url
    assert "http://:8000" not in trace_url


def test_init_query_string_api_url_produces_wellformed_otlp_url(reset_singleton):
    """A query string in api_url must not leak into the constructed OTLP url.

    The host is used as a string-concatenation base, so a preserved query would
    swallow '/api/otlp/v1/traces' into the query string instead of the path.
    """
    singleton = AgentaSingleton()
    singleton.init(api_url="https://cloud.agenta.ai/api?tenant=x")

    assert singleton.host == "https://cloud.agenta.ai"
    assert singleton.tracing.otlp_url == ("https://cloud.agenta.ai/api/otlp/v1/traces")


def test_get_trace_url_with_query_string_api_url(monkeypatch):
    """get_trace_url() must build a clean web_url from a query-bearing api_url."""
    # Reset the singleton that get_trace_url() actually reads.
    singleton = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE
    singleton.host = None
    singleton.api_url = None
    singleton.api_key = None
    singleton.scope_type = None
    singleton.scope_id = None
    singleton.organization_id = None
    singleton.workspace_id = None
    singleton.project_id = None
    singleton.tracing = None
    singleton.api = None
    singleton.async_api = None
    Singleton._instances.pop(Tracing, None)

    monkeypatch.delenv("DOCKER_NETWORK_MODE", raising=False)
    monkeypatch.delenv("AGENTA_API_URL", raising=False)
    monkeypatch.delenv("AGENTA_API_INTERNAL_URL", raising=False)
    monkeypatch.delenv("AGENTA_API_KEY", raising=False)

    monkeypatch.setattr(
        singleton,
        "resolve_scopes",
        lambda: ("org-1", "ws-1", "proj-1"),
    )

    singleton.init(api_url="https://cloud.agenta.ai/api?tenant=x")

    trace_url = singleton.tracing.get_trace_url(trace_id="abc123")

    assert trace_url == (
        "https://cloud.agenta.ai/w/ws-1/p/proj-1/observability?trace=abc123"
    )
    assert "tenant=x" not in trace_url


def test_init_host_only_with_query_string_produces_clean_host_and_otlp_url(
    reset_singleton,
):
    """Passing host= with a query string (no api_url) must still produce a clean
    self.host — the elif _host: branch must strip query/fragment before appending
    '/api', otherwise self.host carries the query and every downstream consumer
    that concatenates a path onto it (the OTLP trace URL, get_trace_url()) breaks
    the same way as the already-fixed api_url path."""
    singleton = AgentaSingleton()
    singleton.init(host="https://cloud.agenta.ai?tenant=x")

    assert singleton.host == "https://cloud.agenta.ai"
    assert "tenant=x" not in singleton.host
    assert singleton.tracing.otlp_url == (
        "https://cloud.agenta.ai/api/otlp/v1/traces"
    )
    assert "tenant=x" not in singleton.tracing.otlp_url


def test_resolve_scopes_uses_query_free_api_url(reset_singleton, monkeypatch):
    """resolve_scopes() must send a well-formed request URL from a query-bearing
    api_url (the appended '/projects/current' path must not be swallowed into a
    query string)."""
    captured = {}

    class FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return {
                "organization_id": "org-1",
                "workspace_id": "ws-1",
                "project_id": "proj-1",
            }

    class FakeClient:
        def __init__(self, *args, **kwargs):
            # AgentaApi/AsyncAgentaApi also construct an httpx.Client during
            # init(); accept and ignore their arguments.
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def get(self, url, **kwargs):
            captured["url"] = url
            return FakeResponse()

    monkeypatch.setattr("httpx.Client", FakeClient)

    singleton = AgentaSingleton()
    singleton.init(api_url="https://cloud.agenta.ai/api?tenant=x", api_key="test-key")
    scopes = singleton.resolve_scopes()

    assert scopes == ("org-1", "ws-1", "proj-1")
    # The actual URL sent to client.get() must be well-formed: /api path intact,
    # appended path NOT swallowed into a query string.
    assert captured["url"] == "https://cloud.agenta.ai/api/projects/current"
    assert "tenant=x" not in captured["url"]
