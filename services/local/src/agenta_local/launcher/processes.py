"""Explicit child environments and owned process-group lifecycle."""

from __future__ import annotations

import os
import signal
import subprocess
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

HOST_ENV_NAMES = {
    "PATH",
    "HOME",
    "LANG",
    "LANGUAGE",
    "TMPDIR",
    "TMP",
    "TEMP",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_RUNTIME_DIR",
}


def allowed_host_environment(source: Mapping[str, str]) -> dict[str, str]:
    return {
        name: value
        for name, value in source.items()
        if name in HOST_ENV_NAMES or name.startswith("LC_")
    }


def runner_environment(
    source: Mapping[str, str],
    *,
    port: int,
    token: str,
    node_bin_dir: Path,
    sandbox_agent: Path,
) -> dict[str, str]:
    env = allowed_host_environment(source)
    inherited_path = env.get("PATH", "/usr/bin:/bin")
    env.update(
        {
            "PATH": f"{node_bin_dir}:{inherited_path}",
            "NODE_ENV": "production",
            "npm_config_offline": "true",
            "AGENTA_RUNNER_HOST": "127.0.0.1",
            "AGENTA_RUNNER_PORT": str(port),
            "AGENTA_RUNNER_TOKEN": token,
            "AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS": "local",
            "AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER": "local",
            "AGENTA_SESSIONS_RECONSTRUCT": "false",
            "AGENTA_RUNNER_SESSION_KEEPALIVE": "off",
            "SANDBOX_AGENT_BIN": str(sandbox_agent),
        }
    )
    return env


def service_environment(
    source: Mapping[str, str],
    *,
    host: str,
    port: int,
    data_dir: Path,
    static_dir: Path,
    migrations_dir: Path,
    runner_url: str,
    runner_token: str,
    browser_session: str,
    lock_fd: int,
    site_packages: Path,
) -> dict[str, str]:
    env = allowed_host_environment(source)
    env.setdefault("PATH", "/usr/bin:/bin")
    env.update(
        {
            "PYTHONPATH": str(site_packages),
            "PYTHONNOUSERSITE": "1",
            "PYTHONDONTWRITEBYTECODE": "1",
            "AGENTA_INSECURE_EGRESS_ALLOWED": "true",
            "AGENTA_RUNNER_TOKEN": runner_token,
            "AGENTA_LOCAL_HOST": host,
            "AGENTA_LOCAL_PORT": str(port),
            "AGENTA_LOCAL_DATA_DIR": str(data_dir),
            "AGENTA_LOCAL_STATIC_DIR": str(static_dir),
            "AGENTA_LOCAL_MIGRATIONS_DIR": str(migrations_dir),
            "AGENTA_LOCAL_RUNNER_URL": runner_url,
            "AGENTA_LOCAL_BROWSER_SESSION": browser_session,
            "AGENTA_LOCAL_LOCK_FD": str(lock_fd),
        }
    )
    return env


@dataclass
class ManagedProcess:
    name: str
    process: subprocess.Popen[bytes]
    log_path: Path

    @property
    def pid(self) -> int:
        return self.process.pid

    def poll(self) -> int | None:
        return self.process.poll()


def start_process(
    name: str,
    argv: Sequence[str],
    *,
    cwd: Path,
    env: Mapping[str, str],
    log: BinaryIO,
    log_path: Path,
    pass_fds: Sequence[int] = (),
) -> ManagedProcess:
    if not argv or any(not isinstance(argument, str) for argument in argv):
        raise ValueError("child argv must be a non-empty sequence of strings")
    process = subprocess.Popen(
        list(argv),
        cwd=str(cwd),
        env=dict(env),
        stdin=subprocess.DEVNULL,
        stdout=log,
        stderr=subprocess.STDOUT,
        shell=False,
        start_new_session=True,
        pass_fds=tuple(pass_fds),
    )
    return ManagedProcess(name=name, process=process, log_path=log_path)


def wait_for_exit(process: ManagedProcess, timeout: float) -> bool:
    if process.poll() is not None:
        return True
    try:
        process.process.wait(timeout=timeout)
        return True
    except subprocess.TimeoutExpired:
        return False


def terminate_process_group(
    process: ManagedProcess,
    *,
    terminate_timeout: float,
    kill_timeout: float = 2.0,
) -> None:
    """Signal only the new session whose process-group id is the child pid.

    A dead leader's pgid remains valid while descendants survive, so the
    sweep proceeds even when the leader has already exited.
    """
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    if wait_for_exit(process, terminate_timeout):
        return
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        return
    wait_for_exit(process, kill_timeout)
