from agenta.sdk.utils.helpers import parse_url


def test_parse_url_schemeless_localhost_bridge_mode(monkeypatch):
    """Verify schemeless localhost in bridge mode rewrites to host.docker.internal."""
    monkeypatch.setenv("DOCKER_NETWORK_MODE", "bridge")
    assert parse_url("localhost:8080/api") == "http://host.docker.internal:8080/api"


def test_parse_url_schemeless_non_local_host(monkeypatch):
    """Verify schemeless non-local URLs default to http:// across network modes."""
    monkeypatch.setenv("DOCKER_NETWORK_MODE", "bridge")
    assert parse_url("my-agenta.example.com/api") == "http://my-agenta.example.com/api"

    monkeypatch.setenv("DOCKER_NETWORK_MODE", "host")
    assert parse_url("my-agenta.example.com/api") == "http://my-agenta.example.com/api"

    monkeypatch.delenv("DOCKER_NETWORK_MODE", raising=False)
    assert parse_url("my-agenta.example.com/api") == "http://my-agenta.example.com/api"


def test_parse_url_absolute_https_cloud_url_unchanged(monkeypatch):
    """Verify absolute https URLs remain unchanged across network modes."""
    for mode in ["bridge", "host", None]:
        if mode is not None:
            monkeypatch.setenv("DOCKER_NETWORK_MODE", mode)
        else:
            monkeypatch.delenv("DOCKER_NETWORK_MODE", raising=False)
        assert parse_url("https://cloud.agenta.ai/api") == "https://cloud.agenta.ai/api"


def test_parse_url_http_localhost_bridge_mode(monkeypatch):
    """Verify http localhost in bridge mode rewrites to host.docker.internal."""
    monkeypatch.setenv("DOCKER_NETWORK_MODE", "bridge")
    assert (
        parse_url("http://localhost:8080/api")
        == "http://host.docker.internal:8080/api"
    )


def test_parse_url_http_localhost_host_mode_and_unset_mode(monkeypatch):
    """Verify http localhost in host mode and unset mode remains unchanged."""
    monkeypatch.setenv("DOCKER_NETWORK_MODE", "host")
    assert parse_url("http://localhost:8080/api") == "http://localhost:8080/api"

    monkeypatch.delenv("DOCKER_NETWORK_MODE", raising=False)
    assert parse_url("http://localhost:8080/api") == "http://localhost:8080/api"


def test_parse_url_trailing_slash_stripped(monkeypatch):
    """Verify trailing slashes are stripped from URLs."""
    monkeypatch.delenv("DOCKER_NETWORK_MODE", raising=False)
    assert parse_url("http://localhost:8080/api/") == "http://localhost:8080/api"
    assert parse_url("localhost:8080/api/") == "http://localhost:8080/api"
    assert parse_url("https://cloud.agenta.ai/api/") == "https://cloud.agenta.ai/api"


def test_parse_url_schemeless_0000_bridge_mode(monkeypatch):
    """Verify schemeless 0.0.0.0 in bridge mode rewrites to host.docker.internal."""
    monkeypatch.setenv("DOCKER_NETWORK_MODE", "bridge")
    assert parse_url("0.0.0.0:8080/api") == "http://host.docker.internal:8080/api"
