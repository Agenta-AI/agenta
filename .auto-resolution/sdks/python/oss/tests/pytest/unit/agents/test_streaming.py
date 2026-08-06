"""Tests for the live streaming boundary: ``AgentStream`` and the NDJSON subprocess transport.

Two layers:

- ``AgentStream`` over a fake record source — pure, fast: events are yielded live, the terminal
  result is captured, hooks/cleanup fire, and an ``ok:false`` terminal raises.
- ``deliver_subprocess_stream`` against a fake NDJSON emitter — proves records arrive
  incrementally (not buffered then dumped) and that closing the stream kills the child.

A final integration test drives the real ``cli.ts --stream`` when ``pnpm`` is available.

Run: ``uv run pytest oss/tests/pytest/unit/agents/test_streaming.py`` from ``sdks/python``.
"""

from __future__ import annotations

import shutil
import sys
import time
from pathlib import Path
from typing import Any, Dict, List

import pytest

from agenta.sdk.agents import AgentStream
from agenta.sdk.agents.utils import deliver_subprocess_stream


async def _from_list(records: List[Dict[str, Any]]):
    for record in records:
        yield record


# --- AgentStream ---------------------------------------------------------------


async def test_agentrun_yields_events_then_captures_result() -> None:
    seen_result: Dict[str, Any] = {}
    cleaned: List[bool] = []

    async def _cleanup() -> None:
        cleaned.append(True)

    records = [
        {"kind": "event", "event": {"type": "message_start", "id": "m0"}},
        {
            "kind": "event",
            "event": {"type": "message_delta", "id": "m0", "delta": "Hi"},
        },
        {"kind": "event", "event": {"type": "message_end", "id": "m0"}},
        {
            "kind": "result",
            "result": {
                "ok": True,
                "output": "Hi",
                "sessionId": "s1",
                "stopReason": "end_turn",
            },
        },
    ]
    run = AgentStream(_from_list(records))
    run.on_result(lambda r: seen_result.update({"id": r.session_id}))
    run.on_cleanup(_cleanup)

    events = [event async for event in run]

    assert [e.type for e in events] == ["message_start", "message_delta", "message_end"]
    assert run.result().output == "Hi"
    assert run.result().session_id == "s1"
    assert run.result().stop_reason == "end_turn"
    assert seen_result == {"id": "s1"}  # on_result fired with the terminal result
    assert cleaned == [True]  # cleanup ran when iteration ended


async def test_agentrun_raises_on_error_terminal() -> None:
    records = [
        {"kind": "event", "event": {"type": "message_start", "id": "m0"}},
        {"kind": "result", "result": {"ok": False, "error": "boom"}},
    ]
    run = AgentStream(_from_list(records))
    with pytest.raises(RuntimeError, match="boom"):
        async for _ in run:
            pass


async def test_agentrun_result_unavailable_before_drain() -> None:
    run = AgentStream(_from_list([{"kind": "event", "event": {"type": "done"}}]))
    with pytest.raises(RuntimeError, match="not available"):
        run.result()


# --- deliver_subprocess_stream (fake NDJSON emitter) ------------------------

# Emits 3 event lines with a small gap, then one terminal result line. `-u` + flush so the
# parent observes each line as it is written, not at process exit.
_EMITTER = r"""
import sys, time, json
for i in range(3):
    sys.stdout.write(json.dumps({"kind":"event","event":{"type":"message_delta","id":"m","delta":"d%d"%i}})+"\n")
    sys.stdout.flush()
    time.sleep(0.05)
sys.stdout.write(json.dumps({"kind":"result","result":{"ok":True,"output":"d0d1d2","sessionId":"s1"}})+"\n")
sys.stdout.flush()
"""


async def test_subprocess_stream_is_incremental() -> None:
    cmd = [sys.executable, "-u", "-c", _EMITTER]
    stamped = []
    async for record in deliver_subprocess_stream(cmd, {}):
        stamped.append((time.monotonic(), record))

    kinds = [r["kind"] for _, r in stamped]
    assert kinds == ["event", "event", "event", "result"], (
        "events precede the single terminal result"
    )
    assert kinds.count("result") == 1, "exactly one terminal record"
    # Incremental, not buffered-then-dumped: the first event lands well before the result.
    first_event_t = stamped[0][0]
    result_t = stamped[-1][0]
    assert result_t - first_event_t >= 0.1, (
        "records were spread out over time, not delivered in one batch"
    )


# Emits one event, then blocks for a long time. Closing the stream must kill it promptly.
_HANGING_EMITTER = r"""
import sys, time, json
sys.stdout.write(json.dumps({"kind":"event","event":{"type":"message_delta","id":"m","delta":"x"}})+"\n")
sys.stdout.flush()
time.sleep(60)
"""


async def test_subprocess_stream_cancellation_kills_child() -> None:
    cmd = [sys.executable, "-u", "-c", _HANGING_EMITTER]
    agen = deliver_subprocess_stream(cmd, {})
    first = await agen.__anext__()
    assert first["kind"] == "event"

    started = time.monotonic()
    await agen.aclose()  # runs the finally: proc.kill() + await proc.wait()
    elapsed = time.monotonic() - started
    assert elapsed < 5, "aclose() killed the child instead of waiting out its 60s sleep"


# --- Real cli.ts --stream boundary (integration) ----------------------------


@pytest.mark.skipif(shutil.which("pnpm") is None, reason="pnpm not available")
async def test_cli_stream_terminal_only_on_empty_request() -> None:
    agent_dir = Path(__file__).resolve().parents[7] / "services" / "runner"
    cmd = ["pnpm", "exec", "tsx", "src/cli.ts"]
    records = []
    async for record in deliver_subprocess_stream(cmd, {}, cwd=str(agent_dir)):
        records.append(record)

    # An empty request fails before any event, so the stream is exactly one result record.
    assert len(records) == 1, records
    assert records[0]["kind"] == "result"
    assert records[0]["result"]["ok"] is False

    # AgentStream surfaces that failure as a RuntimeError, just like the one-shot path.
    run = AgentStream(deliver_subprocess_stream(cmd, {}, cwd=str(agent_dir)))
    with pytest.raises(RuntimeError):
        async for _ in run:
            pass
