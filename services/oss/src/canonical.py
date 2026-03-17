from typing import Any, Awaitable, Callable, Optional, Union

import agenta as ag

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


def _create_canonical_service(handler: CanonicalHandler):
    service_app = ag.create_app()

    @ag.route("/", app=service_app)
    async def workflow_service(
        revision: Optional[Data] = None,
        inputs: Optional[Data] = None,
        parameters: Optional[Data] = None,
        outputs: Optional[Union[Data, str, int, float, bool, list, None]] = None,
        trace: Optional[Data] = None,
        testcase: Optional[Data] = None,
    ):
        return await handler(
            request=None,
            revision=revision,
            inputs=inputs,
            parameters=parameters,
            outputs=outputs,
            trace=trace,
            testcase=testcase,
        )

    return service_app


custom_code_app = _create_canonical_service(code_v0)
custom_hook_app = _create_canonical_service(hook_v0)
custom_trace_app = _create_canonical_service(trace_v0)

builtin_match_app = _create_canonical_service(match_v0)
builtin_prompt_app = _create_canonical_service(prompt_v0)
builtin_agent_app = _create_canonical_service(agent_v0)
