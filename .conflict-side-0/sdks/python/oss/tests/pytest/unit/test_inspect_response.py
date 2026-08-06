"""The ``/inspect`` response is the :class:`WorkflowInspectResponse`.

On main, ``/inspect`` returned a whole ``WorkflowInvokeRequest`` AS the response. This model
makes the response explicit while keeping that request available as a field:

- ``revision`` is the ``WorkflowRevision`` shape, UNMODIFIED — its ``data`` holds the
  ``WorkflowRevisionData``, so schemas stay at ``response["revision"]["data"]["schemas"]``
  (never lifted out, never reshaped).
- ``request`` is the ready-made ``WorkflowInvokeRequest`` (what main returned as the whole
  response), demoted to a field.
- There is no ``configuration``.
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
        # Outputs mirror inputs: an object with a `messages` field of type `messages` (NOT
        # keyed by output surface — the old invoke/messages keying is gone).
        "outputs": {
            "type": "object",
            "properties": {"messages": {"x-ag-type-ref": "messages", "type": "array"}},
        },
    },
    parameters={"agent": {"model": "gpt-5.5"}},
)


def _built_invoke_request() -> WorkflowInvokeRequest:
    """The internally-built inspect result (what ``workflow.inspect()`` returns today).

    ``data.revision`` carries a ``WorkflowRevision`` shape, so schemas live at
    ``data.revision.data.schemas``.
    """
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


def test_inspect_response_keeps_revision_unmodified():
    response = _to_inspect_response(_built_invoke_request())

    assert isinstance(response, WorkflowInspectResponse)
    assert response.revision is not None
    # The revision is the WorkflowRevision shape, unmodified: schemas stay at revision.data.schemas.
    assert response.revision["data"]["uri"] == "agenta:builtin:agent:v0"
    assert (
        response.revision["data"]["schemas"]["inputs"]
        == _RESOLVED_REVISION.schemas.inputs
    )
    assert response.revision["data"]["parameters"] == {"agent": {"model": "gpt-5.5"}}
    # Interface metadata rides top-level meta.
    assert response.meta == {"harness_capabilities": {"pi_core": {}}}


def test_inspect_response_carries_the_ready_made_request():
    # The ready-made WorkflowInvokeRequest is available at response.request, not as the whole
    # response. A client that wants a prepared request reads it directly.
    response = _to_inspect_response(_built_invoke_request())

    assert response.request is not None
    # It is the invoke request envelope (carries data.revision), unreshaped.
    assert "data" in response.request
    assert "revision" in response.request["data"]


def test_inspect_response_has_no_configuration():
    response = _to_inspect_response(_built_invoke_request())
    assert not hasattr(response, "configuration")
    body = json.loads(response.model_dump_json(exclude_none=True))
    assert "configuration" not in body


def test_inspect_response_serializes_schemas_at_revision_data_schemas():
    # The acceptance criterion in the words of a client: post /inspect, read response body,
    # find schemas at body["revision"]["data"]["schemas"]. Schemas are never lifted out of data.
    response = _to_inspect_response(_built_invoke_request())
    body = json.loads(response.model_dump_json(exclude_none=True))

    assert "revision" in body
    assert "schemas" in body["revision"]["data"]
    assert "inputs" in body["revision"]["data"]["schemas"]


def test_inspect_response_outputs_mirror_inputs_messages_field():
    # outputs is an object with a `messages` field of type `messages`, symmetric with
    # inputs.messages — NOT keyed by output surface (no `invoke` surface).
    response = _to_inspect_response(_built_invoke_request())
    outputs = response.revision["data"]["schemas"]["outputs"]

    assert outputs["type"] == "object"
    assert outputs["properties"]["messages"]["x-ag-type-ref"] == "messages"
    assert "invoke" not in outputs.get("properties", {})


def test_inspect_response_handles_a_request_with_no_revision():
    # A built request with no resolved revision yields an empty-revision response, not a crash
    # (the inspect path can resolve nothing for an unknown URI). The request field still carries
    # the (empty) invoke request.
    response = _to_inspect_response(WorkflowInvokeRequest())
    assert isinstance(response, WorkflowInspectResponse)
    assert response.revision is None
    assert response.request is not None
