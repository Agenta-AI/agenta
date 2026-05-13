# - THIS WOULD BE PART OF THE BACKEND ---------------------------------- START -
from os import getenv
from json import dumps

import agenta as ag

AGENTA_API_URL = "http://localhost/api"
AGENTA_API_KEY = getenv("AGENTA_API_KEY")

ag.init(
    api_url=AGENTA_API_URL,
    api_key=AGENTA_API_KEY,
)
# - THIS WOULD BE PART OF THE BACKEND ---------------------------------- END ---


# - THIS IS THE USER'S CODE -------------------------------------------- START -

VERSION = "2025.07.14"

SCHEMAS = {
    "parameters": {
        "type": "object",
        "properties": {
            "reference_path": {
                "type": "string",
                "description": "The key in the inputs to compare against the trace outputs.",
            }
        },
        "required": ["reference_path"],
        "additionalProperties": True,
    },
    "inputs": {"type": "object"},
    "outputs": {
        "type": "object",
        "properties": {
            "success": {
                "type": "boolean",
                "description": "Indicates whether the trace outputs match the reference outputs.",
            }
        },
        "required": ["success"],
        "additionalProperties": False,
    },
}


@ag.workflow(
    version=VERSION,
    schemas=SCHEMAS,
)
@ag.instrument()
async def exact_match_v1(
    *,
    parameters: dict,
    inputs: dict,
    outputs: dict | str,
) -> dict:
    reference_path = parameters.get("reference_path", None)
    reference_outputs = inputs.get(reference_path, None)

    if isinstance(outputs, str) and isinstance(reference_outputs, str):
        success = outputs == reference_outputs
    elif isinstance(outputs, dict) and isinstance(reference_outputs, dict):
        outputs = dumps(outputs, sort_keys=True)
        reference_outputs = dumps(reference_outputs, sort_keys=True)
        success = outputs == reference_outputs
    else:
        success = False

    outputs = {"success": success}

    return outputs


# - THIS IS THE USER'S CODE -------------------------------------------- END ---

from asyncio import run as run_async  # noqa: E402

from agenta.sdk.models.workflows import (  # noqa: E402
    WorkflowRevision,
    WorkflowRevisionData,
    WorkflowServiceRequestData,
    WorkflowServiceRequest,
    WorkflowServiceResponse,
    Status,
)


TEST_INPUTS = {
    "text": "Hello, world!",
    "result": "Hello, World!",
}

TEST_OUTPUTS = "Hello, World!"

TEST_PARAMETERS = {
    "reference_path": "result",
}


async def main():
    # create the workflow revision
    workflow_revision = WorkflowRevision(
        data=WorkflowRevisionData(
            uri="agenta:function:exact_match:latest",
            parameters=TEST_PARAMETERS,
        )
    )

    print(
        "Revision:", workflow_revision.data.model_dump(mode="json", exclude_none=True)
    )

    # create the workflow request
    workflow_service_request = WorkflowServiceRequest(
        flags={"is_annotation": True},
        data=WorkflowServiceRequestData(
            inputs=TEST_INPUTS,
            outputs=TEST_OUTPUTS,
        ),
        credentials=f"ApiKey {AGENTA_API_KEY}",
    )

    print(
        "Request: ",
        workflow_service_request.data.model_dump(mode="json", exclude_none=True),
    )

    # invoke the workflow service
    # - THIS WILL BE PART OF THE BACKEND (via @ag.workflow) ---------------- START -

    # print("Registry:", ag.workflow.get_registry())

    method = workflow_service_request.method or "invoke"

    workflow_registry = ag.workflows.get_registry()

    handler = workflow_registry.handlers.get(method, None)

    if not handler:
        return WorkflowServiceResponse(
            status=Status(
                code=400,
                message="Could not find service handler for the given URI, path, and method.",
            )
        )

    print("Handler: ", handler)

    with ag.workflow_mode_enabled():
        workflow_service_response: WorkflowServiceResponse = await handler(
            request=workflow_service_request,
            revision=workflow_revision,
        )

    print(
        f"Response: {workflow_service_response.model_dump(mode='json', exclude_none=True)}"
    )

    outputs = await handler(
        inputs=workflow_service_request.data.inputs,
        outputs=workflow_service_request.data.outputs,
        parameters=workflow_revision.data.parameters,
    )

    print(f"Outputs:  {outputs}")

    return workflow_service_response

    # - THIS WILL BE PART OF THE BACKEND (via @ag.workflow) ---------------- END ---


if __name__ == "__main__":
    print()
    run_async(main())
    print()
