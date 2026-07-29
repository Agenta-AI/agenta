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

from ..permission_rules import PermissionRule
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
_ERROR_MAX_LEN = 300
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
    secrets: Optional[Dict[str, str]] = None,
    trace: Optional[TraceContext] = None,
    run_context: Optional[RunContext] = None,
    session_id: Optional[str] = None,
    turn_id: Optional[str] = None,
    project_id: Optional[str] = None,
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
    ``config.wire_model_ref()`` adds the non-secret provider/connection fields, omitted when no
    structured ``model_ref`` is set so a string-only config's payload is unchanged (the secret
    still rides ``secrets``; ``model`` stays the plain string).
    ``config.wire_resolved_connection()`` adds the resolved-connection descriptor
    (``provider`` / ``model`` / ``deployment`` / ``credentialMode`` / ``endpoint``), omitted when
    no ``resolved_connection`` is threaded so a config without one is unchanged. It is spread
    LAST among the model fields so the resolved ``provider``/``model`` override the base ``model``
    and ``wire_model_ref``'s ``provider`` (its ``env`` never reaches the wire; the secret rides
    ``secrets``).
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
    """
    payload: Dict[str, Any] = {
        "harness": harness.value,
        "sandbox": sandbox,
        "sessionId": session_id,
        "agentsMd": config.agents_md,
        "model": config.model,
        "messages": [message.to_wire() for message in messages],
        "secrets": dict(secrets or {}),
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
        **config.wire_model_ref(),
        **config.wire_resolved_connection(),
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
    return payload


def result_from_wire(data: Dict[str, Any]) -> AgentResult:
    """Parse a ``/run`` result JSON into an :class:`AgentResult`.

    Raises ``RuntimeError`` when the runner reported a failure, so the caller surfaces a
    clear message rather than handing the model an empty reply. The runner ``error`` is
    sanitized at this boundary (one clean line, no stack/path leak); the full detail is logged.
    """
    if not data.get("ok"):
        raise RuntimeError(
            f"Agent run failed: {sanitize_runner_error(data.get('error'))}"
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
