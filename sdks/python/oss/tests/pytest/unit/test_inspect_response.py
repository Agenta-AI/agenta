"""The ``/inspect`` response is the canonical :class:`WorkflowInspectResponse`.

Architecture-followups issue 1: ``/inspect`` used to return a ``WorkflowInvokeRequest`` (a
REQUEST model carrying response semantics), nesting the resolved interface at
``data.revision.data.schemas`` so every client had to guess the envelope. ``handle_inspect_success``
now normalizes that internally-built request into a flat :class:`WorkflowInspectResponse` whose
``revision`` IS the :class:`WorkflowRevisionData`, so schemas live at the obvious
``response["revision"]["schemas"]``.

These are the acceptance criteria from
``docs/design/agent-workflows/interfaces/architecture-followups.md`` issue 1:

- The response exposes schemas at ``response["revision"]["schemas"]`` (not ``data.revision.data``).
- The frontend can resolve schemas from the new shape.
"""

from __future__ import annotations

import json

from agenta.sdk.decorators.routing import _to_inspect_response
from agenta.sdk.models.workflows import (
    WorkflowInspectResponse,
    WorkflowInvokeRequest,
    WorkflowRequestData,
    WorkflowRevision,
    WorkflowRevisionData,
)

_RESOLVED_REVISION = WorkflowRevisionData(
    uri="agenta:builtin:agent:v0",
    schemas={
        "inputs": {"type": "object", "properties": {"messages": {"type": "array"}}},
        "parameters": {"type": "object"},
        # Typed outputs keyed per output surface (issue 4): the POC shape, no flat field.
        "outputs": {
            "invoke": {"x-ag-type-ref": "message", "type": "object"},
            "messages": {"x-ag-type-ref": "messages", "type": "array"},
        },
    },
    parameters={"agent": {"model": "gpt-5.5"}},
)


def _built_invoke_request() -> WorkflowInvokeRequest:
    """The internally-built inspect result (what ``workflow.inspect()`` returns today)."""
    return WorkflowInvokeRequest(
        meta={"harness_capabilities": {"pi_core": {}}},
        data=WorkflowRequestData(
            revision=WorkflowRevision(
                id=None,
                slug="agent",
                version="v0",
                name="Agent",
                data=_RESOLVED_REVISION,
            ).model_dump(mode="json", exclude_none=True),
        ),
    )


def test_inspect_response_lifts_revision_to_top_level():
    response = _to_inspect_response(_built_invoke_request())

    assert isinstance(response, WorkflowInspectResponse)
    assert response.revision is not None
    # Schemas live at response.revision.schemas — not nested under data.revision.data.
    assert response.revision.schemas is not None
    assert response.revision.schemas.inputs == _RESOLVED_REVISION.schemas.inputs
    assert response.revision.uri == "agenta:builtin:agent:v0"
    assert response.revision.parameters == {"agent": {"model": "gpt-5.5"}}
    # Resolved config is preserved at the public boundary, not dropped.
    assert response.configuration == {"parameters": {"agent": {"model": "gpt-5.5"}}}
    # Interface metadata rides top-level meta.
    assert response.meta == {"harness_capabilities": {"pi_core": {}}}


def test_inspect_response_serializes_schemas_at_revision_schemas():
    # The acceptance criterion in the words of a client: post /inspect, read response body,
    # find schemas at body["revision"]["schemas"]. This is the exact path the frontend reads.
    response = _to_inspect_response(_built_invoke_request())
    body = json.loads(response.model_dump_json(exclude_none=True))

    assert "revision" in body
    assert "schemas" in body["revision"]
    assert "inputs" in body["revision"]["schemas"]
    # No request-envelope leakage: there is no top-level `data.revision.data` nesting.
    assert "data" not in body


def test_inspect_response_outputs_are_keyed_per_surface():
    # Issue 4: outputs carry the typed shape keyed per output surface (messages / invoke).
    response = _to_inspect_response(_built_invoke_request())
    outputs = response.revision.schemas.outputs

    assert set(outputs) == {"invoke", "messages"}
    assert outputs["invoke"]["x-ag-type-ref"] == "message"
    assert outputs["messages"]["x-ag-type-ref"] == "messages"


def test_inspect_response_handles_a_request_with_no_revision():
    # A built request with no resolved revision normalizes to an empty-revision response, not a
    # crash (the inspect path can resolve nothing for an unknown URI).
    response = _to_inspect_response(WorkflowInvokeRequest())
    assert isinstance(response, WorkflowInspectResponse)
    assert response.revision is None
    assert response.configuration is None
