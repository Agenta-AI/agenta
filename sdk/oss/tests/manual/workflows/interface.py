from typing import Callable, Union
from asyncio import run as run_async
from time import time_ns
from uuid import uuid4
from os import getenv
from sys import argv

from pydantic import BaseModel
from aiohttp import ClientSession
from fastapi import FastAPI

from agenta.sdk.models.workflows import (
    WorkflowRevision,
    WorkflowRevisionData,
    WorkflowServiceRequest,
    WorkflowServiceResponse,
    WorkflowServiceRequestData,
    Status,
    Data,
)

from agenta.sdk.workflows.utils import parse_service_uri
from agenta.sdk.workflows.handlers import exact_match_v1

import agenta as ag

AGENTA_API_URL = "http://localhost/api"
AGENTA_API_KEY = getenv("AGENTA_API_KEY")

# TODO:
# - Add service URI definitions
# - Add URI-based service schemas
# - Talk about paths
# - Check if it should be revision or revision.data in invoke


def debug(func):
    async def wrapper(*args, **kwargs):
        start_time = time_ns()
        print("-" * 40)
        print(f"Running:  {func.__name__}")
        # print(f"Request:  {args} & {kwargs}")
        result = await func(*args, **kwargs)
        end_time = time_ns()
        if isinstance(result, BaseModel):
            print(f"Response: {result.model_dump(mode='json', exclude_none=True)}")
        else:
            print(f"Response: {result}")
        print(f"Elapsed:  {(end_time - start_time) / 1_000_000} ms")
        return result

    return wrapper


TEST_INPUTS = {
    "text": "Hello, world!",
    "result": "Hello, World!",
}

TEST_OUTPUTS = "Hello, World!"

TEST_PARAMETERS = {
    "/": {
        "reference_key": "result",
    }
}

TEST_SCRIPT = """
# - THIS WILL BE PART OF THE SDK (import agenta as ag) ----------------- START -

from typing import Callable
from uuid import uuid4

from agenta.sdk.workflows.types import (
    WorkflowRevision,
    WorkflowRevisionData,
    WorkflowServiceRequestData,
    WorkflowServiceRequestData,
    WorkflowServiceResponseData,
    WorkflowServiceRequest,
    WorkflowServiceResponse,
    WorkflowServiceInterface,
    Status,
    Data,
)

from agenta.sdk.workflows.utils import parse_service_uri

async def local_call(
    request: WorkflowServiceRequest,
    revision: WorkflowRevision,
    handler: Callable,
):
    parameters = revision.data.parameters.get(request.path, {})

    # INPUTS/PARAMETERS VALUES  MAPPINGS
    # INPUTS/PARAMETERS SCHEMAS VALIDATION

    outputs = await handler(
        # request=request,
        # revision=revision,
        inputs=request.data.inputs,
        parameters=parameters,
        outputs=request.data.outputs,
    )

    # OUTPUTS/RESULTS VALUES MAPPINGS
    # OUTPUTS/RESULTS SCHEMAS VALIDATION

    response = WorkflowServiceResponse(
        id=uuid4(),
        version="2025.07.14",
        status=Status(
            code=200,
            message="Success",
        ),
        data=WorkflowServiceRequestData(
            outputs=outputs,
            # trace=
        ),
    )

    return response

def ag_workflow(
    workflow_handler: Callable,
) -> Data:
    async def workflow_decorator_wrapper(
        workflow_service_request: WorkflowServiceRequest,
        workflow_revision_data: WorkflowRevisionData,
    ):
        workflow_revision = WorkflowRevision(
            data=workflow_revision_data,
        )

        return await local_call(
            request=workflow_service_request,
            revision=workflow_revision,
            handler=workflow_handler,
        )

    return workflow_decorator_wrapper

def ag_instrument(
    workflow_handler: Callable,
) -> Data:

    return workflow_handler

# - THIS WILL BE PART OF THE SDK (import agenta as ag) ----------------- END ---


# - THIS IS THE USER'S CODE -------------------------------------------- START -

from json import dumps

from agenta.sdk.workflows.types import Data


@ag_workflow
@ag_instrument
async def exact_match_v1(
    *,
    inputs: Data,
    outputs: Data | str,
    parameters: Data,
) -> Data:
    reference_key = parameters.get("reference_key", None)
    reference_outputs = inputs.get(reference_key, None)

    if isinstance(outputs, str) and isinstance(reference_outputs, str):
        success = outputs == reference_outputs
    elif isinstance(outputs, dict) and isinstance(reference_outputs, dict):
        outputs = dumps(outputs, sort_keys=True)
        reference_outputs = dumps(reference_outputs, sort_keys=True)
        success = outputs == reference_outputs
    else:
        success = False

    return {"success": success}

# - THIS IS THE USER'S CODE -------------------------------------------- END ---


# - THIS WILL BE PART OF THE SDK (via @ag.workflow) -------------------- START -

__ag_workflow_registry__ = {
    "/": {
        "invoke": exact_match_v1,
    }
}

# - THIS WILL BE PART OF THE SDK (via @ag.workflow) -------------------- END ---
"""

EXEC_SCRIPT = """
# - THIS WILL BE PART OF THE BACKEND (via @ag.workflow) ---------------- START -

async def __ag_workflow_runner__():
    path = {workflow_revision_data}.get("parameters", {{}}).get("path", "/")
    method = {workflow_revision_data}.get("parameters", {{}}).get("method", "invoke")
    handler = __ag_workflow_registry__.get(path, {{}}).get(method, None)

    if not handler:
        return WorkflowServiceResponse(
            status=Status(
                code=400,
                message="Could not find service handler for the given URI, path, and method.",
            )
        )

    return await handler(
        workflow_service_request=WorkflowServiceRequest(**{workflow_service_request}),
        workflow_revision_data=WorkflowRevisionData(**{workflow_revision_data}),
    )

return await __ag_workflow_runner__()  # UNCOMMENT THIS

# - THIS WILL BE PART OF THE BACKEND (via @ag.workflow) ---------------- END ---


"""


async def run_script_locally(
    *,
    workflow_service_request: WorkflowServiceRequest,
    workflow_revision_data: WorkflowRevisionData,
) -> Union[Data, str]:
    actual_script = (
        TEST_SCRIPT
        + "\n"
        + EXEC_SCRIPT.format(
            workflow_service_request=workflow_service_request.model_dump(
                mode="json",
                exclude_none=True,
            ),
            workflow_revision_data=workflow_revision_data.model_dump(
                mode="json",
                exclude_none=True,
            ),
        )
    )

    async def async_exec(code: str, globals_dict=None, locals_dict=None):
        # Wrap code in async def so we can await it
        wrapper_name = "__ag_workflow_script__"
        indented_code = "\n".join(f"    {line}" for line in code.splitlines())
        wrapped = f"async def {wrapper_name}():\n{indented_code}"

        exec_globals = globals_dict if globals_dict is not None else {}
        exec_locals = locals_dict if locals_dict is not None else exec_globals

        # Compile the async wrapper
        exec(wrapped, exec_globals, exec_locals)

        # Await and return result
        return await exec_locals[wrapper_name]()

    result = await async_exec(actual_script)

    return result


# A DECORATOR THAT USES local_call to wrap functions, like exact_match
def workflow_decorator(
    workflow_handler: Callable,
) -> Data:
    async def local_call(
        request: WorkflowServiceRequest,
        revision: WorkflowRevision,
        handler: Callable,
    ):
        parameters = revision.data.parameters.get(request.path, {})

        outputs = await handler(
            # request=request,
            # revision=revision,
            inputs=request.data.inputs,
            parameters=parameters,
            outputs=request.data.outputs,
        )

        # OUTPUTS/RESULTS VALUES MAPPINGS
        # OUTPUTS/RESULTS SCHEMAS VALIDATION

        response = WorkflowServiceResponse(
            id=uuid4(),
            version="2025.07.14",
            status=Status(
                code=200,
                message="Success",
            ),
            data=WorkflowServiceRequestData(
                outputs=outputs,
                # trace=
            ),
        )

        return response

    async def workflow_decorator_wrapper(
        workflow_service_request: WorkflowServiceRequest,
        workflow_revision_data: WorkflowRevisionData,
    ):
        workflow_revision = WorkflowRevision(
            data=workflow_revision_data,
        )

        return await local_call(
            request=workflow_service_request,
            revision=workflow_revision,
            handler=workflow_handler,
        )

    return workflow_decorator_wrapper


HANDLER_REGISTRY = {
    "agenta": {
        "function": {
            "exact_match": {
                "latest": workflow_decorator(exact_match_v1),
                "v1": workflow_decorator(exact_match_v1),
            },
        },
        "code": {
            "local": {
                "latest": run_script_locally,
                "v1": run_script_locally,
            }
        },
    },
}


app = FastAPI()

app.add_api_route(
    "/agenta-function-exact_match-latest",
    workflow_decorator(exact_match_v1),
    methods=["POST"],
)


async def health_check():
    return {"status": "ok"}


app.add_api_route(
    "/health",
    health_check,
)


class WorkflowServiceHandler:
    def __init__(
        self,
        api_url: str,
        api_key: str,
    ):
        self.api_url = api_url
        self.api_key = api_key

    async def invoke(
        self,
        *,
        request: WorkflowServiceRequest,
        revision: WorkflowRevision,
        force_remote: bool = False,
    ):
        (
            service_provider,
            service_kind,
            service_key,
            service_version,
        ) = await parse_service_uri(
            uri=revision.data.uri,
        )

        if force_remote:
            return await self.remote_call(
                request=request,
                revision=revision,
            )

        handler = (
            HANDLER_REGISTRY.get(service_provider, {})
            .get(service_kind, {})
            .get(service_key, {})
            .get(service_version, None)
        )

        if not handler:
            return WorkflowServiceResponse(
                status=Status(
                    code=400,
                    message="Could not find service handler for the given URI.",
                )
            )

        return await handler(
            workflow_service_request=request,
            workflow_revision_data=revision.data,
        )

    async def remote_call(
        self,
        *,
        request: WorkflowServiceRequest,
        revision: WorkflowRevision,
    ):
        # CALL API_URL
        async with ClientSession() as session:
            async with session.post(
                f"{self.api_url}/preview/workflows/invoke",
                json={
                    "workflow_service_request": request.model_dump(
                        mode="json",
                        exclude_none=True,
                    ),
                    "workflow_revision_data": revision.data.model_dump(
                        mode="json",
                        exclude_none=True,
                    ),
                },
                headers={"Authorization": f"ApiKey {self.api_key}"},
            ) as response:
                if response.status != 200:
                    return WorkflowServiceResponse(
                        status=Status(
                            code=response.status,
                            message=response.reason,
                        )
                    )

                data = await response.json()

                return WorkflowServiceResponse(**data)


workflow_service_handler = WorkflowServiceHandler(
    api_url=AGENTA_API_URL,
    api_key=AGENTA_API_KEY,
)


@debug
async def test_noop():
    pass


@debug
async def test_local_function_workflow_by_value():
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
        data=WorkflowServiceRequestData(
            inputs=TEST_INPUTS,
            outputs=TEST_OUTPUTS,
        )
    )

    print(
        "Request: ",
        workflow_service_request.data.model_dump(mode="json", exclude_none=True),
    )

    # invoke the workflow service
    workflow_service_response = await workflow_service_handler.invoke(
        request=workflow_service_request,
        revision=workflow_revision,
    )

    # check response
    if not workflow_service_response:
        return

    # check response
    status = workflow_service_response.status
    if status.code == "200":
        print("Check:   ", workflow_service_response.data.outputs["success"])
    else:
        print("Check:   ", status.model_dump(mode="json", exclude_none=True))

    return workflow_service_response


@debug
async def test_remote_function_workflow_by_value():
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
        data=WorkflowServiceRequestData(
            inputs=TEST_INPUTS,
            outputs=TEST_OUTPUTS,
        )
    )

    print(
        "Request: ",
        workflow_service_request.data.model_dump(mode="json", exclude_none=True),
    )

    # invoke the workflow service
    workflow_service_response = await workflow_service_handler.invoke(
        request=workflow_service_request,
        revision=workflow_revision,
        force_remote=True,
    )

    # check response
    if not workflow_service_response:
        return

    # check response
    status = workflow_service_response.status
    if status.code == "200":
        print("Check:   ", workflow_service_response.data.outputs["success"])
    else:
        print("Check:   ", status.model_dump(mode="json", exclude_none=True))

    return workflow_service_response


@debug
async def test_code_workflow_by_value():
    # create the workflow revision
    workflow_revision = WorkflowRevision(
        data=WorkflowRevisionData(
            uri="agenta:code:local:latest",
            script=TEST_SCRIPT,
            parameters=TEST_PARAMETERS,
        )
    )

    print(
        "Revision:",
        {
            **workflow_revision.data.model_dump(
                mode="json", exclude_none=True, exclude={"script"}
            ),
            "script": "<some-long-script>",
        },
    )

    # create the workflow request
    workflow_service_request = WorkflowServiceRequest(
        data=WorkflowServiceRequestData(
            inputs=TEST_INPUTS,
            outputs=TEST_OUTPUTS,
        )
    )

    print(
        "Request: ",
        workflow_service_request.data.model_dump(mode="json", exclude_none=True),
    )

    # invoke the workflow service
    workflow_service_response = await workflow_service_handler.invoke(
        request=workflow_service_request,
        revision=workflow_revision,
    )

    # check response
    if not workflow_service_response:
        return

    status = workflow_service_response.status
    if status.code == "200":
        print("Check:   ", workflow_service_response.data.outputs["success"])
    else:
        print("Check:   ", status.model_dump(mode="json", exclude_none=True))

    return workflow_service_response


@debug
async def test_hook_workflow_by_value_direct():
    # create the workflow revision
    workflow_revision = WorkflowRevision(
        data=WorkflowRevisionData(
            url="http://localhost:8888/agenta-function-exact_match-latest",
            parameters=TEST_PARAMETERS,
        )
    )

    print(
        "Revision:", workflow_revision.data.model_dump(mode="json", exclude_none=True)
    )

    # create the workflow request
    workflow_service_request = WorkflowServiceRequest(
        data=WorkflowServiceRequestData(
            inputs=TEST_INPUTS,
            outputs=TEST_OUTPUTS,
        )
    )

    print(
        "Request: ",
        workflow_service_request.data.model_dump(mode="json", exclude_none=True),
    )

    url = workflow_revision.data.url

    data = {
        "workflow_service_request": workflow_service_request.model_dump(
            mode="json",
            exclude_none=True,
        ),
        "workflow_revision_data": workflow_revision.data.model_dump(
            mode="json",
            exclude_none=True,
        ),
    }

    headers = {"Authorization": f"ApiKey {AGENTA_API_KEY}"}
    if workflow_revision.data and workflow_revision.data.headers:
        path_headers = workflow_revision.data.headers[workflow_service_request.path]
        for key, value in (path_headers or {}).items():
            if isinstance(value, str):
                headers[key] = path_headers[value]
            else:
                pass

    # invoke the workflow service
    async with ClientSession() as session:
        async with session.post(
            url=url,
            json=data,
            headers=headers,
        ) as response:
            if response.status != 200:
                workflow_service_response = WorkflowServiceResponse(
                    status=Status(
                        code=response.status,
                        message=response.reason,
                    )
                )
            else:
                data = await response.json()

                workflow_service_response = WorkflowServiceResponse(**data)

    # check response
    if not workflow_service_response:
        return

    # check response
    status = workflow_service_response.status
    if status.code == "200":
        print("Check:   ", workflow_service_response.data.outputs["success"])
    else:
        print("Check:   ", status.model_dump(mode="json", exclude_none=True))

    return workflow_service_response


@debug
async def test_local_function_workflow_by_reference():
    # invoke the workflow

    # check response
    pass


@debug
async def test_remote_function_workflow_by_reference():
    # invoke the workflow

    # check response
    pass


@debug
async def test_code_workflow_by_reference():
    # create a workflow (incl variant and revision)

    # invoke the workflow

    # check response
    pass


@debug
async def test_hook_workflow_by_reference():
    # create a workflow (incl variant and revision)

    # invoke the workflow

    # check response
    pass


print("-------------------------------------------------")

ag.init(
    api_url=AGENTA_API_URL,
    api_key=AGENTA_API_KEY,
)


async def main():
    await test_noop()

    await test_local_function_workflow_by_value()
    await test_remote_function_workflow_by_value()
    await test_code_workflow_by_value()
    await test_hook_workflow_by_value_direct()

    # await test_local_function_workflow_by_reference()
    # await test_remote_function_workflow_by_reference()
    # await test_code_workflow_by_reference()
    # await test_hook_workflow_by_reference()


if __name__ == "__main__":
    args = argv[1:]
    serve = "--serve" in args

    if not serve:
        run_async(main())

    else:
        import uvicorn

        # quit with ctrl+c
        uvicorn.run(
            "tests.manual.workflows.interface:app",
            host="0.0.0.0",
            port=8888,
            log_level="info",
            reload=True,
        )
