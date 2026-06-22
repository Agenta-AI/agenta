"""``select_backend``: the service always uses the sandbox-agent runner backend."""

from __future__ import annotations

from pathlib import Path

import pytest

from agenta.sdk.agents import (
    AgentRunnerConfigurationError,
    SandboxAgentBackend,
    RunSelection,
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
    # Start every case from a known-empty deployment environment.
    monkeypatch.delenv("AGENTA_AGENT_RUNNER_URL", raising=False)
    monkeypatch.setenv("AGENTA_AGENT_RUNNER_DIR", str(runner_wrapper))


def _sel(harness="pi", sandbox="local"):
    return RunSelection(harness=harness, sandbox=sandbox)


@pytest.mark.parametrize("harness", ["pi", "agenta", "claude"])
def test_all_harnesses_use_sandbox_agent_backend(harness):
    assert isinstance(select_backend(_sel(harness, "local")), SandboxAgentBackend)


def test_non_local_sandbox_is_threaded_through():
    backend = select_backend(_sel("pi", "daytona"))

    assert isinstance(backend, SandboxAgentBackend)
    assert backend._sandbox == "daytona"


def test_runner_url_selects_http_transport(monkeypatch):
    monkeypatch.setenv("AGENTA_AGENT_RUNNER_URL", "http://sandbox-agent:8765")

    backend = select_backend(_sel("pi", "local"))

    assert backend._url == "http://sandbox-agent:8765"


def test_no_runner_url_uses_subprocess_transport():
    # Unset URL means the backend will spawn the runner CLI from a local checkout.
    assert select_backend(_sel("pi", "local"))._url is None


def test_no_runner_url_requires_runner_assets(monkeypatch, tmp_path: Path):
    missing_wrapper = tmp_path / "missing-wrapper"
    missing_wrapper.mkdir()
    monkeypatch.setenv("AGENTA_AGENT_RUNNER_DIR", str(missing_wrapper))

    with pytest.raises(AgentRunnerConfigurationError, match="src/cli.ts"):
        select_backend(_sel("pi", "local"))
