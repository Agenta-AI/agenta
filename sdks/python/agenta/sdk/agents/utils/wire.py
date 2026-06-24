"""The ``/run`` wire contract: our DTOs <-> the runner's camelCase JSON.

Shared by the runner-backed adapters (sandbox-agent, in-process Pi). The TS side mirrors these names
in ``services/agent/src/protocol.ts``, and the contract is pinned by shared golden fixtures
under ``sdks/python/oss/tests/pytest/unit/agents/golden/`` (see ``test_wire_contract.py``).
The caller passes the engine id explicitly, since each adapter hard-codes its own.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence

from ..dtos import (
    AgentEvent,
    AgentResult,
    HarnessAgentConfig,
    HarnessCapabilities,
    HarnessType,
    Message,
    TraceContext,
)


def request_to_wire(
    *,
    engine: str,
    harness: HarnessType,
    sandbox: str,
    config: HarnessAgentConfig,
    messages: Sequence[Message],
    secrets: Optional[Dict[str, str]] = None,
    trace: Optional[TraceContext] = None,
    session_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Serialize one turn into the ``/run`` request JSON.

    The tool + permission fields come from ``config.wire_tools()`` so each harness shapes its
    own (Pi: built-ins + native specs, no gating; Claude: MCP specs + permission policy).
    ``config.wire_prompt()`` adds any system-prompt overrides the harness exposes (Pi's
    ``systemPrompt`` / ``appendSystemPrompt``); it is empty for harnesses that have none.
    ``config.wire_mcp()`` adds user-declared MCP servers, omitted when there are none so a
    tool-free run's payload is unchanged. ``config.wire_skills()`` adds resolved inline skill
    packages, likewise omitted when there are none (skills ride their own seam, not the tool
    wire).
    """
    return {
        "backend": engine,
        "harness": harness.value,
        "sandbox": sandbox,
        "sessionId": session_id,
        "agentsMd": config.agents_md,
        "model": config.model,
        "messages": [message.to_wire() for message in messages],
        "secrets": dict(secrets or {}),
        "trace": trace.to_wire() if trace else None,
        **config.wire_tools(),
        **config.wire_prompt(),
        **config.wire_mcp(),
        **config.wire_skills(),
    }


def result_from_wire(data: Dict[str, Any]) -> AgentResult:
    """Parse a ``/run`` result JSON into an :class:`AgentResult`.

    Raises ``RuntimeError`` when the runner reported a failure, so the caller surfaces a
    clear message rather than handing the model an empty reply.
    """
    if not data.get("ok"):
        raise RuntimeError(f"Agent run failed: {data.get('error')}")

    messages: List[Message] = []
    for raw in data.get("messages") or []:
        message = Message.from_raw(raw)
        if message is not None:
            messages.append(message)

    events: List[AgentEvent] = []
    for raw in data.get("events") or []:
        event = AgentEvent.from_wire(raw)
        if event is not None:
            events.append(event)

    return AgentResult(
        output=data.get("output", "") or "",
        messages=messages,
        events=events,
        usage=data.get("usage"),
        stop_reason=data.get("stopReason"),
        capabilities=HarnessCapabilities.from_wire(data.get("capabilities")),
        session_id=data.get("sessionId"),
        model=data.get("model"),
        trace_id=data.get("traceId"),
    )
