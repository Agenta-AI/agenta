from typing import Any, Awaitable, Callable, Optional, Union

import agenta as ag
from pydantic import BaseModel, Field

from agenta.sdk.models.shared import Data
from agenta.sdk.engines.running.handlers import (
    auto_ai_critique_v0,
    auto_contains_all_v0,
    auto_contains_any_v0,
    auto_contains_json_v0,
    auto_contains_v0,
    auto_custom_code_run_v0,
    auto_ends_with_v0,
    auto_exact_match_v0,
    auto_json_diff_v0,
    auto_levenshtein_distance_v0,
    auto_regex_test_v0,
    auto_semantic_similarity_v0,
    auto_similarity_match_v0,
    auto_starts_with_v0,
    auto_webhook_test_v0,
    code_v0,
    field_match_test_v0,
    hook_v0,
    json_multi_field_match_v0,
    llm_v0,
    match_v0,
)


ManagedHandler = Callable[..., Awaitable[Any]]


class WorkflowServiceData(BaseModel):
    revision: Optional[Data] = None
    inputs: Optional[Data] = None
    parameters: Optional[Data] = None
    outputs: Optional[Union[Data, str, int, float, bool, list, None]] = None
    trace: Optional[Data] = None
    testcase: Optional[Data] = None


class WorkflowServiceRequest(BaseModel):
    data: WorkflowServiceData = Field(default_factory=WorkflowServiceData)


def _create_managed_service(
    handler: ManagedHandler,
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

    workflow_service.__name__ = handler.__name__
    workflow_service.__qualname__ = handler.__name__
    ag.route("/", app=service_app)(workflow_service)

    return service_app


custom_code_app = _create_managed_service(
    code_v0,
)
custom_hook_app = _create_managed_service(
    hook_v0,
)
builtin_match_app = _create_managed_service(
    match_v0,
)
builtin_llm_app = _create_managed_service(
    llm_v0,
)
builtin_auto_exact_match_app = _create_managed_service(
    auto_exact_match_v0,
)
builtin_auto_regex_test_app = _create_managed_service(
    auto_regex_test_v0,
)
builtin_field_match_test_app = _create_managed_service(
    field_match_test_v0,
)
builtin_json_multi_field_match_app = _create_managed_service(
    json_multi_field_match_v0,
)
builtin_auto_webhook_test_app = _create_managed_service(
    auto_webhook_test_v0,
)
builtin_auto_custom_code_run_app = _create_managed_service(
    auto_custom_code_run_v0,
)
builtin_auto_ai_critique_app = _create_managed_service(
    auto_ai_critique_v0,
)
builtin_auto_starts_with_app = _create_managed_service(
    auto_starts_with_v0,
)
builtin_auto_ends_with_app = _create_managed_service(
    auto_ends_with_v0,
)
builtin_auto_contains_app = _create_managed_service(
    auto_contains_v0,
)
builtin_auto_contains_any_app = _create_managed_service(
    auto_contains_any_v0,
)
builtin_auto_contains_all_app = _create_managed_service(
    auto_contains_all_v0,
)
builtin_auto_contains_json_app = _create_managed_service(
    auto_contains_json_v0,
)
builtin_auto_json_diff_app = _create_managed_service(
    auto_json_diff_v0,
)
builtin_auto_levenshtein_distance_app = _create_managed_service(
    auto_levenshtein_distance_v0,
)
builtin_auto_similarity_match_app = _create_managed_service(
    auto_similarity_match_v0,
)
builtin_auto_semantic_similarity_app = _create_managed_service(
    auto_semantic_similarity_v0,
)
