"""Replay real captured QA runs through the actual SDK runtime -- no live LLM.

The agent-workflows QA program (``docs/design/agent-workflows/projects/qa/``) captured 21 real
``/invoke`` request/response pairs against a live deployment. Until this file, nothing replayed
them: every test of the run orchestration exercised only hand-built fakes (``fakeHarness()`` on
the TS side, ``FakeRunnerBackend``'s hand-written echo scripts here), which encode the author's
mental model of the wire rather than a real recorded run. A behavioral regression in the
translation or parsing path could ship silently as long as the hand-built fakes still agreed with
the code that broke.

Each test here loads one ``qa/runs/*.json`` file (never hand-copies its content), builds today's
``SessionConfig``/``AgentTemplate`` from its captured request half (see
``_qa_transcripts.session_config_from_transcript`` for the exact, intentionally-visible field-name
translation), drives it through the real wire + subprocess transport
(``FakeRunnerBackend``, shared with ``test_transport_roundtrip.py``) against a fake runner script
that echoes the transcript's own captured reply, and asserts the folded/parsed result matches.

This proves ``result_from_wire`` / ``AgentStream`` / ``fold`` handle a real recorded shape, not
just the shapes a hand-built fake happens to produce.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

from agenta.sdk.agents import Environment, PiHarness
from agenta.sdk.agents.fold import fold

from ._fake_runner_backend import FakeRunnerBackend
from ._qa_transcripts import (
    load_transcript,
    session_config_from_transcript,
    transcript_messages,
    transcript_reply,
)

pytestmark = [pytest.mark.integration, pytest.mark.cost_free]


# A runner that ignores the real request and echoes back the ONE captured reply -- the
# transcript-driven counterpart to `_ECHO_RUNNER` in test_transport_roundtrip.py, except the
# text comes from a loaded transcript, not a hand-built literal. It speaks BOTH transports the
# real runner CLI does: a single JSON result on stdout normally (`deliver_subprocess_result`,
# what `prompt()` uses), or NDJSON event+result records under `--stream`
# (`deliver_subprocess_stream`, what `stream()`/`AgentStream` uses) -- so one recorded reply can
# replay through either path. `reply` is written as a Python literal (`json.dumps`), so control
# characters in a captured reply stay valid Python source.
_QA_ECHO_RUNNER_SCRIPT = """
import sys, json

reply = json.loads(%(reply_json)s)
req = json.load(sys.stdin)

result = {
    "ok": True,
    "output": reply,
    "messages": [{"role": "assistant", "content": reply}],
    "events": [
        {"type": "message", "text": reply},
        {"type": "done", "stopReason": "end_turn"},
    ],
    "usage": {"input": 1, "output": 1, "total": 2, "cost": 0.0},
    "stopReason": "end_turn",
    "capabilities": {"textMessages": True, "mcpTools": False},
    "sessionId": "sess-qa-replay",
    "model": req.get("model"),
}

if "--stream" in sys.argv:
    for record in (
        {"kind": "event", "event": result["events"][0]},
        {"kind": "event", "event": result["events"][1]},
        {"kind": "result", "result": result},
    ):
        sys.stdout.write(json.dumps(record) + "\\n")
        sys.stdout.flush()
else:
    sys.stdout.write(json.dumps(result))
"""


def _replay_backend(tmp_path: Path, reply: str) -> FakeRunnerBackend:
    """A FakeRunnerBackend whose runner script echoes ``reply`` for both prompt() and stream()."""
    runner = tmp_path / "qa_replay_runner.py"
    script = _QA_ECHO_RUNNER_SCRIPT % {"reply_json": json.dumps(json.dumps(reply))}
    runner.write_text(script, encoding="utf-8")
    return FakeRunnerBackend(command=[sys.executable, str(runner)], cwd=str(tmp_path))


# A runner that captures the /run request it received into `captured_request_path` (as JSON)
# and returns a minimal successful result. Used to assert the SDK actually PUT the recorded
# capability onto the wire, not just that a canned reply parses back -- the request-shaping half
# of the replay, mirroring the DRAFT skill's "assert the request too" step.
_QA_CAPTURE_REQUEST_RUNNER_SCRIPT = """
import sys, json

req = json.load(sys.stdin)
with open(%(capture_path_json)s, "w", encoding="utf-8") as f:
    json.dump(req, f)

result = {
    "ok": True,
    "output": "ok",
    "messages": [{"role": "assistant", "content": "ok"}],
    "events": [{"type": "done", "stopReason": "end_turn"}],
    "usage": {"input": 1, "output": 1, "total": 2, "cost": 0.0},
    "stopReason": "end_turn",
    "sessionId": "sess-qa-replay",
    "model": req.get("model"),
}
sys.stdout.write(json.dumps(result))
"""


def _capture_request_backend(tmp_path: Path) -> tuple[FakeRunnerBackend, Path]:
    """A FakeRunnerBackend whose runner writes the received /run request to a file, so the
    test can assert on it afterward (the request-shaping half of the replay)."""
    runner = tmp_path / "qa_capture_request_runner.py"
    capture_path = tmp_path / "captured_request.json"
    script = _QA_CAPTURE_REQUEST_RUNNER_SCRIPT % {
        "capture_path_json": json.dumps(str(capture_path))
    }
    runner.write_text(script, encoding="utf-8")
    backend = FakeRunnerBackend(
        command=[sys.executable, str(runner)], cwd=str(tmp_path)
    )
    return backend, capture_path


async def _replay_prompt(tmp_path: Path, transcript_name: str):
    """Load a transcript, drive it through the real wire + transport, return (transcript, result)."""
    transcript = load_transcript(transcript_name)
    config = session_config_from_transcript(transcript)
    messages = transcript_messages(transcript)
    reply = transcript_reply(transcript)

    harness = PiHarness(Environment(_replay_backend(tmp_path, reply)))
    result = await harness.prompt(config, messages)
    return transcript, result


# --------------------------------------------------------------------------- #
# The canonical regression: an author-supplied `append_system` override must reach the model
# and show up in the reply. This is the recorded run's own contract (`transcript["expect"]`).
# --------------------------------------------------------------------------- #


async def test_append_system_override_replay_matches_capture(tmp_path):
    transcript, result = await _replay_prompt(tmp_path, "E2__append_system_pi.json")

    # The captured request actually carried an append_system override -- guard the fixture, not
    # just the parsed shape, so a stale/edited transcript is caught before it silently no-ops.
    agent = transcript["request"]["data"]["parameters"]["agent"]
    assert agent["harness_options"]["pi"]["append_system"]

    assert result.output == transcript["reply"]
    folded = fold({"type": event.type, "data": event.data} for event in result.events)
    assert folded["messages"] == [{"role": "assistant", "content": transcript["reply"]}]
    assert folded["stop_reason"] == "end_turn"


async def test_append_system_override_reaches_the_wire(tmp_path):
    """The request-shaping half: the recorded append_system override must actually reach the
    /run wire as `appendSystemPrompt`, not just parse back if a runner happened to honor it.

    This is the request-side complement to `test_append_system_override_replay_matches_capture`
    (which only proves a canned reply parses back correctly regardless of what was sent). F-001
    was precisely a request-shaping bug (the override silently failing to reach the runner), so a
    replay guard for it must assert the OUTBOUND wire, not just inbound parsing.
    """
    transcript = load_transcript("E2__append_system_pi.json")
    config = session_config_from_transcript(transcript)
    messages = transcript_messages(transcript)
    expected = transcript["request"]["data"]["parameters"]["agent"]["harness_options"][
        "pi"
    ]["append_system"]

    backend, capture_path = _capture_request_backend(tmp_path)
    harness = PiHarness(Environment(backend))
    await harness.prompt(config, messages)

    sent = json.loads(capture_path.read_text(encoding="utf-8"))
    assert sent.get("appendSystemPrompt") == expected


async def test_append_system_override_replay_streams_the_same_result(tmp_path):
    """The AgentStream (live) path parses the identical recorded reply as the batch path."""
    transcript = load_transcript("E2__append_system_pi.json")
    config = session_config_from_transcript(transcript)
    messages = transcript_messages(transcript)
    reply = transcript_reply(transcript)

    harness = PiHarness(Environment(_replay_backend(tmp_path, reply)))
    run = await harness.stream(config, messages)
    seen_types = [event.type async for event in run]
    result = run.result()

    assert seen_types == ["message", "done"]
    assert result.output == transcript["reply"]
    assert result.stop_reason == "end_turn"


# --------------------------------------------------------------------------- #
# Green cells: prove the replay harness is not solely tuned to the failing/edge case.
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "transcript_name",
    ["E2__smoke_chat_pi.json", "E2__builtin_bash_pi.json"],
)
async def test_green_cell_replay_matches_capture(tmp_path, transcript_name):
    transcript, result = await _replay_prompt(tmp_path, transcript_name)

    assert transcript["passed"] is True
    assert result.output == transcript["reply"]
    assert result.stop_reason == "end_turn"
    assert result.session_id == "sess-qa-replay"
