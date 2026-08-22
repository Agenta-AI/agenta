"""Startup warnings that name a misconfiguration the runtime cannot report itself.

A deployment using write-only secrets needs a platform runtime key, or runs cannot read
the secrets they were authorized to use. That failure surfaces as advice about provider
keys, which is right for a standalone run and useless here, so it has to be said at boot.
"""

import pytest
import oss.src.utils.env as env_module

from oss.src.utils.env import env
from oss.src.utils.helpers import warn_unconfigured_platform_runtime_key


@pytest.fixture(name="warnings")
def _warnings(monkeypatch):
    recorded: list = []

    monkeypatch.setattr(
        "oss.src.utils.helpers.log",
        type("_Log", (), {"warning": staticmethod(lambda msg: recorded.append(msg))})(),
    )
    return recorded


def _configure(monkeypatch, *, runtime_key):
    monkeypatch.setattr(env.agenta, "services_internal_key", runtime_key)


@pytest.mark.parametrize("runtime_key", ["", "replace-me"])
def test_deployments_without_a_runtime_key_are_warned(
    warnings, monkeypatch, runtime_key
):
    _configure(monkeypatch, runtime_key=runtime_key)

    warn_unconfigured_platform_runtime_key()

    assert len(warnings) == 1
    assert "AGENTA_SERVICES_INTERNAL_KEY" in warnings[0]


def test_a_configured_deployment_is_not_warned(warnings, monkeypatch):
    _configure(monkeypatch, runtime_key="a-real-runtime-key")

    warn_unconfigured_platform_runtime_key()

    assert warnings == []


def test_the_warning_does_not_depend_on_a_feature_gate(warnings, monkeypatch):
    _configure(monkeypatch, runtime_key="")

    warn_unconfigured_platform_runtime_key()

    assert len(warnings) == 1
    assert "AGENTA_SERVICES_INTERNAL_KEY" in warnings[0]


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
