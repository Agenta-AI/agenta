"""End-to-end through the real wire and transport, against a fake runner.

This is the Python-only stand-in for a live ``/invoke``: a tiny script plays the runner,
echoing the latest turn. The whole runtime path is real -- harness translation, the cold
environment lifecycle, ``request_to_wire``, the subprocess transport, and ``result_from_wire``
-- only the runner program (which would be the TS + Pi + LLM stack) is faked. So it catches
serialization or transport drift that per-side unit tests cannot, with no TS and no LLM.
"""

from __future__ import annotations

import json
import sys

import pytest

from agenta.sdk.agents import (
    AgentConfig,
    Environment,
    Message,
    PiHarness,
    SessionConfig,
)
from agenta.sdk.agents.skills import SkillTemplate

from ._fake_runner_backend import FakeRunnerBackend

pytestmark = pytest.mark.integration


# A runner that reads the /run request on stdin and echoes the latest user turn as a full
# AgentRunResult on stdout (the camelCase wire shape result_from_wire parses).
_ECHO_RUNNER = """
import sys, json

req = json.load(sys.stdin)
text = ""
for message in reversed(req.get("messages") or []):
    if message.get("role") == "user":
        content = message.get("content")
        if isinstance(content, str):
            text = content
        else:
            text = "".join(
                block.get("text", "")
                for block in content
                if isinstance(block, dict) and block.get("type") == "text"
            )
        if text:
            break

out = {
    "ok": True,
    "output": "echo: " + text,
    "messages": [{"role": "assistant", "content": "echo: " + text}],
    "events": [
        {"type": "message", "text": "echo: " + text},
        {"type": "done", "stopReason": "end_turn"},
    ],
    "usage": {"input": 1, "output": 1, "total": 2, "cost": 0.0},
    "stopReason": "end_turn",
    "capabilities": {"textMessages": True, "mcpTools": False},
    "sessionId": "sess-fake",
    "model": req.get("model"),
}
sys.stdout.write(json.dumps(out))
"""

_FAIL_RUNNER = """
import sys, json
json.load(sys.stdin)
sys.stdout.write(json.dumps({"ok": False, "error": "model exploded"}))
"""

_SILENT_RUNNER = """
import sys, json
json.load(sys.stdin)
"""

# Reads the /run request and echoes back the `skills` it received in the result `output`, as
# JSON. This lets a test assert the runner actually received the resolved inline skill package
# (the full wire path: harness translation -> request_to_wire -> subprocess transport).
_SKILL_ECHO_RUNNER = """
import sys, json

req = json.load(sys.stdin)
skills = req.get("skills")
out = {
    "ok": True,
    "output": json.dumps(skills),
    "messages": [{"role": "assistant", "content": "ok"}],
    "events": [{"type": "done", "stopReason": "end_turn"}],
    "usage": {"input": 1, "output": 1, "total": 2, "cost": 0.0},
    "stopReason": "end_turn",
    "sessionId": "sess-fake",
    "model": req.get("model"),
}
sys.stdout.write(json.dumps(out))
"""


def _backend(tmp_path, body: str) -> FakeRunnerBackend:
    runner = tmp_path / "fake_runner.py"
    runner.write_text(body, encoding="utf-8")
    return FakeRunnerBackend(command=[sys.executable, str(runner)], cwd=str(tmp_path))


async def test_prompt_round_trips_through_the_real_transport(tmp_path):
    harness = PiHarness(Environment(_backend(tmp_path, _ECHO_RUNNER)))
    config = SessionConfig(agent=AgentConfig(instructions="hi", model="gpt-5.5"))

    result = await harness.prompt(config, [Message(role="user", content="ping")])

    # The runner saw the wired turn and model, and the result parsed back cleanly.
    assert result.output == "echo: ping"
    assert result.model == "gpt-5.5"
    assert [e.type for e in result.events] == ["message", "done"]
    assert result.capabilities is not None and result.capabilities.mcp_tools is False
    # The session id is parsed and carried forward for a follow-up turn.
    assert result.session_id == "sess-fake"
    assert config.session_id == "sess-fake"


async def test_runner_failure_surfaces_as_runtime_error(tmp_path):
    harness = PiHarness(Environment(_backend(tmp_path, _FAIL_RUNNER)))
    config = SessionConfig(agent=AgentConfig(instructions="hi"))

    with pytest.raises(RuntimeError, match="model exploded"):
        await harness.prompt(config, [Message(role="user", content="hi")])


async def test_runner_empty_output_raises(tmp_path):
    harness = PiHarness(Environment(_backend(tmp_path, _SILENT_RUNNER)))
    config = SessionConfig(agent=AgentConfig(instructions="hi"))

    with pytest.raises(RuntimeError, match="no output"):
        await harness.prompt(config, [Message(role="user", content="hi")])


async def test_resolved_skill_reaches_the_runner_over_the_wire(tmp_path):
    # An AgentConfig carrying a resolved inline skill (the post-@ag.embed-resolution shape) must
    # arrive at the runner as a concrete `skills` package over the real wire + transport, not as
    # an embed and not dropped. The skill-echo runner reports the `skills` it saw.
    harness = PiHarness(Environment(_backend(tmp_path, _SKILL_ECHO_RUNNER)))
    skill = SkillTemplate(
        name="release-notes",
        description="Draft release notes.",
        body="Read the changelog, then write notes.",
        files=[{"path": "scripts/draft.py", "content": "print(1)", "executable": True}],
        disable_model_invocation=True,
        allow_executable_files=True,
    )
    config = SessionConfig(
        agent=AgentConfig(instructions="hi", model="gpt-5.5", skills=[skill])
    )

    result = await harness.prompt(config, [Message(role="user", content="ping")])

    # The runner received the materialized inline package (camelCase flags, bundled file).
    received = json.loads(result.output)
    assert received == [
        {
            "name": "release-notes",
            "description": "Draft release notes.",
            "body": "Read the changelog, then write notes.",
            "files": [
                {"path": "scripts/draft.py", "content": "print(1)", "executable": True}
            ],
            "disableModelInvocation": True,
            "allowExecutableFiles": True,
        }
    ]
