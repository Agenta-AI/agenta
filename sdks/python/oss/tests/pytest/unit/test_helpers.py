import pytest
from agenta.sdk.utils.helpers import parse_url


def test_parse_url_schemeless_localhost_bridge_mode(monkeypatch):
    monkeypatch.setenv("DOCKER_NETWORK_MODE", "bridge")
    assert parse_url("localhost:8080/api") == "http://host.docker.internal:8080/api"


def test_parse_url_schemeless_non_local_host(monkeypatch):
    monkeypatch.setenv("DOCKER_NETWORK_MODE", "bridge")
    assert parse_url("my-agenta.example.com/api") == "http://my-agenta.example.com/api"

    monkeypatch.setenv("DOCKER_NETWORK_MODE", "host")
    assert parse_url("my-agenta.example.com/api") == "http://my-agenta.example.com/api"

    monkeypatch.delenv("DOCKER_NETWORK_MODE", raising=False)
    assert parse_url("my-agenta.example.com/api") == "http://my-agenta.example.com/api"


def test_parse_url_absolute_https_cloud_url_unchanged(monkeypatch):
    for mode in ["bridge", "host", None]:
        if mode is not None:
            monkeypatch.setenv("DOCKER_NETWORK_MODE", mode)
        else:
            monkeypatch.delenv("DOCKER_NETWORK_MODE", raising=False)
        assert parse_url("https://cloud.agenta.ai/api") == "https://cloud.agenta.ai/api"


def test_parse_url_http_localhost_bridge_mode(monkeypatch):
    monkeypatch.setenv("DOCKER_NETWORK_MODE", "bridge")
    assert (
        parse_url("http://localhost:8080/api")
        == "http://host.docker.internal:8080/api"
    )


def test_parse_url_http_localhost_host_mode_and_unset_mode(monkeypatch):
    monkeypatch.setenv("DOCKER_NETWORK_MODE", "host")
    assert parse_url("http://localhost:8080/api") == "http://localhost:8080/api"

    monkeypatch.delenv("DOCKER_NETWORK_MODE", raising=False)
    assert parse_url("http://localhost:8080/api") == "http://localhost:8080/api"


def test_parse_url_trailing_slash_stripped(monkeypatch):
    monkeypatch.delenv("DOCKER_NETWORK_MODE", raising=False)
    assert parse_url("http://localhost:8080/api/") == "http://localhost:8080/api"
    assert parse_url("localhost:8080/api/") == "http://localhost:8080/api"
    assert parse_url("https://cloud.agenta.ai/api/") == "https://cloud.agenta.ai/api"


def test_parse_url_schemeless_0000_bridge_mode(monkeypatch):
    monkeypatch.setenv("DOCKER_NETWORK_MODE", "bridge")
    assert parse_url("0.0.0.0:8080/api") == "http://host.docker.internal:8080/api"
