"""Unit test for the silent-turn invariant (run like the other lib tests:
`uv run --no-sync pytest` from `api/`, or any interpreter with pytest + httpx).

The trap this pins: the gate scores a cell on its own scenario assertions, so a turn that came
back completely bare — no text, no tool call, no gate, no error — passes every check that only
looks for the ABSENCE of something bad. That is exactly the shape a swallowed provider failure
takes (ASD-EST100): the model call is rejected, the error is dropped, and the turn is reported
as a clean empty finish. `check_no_silent_turn` makes that shape an automatic failure.

Three things are pinned here:
  1. a bare turn is a violation, and the turns that legitimately carry no assistant text are not;
  2. the content definition matches the product's own (`content_parts_emitted` in the Vercel
     egress), so a turn whose only output is a file or a data payload is NOT reported;
  3. the check is actually WIRED into the cells — it was dead code once, and a dead invariant is
     worse than none because the gate looks like it covers this.
"""

import importlib
import re
import sys
from pathlib import Path

import pytest

RESOURCES = Path(__file__).resolve().parent

# Every cell that both holds turns and whose verdict depends on something NOT appearing, so a
# turn that produced nothing would satisfy it by doing nothing at all.
WIRED_CELLS = [
    "matrix_w7.py",
    "matrix_w7_daytona.py",
    "matrix_w7_per_harness.py",
    "matrix_t8_saved_files.py",
    "matrix_b1_builtin_find.py",
    "matrix_invariant_commit_auth_refusal.py",
    "matrix_l3_abandoned_approval.py",
    "matrix_w5.py",
    "matrix_w4.py",
    "matrix_w3.py",
]


def _lib(monkeypatch):
    monkeypatch.setenv("AGENTA_BASE", "https://qa.example")
    monkeypatch.setenv("AGENTA_PROJECT_ID", "proj-1")
    monkeypatch.setenv("AGENTA_API_KEY", "test-key")
    sys.path.insert(0, str(RESOURCES))
    sys.modules.pop("qa_matrix_lib", None)
    return importlib.import_module("qa_matrix_lib")


def _turn(lib, *, content_frames=(), finish_reason="stop"):
    """A turn whose stream carried the scaffolding plus `content_frames` and nothing else."""
    turn = lib.Turn()
    turn.frames = ["start", "start-step", *content_frames, "finish-step", "finish"]
    turn.finish_reason = finish_reason
    return turn


def _bare_turn(lib, finish_reason="stop"):
    """The incident's turn: the stream carried a terminator and nothing else."""
    return _turn(lib, finish_reason=finish_reason)


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
    turn = _turn(lib, content_frames=["text-start", "text-delta", "text-end"])
    turn.text_parts = ["  ", "\n"]

    assert len(lib.check_no_silent_turn([turn])["violations"]) == 1


def test_a_turn_that_answered_is_clean(monkeypatch):
    lib = _lib(monkeypatch)
    turn = _turn(lib, content_frames=["text-start", "text-delta", "text-end"])
    turn.text_parts = ["The answer is 4."]

    assert lib.check_no_silent_turn([turn])["violations"] == []


def test_a_turn_that_reported_an_error_is_clean(monkeypatch):
    lib = _lib(monkeypatch)
    # A failed turn is loud, which is the whole point: it must not be double-reported here.
    turn = _turn(lib, content_frames=["error"])
    turn.errors = ["the model provider account has insufficient credit"]

    assert lib.check_no_silent_turn([turn])["violations"] == []


def test_a_parked_turn_is_clean(monkeypatch):
    lib = _lib(monkeypatch)
    # A turn paused on an approval gate carries no assistant text by design.
    turn = _turn(
        lib,
        content_frames=["tool-input-available", "tool-approval-request"],
        finish_reason="other",
    )
    turn.tool_calls = [{"toolCallId": "tc-1", "toolName": "bash", "input": {}}]
    turn.approvals = [{"approvalId": "a1", "toolCallId": "tc-1"}]

    assert lib.check_no_silent_turn([turn])["violations"] == []


def test_a_tool_only_turn_is_clean(monkeypatch):
    lib = _lib(monkeypatch)
    turn = _turn(lib, content_frames=["tool-input-available", "tool-output-available"])
    turn.tool_calls = [{"toolCallId": "tc-1", "toolName": "bash", "input": {}}]

    assert lib.check_no_silent_turn([turn])["violations"] == []


@pytest.mark.parametrize(
    "frame",
    [
        "file",  # the agent generated a file and said nothing
        "data-attachment-delivery",  # it delivered an attachment
        "data-chart",  # any generative-UI payload
        "data-interaction",  # an interaction card
    ],
)
def test_a_turn_whose_only_output_is_a_content_payload_is_clean(monkeypatch, frame):
    """The product counts these as content (`content_parts_emitted`), so a turn carrying one has
    put something in front of the user and must not be reported as silent."""
    lib = _lib(monkeypatch)

    assert (
        lib.check_no_silent_turn([_turn(lib, content_frames=[frame])])["violations"]
        == []
    )


def test_reasoning_alone_is_still_silent(monkeypatch):
    """Deliberate: the product does NOT count reasoning as content, so a turn that only thought
    renders as a blank bubble and is exactly the failure this invariant exists to catch."""
    lib = _lib(monkeypatch)
    turn = _turn(
        lib, content_frames=["reasoning-start", "reasoning-delta", "reasoning-end"]
    )

    assert len(lib.check_no_silent_turn([turn])["violations"]) == 1


def test_the_error_data_frame_is_not_counted_as_content(monkeypatch):
    """`data-agent-error` is the paired half of an error frame, not a content payload — counting
    it would make every swallowed-error turn look like it produced something."""
    lib = _lib(monkeypatch)

    result = lib.check_no_silent_turn([_turn(lib, content_frames=["data-agent-error"])])

    assert len(result["violations"]) == 1


def test_only_the_silent_turns_of_a_session_are_reported(monkeypatch):
    lib = _lib(monkeypatch)
    answered = _turn(lib, content_frames=["text-delta"])
    answered.text_parts = ["hello"]

    result = lib.check_no_silent_turn([answered, _bare_turn(lib), _bare_turn(lib)])

    assert [v["turn"] for v in result["violations"]] == [1, 2]


@pytest.mark.parametrize("cell", WIRED_CELLS)
def test_the_invariant_is_wired_into_the_cell(cell):
    """The check was dead code when it first landed: defined, tested, and called by nobody, so
    the gate still PASSed a completely bare turn. This fails if a cell drops the wiring."""
    source = (RESOURCES / cell).read_text()

    assert "check_no_silent_turn" in source, f"{cell} does not call the invariant"
    # It must feed the verdict, not just be computed and discarded.
    assert re.search(r'not silent\["violations"\]', source), (
        f"{cell} computes the invariant but does not let it decide the verdict"
    )


def test_a_bare_turn_forces_every_wired_cell_to_fail(monkeypatch):
    """The cells all fold the invariant in as `... and not silent["violations"]`. A conjunction
    with a False term is False, so this plus the wiring test above is what proves a bare turn
    turns any wired cell's verdict into FAIL, whatever its own assertions concluded.

    (Running a cell end-to-end additionally needs a live deployment; the two tests together pin
    the part that can be checked without one.)
    """
    lib = _lib(monkeypatch)

    silent = lib.check_no_silent_turn([_bare_turn(lib)])

    assert not (not silent["violations"]), (
        "a bare turn must make the cells' `not silent[...]` conjunct False"
    )
    for other_terms_all_passed in (True, False):
        assert (other_terms_all_passed and not silent["violations"]) is False
