"""Unit tests for the API-side sandbox-provider registry parser (api/oss/src/utils/env.py).

The API reimplements the runner's `AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS` /
`AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER` parsing so its provider pre-filter matches the
runner's final authority. These cases mirror the runner's TypeScript parser tests
(runner-selfhosting-cleanup/qa.md section 2) so both readers agree on every input.
"""

import importlib

import pytest

from oss.src.utils import env


# --- Parser rules (pure functions, no env) -------------------------------------- #


def test_enabled_unset_gives_local():
    assert env._parse_enabled_sandbox_providers(None) == ["local"]


def test_enabled_explicit_pair_is_set_equal_order_independent():
    a = env._parse_enabled_sandbox_providers("local,daytona")
    b = env._parse_enabled_sandbox_providers("daytona,local")
    assert sorted(a) == sorted(b) == ["daytona", "local"]


def test_enabled_normalizes_whitespace_and_case():
    assert env._parse_enabled_sandbox_providers("  LOCAL , Daytona ") == [
        "local",
        "daytona",
    ]


@pytest.mark.parametrize("raw", ["", "   "])
def test_enabled_explicit_empty_fails(raw):
    with pytest.raises(ValueError):
        env._parse_enabled_sandbox_providers(raw)


def test_enabled_duplicate_fails():
    with pytest.raises(ValueError):
        env._parse_enabled_sandbox_providers("local,local")


def test_enabled_unknown_fails():
    with pytest.raises(ValueError):
        env._parse_enabled_sandbox_providers("local,e2b")


def test_default_unset_gives_local():
    assert env._parse_default_sandbox_provider(None, ["local"]) == "local"


def test_default_outside_enabled_fails():
    with pytest.raises(ValueError):
        env._parse_default_sandbox_provider("local", ["daytona"])


def test_default_honors_explicit_enabled_value():
    assert (
        env._parse_default_sandbox_provider("daytona", ["local", "daytona"])
        == "daytona"
    )


# --- RunnerConfig integration (default_factory reads the environment) ----------- #


def test_runner_config_defaults_local_when_unset(monkeypatch):
    monkeypatch.delenv("AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS", raising=False)
    monkeypatch.delenv("AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER", raising=False)
    config = env.RunnerConfig()
    assert config.enabled_sandbox_providers == ["local"]
    assert config.default_sandbox_provider == "local"


def test_runner_config_reads_enabled_pair(monkeypatch):
    monkeypatch.setenv("AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS", "local,daytona")
    monkeypatch.setenv("AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER", "daytona")
    config = env.RunnerConfig()
    assert config.enabled_sandbox_providers == ["local", "daytona"]
    assert config.default_sandbox_provider == "daytona"


def test_runner_config_rejects_invalid_enabled(monkeypatch):
    monkeypatch.setenv("AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS", "local,e2b")
    with pytest.raises(Exception):
        env.RunnerConfig()


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


@pytest.mark.parametrize(
    "configured, expected", [(None, True), ("", True), ("true", True), ("false", False)]
)
def test_session_features_default_on_and_honor_overrides(
    monkeypatch, configured, expected
):
    try:
        with monkeypatch.context() as context:
            for name in (
                "AGENTA_SESSIONS_SHARED_READER",
                "AGENTA_SESSIONS_SEQUENCE_WRITES",
            ):
                if configured is None:
                    context.delenv(name, raising=False)
                else:
                    context.setenv(name, configured)
            importlib.reload(env)
            config = env.SessionsRedisConfig()
            assert config.shared_reader is expected
            assert config.sequence_writes is expected
    finally:
        importlib.reload(env)
