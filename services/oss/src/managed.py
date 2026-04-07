from typing import Any, Awaitable, Callable

import agenta as ag

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
    config_v0,
)


ManagedHandler = Callable[..., Awaitable[Any]]


def _create_managed_service(
    handler: ManagedHandler,
    *,
    uri: str | None = None,
):
    service_app = ag.create_app()
    routed = ag.workflow(uri=uri)(handler) if uri else handler
    ag.route("/", app=service_app)(routed)
    return service_app


custom_config_app = _create_managed_service(
    config_v0,
)
custom_code_app = _create_managed_service(
    code_v0,
    uri="agenta:custom:code:v0",
)
custom_hook_app = _create_managed_service(
    hook_v0,
    uri="agenta:custom:hook:v0",
)
builtin_match_app = _create_managed_service(
    match_v0,
    uri="agenta:builtin:match:v0",
)
builtin_llm_app = _create_managed_service(
    llm_v0,
    uri="agenta:builtin:llm:v0",
)
builtin_auto_exact_match_app = _create_managed_service(
    auto_exact_match_v0,
    uri="agenta:builtin:auto_exact_match:v0",
)
builtin_auto_regex_test_app = _create_managed_service(
    auto_regex_test_v0,
    uri="agenta:builtin:auto_regex_test:v0",
)
builtin_field_match_test_app = _create_managed_service(
    field_match_test_v0,
    uri="agenta:builtin:field_match_test:v0",
)
builtin_json_multi_field_match_app = _create_managed_service(
    json_multi_field_match_v0,
    uri="agenta:builtin:json_multi_field_match:v0",
)
builtin_auto_webhook_test_app = _create_managed_service(
    auto_webhook_test_v0,
    uri="agenta:builtin:auto_webhook_test:v0",
)
builtin_auto_custom_code_run_app = _create_managed_service(
    auto_custom_code_run_v0,
    uri="agenta:builtin:auto_custom_code_run:v0",
)
builtin_auto_ai_critique_app = _create_managed_service(
    auto_ai_critique_v0,
    uri="agenta:builtin:auto_ai_critique:v0",
)
builtin_auto_starts_with_app = _create_managed_service(
    auto_starts_with_v0,
    uri="agenta:builtin:auto_starts_with:v0",
)
builtin_auto_ends_with_app = _create_managed_service(
    auto_ends_with_v0,
    uri="agenta:builtin:auto_ends_with:v0",
)
builtin_auto_contains_app = _create_managed_service(
    auto_contains_v0,
    uri="agenta:builtin:auto_contains:v0",
)
builtin_auto_contains_any_app = _create_managed_service(
    auto_contains_any_v0,
    uri="agenta:builtin:auto_contains_any:v0",
)
builtin_auto_contains_all_app = _create_managed_service(
    auto_contains_all_v0,
    uri="agenta:builtin:auto_contains_all:v0",
)
builtin_auto_contains_json_app = _create_managed_service(
    auto_contains_json_v0,
    uri="agenta:builtin:auto_contains_json:v0",
)
builtin_auto_json_diff_app = _create_managed_service(
    auto_json_diff_v0,
    uri="agenta:builtin:auto_json_diff:v0",
)
builtin_auto_levenshtein_distance_app = _create_managed_service(
    auto_levenshtein_distance_v0,
    uri="agenta:builtin:auto_levenshtein_distance:v0",
)
builtin_auto_similarity_match_app = _create_managed_service(
    auto_similarity_match_v0,
    uri="agenta:builtin:auto_similarity_match:v0",
)
builtin_auto_semantic_similarity_app = _create_managed_service(
    auto_semantic_similarity_v0,
    uri="agenta:builtin:auto_semantic_similarity:v0",
)
