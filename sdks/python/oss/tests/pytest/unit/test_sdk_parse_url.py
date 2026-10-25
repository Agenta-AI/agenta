"""Unit tests for the SDK ``parse_url`` scheme default.

A scheme-less ``AGENTA_API_URL`` must get ``http://`` before any other
handling, mirroring the API copy. Otherwise the trace endpoint built from
it has no host at all.
"""

import pytest

from agenta.sdk.utils.helpers import parse_url


def test_parse_url_prepends_http_for_scheme_less_localhost(monkeypatch):
    monkeypatch.delenv("DOCKER_NETWORK_MODE", raising=False)
    assert parse_url("localhost:8080/api") == "http://localhost:8080/api"


def test_parse_url_prepends_http_before_bridge_rewrite(monkeypatch):
    monkeypatch.setenv("DOCKER_NETWORK_MODE", "bridge")
    assert (
        parse_url("localhost:8080/api")
        == "http://host.docker.internal:8080/api"
    )


def test_parse_url_prepends_http_for_scheme_less_public_host(monkeypatch):
    # This is the placement check: a public host hits the early return in
    # parse_url, so the scheme default must run before that return.
    monkeypatch.delenv("DOCKER_NETWORK_MODE", raising=False)
    assert (
        parse_url("my-agenta.example.com/api")
        == "http://my-agenta.example.com/api"
    )


def test_parse_url_keeps_existing_scheme(monkeypatch):
    monkeypatch.delenv("DOCKER_NETWORK_MODE", raising=False)
    assert (
        parse_url("http://localhost:8080/api") == "http://localhost:8080/api"
    )
    assert (
        parse_url("https://cloud.agenta.ai/api")
        == "https://cloud.agenta.ai/api"
    )


def test_parse_url_strips_trailing_slash_before_scheme_default(monkeypatch):
    monkeypatch.delenv("DOCKER_NETWORK_MODE", raising=False)
    assert parse_url("localhost:8080/api/") == "http://localhost:8080/api"
