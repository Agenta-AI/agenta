"""Constructor validation for runner-backed backend adapters."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

from agenta.sdk.agents import (
    AgentRunnerConfigurationError,
    InProcessPiBackend,
    RivetBackend,
)


@pytest.fixture
def runner_dir(tmp_path: Path) -> Path:
    cli = tmp_path / "src" / "cli.ts"
    cli.parent.mkdir()
    cli.write_text("console.log('runner')\n", encoding="utf-8")
    return tmp_path


@pytest.mark.parametrize("backend_cls", [InProcessPiBackend, RivetBackend])
def test_default_subprocess_requires_cwd(backend_cls):
    with pytest.raises(AgentRunnerConfigurationError, match="pass cwd"):
        backend_cls()


@pytest.mark.parametrize("backend_cls", [InProcessPiBackend, RivetBackend])
def test_default_subprocess_requires_runner_cli(backend_cls, tmp_path: Path):
    with pytest.raises(AgentRunnerConfigurationError, match="src/cli.ts"):
        backend_cls(cwd=str(tmp_path))


@pytest.mark.parametrize("backend_cls", [InProcessPiBackend, RivetBackend])
def test_default_subprocess_accepts_runner_wrapper_cwd(backend_cls, runner_dir: Path):
    backend = backend_cls(cwd=str(runner_dir))

    assert backend._cwd == str(runner_dir)
    assert backend._command == ["pnpm", "exec", "tsx", "src/cli.ts"]


@pytest.mark.parametrize("backend_cls", [InProcessPiBackend, RivetBackend])
def test_http_transport_does_not_require_runner_wrapper(backend_cls):
    backend = backend_cls(url="http://agent-pi:8765")

    assert backend._url == "http://agent-pi:8765"
    assert backend._command == ["pnpm", "exec", "tsx", "src/cli.ts"]


@pytest.mark.parametrize("backend_cls", [InProcessPiBackend, RivetBackend])
def test_custom_command_does_not_require_runner_wrapper(backend_cls):
    command = [sys.executable, "-m", "runner"]

    backend = backend_cls(command=command)

    assert backend._command == command
    assert backend._cwd is None
