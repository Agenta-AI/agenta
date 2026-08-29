"""Development defaults for the platform runtime key."""

import oss.src.utils.env as env_module

import pytest


def test_runtime_key_defaults_independently_of_the_admin_key(monkeypatch):
    monkeypatch.delenv("AGENTA_SERVICES_INTERNAL_KEY", raising=False)
    monkeypatch.setenv("AGENTA_AUTH_KEY", "administrator-key")

    assert env_module._services_internal_key_from_environment() == "replace-me"


@pytest.mark.parametrize(
    ("configured", "expected"),
    [
        (None, "replace-me"),
        ("", "replace-me"),
        ("   ", "replace-me"),
        ("replace-me", "replace-me"),
        ("  runtime-key  ", "runtime-key"),
    ],
)
def test_runtime_key_configuration_is_normalized(monkeypatch, configured, expected):
    if configured is None:
        monkeypatch.delenv("AGENTA_SERVICES_INTERNAL_KEY", raising=False)
    else:
        monkeypatch.setenv("AGENTA_SERVICES_INTERNAL_KEY", configured)

    assert env_module._services_internal_key_from_environment() == expected
