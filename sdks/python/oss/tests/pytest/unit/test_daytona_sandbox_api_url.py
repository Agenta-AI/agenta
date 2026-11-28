from types import SimpleNamespace
from unittest.mock import MagicMock

import agenta as ag
import pytest
from agenta.sdk.engines.running.runners import daytona as daytona_module
from agenta.sdk.engines.running.runners.daytona import DaytonaRunner


@pytest.fixture
def runner(monkeypatch):
    monkeypatch.setenv("DAYTONA_API_KEY", "test-key")
    monkeypatch.delenv("DAYTONA_API_URL", raising=False)
    monkeypatch.setenv("DAYTONA_SNAPSHOT", "snap")
    r = DaytonaRunner()
    r.daytona = MagicMock()
    monkeypatch.setattr(r, "_resolve_snapshot_id", lambda force_refresh: "snap-id")
    monkeypatch.setattr(r, "_get_provider_env_vars", dict)
    monkeypatch.setattr(
        daytona_module,
        "_load_daytona",
        lambda: (None, None, None, lambda **kwargs: SimpleNamespace(**kwargs)),
    )
    monkeypatch.setattr(
        daytona_module.RunningContext,
        "get",
        staticmethod(lambda: SimpleNamespace(credentials="ApiKey abc")),
    )
    # The service process talks to the API over the in-network hop.
    monkeypatch.setattr(ag.DEFAULT_AGENTA_SINGLETON_INSTANCE, "host", "http://api:8000")
    monkeypatch.setattr(
        ag.DEFAULT_AGENTA_SINGLETON_INSTANCE, "api_url", "http://api:8000"
    )
    return r


def _sandbox_env(runner):
    runner._create_sandbox()
    return runner.daytona.create.call_args.args[0].env_vars


def test_sandbox_gets_the_public_api_url_not_the_internal_hop(runner, monkeypatch):
    monkeypatch.setenv("AGENTA_API_URL", "https://agenta.example.com/api")

    env = _sandbox_env(runner)

    assert env["AGENTA_API_URL"] == "https://agenta.example.com/api"
    assert env["AGENTA_HOST"] == "https://agenta.example.com"


def test_sandbox_falls_back_to_the_sdk_url_without_a_public_url(runner, monkeypatch):
    monkeypatch.delenv("AGENTA_API_URL", raising=False)

    env = _sandbox_env(runner)

    assert env["AGENTA_API_URL"] == "http://api:8000"
    assert env["AGENTA_HOST"] == "http://api:8000"
