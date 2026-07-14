"""The runner streaming transports treat ``AGENTA_RUNNER_TIMEOUT_SECONDS`` as an IDLE timeout.

The env var means the same thing on both streaming transports: it bounds the gap between
successive records (resets on each record), never the whole run. The runner owns the true
end-to-end deadline server-side, so a long-but-progressing run must not be killed here — only a
stalled connection with no records flowing should trip. These tests pin that unified semantics:
a stream that keeps producing records within each idle window survives past the window in total,
while a genuine stall raises.
"""

from __future__ import annotations

import asyncio
import json
from typing import List, Optional

import pytest

from agenta.sdk.agents.utils import ts_runner


class _FakeStdout:
    """A fake ``proc.stdout`` whose ``readline`` returns queued lines on a schedule.

    Each entry is ``(delay_seconds, line_bytes)``; ``readline`` sleeps ``delay`` before
    returning the line, so ``asyncio.wait_for(readline(), timeout=...)`` sees a real gap and
    trips only when a single gap exceeds the timeout. A trailing ``b""`` line signals EOF.
    """

    def __init__(self, script: List[tuple]) -> None:
        self._script = list(script)

    async def readline(self) -> bytes:
        if not self._script:
            return b""
        delay, line = self._script.pop(0)
        if delay:
            await asyncio.sleep(delay)
        return line


class _FakeStderr:
    async def read(self, _n: int = 65536) -> bytes:
        return b""


class _FakeProc:
    def __init__(self, stdout: _FakeStdout) -> None:
        self.stdin = _FakeStdin()
        self.stdout = stdout
        self.stderr = _FakeStderr()
        self.returncode: Optional[int] = None

    async def wait(self) -> int:
        self.returncode = 0
        return 0

    def kill(self) -> None:
        self.returncode = -9


class _FakeStdin:
    def write(self, _data: bytes) -> None:
        pass

    def close(self) -> None:
        pass


def _install_fake_subprocess(monkeypatch, script: List[tuple]) -> None:
    async def _create(*_args, **_kwargs):
        return _FakeProc(_FakeStdout(script))

    monkeypatch.setattr(asyncio, "create_subprocess_exec", _create)


async def _collect_subprocess(timeout: float) -> List[dict]:
    records = []
    async for record in ts_runner.deliver_subprocess_stream(
        ["runner"], {"harness": "pi_core"}, timeout=timeout
    ):
        records.append(record)
    return records


# --- subprocess transport: idle (per-record) timeout ------------------------------


async def test_subprocess_stream_survives_a_run_longer_than_the_idle_window(
    monkeypatch,
):
    # Three records, each arriving 0.05s apart, with a 0.1s idle window. The total (0.15s+)
    # exceeds the window, but no single gap does — an idle timeout must NOT fire.
    result_line = json.dumps({"kind": "result", "result": {"ok": True}}).encode()
    _install_fake_subprocess(
        monkeypatch,
        [
            (0.05, json.dumps({"kind": "event", "event": {}}).encode() + b"\n"),
            (0.05, json.dumps({"kind": "event", "event": {}}).encode() + b"\n"),
            (0.05, result_line + b"\n"),
        ],
    )

    records = await _collect_subprocess(timeout=0.1)

    assert [r["kind"] for r in records] == ["event", "event", "result"]


async def test_subprocess_stream_raises_on_a_stall_longer_than_the_idle_window(
    monkeypatch,
):
    # One record arrives quickly, then a gap longer than the idle window: the transport must
    # trip on the stall rather than hang.
    _install_fake_subprocess(
        monkeypatch,
        [
            (0.0, json.dumps({"kind": "event", "event": {}}).encode() + b"\n"),
            (
                0.3,
                json.dumps({"kind": "result", "result": {"ok": True}}).encode() + b"\n",
            ),
        ],
    )

    with pytest.raises(RuntimeError, match="stalled"):
        await _collect_subprocess(timeout=0.1)


# --- HTTP transport: the timeout is handed to httpx as a per-read (idle) bound ----


async def test_http_stream_passes_timeout_to_httpx_client(monkeypatch):
    import httpx

    # The runner token is required on every call; this test is about the timeout, not auth.
    monkeypatch.setenv("AGENTA_RUNNER_TOKEN", "test-token")

    captured = {}

    class _Stream:
        def __init__(self) -> None:
            self.status_code = 200

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def aiter_lines(self):
            yield json.dumps({"kind": "result", "result": {"ok": True}})

        async def aread(self) -> bytes:
            return b""

    class _Client:
        def __init__(self, *args, **kwargs) -> None:
            captured["timeout"] = kwargs.get("timeout")

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        def stream(self, method, url, json=None, headers=None):
            return _Stream()

    monkeypatch.setattr(httpx, "AsyncClient", _Client)

    records = [
        record
        async for record in ts_runner.deliver_http_stream(
            "http://runner:8765", {"harness": "pi_core"}, timeout=7.5
        )
    ]

    assert records == [{"kind": "result", "result": {"ok": True}}]
    # The idle bound is handed to httpx, which applies it per-read on the stream.
    assert captured["timeout"] == 7.5
