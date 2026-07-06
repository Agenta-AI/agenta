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


def test_allow_insecure_defaults_false(monkeypatch):
    monkeypatch.delenv("AGENTA_INSECURE_EGRESS_ALLOWED", raising=False)
    monkeypatch.delenv("AGENTA_CUSTOM_PROVIDER_ALLOW_INSECURE", raising=False)
    monkeypatch.delenv("AGENTA_WEBHOOKS_ALLOW_INSECURE", raising=False)
    monkeypatch.delenv("AGENTA_WEBHOOK_ALLOW_INSECURE", raising=False)
    assert net._ALLOW_INSECURE is False


def test_allow_insecure_canonical_env_var(monkeypatch):
    # _ALLOW_INSECURE is resolved once at import time; reload to re-run resolution.
    monkeypatch.setenv("AGENTA_INSECURE_EGRESS_ALLOWED", "true")
    monkeypatch.delenv("AGENTA_CUSTOM_PROVIDER_ALLOW_INSECURE", raising=False)
    monkeypatch.delenv("AGENTA_WEBHOOKS_ALLOW_INSECURE", raising=False)
    monkeypatch.delenv("AGENTA_WEBHOOK_ALLOW_INSECURE", raising=False)
    try:
        importlib.reload(net)
        assert net._ALLOW_INSECURE is True
    finally:
        monkeypatch.delenv("AGENTA_INSECURE_EGRESS_ALLOWED", raising=False)
        importlib.reload(net)


def test_allow_insecure_legacy_alias_still_honored(monkeypatch):
    monkeypatch.delenv("AGENTA_INSECURE_EGRESS_ALLOWED", raising=False)
    monkeypatch.setenv("AGENTA_CUSTOM_PROVIDER_ALLOW_INSECURE", "true")
    monkeypatch.delenv("AGENTA_WEBHOOKS_ALLOW_INSECURE", raising=False)
    monkeypatch.delenv("AGENTA_WEBHOOK_ALLOW_INSECURE", raising=False)
    try:
        importlib.reload(net)
        assert net._ALLOW_INSECURE is True
    finally:
        monkeypatch.delenv("AGENTA_CUSTOM_PROVIDER_ALLOW_INSECURE", raising=False)
        importlib.reload(net)
