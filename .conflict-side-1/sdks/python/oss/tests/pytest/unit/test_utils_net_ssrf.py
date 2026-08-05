"""Unit tests for agenta/sdk/utils/net.py — validate_endpoint_url.

Mirrors api/oss/src/core/webhooks/utils.py's test suite; pure function, no network
required (literal-IP cases plus a monkeypatched socket.getaddrinfo for hostnames).
"""

import importlib
import socket

import pytest

from agenta.sdk.utils import net


@pytest.mark.parametrize(
    "url",
    [
        "",
        "ftp://example.com/hook",
        "//example.com/hook",
        "https://",
        "https:///path",
        "https://user:pass@example.com/hook",
    ],
)
def test_format_errors_always_rejected(url, monkeypatch):
    monkeypatch.setattr(net, "_ALLOW_INSECURE", True)
    with pytest.raises(ValueError):
        net.validate_endpoint_url(url)


@pytest.mark.parametrize(
    "url",
    [
        "http://93.184.216.34/v1",
        "https://localhost/v1",
        "https://127.0.0.1/v1",
        "https://10.0.0.1/v1",
        "https://172.16.0.1/v1",
        "https://192.168.1.1/v1",
        "https://169.254.0.1/v1",
    ],
)
def test_secure_mode_rejects_private_and_insecure_urls(url, monkeypatch):
    monkeypatch.setattr(net, "_ALLOW_INSECURE", False)
    with pytest.raises(ValueError):
        net.validate_endpoint_url(url)


def test_secure_mode_accepts_public_ip(monkeypatch):
    monkeypatch.setattr(net, "_ALLOW_INSECURE", False)
    assert net.validate_endpoint_url("https://93.184.216.34/v1") == "93.184.216.34"


def test_hostname_resolving_to_private_ip_is_rejected(monkeypatch):
    monkeypatch.setattr(net, "_ALLOW_INSECURE", False)
    monkeypatch.setattr(
        net.socket,
        "getaddrinfo",
        lambda *a, **kw: [(None, None, None, None, ("10.0.0.5", 0))],
    )
    with pytest.raises(ValueError, match="blocked IP"):
        net.validate_endpoint_url("https://internal.example.com/v1")


def test_hostname_resolving_to_public_ip_is_accepted(monkeypatch):
    monkeypatch.setattr(net, "_ALLOW_INSECURE", False)
    monkeypatch.setattr(
        net.socket,
        "getaddrinfo",
        lambda *a, **kw: [(None, None, None, None, ("93.184.216.34", 0))],
    )
    assert (
        net.validate_endpoint_url("https://gateway.example.com/v1") == "93.184.216.34"
    )


def test_unresolvable_hostname_raises(monkeypatch):
    monkeypatch.setattr(net, "_ALLOW_INSECURE", False)
    monkeypatch.setattr(
        net.socket,
        "getaddrinfo",
        lambda *a, **kw: (_ for _ in ()).throw(
            socket.gaierror("Name or service not known")
        ),
    )
    with pytest.raises(ValueError, match="could not be resolved"):
        net.validate_endpoint_url("https://this-does-not-exist.invalid/v1")


_ALLOW_INSECURE_ENV_VARS = (
    "AGENTA_INSECURE_EGRESS_ALLOWED",
    "AGENTA_CUSTOM_PROVIDER_ALLOW_INSECURE",
    "AGENTA_WEBHOOKS_ALLOW_INSECURE",
    "AGENTA_WEBHOOK_ALLOW_INSECURE",
)


@pytest.fixture
def resolve_allow_insecure(monkeypatch):
    """Re-run net's import-time env resolution under `env` and return the resulting flag.

    Clears every recognized var first so the ambient shell cannot leak in; reloads once more
    on teardown to restore module state for later tests.
    """

    def _resolve(env=None):
        for name in _ALLOW_INSECURE_ENV_VARS:
            monkeypatch.delenv(name, raising=False)
        for name, value in (env or {}).items():
            monkeypatch.setenv(name, value)
        importlib.reload(net)
        return net._ALLOW_INSECURE

    try:
        yield _resolve
    finally:
        for name in _ALLOW_INSECURE_ENV_VARS:
            monkeypatch.delenv(name, raising=False)
        importlib.reload(net)


@pytest.mark.allow_insecure_env
def test_allow_insecure_defaults_false(resolve_allow_insecure):
    assert resolve_allow_insecure() is False


@pytest.mark.allow_insecure_env
def test_allow_insecure_canonical_env_var(resolve_allow_insecure):
    assert resolve_allow_insecure({"AGENTA_INSECURE_EGRESS_ALLOWED": "true"}) is True


@pytest.mark.allow_insecure_env
def test_allow_insecure_legacy_alias_still_honored(resolve_allow_insecure):
    assert (
        resolve_allow_insecure({"AGENTA_CUSTOM_PROVIDER_ALLOW_INSECURE": "true"})
        is True
    )


@pytest.mark.allow_insecure_env
def test_allow_insecure_ignores_ambient_env(resolve_allow_insecure, monkeypatch):
    # The ambient shell may export it (a loaded dev env file); resolution must still start clean.
    monkeypatch.setenv("AGENTA_INSECURE_EGRESS_ALLOWED", "true")
    assert resolve_allow_insecure() is False
