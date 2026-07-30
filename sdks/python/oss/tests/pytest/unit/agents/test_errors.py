"""Regression test: LocalSandboxNotAllowedError.type must name the refused sandbox
provider, not a hardcoded 'local' slug, so clients branching on `type` see the
provider that was actually rejected."""

from __future__ import annotations

from agenta.sdk.agents.errors import LocalSandboxNotAllowedError


def test_type_slug_reflects_refused_provider() -> None:
    err = LocalSandboxNotAllowedError(sandbox="daytona")
    assert "daytona" in err.type
    assert "local-sandbox-not-allowed" not in err.type


def test_type_slug_defaults_to_local() -> None:
    err = LocalSandboxNotAllowedError()
    assert "local" in err.type


def test_message_names_refused_provider() -> None:
    err = LocalSandboxNotAllowedError(sandbox="daytona")
    assert "daytona" in err.message
    assert "AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS" in err.message


def test_code_is_403() -> None:
    err = LocalSandboxNotAllowedError(sandbox="daytona")
    assert err.code == 403


def test_legacy_type_attribute_still_present() -> None:
    # Backward-compat surface: no current consumer in web/ or sdks/ matches on this
    # directly, but external/downstream code may, so the old slug stays available.
    assert LocalSandboxNotAllowedError.LEGACY_TYPE.endswith("local-sandbox-not-allowed")
