"""Unit test for the silent-turn invariant (run like the other lib tests:
`uv run --no-sync pytest` from `api/`, or any interpreter with pytest + httpx).

The trap this pins: the gate scores a cell on its own scenario assertions, so a turn that came
back completely bare — no text, no tool call, no gate, no error — passes every check that only
looks for the ABSENCE of something bad. That is exactly the shape a swallowed provider failure
takes (ASD-EST100): the model call is rejected, the error is dropped, and the turn is reported
as a clean empty finish. `check_no_silent_turn` makes that shape an automatic failure, and these
cases pin that it does not fire on the turns that legitimately carry no assistant text.
"""

import importlib
import sys
from pathlib import Path


def _lib(monkeypatch):
    monkeypatch.setenv("AGENTA_BASE", "https://qa.example")
    monkeypatch.setenv("AGENTA_PROJECT_ID", "proj-1")
    monkeypatch.setenv("AGENTA_API_KEY", "test-key")
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    sys.modules.pop("qa_matrix_lib", None)
    return importlib.import_module("qa_matrix_lib")


def _bare_turn(lib, finish_reason="stop"):
    """The incident's turn: the stream carried a terminator and nothing else."""
    turn = lib.Turn()
    turn.frames = ["start", "start-step", "finish-step", "finish"]
    turn.finish_reason = finish_reason
    return turn


def test_a_bare_turn_is_a_violation(monkeypatch):
    lib = _lib(monkeypatch)

    result = lib.check_no_silent_turn([_bare_turn(lib)])

    assert len(result["violations"]) == 1
    # The violation has to carry enough to debug the run it came from.
    assert result["violations"][0]["turn"] == 0
    assert result["violations"][0]["finishReason"] == "stop"
    assert "finish" in result["violations"][0]["frames"]


def test_whitespace_is_not_an_answer(monkeypatch):
    lib = _lib(monkeypatch)
    turn = _bare_turn(lib)
    turn.text_parts = ["  ", "\n"]

    assert len(lib.check_no_silent_turn([turn])["violations"]) == 1


def test_a_turn_that_answered_is_clean(monkeypatch):
    lib = _lib(monkeypatch)
    turn = _bare_turn(lib)
    turn.text_parts = ["The answer is 4."]

    assert lib.check_no_silent_turn([turn])["violations"] == []


def test_a_turn_that_reported_an_error_is_clean(monkeypatch):
    lib = _lib(monkeypatch)
    # A failed turn is loud, which is the whole point: it must not be double-reported here.
    turn = _bare_turn(lib)
    turn.errors = ["the model provider account has insufficient credit"]

    assert lib.check_no_silent_turn([turn])["violations"] == []


def test_a_parked_turn_is_clean(monkeypatch):
    lib = _lib(monkeypatch)
    # A turn paused on an approval gate carries no assistant text by design.
    turn = _bare_turn(lib, finish_reason="other")
    turn.tool_calls = [{"toolCallId": "tc-1", "toolName": "bash", "input": {}}]
    turn.approvals = [{"approvalId": "a1", "toolCallId": "tc-1"}]

    assert lib.check_no_silent_turn([turn])["violations"] == []


def test_a_tool_only_turn_is_clean(monkeypatch):
    lib = _lib(monkeypatch)
    turn = _bare_turn(lib)
    turn.tool_calls = [{"toolCallId": "tc-1", "toolName": "bash", "input": {}}]

    assert lib.check_no_silent_turn([turn])["violations"] == []


def test_only_the_silent_turns_of_a_session_are_reported(monkeypatch):
    lib = _lib(monkeypatch)
    answered = _bare_turn(lib)
    answered.text_parts = ["hello"]

    result = lib.check_no_silent_turn([answered, _bare_turn(lib), _bare_turn(lib)])

    assert [v["turn"] for v in result["violations"]] == [1, 2]
