"""
`request.flags` must be a typed `WorkflowRequestFlags` carrying the per-call
COMMAND directives — `stream`, `history`, `control` (all bool) — distinct from
the descriptor `WorkflowFlags` (`is_chat`/`is_agent`/...) which describes what a
workflow IS, not what a call should DO.

Today the request inherits `flags: Optional[Flags]` where `Flags = Dict[str,
LabelJson]` (a loose dict). These RED tests pin the target type and its presence
on the invoke request.
"""


# --------------------------------------------------------------------------- #
# The type exists with the three boolean command fields
# --------------------------------------------------------------------------- #
def test_workflow_request_flags_type_exists():
    from agenta.sdk.models.workflows import WorkflowRequestFlags  # RED: not defined

    flags = WorkflowRequestFlags(stream=True, history=False, control=True)
    assert flags.stream is True
    assert flags.history is False
    assert flags.control is True


def test_workflow_request_flags_default_none():
    from agenta.sdk.models.workflows import WorkflowRequestFlags

    flags = WorkflowRequestFlags()
    # absent = not set; the reader treats None as False, but the model keeps the
    # tri-state so "unset" is distinguishable from explicit False.
    assert flags.stream is None
    assert flags.history is None
    assert flags.control is None


# --------------------------------------------------------------------------- #
# The request boundary stays dict-ish (loose). WorkflowRequestFlags is the typed
# ACCESSOR the running layer builds to read the per-call directives — not the wire
# type. So req.flags is a plain dict; parsing it yields the typed view.
# --------------------------------------------------------------------------- #
def test_invoke_request_flags_dict_parses_via_accessor():
    from agenta.sdk.models.workflows import (
        WorkflowInvokeRequest,
        WorkflowRequestFlags,
    )

    req = WorkflowInvokeRequest(
        data={"inputs": {"value": "x"}},
        flags={"stream": False, "history": True},
    )
    # boundary stays a loose dict
    assert isinstance(req.flags, dict)

    # running layer parses it into the typed accessor
    parsed = WorkflowRequestFlags(**(req.flags or {}))
    assert parsed.stream is False
    assert parsed.history is True
    assert parsed.control is None


# --------------------------------------------------------------------------- #
# `format` is NOT a running-level flag: in code messages are always agenta. It is
# an HTTP-only representation (see test_workflow_format_routing.py).
# --------------------------------------------------------------------------- #
def test_format_is_not_a_request_flag():
    """format is http-only; the command flags are stream/history/control/resolve."""
    from agenta.sdk.models.workflows import WorkflowRequestFlags

    assert "format" not in WorkflowRequestFlags.model_fields
    assert set(WorkflowRequestFlags.model_fields) == {
        "stream",
        "history",
        "control",
        "resolve",
    }
