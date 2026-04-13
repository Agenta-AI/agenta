from oss.src.utils.env import env
from oss.src.utils.helpers import parse_url


def test_parse_url_rewrites_localhost_to_host_docker_internal_in_bridge_mode(
    monkeypatch,
):
    monkeypatch.setattr(env.docker, "network_mode", "bridge")

    assert (
        parse_url("http://localhost/services/completion/v0/invoke")
        == "http://host.docker.internal/services/completion/v0/invoke"
    )


def test_parse_url_keeps_host_docker_internal_services_url_in_bridge_mode(
    monkeypatch,
):
    monkeypatch.setattr(env.docker, "network_mode", "bridge")

    assert (
        parse_url("http://host.docker.internal/services/completion/v0/invoke")
        == "http://host.docker.internal/services/completion/v0/invoke"
    )


def test_parse_url_keeps_services_proxy_url_in_host_mode(monkeypatch):
    monkeypatch.setattr(env.docker, "network_mode", "host")

    assert (
        parse_url("http://localhost/services/completion/v0/invoke")
        == "http://localhost/services/completion/v0/invoke"
    )


def test_parse_url_still_rewrites_plain_localhost_urls_in_bridge_mode(monkeypatch):
    monkeypatch.setattr(env.docker, "network_mode", "bridge")

    assert (
        parse_url("http://localhost:8080/openapi.json")
        == "http://host.docker.internal:8080/openapi.json"
    )


def test_parse_url_prepends_default_scheme_for_localhost_inputs(monkeypatch):
    monkeypatch.setattr(env.docker, "network_mode", "bridge")

    assert (
        parse_url("localhost:8080/openapi.json")
        == "http://host.docker.internal:8080/openapi.json"
    )
