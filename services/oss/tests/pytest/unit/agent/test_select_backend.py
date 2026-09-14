"""``select_backend``: the service always uses the sandbox-agent runner backend."""

from __future__ import annotations

from pathlib import Path

import pytest

from agenta.sdk.agents import (
    AgentTemplate,
    AgentRunnerConfigurationError,
    SandboxAgentBackend,
    SandboxNotAllowedError,
)

from oss.src.agent.app import select_backend


@pytest.fixture
def runner_wrapper(tmp_path: Path) -> Path:
    cli = tmp_path / "src" / "cli.ts"
    cli.parent.mkdir()
    cli.write_text("console.log('runner')\n", encoding="utf-8")
    return tmp_path


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch, runner_wrapper: Path):
    # Start every case from a known deployment environment. These tests exercise
    # transport/harness selection, so enable both providers; the enabled-provider gate has
    # its own tests below.
    monkeypatch.delenv("AGENTA_RUNNER_INTERNAL_URL", raising=False)
    monkeypatch.setenv("AGENTA_RUNNER_DIR", str(runner_wrapper))
    monkeypatch.setenv("AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS", "local,daytona")


def _sel(harness="pi_core", sandbox="local"):
    return AgentTemplate(harness=harness, sandbox=sandbox)


@pytest.mark.parametrize("harness", ["pi_core", "pi_agenta", "claude", "codex", "mock"])
def test_all_harnesses_use_sandbox_agent_backend(harness):
    assert isinstance(select_backend(_sel(harness, "local")), SandboxAgentBackend)


def test_non_local_sandbox_is_threaded_through():
    backend = select_backend(_sel("pi_core", "daytona"))

    assert isinstance(backend, SandboxAgentBackend)
    assert backend._sandbox == "daytona"


def test_runner_url_selects_http_transport(monkeypatch):
    monkeypatch.setenv("AGENTA_RUNNER_INTERNAL_URL", "http://sandbox-agent:8765")

    backend = select_backend(_sel("pi_core", "local"))

    assert backend._url == "http://sandbox-agent:8765"


def test_no_runner_url_uses_subprocess_transport():
    # Unset URL means the backend will spawn the runner CLI from a local checkout.
    assert select_backend(_sel("pi_core", "local"))._url is None


def test_no_runner_url_requires_runner_assets(monkeypatch, tmp_path: Path):
    missing_wrapper = tmp_path / "missing-wrapper"
    missing_wrapper.mkdir()
    monkeypatch.setenv("AGENTA_RUNNER_DIR", str(missing_wrapper))

    with pytest.raises(AgentRunnerConfigurationError, match="src/cli.ts"):
        select_backend(_sel("pi_core", "local"))


# ---------------------------------------------------------------------------
# Enabled-provider gate: a sandbox not in AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS is
# refused before any run. `local` is unconfined host bash, not a tenant boundary.
# ---------------------------------------------------------------------------


def test_local_sandbox_refused_when_not_enabled(monkeypatch):
    monkeypatch.setenv("AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS", "daytona")

    with pytest.raises(SandboxNotAllowedError) as excinfo:
        select_backend(_sel("pi_core", "local"))

    assert "'local'" in excinfo.value.message
    assert excinfo.value.sandbox == "local"
    assert excinfo.value.type.endswith("#v0:agent:sandbox-provider-not-allowed")


def test_local_sandbox_allowed_by_default_when_unset(monkeypatch):
    monkeypatch.delenv("AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS", raising=False)

    backend = select_backend(_sel("pi_core", "local"))

    assert isinstance(backend, SandboxAgentBackend)
    assert backend._sandbox == "local"


def test_local_sandbox_allowed_when_explicitly_enabled(monkeypatch):
    monkeypatch.setenv("AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS", "local")

    backend = select_backend(_sel("pi_core", "local"))

    assert isinstance(backend, SandboxAgentBackend)
    assert backend._sandbox == "local"


def test_daytona_sandbox_allowed_when_enabled(monkeypatch):
    monkeypatch.setenv("AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS", "local,daytona")

    backend = select_backend(_sel("pi_core", "daytona"))

    assert isinstance(backend, SandboxAgentBackend)
    assert backend._sandbox == "daytona"


def test_daytona_sandbox_refused_when_not_enabled(monkeypatch):
    monkeypatch.setenv("AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS", "local")

    with pytest.raises(SandboxNotAllowedError) as excinfo:
        select_backend(_sel("pi_core", "daytona"))

    # The envelope must not claim 'local' when another provider was refused (#5575):
    # the message names the refused provider and the type slug is provider-neutral.
    assert "'daytona'" in excinfo.value.message
    assert excinfo.value.sandbox == "daytona"
    assert excinfo.value.type.endswith("#v0:agent:sandbox-provider-not-allowed")
    assert "local" not in excinfo.value.type
