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

import ast
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


def _assigned_expressions(tree):
    """Every `name = <expression>` in the cell, so a verdict built in named steps
    (`post_interrupt_works` -> `core_ok` -> the return) can be followed back to what it reads."""
    return {
        target.id: node.value
        for node in ast.walk(tree)
        if isinstance(node, ast.Assign)
        for target in node.targets
        if isinstance(target, ast.Name)
    }


def _reads_the_invariant(node):
    """`silent["violations"]` — the invariant's own read, and the only atom this evaluation knows
    the value of."""
    return (
        isinstance(node, ast.Subscript)
        and isinstance(node.value, ast.Name)
        and node.value.id == "silent"
        and isinstance(node.slice, ast.Constant)
        and node.slice.value == "violations"
    )


def _value_when_a_turn_was_silent(node, assigned, seen=()):
    """What an expression evaluates to on the ONE assumption that a silent turn happened.

    Three-valued: True, False, or None for "depends on the cell's own checks, which this cannot
    know". `silent["violations"]` is a non-empty list under that assumption, so it is True, and
    everything the cell asserts for itself is unknown. Answering the polarity question needs this
    rather than a search for the invariant's NAME: `not silent["violations"]` and
    `not (not silent["violations"])` both mention it, and only the first one is a guard.
    """
    if _reads_the_invariant(node):
        return True
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not):
        inner = _value_when_a_turn_was_silent(node.operand, assigned, seen)
        return None if inner is None else not inner
    if isinstance(node, ast.BoolOp):
        values = [
            _value_when_a_turn_was_silent(value, assigned, seen)
            for value in node.values
        ]
        # `and` keeps going on True and settles on False; `or` is the mirror image.
        keeps_going = isinstance(node.op, ast.And)
        if any(value is not keeps_going for value in values if value is not None):
            return not keeps_going
        return keeps_going if all(value is not None for value in values) else None
    if isinstance(node, ast.Name):
        if node.id in seen or node.id not in assigned:
            return None  # a loop, or a name from outside the cell: nothing can be concluded.
        return _value_when_a_turn_was_silent(
            assigned[node.id], assigned, (*seen, node.id)
        )
    return None  # a call, a comparison, a subscript of something else: the cell's own business.


def _unguarded_pass_paths(source):
    """Every `return {...}` in the cell that can report PASS even though a turn was silent. An
    empty list is what a fully wired cell looks like."""
    tree = ast.parse(source)
    assigned = _assigned_expressions(tree)
    unguarded = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Return) or not isinstance(node.value, ast.Dict):
            continue
        verdict = next(
            (
                value
                for key, value in zip(node.value.keys, node.value.values)
                if isinstance(key, ast.Constant) and key.value == "status"
            ),
            None,
        )
        if verdict is None:
            continue
        verdict_source = ast.unparse(verdict)
        if "PASS" not in verdict_source:
            continue  # a FAIL-only early return; the invariant has nothing to add.
        # PASS has to be the branch a silent turn CANNOT reach, whichever side of the conditional
        # it is written on.
        reaches_pass = None
        if isinstance(verdict, ast.IfExp):
            says_pass = (
                "PASS" in ast.unparse(verdict.body),
                "PASS" in ast.unparse(verdict.orelse),
            )
            if says_pass == (True, False):
                reaches_pass = _value_when_a_turn_was_silent(verdict.test, assigned)
            elif says_pass == (False, True):
                inverted = _value_when_a_turn_was_silent(verdict.test, assigned)
                reaches_pass = None if inverted is None else not inverted
        if reaches_pass is False:
            continue
        unguarded.append(f"line {node.lineno}: {verdict_source}")
    return unguarded


@pytest.mark.parametrize("cell", WIRED_CELLS)
def test_every_pass_path_in_the_cell_is_decided_by_the_invariant(cell):
    """Wiring the invariant into a cell's FINAL verdict is not enough when the cell can return
    PASS earlier. W3 shipped exactly that hole: its Stage 1 ("session B recovered on its own and
    both edits landed") returned PASS before the invariant ran, so a bare turn inside an
    otherwise-successful W3 was invisible to the gate — while the source-level test above stayed
    green, because Stage 2 did have the wiring.

    This walks each cell's returns instead of its text, so any new early PASS path has to consult
    the invariant too.
    """
    unguarded = _unguarded_pass_paths((RESOURCES / cell).read_text())

    assert not unguarded, (
        f"{cell} can return PASS without consulting the silent-turn invariant: "
        + "; ".join(unguarded)
    )


def test_an_early_pass_that_skips_the_invariant_is_reported():
    """Keeps the check above from being vacuously green. It is a static analysis, so if it ever
    stopped finding anything it would look exactly like a perfectly wired suite. This is the W3
    hole in miniature: an early PASS, and a final verdict that does fold the invariant in."""
    cell = """
def cell():
    turns = run()
    if edits_landed(turns):
        return {"status": "PASS", "why": "stage 1"}
    silent = check_no_silent_turn(turns)
    core_ok = retried(turns) and not silent["violations"]
    return {"status": "PASS" if core_ok else "FAIL", "why": "stage 2"}
"""

    unguarded = _unguarded_pass_paths(cell)

    assert len(unguarded) == 1
    assert "stage 1" not in unguarded[0]  # it reports the verdict, not the prose
    assert "PASS" in unguarded[0]


def test_a_pass_that_uses_the_invariant_backwards_is_reported():
    """Mentioning the invariant is not the same as being guarded by it. This cell reads it and
    then inverts it, so it reports PASS in exactly the case the invariant exists to catch."""
    cell = """
def cell():
    turns = run()
    silent = check_no_silent_turn(turns)
    core_ok = not silent["violations"]
    return {"status": "PASS" if not core_ok else "FAIL", "why": "inverted"}
"""

    assert len(_unguarded_pass_paths(cell)) == 1


def test_a_pass_written_on_the_other_side_of_the_conditional_is_accepted():
    """The guard is about which branch a silent turn can reach, not about where PASS is typed."""
    cell = """
def cell():
    turns = run()
    silent = check_no_silent_turn(turns)
    return {"status": "FAIL" if silent["violations"] else "PASS", "why": "mirrored"}
"""

    assert _unguarded_pass_paths(cell) == []


def test_a_cell_whose_every_pass_path_consults_the_invariant_is_clean():
    """The other half of the same guard: the analysis must accept the verdict shape the cells
    actually use, where the invariant reaches the return through a chain of named steps."""
    cell = """
def cell():
    turns = run()
    silent = check_no_silent_turn(turns)
    settled = no_errors(turns) and not silent["violations"]
    core_ok = settled and edits_landed(turns)
    if early(turns):
        return {"status": "PASS" if settled else "FAIL", "why": "stage 1"}
    return {"status": "PASS" if core_ok else "FAIL", "why": "stage 2"}
"""

    assert _unguarded_pass_paths(cell) == []


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
