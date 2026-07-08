"""Unit tests for `RunnerConfig.sandbox_local_allowed` (api/oss/src/utils/env.py).

Declarative config only: the value is a class-level default evaluated at import time
(same pattern as `WebhooksConfig.allow_insecure`), so tests reload the module after
setting/clearing the env var. See test_webhooks_utils.py for the precedent this mirrors.
The actual runtime gate lives in services/oss/src/agent/app.py (this env var's canonical
declaration only, not a second live enforcement point in the api service).
"""

import importlib

import pytest


def test_sandbox_local_allowed_defaults_true(monkeypatch):
    monkeypatch.delenv("AGENTA_SANDBOX_LOCAL_ALLOWED", raising=False)
    from oss.src.utils import env

    importlib.reload(env)
    assert env.RunnerConfig().sandbox_local_allowed is True


@pytest.mark.parametrize("value", ["true", "1", "yes", "on"])
def test_sandbox_local_allowed_true_values(monkeypatch, value):
    from oss.src.utils import env

    monkeypatch.setenv("AGENTA_SANDBOX_LOCAL_ALLOWED", value)
    try:
        importlib.reload(env)
        assert env.RunnerConfig().sandbox_local_allowed is True
    finally:
        monkeypatch.delenv("AGENTA_SANDBOX_LOCAL_ALLOWED", raising=False)
        importlib.reload(env)


@pytest.mark.parametrize("value", ["false", "0", "no", "off"])
def test_sandbox_local_allowed_false_values(monkeypatch, value):
    from oss.src.utils import env

    monkeypatch.setenv("AGENTA_SANDBOX_LOCAL_ALLOWED", value)
    try:
        importlib.reload(env)
        assert env.RunnerConfig().sandbox_local_allowed is False
    finally:
        monkeypatch.delenv("AGENTA_SANDBOX_LOCAL_ALLOWED", raising=False)
        importlib.reload(env)


def test_sandbox_local_allowed_true_when_unset_after_reload(monkeypatch):
    from oss.src.utils import env

    monkeypatch.delenv("AGENTA_SANDBOX_LOCAL_ALLOWED", raising=False)
    try:
        importlib.reload(env)
        assert env.RunnerConfig().sandbox_local_allowed is True
    finally:
        importlib.reload(env)


def test_sandbox_runner_defaults_local_when_unset(monkeypatch):
    from oss.src.utils import env

    monkeypatch.delenv("AGENTA_SERVICES_CODE_SANDBOX_RUNNER", raising=False)
    monkeypatch.delenv("AGENTA_SERVICES_SANDBOX_RUNNER", raising=False)
    try:
        importlib.reload(env)
        assert env.ServicesCodeConfig().sandbox_runner == "local"
    finally:
        importlib.reload(env)


def test_sandbox_runner_honors_explicit_restricted(monkeypatch):
    from oss.src.utils import env

    monkeypatch.setenv("AGENTA_SERVICES_CODE_SANDBOX_RUNNER", "restricted")
    try:
        importlib.reload(env)
        assert env.ServicesCodeConfig().sandbox_runner == "restricted"
    finally:
        monkeypatch.delenv("AGENTA_SERVICES_CODE_SANDBOX_RUNNER", raising=False)
        importlib.reload(env)
