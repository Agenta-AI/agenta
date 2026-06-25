"""Unit tests for the SDK platform connection (base URL + per-call authorization)."""

from __future__ import annotations

import pytest

from agenta.sdk.agents.platform import PlatformConnection, default_timeout
from agenta.sdk.agents.platform.connection import DEFAULT_TOOLS_TIMEOUT

# Env vars the connection reads; cleared per test so the host environment can't leak in.
_ENV_VARS = (
    "AGENTA_API_URL",
    "AGENTA_API_KEY",
)


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    """Start each test from a known-empty config, with no ambient request credential."""
    for name in _ENV_VARS:
        monkeypatch.delenv(name, raising=False)
    # No per-request tracing context by default; tests opt in explicitly.
    monkeypatch.setattr(
        "agenta.sdk.engines.tracing.propagation.inject",
        lambda carrier: carrier,
    )


# --- timeout ---------------------------------------------------------------


def test_timeout_is_fixed_default():
    # The backend round-trip budget is a fixed constant, not env-configurable.
    assert default_timeout() == DEFAULT_TOOLS_TIMEOUT
    assert PlatformConnection().timeout == DEFAULT_TOOLS_TIMEOUT


def test_explicit_timeout_wins():
    assert PlatformConnection(timeout=12.0).timeout == 12.0


# --- base URL --------------------------------------------------------------


def test_base_url_explicit_overrides_everything(monkeypatch):
    monkeypatch.setenv("AGENTA_API_URL", "https://env.example/api")
    conn = PlatformConnection(base_url="https://explicit.example/api/")
    assert conn.base_url() == "https://explicit.example/api"  # trailing slash trimmed


def test_base_url_from_api_url_env(monkeypatch):
    monkeypatch.setenv("AGENTA_API_URL", "https://api.example/api/")
    assert PlatformConnection().base_url() == "https://api.example/api"


def test_base_url_none_when_unconfigured():
    # No env, and a bare SDK has no configured OTLP endpoint to derive from.
    assert PlatformConnection().base_url() is None


# --- authorization (per call, never cached) --------------------------------


def test_authorization_explicit_wins(monkeypatch):
    monkeypatch.setenv("AGENTA_API_KEY", "envkey")
    assert PlatformConnection(authorization="Bearer x").authorization() == "Bearer x"


def test_authorization_from_request_context(monkeypatch):
    # The caller's Authorization rides on the tracing propagation, per request.
    monkeypatch.setattr(
        "agenta.sdk.engines.tracing.propagation.inject",
        lambda carrier: {**carrier, "Authorization": "Bearer caller"},
    )
    monkeypatch.setenv(
        "AGENTA_API_KEY", "envkey"
    )  # context must win over the env fallback
    assert PlatformConnection().authorization() == "Bearer caller"


def test_authorization_falls_back_to_process_api_key(monkeypatch):
    monkeypatch.setenv("AGENTA_API_KEY", "envkey")
    assert PlatformConnection().authorization() == "ApiKey envkey"


def test_authorization_none_when_nothing_available():
    assert PlatformConnection().authorization() is None


def test_authorization_resolved_per_call_not_cached(monkeypatch):
    # A long-lived connection must reflect the current caller, not a value frozen at init.
    conn = PlatformConnection()
    monkeypatch.setenv("AGENTA_API_KEY", "first")
    assert conn.authorization() == "ApiKey first"
    monkeypatch.setenv("AGENTA_API_KEY", "second")
    assert conn.authorization() == "ApiKey second"


# --- headers ---------------------------------------------------------------


def test_headers_include_auth_when_present(monkeypatch):
    monkeypatch.setenv("AGENTA_API_KEY", "k")
    headers = PlatformConnection().headers()
    assert headers["Content-Type"] == "application/json"
    assert headers["Authorization"] == "ApiKey k"


def test_headers_omit_auth_when_absent():
    headers = PlatformConnection().headers()
    assert "Authorization" not in headers
    assert headers["Content-Type"] == "application/json"


def test_headers_can_skip_content_type():
    assert "Content-Type" not in PlatformConnection().headers(json=False)


def test_headers_reuse_explicit_authorization(monkeypatch):
    # An explicit authorization is reused verbatim, not re-resolved from context/env.
    monkeypatch.setenv("AGENTA_API_KEY", "envkey")
    headers = PlatformConnection().headers(authorization="Bearer pinned")
    assert headers["Authorization"] == "Bearer pinned"
