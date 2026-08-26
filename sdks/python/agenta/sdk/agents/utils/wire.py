"""The ``/run`` wire contract: our DTOs <-> the runner's camelCase JSON.

Used by the sandbox-agent backend. The TS side mirrors these names in
``services/runner/src/protocol.ts``, and the contract is pinned by shared golden fixtures
under ``sdks/python/oss/tests/pytest/unit/agents/golden/`` (see ``test_wire_contract.py``).
The runner drives one engine (the sandbox-agent ACP path); the ``harness`` field selects the
agent, so there is no engine selector on the wire.

The SCHEMA source of truth for this contract is the dedicated Pydantic wire models in
``agenta.sdk.agents.wire_models`` (``WireRunRequest`` / ``WireRunResult``). Their exported JSON
Schema ships in the SDK through ``CATALOG_TYPES`` and is asserted to describe exactly what the
functions below emit/parse (``test_wire_models.py``). The serializer here stays a hand-built
dict on purpose: the omit-when-empty behavior lives in this file (and is pinned by the goldens),
which ``model_json_schema()`` cannot express. Add or rename a wire field in BOTH places (here and
the wire models) plus ``protocol.ts`` and the goldens — the tests catch a one-sided change.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Literal, Optional, Sequence, TypedDict

from agenta.sdk.utils.logging import get_module_logger
from agenta.sdk.redaction.context import get_active_redactor

from .effective_config import stamp_effective_parameters
from ..permission_rules import PermissionRule
from ..errors import AgentRunFailed
from ..dtos import (
    Event,
    AgentResult,
    HarnessAgentTemplate,
    HarnessCapabilities,
    HarnessKind,
    Message,
    RunContext,
    TraceContext,
)

log = get_module_logger(__name__)

PermissionMode = Literal["allow", "ask", "deny", "allow_reads"]


class PermissionsConfig(TypedDict, total=False):
    default: PermissionMode
    rules: List[PermissionRule]


# The user-facing error must not carry an internal stack/path dump. Cap the surfaced line and
# strip the patterns that leak implementation detail; the full text is logged, never shown.
# The cap bounds SIZE, not content: first-line-only, the stack-frame strip, and the redactor below
# are what protect the user, so it is set wide enough for a real actionable message to arrive whole.
_ERROR_MAX_LEN = 2000
# A stack frame leaked into the message ("at fn (/abs/path:12:3)" / 'File "/abs/path", line 12').
_STACK_FRAME_RE = re.compile(r"\b(at\s+\S+\s*\(|File\s+\"|/[\w./-]+:\d+)")


def sanitize_runner_error(error: Any) -> str:
    """Reduce a runner ``error`` to one clean user-facing line, logging the full detail.

    The runner already concise-formats its known auth/credit failures, but the fall-through case
    returns the raw first line of an SDK/JS error, and the transport errors (HTTP/stderr/stdout
    dumps) carry internal text. This is the single boundary that reaches the caller/UI, so it
    keeps the actionable message, drops stack-frame and path noise, caps the length, and logs the
    untruncated original for the trace/logs. A clean concise message passes through unchanged.

    Stack-strip THEN redact: known-value redaction runs last so a leaked secret can't survive
    even inside an otherwise-clean message.
    """
    raw = "" if error is None else str(error)
    if raw and (
        len(raw) > _ERROR_MAX_LEN or "\n" in raw or _STACK_FRAME_RE.search(raw)
    ):
        log.warning("agent: runner reported a failure: %s", raw)
    # Keep only the first line; a multi-line body is a stack dump, never the message.
    message = raw.split("\n", 1)[0].strip()
    # If even the first line is a raw stack frame, fall back to a generic line.
    if not message or _STACK_FRAME_RE.match(message):
        return "agent run failed"
    if len(message) > _ERROR_MAX_LEN:
        message = message[: _ERROR_MAX_LEN - 1].rstrip() + "…"
    return get_active_redactor().redact_string(message, sink="error") or message


def request_to_wire(
    *,
    harness: HarnessKind,
    sandbox: str,
    config: HarnessAgentTemplate,
    messages: Sequence[Message],
    trace: Optional[TraceContext] = None,
    run_context: Optional[RunContext] = None,
    session_id: Optional[str] = None,
    turn_id: Optional[str] = None,
    project_id: Optional[str] = None,
    effective_parameters: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Serialize one turn into the ``/run`` request JSON.

    The tool + permission fields come from ``config.wire_tools()`` so each harness shapes its
    own (Pi: built-ins + native specs, no gating; Claude: MCP specs + permission policy).
    ``config.wire_prompt()`` adds any system-prompt overrides the harness exposes (Pi's
    ``systemPrompt`` / ``appendSystemPrompt``); it is empty for harnesses that have none.
    ``config.wire_mcp()`` adds user-declared MCP servers, omitted when there are none so a
    tool-free run's payload is unchanged. ``config.wire_skills()`` adds resolved inline skill
    packages, likewise omitted when there are none (skills ride their own seam, not the tool
    wire). ``config.wire_sandbox_permission()`` adds the declared sandbox security boundary,
    omitted when unset (plumbing only; the runner does not enforce it yet).
    ``config.wire_connection_ref()`` adds the author's connection CHOICE (``self_managed``, or an
    Agenta connection named by slug), omitted for the project default because it carries nothing
    beyond the model. ``config.wire_model_connection()`` adds what that choice RESOLVED to: the
    model route and typed credentials as one consumer-owned object. It is omitted when no
    connection was resolved and overrides the base model id with the exact resolved model.
    ``config.wire_harness_files()`` adds the generic ``harnessFiles`` array: files the active
    harness's config rendered from its own ``permissions`` / ``extras`` slice, to materialize in the session
    cwd before the session starts (``path`` relative to cwd, ``content`` the file text). Omitted
    unless the config produced any files. This is where the per-harness translation happens in
    Python (e.g. the claude config renders ``.claude/settings.json``); the runner is a dumb writer
    that drops each entry into the cwd with no harness knowledge.

    ``run_context`` is the run's own context (trace + variant identity), refreshed per turn. When
    set it rides as ``runContext`` and is consumed by tool context bindings at dispatch
    (``call.context`` on direct-call specs and ``contextBindings`` on callRef specs) (direct-call tools, Phase 3a). Omitted when unset (and when its ``to_wire`` is empty),
    so a run that needs no binding stays byte-identical to before.

    ``effective_parameters`` is the POST-HYDRATION config this turn actually runs (the handler's
    resolved ``data.parameters``). It rides as the opaque ``effectiveParameters`` ONLY on a
    session run — a non-session run has no interaction row to stamp it onto, so its payload stays
    byte-identical to the golden contract. The runner echoes it onto the durable interaction row
    of any HITL gate this turn parks, so a client that answers the gate without being able to
    reproduce the config (mobile, the M2 dispatcher) can replay the exact turn instead of
    hydrating the referenced variant's HEAD. Redacted and size-capped by
    ``effective_config.stamp_effective_parameters``, which returns ``None`` (key omitted) when
    there is nothing safe to stamp.
    """
    payload: Dict[str, Any] = {
        "harness": harness.value,
        "sandbox": sandbox,
        "sessionId": session_id,
        "agentsMd": config.agents_md,
        "model": config.model,
        "messages": [message.to_wire() for message in messages],
        # The run's tracing inputs ride the wire grouped by role (see the trace/telemetry interface
        # restructure): `context.propagation` carries the per-call W3C trace-context headers, and
        # `telemetry` carries the operator-owned exporter config + capture policy. Both come from the
        # single `trace` capture; both are null when the run has no trace context (the standalone
        # case), matching the prior single-`trace`-null behavior.
        "context": trace.context_to_wire() if trace else None,
        "telemetry": trace.telemetry_to_wire() if trace else None,
        **config.wire_tools(),
        **config.wire_prompt(),
        **config.wire_mcp(),
        **config.wire_skills(),
        **config.wire_sandbox_permission(),
        **config.wire_connection_ref(),
        **config.wire_model_connection(),
        **config.wire_harness_mode(),
        **config.wire_harness_files(),
    }
    if run_context is not None:
        run_context_wire = run_context.to_wire()
        if run_context_wire:
            payload["runContext"] = run_context_wire
    if turn_id is not None:
        payload["turnId"] = turn_id
    if project_id is not None:
        payload["projectId"] = project_id
    if session_id:
        stamped = stamp_effective_parameters(effective_parameters)
        if stamped:
            payload["effectiveParameters"] = stamped
    return payload


def result_from_wire(data: Dict[str, Any]) -> AgentResult:
    """Parse a ``/run`` result JSON into an :class:`AgentResult`.

    Raises :class:`AgentRunFailed` when the runner reported a failure, so the caller gets a
    stable code and a clear message rather than an empty reply. The runner ``error`` is
    sanitized at this boundary (one clean line, no stack/path leak); the full detail is logged.
    """
    data = get_active_redactor().redact_json(data, sink="runner_result")
    if not data.get("ok"):
        error_detail = data.get("errorDetail")
        raise AgentRunFailed(
            sanitize_runner_error(data.get("error")),
            error_detail=error_detail if isinstance(error_detail, dict) else None,
        )

    messages: List[Message] = []
    for raw in data.get("messages") or []:
        message = Message.from_raw(raw)
        if message is not None:
            messages.append(message)

    events: List[Event] = []
    for raw in data.get("events") or []:
        event = Event.from_wire(raw)
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
