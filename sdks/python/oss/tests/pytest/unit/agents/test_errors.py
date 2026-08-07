"""Regression tests for LocalSandboxNotAllowedError.

The error type slug is provider-neutral and remains identical regardless
of which sandbox provider was rejected. The provider name is carried in
the human-readable message.
"""

from __future__ import annotations

from agenta.sdk.agents.errors import (
    ERRORS_BASE_URL,
    LocalSandboxNotAllowedError,
)


def test_type_slug_is_provider_neutral() -> None:
    local_err = LocalSandboxNotAllowedError(sandbox="local")
    daytona_err = LocalSandboxNotAllowedError(sandbox="daytona")

    expected = f"{ERRORS_BASE_URL}#v0:agent:sandbox-provider-not-allowed"

    assert local_err.type == expected
    assert daytona_err.type == expected
    assert local_err.type == daytona_err.type


def test_message_names_refused_provider() -> None:
    err = LocalSandboxNotAllowedError(sandbox="daytona")

    assert "daytona" in err.message
    assert "AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS" in err.message


def test_code_is_403() -> None:
    err = LocalSandboxNotAllowedError(sandbox="daytona")

    assert err.code == 403
