"""Unit tests for core/webhooks/utils.py — validate_webhook_url.

Pure function, no network required for IP-based cases.
DNS-dependent cases use a monkeypatched socket.getaddrinfo.
"""

import importlib

import pytest

from oss.src.core.webhooks.utils import (
    resolve_validated_webhook_ip,
    validate_webhook_url,
)


# ---------------------------------------------------------------------------
# Format errors — always rejected regardless of AGENTA_WEBHOOK_ALLOW_INSECURE
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "url",
    [
        "",
        "ftp://example.com/hook",
        "//example.com/hook",
        "https://",
        "https:///path",
        "https://user:pass@example.com/hook",
        "https://:pass@example.com/hook",
    ],
)
def test_format_errors_always_rejected(url, monkeypatch):
    monkeypatch.setattr("oss.src.core.webhooks.utils._WEBHOOK_ALLOW_INSECURE", True)
    with pytest.raises(ValueError):
        validate_webhook_url(url)


# ---------------------------------------------------------------------------
# Secure mode (AGENTA_WEBHOOK_ALLOW_INSECURE=False)
# Tests use literal IP addresses so no DNS lookup is required.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "url",
    [
        # http not allowed when insecure is off
        "http://93.184.216.34/hook",
        # localhost hostnames
        "https://localhost/hook",
        "https://localhost.localdomain/hook",
        # loopback
        "https://127.0.0.1/hook",
        "https://127.0.0.2/hook",
        # RFC-1918 private ranges
        "https://10.0.0.1/hook",
        "https://172.16.0.1/hook",
        "https://192.168.1.1/hook",
        # link-local
        "https://169.254.0.1/hook",
    ],
)
def test_secure_mode_rejects_private_and_insecure_urls(url, monkeypatch):
    monkeypatch.setattr("oss.src.core.webhooks.utils._WEBHOOK_ALLOW_INSECURE", False)
    with pytest.raises(ValueError):
        validate_webhook_url(url)


def test_secure_mode_accepts_public_ip(monkeypatch):
    monkeypatch.setattr("oss.src.core.webhooks.utils._WEBHOOK_ALLOW_INSECURE", False)
    # 93.184.216.34 is example.com — a routable, non-private address
    validate_webhook_url("https://93.184.216.34/hook")


# ---------------------------------------------------------------------------
# Insecure mode (AGENTA_WEBHOOK_ALLOW_INSECURE=True)
# Allows http, localhost, and private IPs (dev/test environments).
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "url",
    [
        "http://localhost/hook",
        "https://localhost/hook",
        "http://127.0.0.1/hook",
        "https://192.168.1.1/hook",
        "https://10.0.0.1/hook",
    ],
)
def test_insecure_mode_allows_local_urls(url, monkeypatch):
    monkeypatch.setattr("oss.src.core.webhooks.utils._WEBHOOK_ALLOW_INSECURE", True)
    # Should not raise
    validate_webhook_url(url)


# ---------------------------------------------------------------------------
# Hostname DNS path — monkeypatched getaddrinfo, no real network needed
# ---------------------------------------------------------------------------


def test_unresolvable_hostname_raises(monkeypatch):
    import socket

    monkeypatch.setattr("oss.src.core.webhooks.utils._WEBHOOK_ALLOW_INSECURE", False)
    monkeypatch.setattr(
        "oss.src.core.webhooks.utils.socket.getaddrinfo",
        lambda *a, **kw: (_ for _ in ()).throw(
            socket.gaierror("Name or service not known")
        ),
    )
    with pytest.raises(ValueError, match="could not be resolved"):
        validate_webhook_url("https://this-does-not-exist.invalid/hook")


def test_hostname_resolving_to_private_ip_is_rejected(monkeypatch):
    monkeypatch.setattr("oss.src.core.webhooks.utils._WEBHOOK_ALLOW_INSECURE", False)
    monkeypatch.setattr(
        "oss.src.core.webhooks.utils.socket.getaddrinfo",
        lambda *a, **kw: [(None, None, None, None, ("192.168.1.100", 0))],
    )
    with pytest.raises(ValueError, match="blocked IP"):
        validate_webhook_url("https://internal.example.com/hook")


def test_hostname_resolving_to_public_ip_is_accepted(monkeypatch):
    monkeypatch.setattr("oss.src.core.webhooks.utils._WEBHOOK_ALLOW_INSECURE", False)
    monkeypatch.setattr(
        "oss.src.core.webhooks.utils.socket.getaddrinfo",
        lambda *a, **kw: [(None, None, None, None, ("93.184.216.34", 0))],
    )
    # Should not raise
    validate_webhook_url("https://example.com/hook")


# ---------------------------------------------------------------------------
# resolve_validated_webhook_ip — same validation, plus the literal IP to pin
# ---------------------------------------------------------------------------


def test_resolve_returns_the_literal_ip_for_a_hostname(monkeypatch):
    monkeypatch.setattr("oss.src.core.webhooks.utils._WEBHOOK_ALLOW_INSECURE", False)
    monkeypatch.setattr(
        "oss.src.core.webhooks.utils.socket.getaddrinfo",
        lambda *a, **kw: [(None, None, None, None, ("93.184.216.34", 0))],
    )
    assert resolve_validated_webhook_ip("https://example.com/hook") == "93.184.216.34"


def test_resolve_returns_the_ip_itself_for_an_ip_literal_url(monkeypatch):
    monkeypatch.setattr("oss.src.core.webhooks.utils._WEBHOOK_ALLOW_INSECURE", False)
    assert resolve_validated_webhook_ip("https://93.184.216.34/hook") == "93.184.216.34"


def test_resolve_rejects_blocked_ip_before_pinning(monkeypatch):
    monkeypatch.setattr("oss.src.core.webhooks.utils._WEBHOOK_ALLOW_INSECURE", False)
    monkeypatch.setattr(
        "oss.src.core.webhooks.utils.socket.getaddrinfo",
        lambda *a, **kw: [(None, None, None, None, ("10.0.0.5", 0))],
    )
    with pytest.raises(ValueError, match="blocked IP"):
        resolve_validated_webhook_ip("https://internal.example.com/hook")


# ---------------------------------------------------------------------------
# Default posture — allow_insecure defaults to True (permissive, zero-config self-host)
# ---------------------------------------------------------------------------


def test_allow_insecure_defaults_true(monkeypatch):
    from oss.src.utils import env

    monkeypatch.delenv("AGENTA_INSECURE_EGRESS_ALLOWED", raising=False)
    monkeypatch.delenv("AGENTA_WEBHOOKS_ALLOW_INSECURE", raising=False)
    monkeypatch.delenv("AGENTA_WEBHOOK_ALLOW_INSECURE", raising=False)
    try:
        importlib.reload(env)
        assert env.WebhooksConfig().allow_insecure is True
    finally:
        importlib.reload(env)


def test_allow_insecure_canonical_env_var(monkeypatch):
    # allow_insecure is a class-level default evaluated at import time; reload to re-run it.
    from oss.src.utils import env

    monkeypatch.setenv("AGENTA_INSECURE_EGRESS_ALLOWED", "true")
    monkeypatch.delenv("AGENTA_WEBHOOKS_ALLOW_INSECURE", raising=False)
    monkeypatch.delenv("AGENTA_WEBHOOK_ALLOW_INSECURE", raising=False)
    try:
        importlib.reload(env)
        assert env.WebhooksConfig().allow_insecure is True
    finally:
        monkeypatch.delenv("AGENTA_INSECURE_EGRESS_ALLOWED", raising=False)
        importlib.reload(env)


def test_allow_insecure_legacy_alias_still_honored(monkeypatch):
    from oss.src.utils import env

    monkeypatch.delenv("AGENTA_INSECURE_EGRESS_ALLOWED", raising=False)
    monkeypatch.setenv("AGENTA_WEBHOOKS_ALLOW_INSECURE", "true")
    monkeypatch.delenv("AGENTA_WEBHOOK_ALLOW_INSECURE", raising=False)
    try:
        importlib.reload(env)
        assert env.WebhooksConfig().allow_insecure is True
    finally:
        monkeypatch.delenv("AGENTA_WEBHOOKS_ALLOW_INSECURE", raising=False)
        importlib.reload(env)


def test_allow_insecure_canonical_wins_over_legacy_alias(monkeypatch):
    from oss.src.utils import env

    monkeypatch.setenv("AGENTA_INSECURE_EGRESS_ALLOWED", "false")
    monkeypatch.setenv("AGENTA_WEBHOOKS_ALLOW_INSECURE", "true")
    monkeypatch.delenv("AGENTA_WEBHOOK_ALLOW_INSECURE", raising=False)
    try:
        importlib.reload(env)
        assert env.WebhooksConfig().allow_insecure is False
    finally:
        monkeypatch.delenv("AGENTA_INSECURE_EGRESS_ALLOWED", raising=False)
        monkeypatch.delenv("AGENTA_WEBHOOKS_ALLOW_INSECURE", raising=False)
        importlib.reload(env)
