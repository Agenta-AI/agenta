from typing import Any, Awaitable, Callable, Optional, Union

import agenta as ag
from pydantic import BaseModel, Field

from agenta.sdk.models.shared import Data
from agenta.sdk.engines.running.handlers import (
    agent_v0,
    code_v0,
    hook_v0,
    match_v0,
    prompt_v0,
    trace_v0,
)


CanonicalHandler = Callable[..., Awaitable[Any]]


class WorkflowServiceData(BaseModel):
    revision: Optional[Data] = None
    inputs: Optional[Data] = None
    parameters: Optional[Data] = None
    outputs: Optional[Union[Data, str, int, float, bool, list, None]] = None
    trace: Optional[Data] = None
    testcase: Optional[Data] = None


class WorkflowServiceRequest(BaseModel):
    data: WorkflowServiceData = Field(default_factory=WorkflowServiceData)


def _create_canonical_service(
    handler: CanonicalHandler,
    *,
    route_name: str,
):
    service_app = ag.create_app()

    async def workflow_service(
        request: WorkflowServiceRequest,
    ):
        data = request.data
        return await handler(
            request=None,
            revision=data.revision,
            inputs=data.inputs,
            parameters=data.parameters,
            outputs=data.outputs,
            trace=data.trace,
            testcase=data.testcase,
        )

    workflow_service.__name__ = route_name
    workflow_service.__qualname__ = route_name
    ag.route("/", app=service_app)(workflow_service)

    return service_app


custom_code_app = _create_canonical_service(
    code_v0,
    route_name="custom_code_workflow_service",
)
custom_hook_app = _create_canonical_service(
    hook_v0,
    route_name="custom_hook_workflow_service",
)
custom_trace_app = _create_canonical_service(
    trace_v0,
    route_name="custom_trace_workflow_service",
)

builtin_match_app = _create_canonical_service(
    match_v0,
    route_name="builtin_match_workflow_service",
)
builtin_prompt_app = _create_canonical_service(
    prompt_v0,
    route_name="builtin_prompt_workflow_service",
)
builtin_agent_app = _create_canonical_service(
    agent_v0,
    route_name="builtin_agent_workflow_service",
)
