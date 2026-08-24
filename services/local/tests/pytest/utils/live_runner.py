"""Shared fixtures for live-runner integration tests."""

import contextlib
import os
import secrets
import signal
import socket
import subprocess
import time
import urllib.error
import urllib.request
from collections.abc import Iterator
from pathlib import Path

import pytest

LIVE_RUNNER_URL_ENV = "AGENTA_LOCAL_LIVE_RUNNER_URL"
REPO_ROOT = Path(__file__).resolve().parents[5]
RUNNER_DIR = REPO_ROOT / "services" / "runner"


def _runner_install_present() -> bool:
    return (RUNNER_DIR / "node_modules").is_dir() and (RUNNER_DIR / "src").is_dir()


requires_live_runner = pytest.mark.skipif(
    not (os.environ.get(LIVE_RUNNER_URL_ENV) or _runner_install_present()),
    reason=(
        f"set {LIVE_RUNNER_URL_ENV}, or install services/runner "
        "(corepack pnpm install --frozen-lockfile) to run live"
    ),
)


@contextlib.contextmanager
def spawned_live_runner() -> Iterator[str]:
    """Start the source-checkout runner with the plan's env allowlist; yield its URL."""
    token = secrets.token_hex(32)
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    # Explicit allowlist: host vars + the Slice 1 runner variables only.
    env = {
        key: os.environ[key]
        for key in ("PATH", "HOME", "LANG", "LC_ALL", "TERM", "TMPDIR")
        if key in os.environ
    }
    env.update(
        {
            "AGENTA_RUNNER_HOST": "127.0.0.1",
            "AGENTA_RUNNER_PORT": str(port),
            "AGENTA_RUNNER_TOKEN": token,
            "AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS": "local",
            "AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER": "local",
            "AGENTA_SESSIONS_RECONSTRUCT": "false",
            "AGENTA_RUNNER_SESSION_KEEPALIVE": "off",
        }
    )
    process = subprocess.Popen(
        [str(RUNNER_DIR / "node_modules" / ".bin" / "tsx"), "src/server.ts"],
        cwd=str(RUNNER_DIR),
        env=env,
        start_new_session=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    url = f"http://127.0.0.1:{port}"
    try:
        deadline = time.monotonic() + 30
        while True:
            try:
                with urllib.request.urlopen(f"{url}/health", timeout=2) as response:
                    if response.status == 200:
                        break
            except (urllib.error.URLError, OSError):
                pass
            if process.poll() is not None or time.monotonic() > deadline:
                raise RuntimeError("live runner did not become healthy in time")
            time.sleep(0.25)
        request = urllib.request.Request(f"{url}/subscription-status")
        request.add_header("Authorization", f"Bearer {token}")
        with urllib.request.urlopen(request, timeout=5) as response:
            assert response.status == 200  # shared-token readiness before dispatching
        yield url
    finally:
        os.killpg(process.pid, signal.SIGTERM)
        with contextlib.suppress(subprocess.TimeoutExpired):
            process.wait(timeout=10)
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
