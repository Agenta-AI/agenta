"""Egress finish-on-park (F-040).

A parked HITL turn now ends gracefully on the runner with a terminal ``stopReason:"paused"``
result, so the streaming egress must drain to a clean ``finish`` frame (the FE then resumes on
the user's decision). Before the runner fix the parked turn never terminated, the stream hung,
and no ``finish`` ever arrived. This pins the egress side of that contract: given a parked
record stream, ``agent_run_to_vercel_parts`` yields the approval request AND a final ``finish``.
"""

from __future__ import annotations

from typing import Any, AsyncIterator, Dict, List

import pytest

from agenta.sdk.agents.adapters.vercel.stream import agent_run_to_vercel_parts
from agenta.sdk.agents.streaming import AgentStream


async def _records(items: List[Dict[str, Any]]) -> AsyncIterator[Dict[str, Any]]:
    for item in items:
        yield item


def _parked_run() -> AgentStream:
    """A runner record stream for a parked turn: the gated tool call, the approval request,
    a ``done`` event, then the terminal ``paused`` result (what the F-040 runner fix emits)."""
    return AgentStream(
        _records(
            [
                {
                    "kind": "event",
                    "event": {
                        "type": "tool_call",
                        "id": "tool-1",
                        "name": "github__get_user",
                        "input": {},
                    },
                },
                {
                    "kind": "event",
                    "event": {
                        "type": "interaction_request",
                        "id": "perm-1",
                        "kind": "user_approval",
                        "payload": {"toolCallId": "tool-1"},
                    },
                },
                {"kind": "event", "event": {"type": "done", "stopReason": "paused"}},
                {
                    "kind": "result",
                    "result": {
                        "ok": True,
                        "output": "",
                        "stopReason": "paused",
                        "sessionId": "conv-1",
                        "traceId": "trace-1",
                    },
                },
            ]
        )
    )


@pytest.mark.asyncio
async def test_parked_run_emits_approval_then_finish() -> None:
    parts = [part async for part in agent_run_to_vercel_parts(_parked_run())]
    types = [p.get("type") for p in parts]

    # The approval request reaches the FE so it can prompt the user ...
    assert "tool-approval-request" in types
    # ... and the stream drains to a clean finish (no immortal-park hang, F-040).
    assert types[-1] == "finish"
    assert types.count("finish") == 1

    # The approval request carries the gated tool-call id so it attaches to the tool part.
    approval = next(p for p in parts if p["type"] == "tool-approval-request")
    assert approval["approvalId"] == "perm-1"
    assert approval["toolCallId"] == "tool-1"

    # A park is intentional-but-incomplete, mapped to the AI SDK `other` finish reason (not
    # a model completion `stop`, not `unknown`).
    finish = parts[-1]
    assert finish["finishReason"] == "other"


def _two_concurrent_gates_run() -> AgentStream:
    """One turn that raises TWO approval gates at once (concurrent approvals): two distinct tool
    calls, each followed by its own ``user_approval`` request, then the terminal ``paused`` result.
    The egress must surface one ``tool-approval-request`` per gate, each keyed to its own tool-call
    id, and still drain to a single clean finish."""
    return AgentStream(
        _records(
            [
                {
                    "kind": "event",
                    "event": {
                        "type": "tool_call",
                        "id": "tool-1",
                        "name": "github__get_user",
                        "input": {},
                    },
                },
                {
                    "kind": "event",
                    "event": {
                        "type": "tool_call",
                        "id": "tool-2",
                        "name": "github__list_repos",
                        "input": {},
                    },
                },
                {
                    "kind": "event",
                    "event": {
                        "type": "interaction_request",
                        "id": "perm-1",
                        "kind": "user_approval",
                        "payload": {"toolCallId": "tool-1"},
                    },
                },
                {
                    "kind": "event",
                    "event": {
                        "type": "interaction_request",
                        "id": "perm-2",
                        "kind": "user_approval",
                        "payload": {"toolCallId": "tool-2"},
                    },
                },
                {"kind": "event", "event": {"type": "done", "stopReason": "paused"}},
                {
                    "kind": "result",
                    "result": {
                        "ok": True,
                        "output": "",
                        "stopReason": "paused",
                        "sessionId": "conv-1",
                        "traceId": "trace-1",
                    },
                },
            ]
        )
    )


@pytest.mark.asyncio
async def test_concurrent_gates_emit_one_approval_request_each() -> None:
    """Two ``user_approval`` events in one turn yield TWO ``tool-approval-request`` frames — one
    per event — each carrying its own approvalId and tool-call id, so the FE can prompt for both
    gates independently. Pins the plural side of the single-gate contract above."""
    parts = [
        part async for part in agent_run_to_vercel_parts(_two_concurrent_gates_run())
    ]

    approvals = [p for p in parts if p["type"] == "tool-approval-request"]
    assert len(approvals) == 2
    # One frame per event, each keyed to its own gate (perm/tool pair), order preserved.
    assert [(a["approvalId"], a["toolCallId"]) for a in approvals] == [
        ("perm-1", "tool-1"),
        ("perm-2", "tool-2"),
    ]
    # Both gates share the turn but the stream still drains to a single clean finish (F-040).
    assert parts[-1]["type"] == "finish"
    assert [p.get("type") for p in parts].count("finish") == 1


def _parked_run_with_real_args() -> AgentStream:
    """A parked turn where the runner first surfaced the tool call with EMPTY input, then the
    approval request carries the REAL args on ``payload.toolCall.rawInput`` (the cold-replay
    resume shape of the HITL approve-empty-input bug)."""
    return AgentStream(
        _records(
            [
                {
                    "kind": "event",
                    "event": {
                        "type": "tool_call",
                        "id": "tool-1",
                        "name": "commit_revision",
                        "input": {},
                    },
                },
                {
                    "kind": "event",
                    "event": {
                        "type": "interaction_request",
                        "id": "perm-1",
                        "kind": "user_approval",
                        "payload": {
                            "toolCallId": "tool-1",
                            "toolCall": {
                                "id": "tool-1",
                                "name": "commit_revision",
                                "rawInput": {"message": "ship it"},
                            },
                        },
                    },
                },
                {"kind": "event", "event": {"type": "done", "stopReason": "paused"}},
                {
                    "kind": "result",
                    "result": {
                        "ok": True,
                        "output": "",
                        "stopReason": "paused",
                        "sessionId": "conv-1",
                        "traceId": "trace-1",
                    },
                },
            ]
        )
    )


@pytest.mark.asyncio
async def test_parked_tool_call_refreshes_real_args_on_approval() -> None:
    """The approval request must refresh the parked tool call's input with the real args even
    when the tool-call id was already surfaced with empty input. Otherwise the FE persists the
    call with ``{}`` and a self-update tool (e.g. commit_revision) fires with no arguments."""
    parts = [
        part async for part in agent_run_to_vercel_parts(_parked_run_with_real_args())
    ]

    inputs = [p for p in parts if p.get("type") == "tool-input-available"]
    # The empty first emit from the `tool_call` event, then a refreshing emit from the approval
    # request carrying the real args.
    assert len(inputs) == 2
    assert inputs[0]["input"] == {}
    assert inputs[-1]["toolCallId"] == "tool-1"
    assert inputs[-1]["input"] == {"message": "ship it"}

    # The approval still attaches to the same tool-call id and the stream drains cleanly.
    approval = next(p for p in parts if p["type"] == "tool-approval-request")
    assert approval["toolCallId"] == "tool-1"
    assert parts[-1]["type"] == "finish"


@pytest.mark.asyncio
async def test_approval_prefers_resolved_name_over_drifting_title() -> None:
    """When the runner stamps ``resolvedName`` (the recorded tool_call name) on the gate, the
    egress names the FE part with it — matching the responder's live key — even though the ACP
    permission ``title`` is the drift-prone specific command. This is the live Claude-tool shape."""
    run = AgentStream(
        _records(
            [
                {
                    "kind": "event",
                    "event": {
                        "type": "tool_call",
                        "id": "tool-1",
                        "name": "Terminal",
                        "input": {},
                    },
                },
                {
                    "kind": "event",
                    "event": {
                        "type": "interaction_request",
                        "id": "perm-1",
                        "kind": "user_approval",
                        "payload": {
                            "toolCallId": "tool-1",
                            "toolCall": {
                                "id": "tool-1",
                                "resolvedName": "Terminal",
                                "title": "cat ~/.claude/settings.json",
                                "kind": "execute",
                                "rawInput": {"command": "cat ~/.claude/settings.json"},
                            },
                        },
                    },
                },
                {"kind": "event", "event": {"type": "done", "stopReason": "paused"}},
                {
                    "kind": "result",
                    "result": {
                        "ok": True,
                        "output": "",
                        "stopReason": "paused",
                        "sessionId": "conv-1",
                        "traceId": "trace-1",
                    },
                },
            ]
        )
    )
    parts = [part async for part in agent_run_to_vercel_parts(run)]
    inputs = [p for p in parts if p.get("type") == "tool-input-available"]
    assert inputs[-1]["toolName"] == "Terminal", (
        "the resolved (recorded) name wins over the drifting permission title"
    )


def _parked_run_with_spec_name() -> AgentStream:
    """A parked turn whose tracing ``tool_call`` surfaced the drift-prone ACP display name
    (``Terminal``), while the approval request carries the resolved spec's STABLE canonical name
    (``Bash``). The egress must key the FE part on the spec name so the cross-turn resume key
    matches the runner's live re-raised gate (which also prefers ``spec.name``)."""
    return AgentStream(
        _records(
            [
                {
                    "kind": "event",
                    "event": {
                        "type": "tool_call",
                        "id": "tool-1",
                        "name": "Terminal",  # ACP title/kind — varies across turns
                        "input": {},
                    },
                },
                {
                    "kind": "event",
                    "event": {
                        "type": "interaction_request",
                        "id": "perm-1",
                        "kind": "user_approval",
                        "payload": {
                            "toolCallId": "tool-1",
                            "toolCall": {
                                "id": "tool-1",
                                "title": "Terminal",
                                "kind": "execute",
                                "spec": {"name": "Bash"},
                                "rawInput": {"cmd": "ls"},
                            },
                        },
                    },
                },
                {"kind": "event", "event": {"type": "done", "stopReason": "paused"}},
                {
                    "kind": "result",
                    "result": {
                        "ok": True,
                        "output": "",
                        "stopReason": "paused",
                        "sessionId": "conv-1",
                        "traceId": "trace-1",
                    },
                },
            ]
        )
    )


@pytest.mark.asyncio
async def test_approval_refreshes_part_with_stable_spec_name() -> None:
    """The approval refresh re-keys the parked part on the resolved spec name (stable across
    cold-replay turns), not the drift-prone ACP title/kind the tracing tool_call surfaced."""
    parts = [
        part async for part in agent_run_to_vercel_parts(_parked_run_with_spec_name())
    ]
    inputs = [p for p in parts if p.get("type") == "tool-input-available"]
    # The refreshing emit from the approval request names the tool by its stable spec name.
    assert inputs[-1]["toolName"] == "Bash"
    assert inputs[-1]["input"] == {"cmd": "ls"}


def _parked_run_with_late_arg_refresh() -> AgentStream:
    """The regression order: the tool_call surfaces (empty), the approval upgrades the part to the
    stable spec name (``Bash``), and THEN Pi's real args land on a later tool_call_update — which
    the runner replays as a repeat ``tool_call`` carrying only the drift-prone ACP title. That
    late refresh must NOT clobber the spec name back to the title, or the cross-turn resume key
    breaks and the gate loops again (the regression from the input-`{}` fix)."""
    return AgentStream(
        _records(
            [
                {
                    "kind": "event",
                    "event": {
                        "type": "tool_call",
                        "id": "tool-1",
                        "name": "Terminal",
                        "input": {},
                    },
                },
                {
                    "kind": "event",
                    "event": {
                        "type": "interaction_request",
                        "id": "perm-1",
                        "kind": "user_approval",
                        "payload": {
                            "toolCallId": "tool-1",
                            "toolCall": {
                                "id": "tool-1",
                                "title": "Terminal",
                                "kind": "execute",
                                "spec": {"name": "Bash"},
                                "rawInput": {"cmd": "ls"},
                            },
                        },
                    },
                },
                # Pi fills the args in AFTER the gate: a repeat tool_call with only the ACP title.
                {
                    "kind": "event",
                    "event": {
                        "type": "tool_call",
                        "id": "tool-1",
                        "name": "Terminal",
                        "rawInput": {"cmd": "ls"},
                    },
                },
                {"kind": "event", "event": {"type": "done", "stopReason": "paused"}},
                {
                    "kind": "result",
                    "result": {
                        "ok": True,
                        "output": "",
                        "stopReason": "paused",
                        "sessionId": "conv-1",
                        "traceId": "trace-1",
                    },
                },
            ]
        )
    )


@pytest.mark.asyncio
async def test_late_arg_refresh_does_not_clobber_stable_spec_name() -> None:
    """A late arg-refresh (repeat tool_call) after the approval keeps the stable spec name, so the
    FE part the resume folds back still keys as ``Bash`` (not the drift-prone ``Terminal``)."""
    parts = [
        part
        async for part in agent_run_to_vercel_parts(_parked_run_with_late_arg_refresh())
    ]
    inputs = [p for p in parts if p.get("type") == "tool-input-available"]
    # Every emission for this id keeps the stable name; the last (the late refresh) must too.
    assert inputs[-1]["toolName"] == "Bash", (
        "the late arg-refresh must not downgrade the approval's stable spec name"
    )
    assert inputs[-1]["input"] == {"cmd": "ls"}
    # And there is exactly ONE tool-input-start (the refresh must not reset the part).
    assert sum(1 for p in parts if p.get("type") == "tool-input-start") == 1


def _commit_revision_run() -> AgentStream:
    return AgentStream(
        _records(
            [
                {
                    "kind": "event",
                    "event": {
                        "type": "tool_call",
                        "id": "tool-commit-1",
                        "name": "commit_revision",
                        "input": {},
                    },
                },
                {
                    "kind": "event",
                    "event": {
                        "type": "tool_result",
                        "id": "tool-commit-1",
                        "output": (
                            '{"count":1,"workflow_revision":{'
                            '"workflow_variant_id":"variant-1",'
                            '"id":"revision-1",'
                            '"version":"4"'
                            "}}"
                        ),
                    },
                },
                {"kind": "event", "event": {"type": "done", "stopReason": "stop"}},
                {
                    "kind": "result",
                    "result": {
                        "ok": True,
                        "output": "",
                        "stopReason": "stop",
                        "sessionId": "conv-1",
                        "traceId": "trace-1",
                    },
                },
            ]
        )
    )


def _commit_revision_result_only_run() -> AgentStream:
    return AgentStream(
        _records(
            [
                {
                    "kind": "event",
                    "event": {
                        "type": "tool_result",
                        "id": "tool-commit-1",
                        "output": (
                            '{"count":1,"workflow_revision":{'
                            '"workflow_variant_id":"variant-1",'
                            '"id":"revision-1",'
                            '"version":"4"'
                            "}}"
                        ),
                    },
                },
                {"kind": "event", "event": {"type": "done", "stopReason": "stop"}},
                {
                    "kind": "result",
                    "result": {
                        "ok": True,
                        "output": "",
                        "stopReason": "stop",
                        "sessionId": "conv-1",
                        "traceId": "trace-1",
                    },
                },
            ]
        )
    )


@pytest.mark.asyncio
async def test_commit_revision_tool_result_emits_refresh_data_part() -> None:
    parts = [part async for part in agent_run_to_vercel_parts(_commit_revision_run())]

    committed = next(p for p in parts if p["type"] == "data-committed-revision")
    assert committed["data"] == {
        "variantId": "variant-1",
        "revisionId": "revision-1",
        "version": "4",
    }


@pytest.mark.asyncio
async def test_commit_revision_result_only_emits_refresh_data_part() -> None:
    parts = [
        part
        async for part in agent_run_to_vercel_parts(_commit_revision_result_only_run())
    ]

    committed = next(p for p in parts if p["type"] == "data-committed-revision")
    assert committed["data"] == {
        "variantId": "variant-1",
        "revisionId": "revision-1",
        "version": "4",
    }


def _parked_client_tool_run() -> AgentStream:
    return AgentStream(
        _records(
            [
                {
                    "kind": "event",
                    "event": {
                        "type": "interaction_request",
                        "id": "client-tool-1",
                        "kind": "client_tool",
                        "payload": {
                            "toolCallId": "tool-client-1",
                            "toolName": "request_connection",
                            "input": {"integration": "slack"},
                            "render": {"kind": "connect"},
                        },
                    },
                },
                {"kind": "event", "event": {"type": "done", "stopReason": "paused"}},
                {
                    "kind": "result",
                    "result": {
                        "ok": True,
                        "output": "",
                        "stopReason": "paused",
                        "sessionId": "conv-1",
                        "traceId": "trace-1",
                    },
                },
            ]
        )
    )


@pytest.mark.asyncio
async def test_parked_client_tool_emits_unsettled_tool_part() -> None:
    parts = [
        part async for part in agent_run_to_vercel_parts(_parked_client_tool_run())
    ]

    inputs = [p for p in parts if p.get("type") == "tool-input-available"]
    assert inputs == [
        {
            "type": "tool-input-available",
            "toolCallId": "tool-client-1",
            "toolName": "request_connection",
            "input": {"integration": "slack"},
        }
    ]
    assert {
        "type": "data-render",
        "data": {
            "toolCallId": "tool-client-1",
            "render": {"kind": "connect"},
        },
    } in parts
    assert not any(p.get("type") == "tool-output-available" for p in parts)
    assert parts[-1]["type"] == "finish"


def _plain_tool_call_with_raw_input() -> AgentStream:
    """A non-gated tool call where the runner surfaced the real args under ``rawInput`` (the ACP
    field) and left the plain ``input`` empty — the common shape behind tool logs showing ``{}``
    for tools that never go through an approval refresh."""
    return AgentStream(
        _records(
            [
                {
                    "kind": "event",
                    "event": {
                        "type": "tool_call",
                        "id": "tool-1",
                        "name": "read_file",
                        "input": {},
                        "rawInput": {"path": "memory://users/self/profile.md"},
                    },
                },
                {
                    "kind": "event",
                    "event": {
                        "type": "tool_result",
                        "id": "tool-1",
                        "output": {"ok": True},
                    },
                },
                {"kind": "event", "event": {"type": "done", "stopReason": "stop"}},
                {
                    "kind": "result",
                    "result": {
                        "ok": True,
                        "output": "",
                        "stopReason": "stop",
                        "sessionId": "conv-1",
                        "traceId": "trace-1",
                    },
                },
            ]
        )
    )


@pytest.mark.asyncio
async def test_plain_tool_call_prefers_raw_input() -> None:
    """A non-gated tool call projects its real args from ``rawInput`` when the runner leaves the
    plain ``input`` empty. Without this, only approval-gated tools recovered their args (via the
    approval refresh) and every other tool log rendered ``{}``."""
    parts = [
        part
        async for part in agent_run_to_vercel_parts(_plain_tool_call_with_raw_input())
    ]

    inputs = [p for p in parts if p.get("type") == "tool-input-available"]
    assert len(inputs) == 1
    assert inputs[0]["input"] == {"path": "memory://users/self/profile.md"}


def _tool_call_then_input_refresh_run() -> AgentStream:
    """A non-gated tool the runner surfaces up front with an empty input, then re-emits with the
    real args once they arrive on the ACP ``tool_call_update`` (the runner's input-refresh)."""
    return AgentStream(
        _records(
            [
                {
                    "kind": "event",
                    "event": {
                        "type": "tool_call",
                        "id": "tool-1",
                        "name": "query_workflows",
                        "input": {},
                    },
                },
                {
                    "kind": "event",
                    "event": {
                        "type": "tool_call",
                        "id": "tool-1",
                        "name": "query_workflows",
                        "input": {"kind": "agent"},
                    },
                },
                {
                    "kind": "event",
                    "event": {
                        "type": "tool_result",
                        "id": "tool-1",
                        "output": "3 found",
                    },
                },
                {"kind": "event", "event": {"type": "done", "stopReason": "stop"}},
                {
                    "kind": "result",
                    "result": {
                        "ok": True,
                        "output": "",
                        "stopReason": "stop",
                        "sessionId": "conv-1",
                        "traceId": "trace-1",
                    },
                },
            ]
        )
    )


@pytest.mark.asyncio
async def test_repeat_tool_call_refreshes_input_without_a_second_start() -> None:
    """A repeat ``tool_call`` for a seen id is an input REFRESH: it re-emits ``tool-input-available``
    with the real args but must NOT emit a second ``tool-input-start`` (which would reset the FE
    tool part and make it look like the tool re-ran). Mirrors the gated approval-refresh path."""
    parts = [
        part
        async for part in agent_run_to_vercel_parts(_tool_call_then_input_refresh_run())
    ]

    starts = [p for p in parts if p.get("type") == "tool-input-start"]
    inputs = [p for p in parts if p.get("type") == "tool-input-available"]
    # Exactly one start (the call surfaces once), two inputs (empty, then the refresh with args).
    assert len(starts) == 1
    assert [p["input"] for p in inputs] == [{}, {"kind": "agent"}]
    # The refresh precedes the result — input is settled before output arrives.
    types = [p.get("type") for p in parts]
    assert types.index("tool-input-available") < types.index("tool-output-available")


# ---------------------------------------------------------------------------
# finishReason precedence: the terminal result's stop_reason is authoritative.
#
# The live runner settles paused-vs-ended AFTER the event stream closes, so its `done`
# event carries NO stopReason — only the terminal result record does. The finish frame must
# therefore prefer the terminal result's stop_reason over the `done` event's, mirroring the
# batch `fold(events, stop_reason=result.stop_reason)` precedence. (adapters/vercel/stream.py)
# ---------------------------------------------------------------------------


def _run(events, result) -> AgentStream:
    records = [{"kind": "event", "event": e} for e in events]
    records.append({"kind": "result", "result": result})
    return AgentStream(_records(records))


@pytest.mark.asyncio
async def test_terminal_paused_wins_when_done_has_no_stop_reason() -> None:
    """(a) A paused turn whose `done` event omits stopReason (the real live-runner shape) but
    whose terminal result says ``paused`` -> the finish frame carries the paused reason
    (mapped to the AI SDK ``other``)."""
    run = _run(
        events=[
            {"type": "message", "text": "one moment"},
            {"type": "done"},  # runner omits stopReason on a HITL pause
        ],
        result={"ok": True, "output": "", "stopReason": "paused", "sessionId": "c1"},
    )
    parts = [part async for part in agent_run_to_vercel_parts(run)]
    finish = parts[-1]
    assert finish["type"] == "finish"
    assert finish["finishReason"] == "other"


@pytest.mark.asyncio
async def test_normal_turn_finish_reason_unchanged() -> None:
    """(b) A normal completion (done + terminal both ``stop``) still finishes ``stop``."""
    run = _run(
        events=[
            {"type": "message", "text": "here you go"},
            {"type": "done", "stopReason": "stop"},
        ],
        result={
            "ok": True,
            "output": "here you go",
            "stopReason": "stop",
            "sessionId": "c1",
        },
    )
    parts = [part async for part in agent_run_to_vercel_parts(run)]
    finish = parts[-1]
    assert finish["type"] == "finish"
    assert finish["finishReason"] == "stop"


@pytest.mark.asyncio
async def test_done_stop_reason_honored_when_terminal_has_none() -> None:
    """(c) When the terminal result carries NO stop_reason, the `done` event's value is the
    fallback and is still honored — terminal-wins only applies when the terminal value exists."""
    run = _run(
        events=[
            {"type": "message", "text": "done thinking"},
            {"type": "done", "stopReason": "end_turn"},
        ],
        # terminal result omits stopReason -> stop_reason is None
        result={"ok": True, "output": "done thinking", "sessionId": "c1"},
    )
    parts = [part async for part in agent_run_to_vercel_parts(run)]
    finish = parts[-1]
    assert finish["type"] == "finish"
    # end_turn maps to the AI SDK `stop`.
    assert finish["finishReason"] == "stop"
