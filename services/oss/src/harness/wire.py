"""The ``/run`` wire contract, in one place.

Every transport (subprocess, HTTP) sends the same camelCase JSON to the TypeScript runner
and parses the same result back, so the wire shape lives here rather than being rebuilt in
each adapter. The TypeScript side mirrors these names in ``services/agent/src/protocol.ts``.
"""

from __future__ import annotations

from typing import Any, Dict, List

from .ports import (
    AgentEvent,
    AgentRequest,
    AgentResult,
    HarnessCapabilities,
    Message,
)


def request_to_wire(request: AgentRequest) -> Dict[str, Any]:
    """Serialize an :class:`AgentRequest` to the ``/run`` request JSON."""
    config = request.config
    return {
        "harness": config.harness,
        "sandbox": config.sandbox,
        "sessionId": config.session_id,
        "agentsMd": config.instructions,
        "model": config.model,
        "messages": [message.to_wire() for message in request.messages],
        "secrets": config.secrets or {},
        "tools": config.builtin_tools,
        "customTools": config.custom_tools,
        "toolCallback": config.tool_callback.to_wire()
        if config.tool_callback
        else None,
        "permissionPolicy": config.permission_policy,
        "trace": config.trace.to_wire() if config.trace else None,
    }


def result_from_wire(data: Dict[str, Any]) -> AgentResult:
    """Parse a ``/run`` result JSON into an :class:`AgentResult`.

    Raises ``RuntimeError`` when the runner reported a failure, so the invoke surfaces a
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
