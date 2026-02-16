# /agenta/sdk/workflows/utils.py

from typing import Optional, Tuple, Callable

from agenta.sdk.models.workflows import WorkflowServiceInterface

from agenta.sdk.workflows.handlers import (
    echo_v0,
    auto_exact_match_v0,
    auto_regex_test_v0,
    field_match_test_v0,
    auto_webhook_test_v0,
    auto_custom_code_run_v0,
    auto_ai_critique_v0,
    auto_starts_with_v0,
    auto_ends_with_v0,
    auto_contains_v0,
    auto_contains_any_v0,
    auto_contains_all_v0,
    auto_contains_json_v0,
    auto_json_diff_v0,
    auto_levenshtein_distance_v0,
    auto_similarity_match_v0,
    auto_semantic_similarity_v0,
    completion_v0,
    chat_v0,
)

from agenta.sdk.workflows.interfaces import (
    echo_v0_interface,
    auto_exact_match_v0_interface,
    auto_regex_test_v0_interface,
    field_match_test_v0_interface,
    auto_webhook_test_v0_interface,
    auto_custom_code_run_v0_interface,
    auto_ai_critique_v0_interface,
    auto_starts_with_v0_interface,
    auto_ends_with_v0_interface,
    auto_contains_v0_interface,
    auto_contains_any_v0_interface,
    auto_contains_all_v0_interface,
    auto_contains_json_v0_interface,
    auto_json_diff_v0_interface,
    auto_levenshtein_distance_v0_interface,
    auto_similarity_match_v0_interface,
    auto_semantic_similarity_v0_interface,
    completion_v0_interface,
    chat_v0_interface,
)


from agenta.sdk.workflows.configurations import (
    echo_v0_configuration,
    auto_exact_match_v0_configuration,
    auto_regex_test_v0_configuration,
    field_match_test_v0_configuration,
    auto_webhook_test_v0_configuration,
    auto_custom_code_run_v0_configuration,
    auto_ai_critique_v0_configuration,
    auto_starts_with_v0_configuration,
    auto_ends_with_v0_configuration,
    auto_contains_v0_configuration,
    auto_contains_any_v0_configuration,
    auto_contains_all_v0_configuration,
    auto_contains_json_v0_configuration,
    auto_json_diff_v0_configuration,
    auto_levenshtein_distance_v0_configuration,
    auto_similarity_match_v0_configuration,
    auto_semantic_similarity_v0_configuration,
    completion_v0_configuration,
    chat_v0_configuration,
)

INTERFACE_REGISTRY: dict = dict(
    agenta={
        "built-in": dict(
            echo=dict(v0=echo_v0_interface),
            auto_exact_match=dict(v0=auto_exact_match_v0_interface),
            auto_regex_test=dict(v0=auto_regex_test_v0_interface),
            field_match_test=dict(v0=field_match_test_v0_interface),
            auto_webhook_test=dict(v0=auto_webhook_test_v0_interface),
            auto_custom_code_run=dict(v0=auto_custom_code_run_v0_interface),
            auto_ai_critique=dict(v0=auto_ai_critique_v0_interface),
            auto_starts_with=dict(v0=auto_starts_with_v0_interface),
            auto_ends_with=dict(v0=auto_ends_with_v0_interface),
            auto_contains=dict(v0=auto_contains_v0_interface),
            auto_contains_any=dict(v0=auto_contains_any_v0_interface),
            auto_contains_all=dict(v0=auto_contains_all_v0_interface),
            auto_contains_json=dict(v0=auto_contains_json_v0_interface),
            auto_json_diff=dict(v0=auto_json_diff_v0_interface),
            auto_levenshtein_distance=dict(v0=auto_levenshtein_distance_v0_interface),
            auto_similarity_match=dict(v0=auto_similarity_match_v0_interface),
            auto_semantic_similarity=dict(v0=auto_semantic_similarity_v0_interface),
            completion=dict(v0=completion_v0_interface),
            chat=dict(v0=chat_v0_interface),
        ),
    },
)

CONFIGURATION_REGISTRY: dict = dict(
    agenta={
        "built-in": dict(
            echo=dict(v0=echo_v0_configuration),
            auto_exact_match=dict(v0=auto_exact_match_v0_configuration),
            auto_regex_test=dict(v0=auto_regex_test_v0_configuration),
            field_match_test=dict(v0=field_match_test_v0_configuration),
            auto_webhook_test=dict(v0=auto_webhook_test_v0_configuration),
            auto_custom_code_run=dict(v0=auto_custom_code_run_v0_configuration),
            auto_ai_critique=dict(v0=auto_ai_critique_v0_configuration),
            auto_starts_with=dict(v0=auto_starts_with_v0_configuration),
            auto_ends_with=dict(v0=auto_ends_with_v0_configuration),
            auto_contains=dict(v0=auto_contains_v0_configuration),
            auto_contains_any=dict(v0=auto_contains_any_v0_configuration),
            auto_contains_all=dict(v0=auto_contains_all_v0_configuration),
            auto_contains_json=dict(v0=auto_contains_json_v0_configuration),
            auto_json_diff=dict(v0=auto_json_diff_v0_configuration),
            auto_levenshtein_distance=dict(
                v0=auto_levenshtein_distance_v0_configuration
            ),
            auto_similarity_match=dict(v0=auto_similarity_match_v0_configuration),
            auto_semantic_similarity=dict(v0=auto_semantic_similarity_v0_configuration),
            completion=dict(v0=completion_v0_configuration),
            chat=dict(v0=chat_v0_configuration),
        ),
    },
)

# Global registry for workflow handlers organized by URI structure.
#
# URI Format: provider:kind:key:version
#
# Structure:
#   HANDLER_REGISTRY[provider][kind][key][version] = handler_callable
#
# Components:
#   - provider: The source/namespace of the handler (e.g., "agenta", "user")
#   - kind: The category/type of handler (e.g., "built-in", "custom")
#   - key: The unique identifier for the handler (e.g., "echo", "auto_exact_match", "module.function_name")
#   - version: The version identifier (e.g., "v0", "v1", "latest")
#
# Examples:
#   - URI: "agenta:built-in:echo:v0"
#     Access: HANDLER_REGISTRY["agenta"]["built-in"]["echo"]["v0"]
#
#   - URI: "user:custom:mymodule.my_workflow:latest"
#     Access: HANDLER_REGISTRY["user"]["custom"]["mymodule.my_workflow"]["latest"]
#
# Usage:
#   - register_handler(fn, uri) - Registers a new handler with the given URI
#   - retrieve_handler(uri) - Retrieves a handler by its URI
#   - retrieve_interface(uri) - Retrieves the interface configuration for a handler
#   - retrieve_configuration(uri) - Retrieves default parameters for a handler
#
# The registry supports automatic URI generation for user-defined workflows:
#   If no URI is provided, register_handler() generates: "user:custom:{module}.{name}:latest"
HANDLER_REGISTRY: dict = dict(
    agenta={
        "built-in": dict(
            echo=dict(v0=echo_v0),
            auto_exact_match=dict(v0=auto_exact_match_v0),
            auto_regex_test=dict(v0=auto_regex_test_v0),
            field_match_test=dict(v0=field_match_test_v0),
            auto_webhook_test=dict(v0=auto_webhook_test_v0),
            auto_custom_code_run=dict(v0=auto_custom_code_run_v0),
            auto_ai_critique=dict(v0=auto_ai_critique_v0),
            auto_starts_with=dict(v0=auto_starts_with_v0),
            auto_ends_with=dict(v0=auto_ends_with_v0),
            auto_contains=dict(v0=auto_contains_v0),
            auto_contains_any=dict(v0=auto_contains_any_v0),
            auto_contains_all=dict(v0=auto_contains_all_v0),
            auto_contains_json=dict(v0=auto_contains_json_v0),
            auto_json_diff=dict(v0=auto_json_diff_v0),
            auto_levenshtein_distance=dict(v0=auto_levenshtein_distance_v0),
            auto_similarity_match=dict(v0=auto_similarity_match_v0),
            auto_semantic_similarity=dict(v0=auto_semantic_similarity_v0),
            completion=dict(v0=completion_v0),
            chat=dict(v0=chat_v0),
        ),
    },
)


def parse_uri(
    uri: str,
) -> Tuple[Optional[str], Optional[str], Optional[str], Optional[str]]:
    if not uri or not uri.strip():
        return None, None, None, None

    parts = uri.split(":")

    # 1 → key
    # 2 → kind:key
    # 3 → provider:kind:key
    # 4 → provider:kind:key:version
    if len(parts) == 1:
        provider, kind, key, version = "agenta", "built-in", parts[0], "latest"
    elif len(parts) == 2:
        provider, kind, key, version = "agenta", parts[0], parts[1], "latest"
    elif len(parts) == 3:
        provider, kind, key, version = parts[0], parts[1], parts[2], "latest"
    elif len(parts) == 4:
        provider, kind, key, version = parts[0], parts[1], parts[2], parts[3]
    else:
        return None, None, None, None

    return provider, kind, key, version


def register_handler(fn: Callable, uri: Optional[str] = None) -> str:
    """Register a handler function in the global handler registry.

    Stores a callable in the HANDLER_REGISTRY with a hierarchical URI structure
    of provider:kind:key:version. If no URI is provided, generates one automatically
    using the function's module and name (user:custom:module.name:latest).

    The URI is parsed into components and used to create nested dictionary entries
    in the registry for later retrieval by retrieve_handler().

    Args:
        fn: The callable function to register
        uri: Optional URI string in format "provider:kind:key:version".
             If None, auto-generates "user:custom:{module}.{name}:latest"

    Returns:
        The URI string used for registration

    Raises:
        ValueError: If the URI is invalid or missing required components

    Example:
        >>> def my_workflow(): pass
        >>> uri = register_handler(my_workflow, "user:custom:my_workflow:v1")
        >>> uri
        'user:custom:my_workflow:v1'
    """
    if not uri:
        key = f"{fn.__module__}.{fn.__name__}"
        uri = f"user:custom:{key}:latest"

    provider, kind, key, version = parse_uri(uri)  # type: ignore

    if not provider or not kind or not key or not version:
        raise ValueError(f"Invalid URI: {uri}")

    HANDLER_REGISTRY.setdefault(provider, {}).setdefault(kind, {}).setdefault(
        key, {}
    ).setdefault(version, fn)

    return uri


def _get_with_latest(
    registry: dict,
    provider: Optional[str] = None,
    kind: Optional[str] = None,
    key: Optional[str] = None,
    version: Optional[str] = None,
):
    kind_dict = registry.get(provider, {}).get(kind, {}).get(key, {})

    if not isinstance(kind_dict, dict) or not kind_dict:
        return None

    if version == "latest":
        # if "latest" explicitly exists, prefer it
        if "latest" in kind_dict:
            return kind_dict.get("latest")

        # collect keys of the form vN
        candidates = [
            (int(v[1:]), v)
            for v in kind_dict.keys()
            if isinstance(v, str) and v.startswith("v") and v[1:].isdigit()
        ]
        if not candidates:
            return None
        # get the highest int N
        _, best_key = max(candidates, key=lambda x: x[0])
        return kind_dict.get(best_key)

    return kind_dict.get(version)


def retrieve_handler(uri: Optional[str] = None) -> Optional[Callable]:
    if not uri:
        return None
    provider, kind, key, version = parse_uri(uri)

    return _get_with_latest(HANDLER_REGISTRY, provider, kind, key, version)


def retrieve_interface(uri: Optional[str] = None) -> Optional[WorkflowServiceInterface]:
    if not uri:
        return None
    provider, kind, key, version = parse_uri(uri)

    return _get_with_latest(INTERFACE_REGISTRY, provider, kind, key, version)


def retrieve_configuration(uri: Optional[str] = None) -> Optional[dict]:
    if not uri:
        return None
    provider, kind, key, version = parse_uri(uri)

    return _get_with_latest(CONFIGURATION_REGISTRY, provider, kind, key, version)


def is_custom_uri(uri: Optional[str] = None) -> bool:
    if not uri:
        return True

    provider, kind, key, version = parse_uri(uri)

    return provider == "user" and kind == "custom"
