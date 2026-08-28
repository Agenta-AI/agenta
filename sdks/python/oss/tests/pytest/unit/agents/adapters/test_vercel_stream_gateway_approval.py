"""The egress half of the gateway approval identity.

The runner gates a ``run_tool`` call on the coarse tool name plus the FULL outer arguments
(``{integration, tool, arguments}``). This egress decides what the frontend persists for that
approval, and the next turn folds the persisted part back into the stored key the runner reads.
So if this projection renames the call or narrows its arguments, the answer a person gives stops
resolving the call the runner asked about — it re-prompts every turn, and it matches whatever
other tool happens to carry that name and those arguments.

Its twin is ``services/runner/tests/unit/gateway-approval-roundtrip.test.ts``, which runs the
same round trip from the runner side and mirrors this projection in TypeScript because it cannot
call Python. That mirror is only as good as this file: these tests are what pin the rule the
mirror copies. Change one and change the other.

Driven through the public ``agent_run_to_vercel_parts`` rather than the private helpers, so what
is asserted is the part that actually reaches the wire.
"""

from __future__ import annotations

from typing import Any, AsyncIterator, Dict, List, Optional

import pytest

from agenta.sdk.agents.adapters.vercel.stream import agent_run_to_vercel_parts
from agenta.sdk.agents.streaming import AgentStream

# The call the runner gated, exactly as `run_tool` receives it.
OUTER_ARGUMENTS: Dict[str, Any] = {
    "integration": "github",
    "tool": "CREATE_ISSUE",
    "arguments": {"title": "bug", "body": "it broke"},
}


async def _records(items: List[Dict[str, Any]]) -> AsyncIterator[Dict[str, Any]]:
    for item in items:
        yield item


def _approval_run(tool_call: Dict[str, Any]) -> AgentStream:
    """A parked turn carrying one gateway approval card and nothing else.

    The gateway gate raises its card at the relay seam without a preceding ``tool_call`` event,
    so the egress synthesizes the tool part from the card itself — the case under test.
    """
    return AgentStream(
        _records(
            [
                {
                    "kind": "event",
                    "event": {
                        "type": "interaction_request",
                        "id": "token-1",
                        "kind": "user_approval",
                        "payload": {
                            "toolCallId": "call-1",
                            # Presentation fields the gate adds beside the identity. None of
                            # them may be read as the persisted name.
                            "display": "github.CREATE_ISSUE",
                            "integration": "github",
                            "tool": "CREATE_ISSUE",
                            "readOnly": False,
                            "toolCall": tool_call,
                            "availableReplies": ["once", "reject"],
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


async def _persisted_part(tool_call: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """The ``tool-input-available`` part the frontend persists for this approval."""
    parts = [part async for part in agent_run_to_vercel_parts(_approval_run(tool_call))]
    available = [p for p in parts if p.get("type") == "tool-input-available"]
    return available[-1] if available else None


# The card as `buildGatewayToolGate` emits it today: identity in the fields this egress reads,
# the semantic display in fields it does not.
GATE_CARD: Dict[str, Any] = {
    "id": "call-1",
    "toolCallId": "call-1",
    "name": "run_tool",
    "resolvedName": "run_tool",
    "rawInput": OUTER_ARGUMENTS,
    "input": OUTER_ARGUMENTS,
    "kind": "execute",
    "displayName": "github.CREATE_ISSUE",
}


@pytest.mark.asyncio
async def test_gateway_card_persists_the_identity_the_runner_gated_on() -> None:
    part = await _persisted_part(GATE_CARD)

    assert part is not None, "the approval must synthesize a tool part to attach to"
    assert part["toolName"] == "run_tool"
    assert part["input"] == OUTER_ARGUMENTS
    # And so NOT the semantic display: `displayName` is not a field this egress reads, which is
    # the whole reason the gate puts the display there.
    assert part["toolName"] != "github.CREATE_ISSUE"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("label", "tool_call", "expected"),
    [
        (
            "resolvedName wins over every other source",
            {
                **GATE_CARD,
                "spec": {"name": "spec-name"},
                "name": "plain-name",
                "title": "acp-title",
                "kind": "acp-kind",
            },
            "run_tool",
        ),
        (
            "a nested spec's name wins when resolvedName is absent",
            {
                "toolCallId": "call-1",
                "spec": {"name": "spec-name"},
                "name": "plain-name",
                "title": "acp-title",
                "rawInput": OUTER_ARGUMENTS,
            },
            "spec-name",
        ),
        (
            "name wins when neither resolvedName nor a spec is present",
            {
                "toolCallId": "call-1",
                "name": "plain-name",
                "title": "acp-title",
                "kind": "acp-kind",
                "rawInput": OUTER_ARGUMENTS,
            },
            "plain-name",
        ),
        (
            "title is the next fallback",
            {
                "toolCallId": "call-1",
                "title": "acp-title",
                "kind": "acp-kind",
                "rawInput": OUTER_ARGUMENTS,
            },
            "acp-title",
        ),
        (
            "kind is the last resort",
            {
                "toolCallId": "call-1",
                "kind": "acp-kind",
                "rawInput": OUTER_ARGUMENTS,
            },
            "acp-kind",
        ),
    ],
)
async def test_persisted_name_precedence(
    label: str, tool_call: Dict[str, Any], expected: str
) -> None:
    """Pins the ladder the runner's TypeScript mirror copies. `title` and `kind` are in it, which
    is why the gate must never put its display in either."""
    part = await _persisted_part(tool_call)

    assert part is not None, label
    assert part["toolName"] == expected, label


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("label", "tool_call"),
    [
        (
            "rawInput wins over input",
            {
                "toolCallId": "call-1",
                "resolvedName": "run_tool",
                "rawInput": OUTER_ARGUMENTS,
                "input": {},
            },
        ),
        (
            "input is used when rawInput is absent",
            {
                "toolCallId": "call-1",
                "resolvedName": "run_tool",
                "input": OUTER_ARGUMENTS,
            },
        ),
        (
            # The egress collapses a `{tool, server, arguments}` MCP envelope to the bare
            # arguments, and `tool` IS one of its envelope keys. `{integration, tool, arguments}`
            # survives only because `integration` sits beside it and is not an envelope key.
            "the outer arguments survive the envelope unwrap",
            {
                "toolCallId": "call-1",
                "resolvedName": "run_tool",
                "rawInput": OUTER_ARGUMENTS,
            },
        ),
    ],
)
async def test_persisted_input_is_the_full_outer_arguments(
    label: str, tool_call: Dict[str, Any]
) -> None:
    """Pins the input half of the ladder the runner's TypeScript mirror copies."""
    part = await _persisted_part(tool_call)

    assert part is not None, label
    assert part["input"] == OUTER_ARGUMENTS, label
    assert part["input"]["integration"] == "github", label


@pytest.mark.asyncio
async def test_an_argument_shape_without_integration_would_be_unwrapped() -> None:
    """The hazard the test above guards, made visible.

    Drop ``integration`` and every sibling of ``arguments`` is a string-valued envelope key, so
    the envelope collapses and the persisted arguments become the INNER ones — a different
    approval identity than the runner gated on. Nothing else in either suite would notice, so if
    the ``run_tool`` input schema ever changes, this is the test that should stop it.
    """
    part = await _persisted_part(
        {
            "toolCallId": "call-1",
            "resolvedName": "run_tool",
            "rawInput": {"tool": "CREATE_ISSUE", "arguments": {"title": "bug"}},
        }
    )

    assert part is not None
    assert part["input"] == {"title": "bug"}, (
        "the envelope collapsed, which is exactly why `integration` must stay in the schema"
    )
