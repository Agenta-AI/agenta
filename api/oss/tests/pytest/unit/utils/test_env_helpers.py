"""Startup validation for a misconfiguration the runtime cannot report itself.

A deployment using write-only secrets needs a platform runtime key, or runs cannot read
the secrets they were authorized to use. That failure surfaces as advice about provider
keys, which is right for a standalone run and useless here, so it has to be said at boot.
"""

import pytest
import oss.src.utils.env as env_module

from oss.src.utils.env import env
from oss.src.utils.helpers import validate_platform_runtime_key


def _configure(monkeypatch, *, runtime_key):
    monkeypatch.setattr(env.agenta, "services_internal_key", runtime_key)


@pytest.mark.parametrize("runtime_key", ["", "replace-me"])
def test_deployments_without_a_runtime_key_fail_startup(monkeypatch, runtime_key):
    _configure(monkeypatch, runtime_key=runtime_key)

    with pytest.raises(RuntimeError, match="AGENTA_SERVICES_INTERNAL_KEY"):
        validate_platform_runtime_key()


def test_a_configured_deployment_passes_validation(monkeypatch):
    _configure(monkeypatch, runtime_key="a-real-runtime-key")

    validate_platform_runtime_key()


def test_the_validation_does_not_depend_on_a_feature_gate(monkeypatch):
    _configure(monkeypatch, runtime_key="")

    with pytest.raises(RuntimeError, match="AGENTA_SERVICES_INTERNAL_KEY"):
        validate_platform_runtime_key()


def test_runtime_key_does_not_fall_back_to_the_admin_key(monkeypatch):
    monkeypatch.delenv("AGENTA_SERVICES_INTERNAL_KEY", raising=False)
    monkeypatch.setenv("AGENTA_AUTH_KEY", "administrator-key")

    assert env_module._services_internal_key_from_environment() is None


@pytest.mark.parametrize(
    ("configured", "expected"),
    [
        (None, None),
        ("", None),
        ("   ", None),
        ("replace-me", None),
        ("  runtime-key  ", "runtime-key"),
    ],
)
def test_runtime_key_configuration_is_normalized(monkeypatch, configured, expected):
    if configured is None:
        monkeypatch.delenv("AGENTA_SERVICES_INTERNAL_KEY", raising=False)
    else:
        monkeypatch.setenv("AGENTA_SERVICES_INTERNAL_KEY", configured)

    assert env_module._services_internal_key_from_environment() == expected
