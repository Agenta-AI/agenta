"""Start/stop a bridge process, on an ephemeral port, in a real subprocess --
never a fixed port, so two parallel runs never collide, and never an
in-process fake, so the signature is verified across a real boundary.
"""

import hashlib
import hmac
import json
import os
import socket
import subprocess
import sys
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, Iterator, Optional

import httpx

# The api/ directory -- four levels up from this file -- so the subprocess
# resolves `-m oss.tests....` the same way pytest's own `pythonpath = .`
# does for the parent process, regardless of the caller's cwd.
_API_ROOT = Path(__file__).resolve().parents[6]

_VERSION = "v0"
SIGNATURE_HEADER = "x-agenta-bridge-signature"
TIMESTAMP_HEADER = "x-agenta-bridge-timestamp"
_READY_TIMEOUT_SECONDS = 10.0
_READY_POLL_INTERVAL_SECONDS = 0.05


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def sign(*, secret: str, timestamp: str, body: bytes) -> Dict[str, str]:
    """The bridge's own signing logic for the inbound direction -- the
    harness plays the bridge author's sending code, exactly as a real
    bridge process would sign a request before posting it to core."""

    signed_bytes = f"{_VERSION}:{timestamp}:".encode("utf-8") + body
    signature = (
        f"{_VERSION}="
        + hmac.new(secret.encode("utf-8"), signed_bytes, hashlib.sha256).hexdigest()
    )
    return {SIGNATURE_HEADER: signature, TIMESTAMP_HEADER: timestamp}


class RunningBridge:
    """A live bridge subprocess: its base URL, its secret, and helpers to
    sign requests for the inbound direction and inspect what it received on
    the outbound one."""

    def __init__(
        self, *, name: str, secret: str, base_url: str, process: subprocess.Popen
    ):
        self.name = name
        self.secret = secret
        self.base_url = base_url
        self.deliver_url = f"{base_url}/deliver"
        self._process = process

    def sign(self, *, timestamp: str, body: bytes) -> Dict[str, str]:
        return sign(secret=self.secret, timestamp=timestamp, body=body)

    async def hello(self) -> Dict[str, Any]:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{self.base_url}/_test/hello")
            response.raise_for_status()
            return response.json()

    async def deliveries(self) -> list:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{self.base_url}/_test/deliveries")
            response.raise_for_status()
            return response.json()["deliveries"]

    def is_alive(self) -> bool:
        return self._process.poll() is None


def _wait_for_readiness(
    base_url: str, *, timeout: float = _READY_TIMEOUT_SECONDS
) -> None:
    """Poll the port -- never sleep a fixed interval and hope."""

    deadline = time.monotonic() + timeout
    last_error: Optional[Exception] = None
    while time.monotonic() < deadline:
        try:
            with httpx.Client(timeout=0.5) as client:
                response = client.get(f"{base_url}/_test/health")
                if response.status_code == 200:
                    return
        except Exception as e:  # connection refused until uvicorn binds
            last_error = e
        time.sleep(_READY_POLL_INTERVAL_SECONDS)
    raise TimeoutError(f"bridge process never became ready: {last_error}")


@contextmanager
def run_bridge(
    *, name: str, secret: str, hello: Dict[str, Any]
) -> Iterator[RunningBridge]:
    """Start one bridge process on an ephemeral port; stop it on exit."""

    port = _free_port()
    base_url = f"http://127.0.0.1:{port}"

    spec = json.dumps({"name": name, "secret": secret, "hello": hello})

    child_env = dict(os.environ)
    child_env["PYTHONPATH"] = os.pathsep.join(
        [str(_API_ROOT), child_env.get("PYTHONPATH", "")]
    )

    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "oss.tests.pytest.acceptance.channels.bridge_process.server",
            "--port",
            str(port),
            "--spec",
            spec,
        ],
        cwd=str(_API_ROOT),
        env=child_env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )

    try:
        _wait_for_readiness(base_url)
        yield RunningBridge(
            name=name, secret=secret, base_url=base_url, process=process
        )
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
