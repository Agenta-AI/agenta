"""Unit tests for core/webhooks/utils.py — validate_webhook_url.

Pure function, no network required for IP-based cases.
DNS-dependent cases use a monkeypatched socket.getaddrinfo.
"""

import pytest

from oss.src.core.webhooks import utils as webhook_utils
from oss.src.core.webhooks.utils import validate_webhook_url


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
    monkeypatch.setattr(webhook_utils.env.webhooks, "allow_insecure", True)
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
    monkeypatch.setattr(webhook_utils.env.webhooks, "allow_insecure", False)
    with pytest.raises(ValueError):
        validate_webhook_url(url)


def test_secure_mode_accepts_public_ip(monkeypatch):
    monkeypatch.setattr(webhook_utils.env.webhooks, "allow_insecure", False)
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
    monkeypatch.setattr(webhook_utils.env.webhooks, "allow_insecure", True)
    # Should not raise
    validate_webhook_url(url)


# ---------------------------------------------------------------------------
# Hostname DNS path — monkeypatched getaddrinfo, no real network needed
# ---------------------------------------------------------------------------


def test_unresolvable_hostname_raises(monkeypatch):
    import socket

    monkeypatch.setattr(webhook_utils.env.webhooks, "allow_insecure", False)
    monkeypatch.setattr(
        "oss.src.core.webhooks.utils.socket.getaddrinfo",
        lambda *a, **kw: (_ for _ in ()).throw(
            socket.gaierror("Name or service not known")
        ),
    )
    with pytest.raises(ValueError, match="could not be resolved"):
        validate_webhook_url("https://this-does-not-exist.invalid/hook")


def test_hostname_resolving_to_private_ip_is_rejected(monkeypatch):
    monkeypatch.setattr(webhook_utils.env.webhooks, "allow_insecure", False)
    monkeypatch.setattr(
        "oss.src.core.webhooks.utils.socket.getaddrinfo",
        lambda *a, **kw: [(None, None, None, None, ("192.168.1.100", 0))],
    )
    with pytest.raises(ValueError, match="blocked IP"):
        validate_webhook_url("https://internal.example.com/hook")


def test_hostname_resolving_to_public_ip_is_accepted(monkeypatch):
    monkeypatch.setattr(webhook_utils.env.webhooks, "allow_insecure", False)
    monkeypatch.setattr(
        "oss.src.core.webhooks.utils.socket.getaddrinfo",
        lambda *a, **kw: [(None, None, None, None, ("93.184.216.34", 0))],
    )
    # Should not raise
    validate_webhook_url("https://example.com/hook")
