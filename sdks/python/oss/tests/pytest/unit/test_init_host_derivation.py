import sys
import types
from unittest.mock import MagicMock, patch
import pytest

client_mod = types.ModuleType("agenta.client")
client_mod.__path__ = []
client_mod.types = types.ModuleType("agenta.client.types")
client_mod.backend = types.ModuleType("agenta.client.backend")
client_mod.AgentaApi = MagicMock()
client_mod.AsyncAgentaApi = MagicMock()

sys.modules.setdefault("agenta.client", client_mod)
sys.modules.setdefault("agenta.client.types", client_mod.types)
sys.modules.setdefault("agenta.client.backend", client_mod.backend)
sys.modules.setdefault("agenta_client", client_mod)

from agenta.sdk.utils.init import AgentaSingleton


@pytest.fixture(autouse=True)
def reset_singleton():
    """Reset the singleton before and after each test."""
    AgentaSingleton._initialized = False
    AgentaSingleton._instance = None
    yield
    AgentaSingleton._initialized = False
    AgentaSingleton._instance = None


class TestHostDerivation:
    @patch("agenta.sdk.utils.init.Tracing")
    @patch("agenta.sdk.utils.init.AgentaApi")
    @patch("agenta.sdk.utils.init.AsyncAgentaApi")
    def test_api_named_host_with_api_suffix(self, mock_async_api, mock_api, mock_tracing):
        """Host named 'api' with /api suffix should strip /api without corrupting the hostname."""
        singleton = AgentaSingleton()
        singleton.init(api_url="http://api:8000/api")

        assert singleton.host == "http://api:8000"
        assert singleton.api_url == "http://api:8000/api"
        mock_tracing.assert_called_once()
        assert mock_tracing.call_args.kwargs["url"] == "http://api:8000/api/otlp/v1/traces"

    @patch("agenta.sdk.utils.init.Tracing")
    @patch("agenta.sdk.utils.init.AgentaApi")
    @patch("agenta.sdk.utils.init.AsyncAgentaApi")
    def test_api_named_host_without_api_suffix(self, mock_async_api, mock_api, mock_tracing):
        """Host named 'api' without /api suffix should preserve host."""
        singleton = AgentaSingleton()
        singleton.init(api_url="http://api:8000")

        assert singleton.host == "http://api:8000"
        assert singleton.api_url == "http://api:8000"
        mock_tracing.assert_called_once()
        assert mock_tracing.call_args.kwargs["url"] == "http://api:8000/api/otlp/v1/traces"

    @patch("agenta.sdk.utils.init.Tracing")
    @patch("agenta.sdk.utils.init.AgentaApi")
    @patch("agenta.sdk.utils.init.AsyncAgentaApi")
    def test_explicit_host_takes_precedence_over_derivation(self, mock_async_api, mock_api, mock_tracing):
        """Explicit host argument should be preserved when api_url is also provided."""
        singleton = AgentaSingleton()
        singleton.init(host="http://custom-host:8000", api_url="http://custom-host:8000/api")

        assert singleton.host == "http://custom-host:8000"
        assert singleton.api_url == "http://custom-host:8000/api"
        mock_tracing.assert_called_once()
        assert mock_tracing.call_args.kwargs["url"] == "http://custom-host:8000/api/otlp/v1/traces"

    @patch("agenta.sdk.utils.init.Tracing")
    @patch("agenta.sdk.utils.init.AgentaApi")
    @patch("agenta.sdk.utils.init.AsyncAgentaApi")
    def test_default_cloud_fallback(self, mock_async_api, mock_api, mock_tracing):
        """Default initialization falls back to cloud.agenta.ai."""
        singleton = AgentaSingleton()
        singleton.init()

        assert singleton.host == "https://cloud.agenta.ai"
        assert singleton.api_url == "https://cloud.agenta.ai/api"
        mock_tracing.assert_called_once()
        assert mock_tracing.call_args.kwargs["url"] == "https://cloud.agenta.ai/api/otlp/v1/traces"
