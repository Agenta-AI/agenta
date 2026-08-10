"""Unit test for multi-gate approval collection (run like the api_call test:
`uv run --no-sync pytest` from `api/`, or any interpreter with pytest + httpx).

The trap this pins: `Turn.approval` was a single dict overwritten by each
`tool-approval-request` frame, so a turn that raised TWO gates (a parallel batch)
only ever answered the LAST one — the first sat pending until its TTL, and every
"future gated scenario" silently exercised half its gates. `approvals` now collects
every raised gate and `approval_reply` answers each; single-gate turns produce the
exact message they always did.
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


def _turn_with_gates(lib, gates):
    turn = lib.Turn()
    for tool_call_id, name in gates:
        turn.tool_calls.append(
            {"toolCallId": tool_call_id, "toolName": name, "input": {}}
        )
        turn._segments.append({"kind": "tool", "id": tool_call_id})
        turn.approvals = [
            g for g in turn.approvals if g["toolCallId"] != tool_call_id
        ] + [{"approvalId": f"approval-{tool_call_id}", "toolCallId": tool_call_id}]
    return turn


def test_single_gate_reply_is_unchanged(monkeypatch):
    lib = _lib(monkeypatch)
    turn = _turn_with_gates(lib, [("tc-1", "commit_revision")])

    assert turn.approval == {"approvalId": "approval-tc-1", "toolCallId": "tc-1"}
    message = lib.approval_reply(turn, approved=True)
    (part,) = [p for p in message["parts"] if p.get("toolCallId") == "tc-1"]
    assert part["state"] == "approval-responded"
    assert part["approval"] == {"id": "approval-tc-1", "approved": True}


def test_every_raised_gate_is_answered(monkeypatch):
    lib = _lib(monkeypatch)
    turn = _turn_with_gates(lib, [("tc-1", "rename_session"), ("tc-2", "rename_agent")])

    # Back-compat single view stays the LAST raised gate.
    assert turn.approval["toolCallId"] == "tc-2"

    message = lib.approval_reply(turn, approved=True)
    answered = {
        p["toolCallId"]: p["approval"]
        for p in message["parts"]
        if p.get("state") == "approval-responded"
    }
    assert answered == {
        "tc-1": {"id": "approval-tc-1", "approved": True},
        "tc-2": {"id": "approval-tc-2", "approved": True},
    }


def test_a_reraise_refreshes_the_gate_in_place(monkeypatch):
    lib = _lib(monkeypatch)
    turn = _turn_with_gates(lib, [("tc-1", "commit_revision")])
    turn.approvals = [g for g in turn.approvals if g["toolCallId"] != "tc-1"] + [
        {"approvalId": "approval-fresh", "toolCallId": "tc-1"}
    ]

    assert len(turn.approvals) == 1
    message = lib.approval_reply(turn, approved=False)
    (part,) = [p for p in message["parts"] if p.get("toolCallId") == "tc-1"]
    assert part["approval"] == {"id": "approval-fresh", "approved": False}
