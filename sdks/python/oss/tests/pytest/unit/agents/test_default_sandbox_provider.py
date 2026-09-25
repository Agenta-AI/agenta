"""A template with no ``sandbox.kind`` runs on the deployment's default provider (QF-A1)."""

import pytest

from agenta.sdk.agents.dtos import AgentTemplate
from agenta.sdk.agents.errors import SandboxNotAllowedError
from agenta.sdk.agents.sandbox_providers import (
    default_sandbox_provider,
    enabled_sandbox_providers,
    run_default_sandbox_provider,
    sandbox_provider_enabled,
)

ENABLED = "AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS"
DEFAULT = "AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER"


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    monkeypatch.delenv(ENABLED, raising=False)
    monkeypatch.delenv(DEFAULT, raising=False)


def test_the_configured_default_wins(monkeypatch):
    monkeypatch.setenv(ENABLED, "daytona,inprocess")
    monkeypatch.setenv(DEFAULT, "daytona")
    config = AgentTemplate.from_params({"agent": {"instructions": "hi"}})
    assert config.sandbox == "daytona"


def test_the_first_enabled_provider_without_a_configured_default(monkeypatch):
    monkeypatch.setenv(ENABLED, "inprocess,daytona")
    assert AgentTemplate().sandbox == "inprocess"


def test_local_when_nothing_is_configured():
    assert AgentTemplate().sandbox == "local"
    assert run_default_sandbox_provider({}) == "local"


def test_a_default_that_is_not_enabled_falls_back_to_the_first_enabled():
    env = {ENABLED: "local", DEFAULT: "daytona"}
    assert run_default_sandbox_provider(env) == "local"


# `inprocess` is enabled wherever `daytona` is, with no setting of its own; who sees it is
# decided by the per-user preference in the web app.


def test_inprocess_follows_daytona():
    assert enabled_sandbox_providers({ENABLED: "daytona"}) == ["daytona", "inprocess"]
    assert enabled_sandbox_providers({ENABLED: "local,daytona"}) == [
        "local",
        "daytona",
        "inprocess",
    ]
    assert sandbox_provider_enabled("inprocess", {ENABLED: "daytona"})


def test_inprocess_needs_daytona():
    assert enabled_sandbox_providers({ENABLED: "local"}) == ["local"]
    assert enabled_sandbox_providers({}) == ["local"]
    assert not sandbox_provider_enabled("inprocess", {ENABLED: "local"})


def test_an_explicit_inprocess_is_kept_as_written():
    assert enabled_sandbox_providers({ENABLED: "daytona,inprocess"}) == [
        "daytona",
        "inprocess",
    ]
    assert enabled_sandbox_providers({ENABLED: "inprocess,daytona"}) == [
        "inprocess",
        "daytona",
    ]


def test_daytona_stays_the_default_of_a_daytona_only_deployment():
    assert run_default_sandbox_provider({ENABLED: "daytona"}) == "daytona"
    env = {ENABLED: "daytona", DEFAULT: "daytona"}
    assert default_sandbox_provider(env) == "daytona"
    assert run_default_sandbox_provider(env) == "daytona"


def test_inprocess_may_be_the_default_with_daytona_alone_listed():
    env = {ENABLED: "daytona", DEFAULT: "inprocess"}
    assert default_sandbox_provider(env) == "inprocess"
    assert run_default_sandbox_provider(env) == "inprocess"


def test_the_refusal_for_inprocess_says_how_it_is_enabled():
    message = SandboxNotAllowedError(sandbox="inprocess").message
    assert "daytona" in message
    assert "'inprocess'" in message


def test_a_bad_registry_does_not_break_parsing():
    assert run_default_sandbox_provider({ENABLED: "nope"}) == "local"


def test_an_explicit_kind_is_kept(monkeypatch):
    monkeypatch.setenv(ENABLED, "daytona,inprocess")
    monkeypatch.setenv(DEFAULT, "daytona")
    config = AgentTemplate.from_params(
        {"agent": {"instructions": "hi", "sandbox": {"kind": "inprocess"}}}
    )
    assert config.sandbox == "inprocess"
