"""``select_backend``: the engine-routing decision.

The harness and sandbox are orthogonal playground choices; this locks how they (plus the
``AGENTA_AGENT_RUNTIME`` deployment override) map to an engine. ``pi`` and ``agenta`` stay on
the in-process Pi backend locally; anything else routes to rivet. The transport (HTTP sidecar
vs subprocess) follows ``AGENTA_AGENT_PI_URL``.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from agenta.sdk.agents import (
    AgentRunnerConfigurationError,
    InProcessPiBackend,
    RivetBackend,
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
    monkeypatch.delenv("AGENTA_AGENT_RUNTIME", raising=False)
    monkeypatch.delenv("AGENTA_AGENT_PI_URL", raising=False)
    monkeypatch.setenv("AGENTA_AGENT_WRAPPER_DIR", str(runner_wrapper))


def _sel(harness="pi", sandbox="local"):
    return RunSelection(harness=harness, sandbox=sandbox)


def test_pi_local_uses_in_process():
    assert isinstance(select_backend(_sel("pi", "local")), InProcessPiBackend)


def test_agenta_local_uses_in_process():
    # Agenta is Pi with an opinion, so it stays on the in-process Pi backend.
    assert isinstance(select_backend(_sel("agenta", "local")), InProcessPiBackend)


def test_claude_routes_to_rivet():
    assert isinstance(select_backend(_sel("claude", "local")), RivetBackend)


def test_non_local_sandbox_routes_to_rivet():
    backend = select_backend(_sel("pi", "daytona"))
    assert isinstance(backend, RivetBackend)
    assert backend._sandbox == "daytona"  # the sandbox axis is threaded through


def test_runtime_override_forces_rivet(monkeypatch):
    monkeypatch.setenv("AGENTA_AGENT_RUNTIME", "rivet")
    assert isinstance(select_backend(_sel("pi", "local")), RivetBackend)


def test_pi_url_selects_http_transport(monkeypatch):
    monkeypatch.setenv("AGENTA_AGENT_PI_URL", "http://agent-pi:8765")
    backend = select_backend(_sel("pi", "local"))
    assert backend._url == "http://agent-pi:8765"


def test_no_pi_url_uses_subprocess_transport():
    # Unset URL means the backend will spawn the runner CLI rather than POST to a sidecar.
    assert select_backend(_sel("pi", "local"))._url is None


def test_no_pi_url_requires_runner_assets(monkeypatch, tmp_path: Path):
    missing_wrapper = tmp_path / "missing-wrapper"
    missing_wrapper.mkdir()
    monkeypatch.setenv("AGENTA_AGENT_WRAPPER_DIR", str(missing_wrapper))

    with pytest.raises(AgentRunnerConfigurationError, match="src/cli.ts"):
        select_backend(_sel("pi", "local"))
