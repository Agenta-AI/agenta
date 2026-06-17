"""Local environment: run the harness as a subprocess on this host.

This is the parity baseline. The Node process is the run environment. A sandbox
environment (Daytona) is selected on the rivet path inside the TypeScript runner, so it
does not need a separate Python ``Environment`` here.
"""

from __future__ import annotations

import asyncio
from typing import Dict, Optional, Sequence

from agenta.sdk.utils.logging import get_module_logger

from .ports import Environment, ExecResult

log = get_module_logger(__name__)


class LocalEnvironment(Environment):
    """Run a command as a subprocess on this host, feeding it the request on stdin."""

    async def exec(
        self,
        command: Sequence[str],
        input_bytes: bytes,
        *,
        cwd: Optional[str] = None,
        env: Optional[Dict[str, str]] = None,
        timeout: Optional[float] = None,
    ) -> ExecResult:
        proc = await asyncio.create_subprocess_exec(
            *command,
            cwd=cwd,
            env=env,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(input=input_bytes),
                timeout=timeout,
            )
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            raise RuntimeError(
                f"Harness process timed out after {timeout}s: {' '.join(command)}"
            )

        return ExecResult(
            code=proc.returncode if proc.returncode is not None else 0,
            stdout=stdout.decode("utf-8", "replace"),
            stderr=stderr.decode("utf-8", "replace"),
        )
