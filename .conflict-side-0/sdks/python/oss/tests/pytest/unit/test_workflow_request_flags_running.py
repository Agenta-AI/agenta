"""
`request.flags` must be a typed `WorkflowInvokeRequestFlags` carrying the per-call
COMMAND directives — `stream`, `trim`, `force` (all bool) — distinct from
the descriptor `WorkflowFlags` (`is_chat`/`is_agent`/...) which describes what a
workflow IS, not what a call should DO.

Today the request inherits `flags: Optional[Flags]` where `Flags = Dict[str,
LabelJson]` (a loose dict). These RED tests pin the target type and its presence
on the invoke request.
"""


# The type exists with the three boolean command fields
def test_workflow_request_flags_type_exists():
    from agenta.sdk.models.workflows import WorkflowInvokeRequestFlags

    flags = WorkflowInvokeRequestFlags(stream=True, trim=False, force=True)
    assert flags.stream is True
    assert flags.trim is False
    assert flags.force is True


def test_workflow_request_flags_default_none():
    from agenta.sdk.models.workflows import WorkflowInvokeRequestFlags

    flags = WorkflowInvokeRequestFlags()
    # unset stays distinguishable from explicit False (tri-state)
    assert flags.stream is None
    assert flags.trim is None
    assert flags.force is None


# req.flags stays a plain dict at the wire; WorkflowInvokeRequestFlags is the typed accessor
def test_invoke_request_flags_dict_parses_via_accessor():
    from agenta.sdk.models.workflows import (
        WorkflowInvokeRequest,
        WorkflowInvokeRequestFlags,
    )

    req = WorkflowInvokeRequest(
        data={"inputs": {"value": "x"}},
        flags={"stream": False, "trim": True},
    )
    assert isinstance(req.flags, dict)

    parsed = WorkflowInvokeRequestFlags(**(req.flags or {}))
    assert parsed.stream is False
    assert parsed.trim is True
    assert parsed.force is None


# `format` is HTTP-only, not a running-level flag (see test_workflow_format_routing.py)
def test_format_is_not_a_request_flag():
    """format is http-only; the command flags are stream/trim/force/resolve."""
    from agenta.sdk.models.workflows import WorkflowInvokeRequestFlags

    assert "format" not in WorkflowInvokeRequestFlags.model_fields
    assert set(WorkflowInvokeRequestFlags.model_fields) == {
        "stream",
        "trim",
        "force",
        "resolve",
    }
