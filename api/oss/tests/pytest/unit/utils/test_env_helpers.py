"""Startup warnings that name a misconfiguration the runtime cannot report itself.

A deployment using write-only secrets needs a platform runtime key, or runs cannot read
the secrets they were authorized to use. That failure surfaces as advice about provider
keys, which is right for a standalone run and useless here, so it has to be said at boot.
"""

import pytest

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


def _configure(monkeypatch, *, runtime_key, write_only_default):
    monkeypatch.setattr(env.agenta, "services_internal_key", runtime_key)
    monkeypatch.setattr(env.agenta.vault, "write_only_default", write_only_default)


@pytest.mark.parametrize("runtime_key", ["", "replace-me"])
def test_write_only_deployments_without_a_runtime_key_are_warned(
    warnings, monkeypatch, runtime_key
):
    _configure(monkeypatch, runtime_key=runtime_key, write_only_default=True)

    warn_unconfigured_platform_runtime_key()

    assert len(warnings) == 1
    assert "AGENTA_SERVICES_INTERNAL_KEY" in warnings[0]


def test_a_configured_deployment_is_not_warned(warnings, monkeypatch):
    _configure(monkeypatch, runtime_key="a-real-runtime-key", write_only_default=True)

    warn_unconfigured_platform_runtime_key()

    assert warnings == []


def test_a_deployment_using_no_write_only_secrets_is_not_warned(warnings, monkeypatch):
    # Nothing to read back, so the key buys it nothing and the warning would be noise.
    _configure(monkeypatch, runtime_key="", write_only_default=False)

    warn_unconfigured_platform_runtime_key()

    assert warnings == []
