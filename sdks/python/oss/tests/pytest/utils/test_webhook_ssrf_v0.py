"""
Unit tests for the SDK evaluator-webhook SSRF guard in
agenta.sdk.engines.running.handlers: _validate_webhook_url (resolve-once +
block-list) and _pin_webhook_url (literal-IP pin closing the TOCTOU).
"""

import importlib
from unittest.mock import patch

import pytest

from agenta.sdk.workflows import handlers as hook_handlers
from agenta.sdk.workflows.handlers import (
    _HOOK_ALLOW_INSECURE,
    _pin_webhook_url,
    _validate_webhook_url,
)


def test_allow_insecure_defaults_false():
    assert _HOOK_ALLOW_INSECURE is False


def test_allow_insecure_canonical_env_var(monkeypatch):
    # _HOOK_ALLOW_INSECURE is resolved once at import time; reload to re-run resolution.
    monkeypatch.setenv("AGENTA_INSECURE_EGRESS_ALLOWED", "true")
    monkeypatch.delenv("AGENTA_SERVICES_HOOK_ALLOW_INSECURE", raising=False)
    monkeypatch.delenv("AGENTA_WEBHOOKS_ALLOW_INSECURE", raising=False)
    monkeypatch.delenv("AGENTA_WEBHOOK_ALLOW_INSECURE", raising=False)
    try:
        importlib.reload(hook_handlers)
        assert hook_handlers._HOOK_ALLOW_INSECURE is True
    finally:
        monkeypatch.delenv("AGENTA_INSECURE_EGRESS_ALLOWED", raising=False)
        importlib.reload(hook_handlers)


def test_allow_insecure_legacy_alias_still_honored(monkeypatch):
    monkeypatch.delenv("AGENTA_INSECURE_EGRESS_ALLOWED", raising=False)
    monkeypatch.setenv("AGENTA_SERVICES_HOOK_ALLOW_INSECURE", "true")
    monkeypatch.delenv("AGENTA_WEBHOOKS_ALLOW_INSECURE", raising=False)
    monkeypatch.delenv("AGENTA_WEBHOOK_ALLOW_INSECURE", raising=False)
    try:
        importlib.reload(hook_handlers)
        assert hook_handlers._HOOK_ALLOW_INSECURE is True
    finally:
        monkeypatch.delenv("AGENTA_SERVICES_HOOK_ALLOW_INSECURE", raising=False)
        importlib.reload(hook_handlers)


class TestValidateWebhookUrlSecureDefault:
    def test_blocked_loopback_ip_rejected_by_default(self):
        with pytest.raises(ValueError, match="blocked IP"):
            _validate_webhook_url("https://127.0.0.1/hook")

    def test_blocked_private_ip_rejected_by_default(self):
        with pytest.raises(ValueError, match="blocked IP"):
            _validate_webhook_url("https://10.0.0.1/hook")

    def test_blocked_localhost_hostname_rejected_by_default(self):
        with pytest.raises(ValueError, match="not allowed"):
            _validate_webhook_url("https://localhost/hook")

    def test_http_scheme_rejected_by_default(self):
        with pytest.raises(ValueError, match="https"):
            _validate_webhook_url("http://93.184.216.34/hook")

    def test_public_ip_accepted_and_returned_literally(self):
        assert _validate_webhook_url("https://93.184.216.34/hook") == "93.184.216.34"

    def test_hostname_resolving_to_private_ip_rejected(self):
        with patch(
            "agenta.sdk.workflows.handlers.socket.getaddrinfo",
            return_value=[(None, None, None, None, ("192.168.1.100", 0))],
        ):
            with pytest.raises(ValueError, match="blocked IP"):
                _validate_webhook_url("https://internal.example.com/hook")

    def test_hostname_resolving_to_public_ip_returns_literal(self):
        with patch(
            "agenta.sdk.workflows.handlers.socket.getaddrinfo",
            return_value=[(None, None, None, None, ("93.184.216.34", 0))],
        ):
            assert _validate_webhook_url("https://example.com/hook") == "93.184.216.34"


class TestValidateWebhookUrlInsecureMode:
    def test_private_ip_allowed_when_insecure(self):
        with patch("agenta.sdk.workflows.handlers._HOOK_ALLOW_INSECURE", True):
            assert _validate_webhook_url("http://127.0.0.1/hook") == "127.0.0.1"


class TestPinWebhookUrl:
    def test_pin_swaps_host_for_literal_ip(self):
        pinned, hostname = _pin_webhook_url("https://example.com/hook", "93.184.216.34")
        assert pinned == "https://93.184.216.34/hook"
        assert hostname == "example.com"

    def test_pin_preserves_port(self):
        pinned, hostname = _pin_webhook_url(
            "https://example.com:8443/hook", "93.184.216.34"
        )
        assert pinned == "https://93.184.216.34:8443/hook"
        assert hostname == "example.com"

    def test_pin_brackets_ipv6_literal(self):
        pinned, hostname = _pin_webhook_url(
            "https://example.com/hook", "2606:2800:220:1:248:1893:25c8:1946"
        )
        assert pinned == "https://[2606:2800:220:1:248:1893:25c8:1946]/hook"
        assert hostname == "example.com"
