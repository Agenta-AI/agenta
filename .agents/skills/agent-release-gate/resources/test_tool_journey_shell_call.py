# /// script
# requires-python = ">=3.10"
# dependencies = ["httpx>=0.27", "pytest>=8"]
# ///
"""Offline tests for the `tool` journey (j3_tool): which call counts as the shell call.

Run either way:

    uv run test_tool_journey_shell_call.py
    uv run --no-sync pytest test_tool_journey_shell_call.py

`invoke` is replaced with a function that returns a hand-built `Turn`. The Codex case is the
wire shape a real S2 run produced: the exec call is named after the command text.
"""

import importlib
import os
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
CELL = {"harness": "codex", "sandbox": "local", "model": "m", "provider": "openai"}
TOKEN = "QA-BASH-da0539873823-x86_64"
COMMAND = 'echo "QA-BASH-$(hostname)-$(uname -m)"'


def _qa():
    os.environ.setdefault("AGENTA_BASE", "https://qa.example")
    os.environ.setdefault("AGENTA_PROJECT_ID", "proj-1")
    os.environ.setdefault("AGENTA_API_KEY", "test-key")
    sys.path.insert(0, str(HERE))
    return importlib.import_module("qa_product")


qa = _qa()
_REAL_INVOKE = qa.invoke


@pytest.fixture(autouse=True)
def _restore_invoke():
    yield
    qa.invoke = _REAL_INVOKE


def _turn(calls, outputs, reply):
    t = qa.Turn()
    t.http_status, t.ms = 200, 12
    t.finish_reason = "stop"
    t.frames = ["start"]
    for call in calls:
        t.frames.append("tool-input-available")
        t.tool_calls.append(call)
    for call_id, output in outputs.items():
        t.frames.append("tool-output-available")
        t.tool_outcomes[call_id] = "available"
        t.tool_payloads[call_id] = {"output": output}
    t.frames += ["text-delta", "finish"]
    t.text = [reply]
    return t


def _run(turn):
    qa.invoke = lambda *args, **kwargs: turn
    return qa.j3_tool(CELL)["pass"]


def test_a_codex_exec_call_named_after_its_command_passes():
    call_id = "exec-cb521cbd-59b7-4ed7-9d90-daa0d0edd7a5"
    call = {
        "toolCallId": call_id,
        "toolName": COMMAND,
        "input": {"command": COMMAND, "cwd": "/var/lib/agenta/mounts/a/b"},
    }
    assert _run(_turn([call], {call_id: TOKEN + "\n"}, TOKEN))


@pytest.mark.parametrize(
    "call_input", [{"command": COMMAND, "description": "Print the token"}, {}]
)
@pytest.mark.parametrize("name", ["Bash", "bash", "terminal"])
def test_a_claude_or_pi_bash_call_passes(name, call_input):
    call = {"toolCallId": "call-1", "toolName": name, "input": call_input}
    assert _run(_turn([call], {"call-1": TOKEN}, TOKEN))


def test_a_turn_with_no_shell_call_fails():
    # The model wrote a well-shaped token without running anything.
    assert not _run(_turn([], {}, TOKEN))


def test_a_non_shell_tool_that_prints_a_token_fails():
    call = {"toolCallId": "read-1", "toolName": "read", "input": {"path": "/tmp/t"}}
    assert not _run(_turn([call], {"read-1": TOKEN}, TOKEN))


def test_a_codex_reply_that_differs_from_the_shell_output_fails():
    call = {"toolCallId": "exec-1", "toolName": COMMAND, "input": {"command": COMMAND}}
    assert not _run(
        _turn([call], {"exec-1": TOKEN}, "QA-BASH-agenta-runner-7bccbff75-x86_64")
    )


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q", "-p", "no:cacheprovider"]))
