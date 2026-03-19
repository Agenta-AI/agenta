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
)


ManagedHandler = Callable[..., Awaitable[Any]]


def _create_managed_service(
    handler: ManagedHandler,
):
    service_app = ag.create_app()
    ag.route("/", app=service_app)(handler)
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
