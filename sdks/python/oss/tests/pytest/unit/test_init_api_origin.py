"""Regression: host/origin derivation must not match '/api' inside the URL authority.

``AgentaSingleton.init`` used to do ``api_url.rsplit("/api", 1)[0]``. That is not
anchored to a path segment, so a host literally named ``api`` is cut inside the
scheme:

    http://api:8000  →  http:/   →  traces at http://api/otlp/v1/traces

The runner then rejects the endpoint (port mismatch) and every turn fails.
See https://github.com/Agenta-AI/agenta/issues/6787.
"""

from unittest.mock import MagicMock, patch

import pytest

from agenta.sdk.engines.tracing.tracing import Tracing
from agenta.sdk.utils.helpers import strip_trailing_api_segment
from agenta.sdk.utils.init import AgentaSingleton


def _reset_singleton() -> None:
    AgentaSingleton._instance = None
    AgentaSingleton._initialized = False


@pytest.fixture
def fresh_singleton(monkeypatch):
    _reset_singleton()
    for name in (
        "AGENTA_API_INTERNAL_URL",
        "AGENTA_API_URL",
        "AGENTA_HOST",
        "AGENTA_API_KEY",
        "DOCKER_NETWORK_MODE",
    ):
        monkeypatch.delenv(name, raising=False)
    yield
    _reset_singleton()


def _init(api_url: str):
    with (
        patch("agenta.sdk.utils.init.Tracing") as tracing_cls,
        patch("agenta.sdk.utils.init.AgentaApi"),
        patch("agenta.sdk.utils.init.AsyncAgentaApi"),
        patch("agenta.sdk.utils.init.version", return_value="0"),
    ):
        singleton = AgentaSingleton()
        singleton.tracing = None
        singleton.api = None
        singleton.async_api = None
        singleton.init(api_url=api_url)
        return singleton, tracing_cls


@pytest.mark.parametrize(
    ("api_url", "origin"),
    [
        ("http://api:8000", "http://api:8000"),
        ("http://agenta-api:8000", "http://agenta-api:8000"),
        ("http://api:8000/api", "http://api:8000"),
        ("http://agenta-api:8000/api", "http://agenta-api:8000"),
        ("https://cloud.agenta.ai/api", "https://cloud.agenta.ai"),
        ("https://cloud.agenta.ai/api/", "https://cloud.agenta.ai"),
    ],
)
def test_strip_trailing_api_segment_only_touches_path(api_url, origin):
    assert strip_trailing_api_segment(api_url) == origin


def test_strip_trailing_api_segment_leaves_non_trailing_api_path():
    assert (
        strip_trailing_api_segment("https://example.com/api/v1")
        == "https://example.com/api/v1"
    )


@pytest.mark.parametrize(
    ("api_url", "origin"),
    [
        ("http://api:8000", "http://api:8000"),
        ("http://agenta-api:8000", "http://agenta-api:8000"),
        ("http://api:8000/api", "http://api:8000"),
        ("https://cloud.agenta.ai/api", "https://cloud.agenta.ai"),
    ],
)
def test_init_derives_origin_and_otlp_endpoint_from_path_only(
    fresh_singleton, api_url, origin
):
    singleton, tracing_cls = _init(api_url)

    assert singleton.host == origin
    assert singleton.api_url == api_url.rstrip("/")
    tracing_cls.assert_called_once()
    assert tracing_cls.call_args.kwargs["url"] == f"{origin}/api/otlp/v1/traces"


def test_get_trace_url_does_not_cut_host_named_api():
    tracing = Tracing.__new__(Tracing)
    singleton = MagicMock()
    singleton.api_url = "http://api:8000/api"
    singleton.resolve_scopes.return_value = ("org", "ws", "proj")

    with patch("agenta.sdk.engines.tracing.tracing.ag") as ag:
        ag.DEFAULT_AGENTA_SINGLETON_INSTANCE = singleton
        url = tracing.get_trace_url(trace_id="abc")

    assert url == "http://api:8000/w/ws/p/proj/observability?trace=abc"
