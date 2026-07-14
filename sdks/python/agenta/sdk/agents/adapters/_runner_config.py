"""Shared constructor validation for runner-backed adapters."""

from __future__ import annotations

from pathlib import Path
from typing import List, Optional, Sequence

from ..errors import AgentRunnerConfigurationError

DEFAULT_RUNNER_COMMAND = ["pnpm", "exec", "tsx", "src/cli.ts"]
RUNNER_CLI_PATH = Path("src") / "cli.ts"


def resolve_runner_command(
    *,
    backend_name: str,
    url: Optional[str],
    command: Optional[Sequence[str]],
    cwd: Optional[str],
) -> List[str]:
    def _validated_command(raw: Sequence[str]) -> List[str]:
        cmd = list(raw)
        if not cmd:
            raise AgentRunnerConfigurationError(
                f"{backend_name} received an empty command. Pass a non-empty command, "
                "pass url for an HTTP runner, or set cwd to a runner directory containing "
                f"{RUNNER_CLI_PATH.as_posix()}."
            )
        return cmd

    if url:
        return (
            _validated_command(command)
            if command is not None
            else list(DEFAULT_RUNNER_COMMAND)
        )
    if command is not None:
        return _validated_command(command)
    if not cwd:
        raise AgentRunnerConfigurationError(
            f"{backend_name} requires a runner transport: pass url for an HTTP runner, "
            "pass command for a custom subprocess runner, or pass cwd pointing to a "
            f"runner directory containing {RUNNER_CLI_PATH.as_posix()}."
        )

    cli_path = Path(cwd) / RUNNER_CLI_PATH
    if not cli_path.is_file():
        raise AgentRunnerConfigurationError(
            f"{backend_name} could not find runner CLI at {cli_path}. Pass url for an "
            "HTTP runner, pass command for a custom subprocess runner, or set cwd to a "
            f"runner directory containing {RUNNER_CLI_PATH.as_posix()}."
        )

    return list(DEFAULT_RUNNER_COMMAND)
