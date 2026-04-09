# /agenta/sdk/workflows/utils.py

from typing import Any, Dict, List, Optional, Tuple, Callable

from agenta.sdk.models.workflows import (
    WorkflowFlags,
    WorkflowRevisionData,
)

from agenta.sdk.engines.running.handlers import (
    # --- NEW URI
    feedback_v0,
    hook_v0,
    code_v0,
    config_v0,
    match_v0,
    llm_v0,
    # --- OLD URI
    chat_v0,
    completion_v0,
    echo_v0,
    auto_exact_match_v0,
    auto_regex_test_v0,
    field_match_test_v0,
    json_multi_field_match_v0,
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
)

from agenta.sdk.engines.running.interfaces import (
    # --- NEW URI
    feedback_v0_interface,
    hook_v0_interface,
    code_v0_interface,
    config_v0_interface,
    match_v0_interface,
    llm_v0_interface,
    # --- OLD URI
    chat_v0_interface,
    completion_v0_interface,
    echo_v0_interface,
    auto_exact_match_v0_interface,
    auto_regex_test_v0_interface,
    field_match_test_v0_interface,
    json_multi_field_match_v0_interface,
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
)

INTERFACE_REGISTRY: dict = dict(
    agenta=dict(
        custom=dict(
            # --- NEW URI
            feedback=dict(v0=feedback_v0_interface),
            hook=dict(v0=hook_v0_interface),
            code=dict(v0=code_v0_interface),
            snippet=dict(v0=config_v0_interface),
        ),
        builtin=dict(
            # --- NEW URI
            match=dict(v0=match_v0_interface),
            llm=dict(v0=llm_v0_interface),
            # --- OLD URI
            chat=dict(v0=chat_v0_interface),
            completion=dict(v0=completion_v0_interface),
            echo=dict(v0=echo_v0_interface),
            auto_exact_match=dict(v0=auto_exact_match_v0_interface),
            auto_regex_test=dict(v0=auto_regex_test_v0_interface),
            field_match_test=dict(v0=field_match_test_v0_interface),
            json_multi_field_match=dict(v0=json_multi_field_match_v0_interface),
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
        ),
    ),
)


def _catalog_entry() -> dict:
    return dict(
        name=None,
        description=None,
        categories=None,
        flags=None,
        presets=[],
    )


CATALOG_REGISTRY: dict = dict(
    agenta=dict(
        custom=dict(
            feedback=dict(
                v0=dict(
                    name="Custom Feedback",
                    description="Capture external feedback or a manual annotation.",
                    categories=[],
                    flags=WorkflowFlags(
                        is_application=True,
                        is_evaluator=True,
                        is_snippet=False,
                    ),
                    presets=[
                        dict(
                            key="quality-rating",
                            name="Quality Rating",
                            description="Rate the quality of responses with a simple thumbs up or down.",
                            categories=[],
                            flags=None,
                            data=dict(
                                uri="agenta:custom:feedback:v0",
                                schemas=dict(
                                    outputs={
                                        "$schema": "https://json-schema.org/draft/2020-12/schema",
                                        "type": "object",
                                        "properties": {"approved": {"type": "boolean"}},
                                        "required": ["approved"],
                                        "additionalProperties": False,
                                    }
                                ),
                            ),
                        ),
                    ],
                )
            ),
            hook=dict(
                v0=dict(
                    name="Custom Hook",
                    description="Invoke an HTTP(S) endpoint as a workflow step.",
                    categories=[],
                    flags=WorkflowFlags(
                        is_application=True,
                        is_evaluator=True,
                        is_snippet=False,
                    ),
                    presets=[],
                )
            ),
            code=dict(
                v0=dict(
                    name="Custom Code",
                    description="Run user-provided code as a workflow step.",
                    categories=[],
                    flags=WorkflowFlags(
                        is_application=True,
                        is_evaluator=True,
                        is_snippet=False,
                    ),
                    presets=[],
                )
            ),
            snippet=dict(
                v0=dict(
                    name="Custom Snippet",
                    description="Information like instructions, guardrails, skills, rules, etc.",
                    categories=[],
                    flags=WorkflowFlags(
                        is_application=False,
                        is_evaluator=False,
                        is_snippet=True,
                    ),
                    presets=[],
                )
            ),
        ),
        builtin=dict(
            match=dict(
                v0=dict(
                    name="Builtin Matcher",
                    description="Flexible matcher for TEXT and JSON.",
                    categories=[],
                    flags=WorkflowFlags(
                        is_application=False,
                        is_evaluator=True,
                        is_snippet=False,
                    ),
                    presets=[],
                )
            ),
            llm=dict(
                v0=dict(
                    name="Builtin LLM",
                    description="Generic LLM-based workflow for single-prompt apps, multi-step agents, LLM-as-a-judge, etc.",
                    categories=[],
                    flags=WorkflowFlags(
                        is_application=True,
                        is_evaluator=True,
                        is_snippet=False,
                    ),
                    presets=[],
                )
            ),
            #
            chat=dict(
                v0=dict(
                    name="chat",
                    description="Single-prompt application for multi-turn conversations.",
                    categories=None,
                    flags=None,
                    presets=[],
                )
            ),
            completion=dict(
                v0=dict(
                    name="completion",
                    description="Single-prompt application for single-turn completions (text generation, classification, etc.).",
                    categories=None,
                    flags=None,
                    presets=[],
                )
            ),
            #
            echo=dict(v0=_catalog_entry()),
            auto_exact_match=dict(v0=_catalog_entry()),
            auto_regex_test=dict(v0=_catalog_entry()),
            field_match_test=dict(v0=_catalog_entry()),
            json_multi_field_match=dict(v0=_catalog_entry()),
            auto_webhook_test=dict(v0=_catalog_entry()),
            auto_custom_code_run=dict(v0=_catalog_entry()),
            auto_ai_critique=dict(v0=_catalog_entry()),
            auto_starts_with=dict(v0=_catalog_entry()),
            auto_ends_with=dict(v0=_catalog_entry()),
            auto_contains=dict(v0=_catalog_entry()),
            auto_contains_any=dict(v0=_catalog_entry()),
            auto_contains_all=dict(v0=_catalog_entry()),
            auto_contains_json=dict(v0=_catalog_entry()),
            auto_json_diff=dict(v0=_catalog_entry()),
            auto_levenshtein_distance=dict(v0=_catalog_entry()),
            auto_similarity_match=dict(v0=_catalog_entry()),
            auto_semantic_similarity=dict(v0=_catalog_entry()),
        ),
    ),
)

CONFIGURATION_REGISTRY: dict = dict(
    agenta=dict(
        custom=dict(
            # --- NEW URI
            feedback=dict(v0=WorkflowRevisionData()),
            hook=dict(v0=WorkflowRevisionData()),
            code=dict(v0=WorkflowRevisionData()),
            snippet=dict(v0=WorkflowRevisionData()),
        ),
        builtin=dict(
            # --- NEW URI
            match=dict(v0=WorkflowRevisionData()),
            llm=dict(v0=WorkflowRevisionData()),
            # --- OLD URI
            chat=dict(v0=WorkflowRevisionData()),
            completion=dict(v0=WorkflowRevisionData()),
            echo=dict(v0=WorkflowRevisionData()),
            auto_exact_match=dict(v0=WorkflowRevisionData()),
            auto_regex_test=dict(v0=WorkflowRevisionData()),
            field_match_test=dict(v0=WorkflowRevisionData()),
            json_multi_field_match=dict(v0=WorkflowRevisionData()),
            auto_webhook_test=dict(v0=WorkflowRevisionData()),
            auto_custom_code_run=dict(v0=WorkflowRevisionData()),
            auto_ai_critique=dict(v0=WorkflowRevisionData()),
            auto_starts_with=dict(v0=WorkflowRevisionData()),
            auto_ends_with=dict(v0=WorkflowRevisionData()),
            auto_contains=dict(v0=WorkflowRevisionData()),
            auto_contains_any=dict(v0=WorkflowRevisionData()),
            auto_contains_all=dict(v0=WorkflowRevisionData()),
            auto_contains_json=dict(v0=WorkflowRevisionData()),
            auto_json_diff=dict(v0=WorkflowRevisionData()),
            auto_levenshtein_distance=dict(v0=WorkflowRevisionData()),
            auto_similarity_match=dict(v0=WorkflowRevisionData()),
            auto_semantic_similarity=dict(v0=WorkflowRevisionData()),
        ),
    ),
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
#   - kind: The category/type of handler (e.g., "builtin", "custom")
#   - key: The unique identifier for the handler (e.g., "echo", "auto_exact_match", "module.function_name")
#   - version: The version identifier (e.g., "v0", "v1", "latest")
#
# Examples:
#   - URI: "agenta:builtin:echo:v0"
#     Access: HANDLER_REGISTRY["agenta"]["builtin"]["echo"]["v0"]
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
    agenta=dict(
        custom=dict(
            # --- NEW URI
            feedback=dict(v0=feedback_v0),
            hook=dict(v0=hook_v0),
            snippet=dict(v0=config_v0),
            code=dict(v0=code_v0),
        ),
        builtin=dict(
            # --- NEW URI
            match=dict(v0=match_v0),
            llm=dict(v0=llm_v0),
            # --- OLD URI
            chat=dict(v0=chat_v0),
            completion=dict(v0=completion_v0),
            echo=dict(v0=echo_v0),
            auto_exact_match=dict(v0=auto_exact_match_v0),
            auto_regex_test=dict(v0=auto_regex_test_v0),
            field_match_test=dict(v0=field_match_test_v0),
            json_multi_field_match=dict(v0=json_multi_field_match_v0),
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
        ),
    ),
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
        provider, kind, key, version = "agenta", "builtin", parts[0], "latest"
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


def retrieve_interface(uri: Optional[str] = None) -> Optional[WorkflowRevisionData]:
    if not uri:
        return None
    provider, kind, key, version = parse_uri(uri)

    return _get_with_latest(INTERFACE_REGISTRY, provider, kind, key, version)


def retrieve_configuration(uri: Optional[str] = None) -> Optional[dict]:
    if not uri:
        return None
    provider, kind, key, version = parse_uri(uri)

    return _get_with_latest(CONFIGURATION_REGISTRY, provider, kind, key, version)


def is_user_custom_uri(uri: Optional[str] = None) -> bool:
    if not uri:
        return True

    provider, kind, key, version = parse_uri(uri)

    return provider == "user" and kind == "custom"


# ---------------------------------------------------------------------------
# URL inference
# ---------------------------------------------------------------------------


def infer_url_from_uri(uri: Optional[str]) -> Optional[str]:
    """Infer the service URL from a managed URI.

    For managed agenta URIs, derives the mount path as /{kind}/{key}/{version}.
    Returns None for non-managed or unparseable URIs.
    """
    if not uri:
        return None
    provider, kind, key, version = parse_uri(uri)
    if provider == "agenta" and kind and key and version:
        return f"/{key}/{version}"
    return None


# ---------------------------------------------------------------------------
# Flag inference
# ---------------------------------------------------------------------------

# Positively exhaustive: every known agenta URI key must appear here.
# Unknown agenta keys raise ValueError at write time — add new keys explicitly.
# Format: (kind, key) → (is_application, is_evaluator, is_snippet)
_AGENTA_ROLE_TABLE: dict = {
    ("custom", "snippet"): (False, False, True),
    # agenta:custom:* — user-deployed code running on agenta platform
    ("custom", "code"): (True, True, False),
    ("custom", "hook"): (True, True, False),
    ("custom", "feedback"): (True, True, False),
    # agenta:builtin:* — application-only (not evaluators)
    ("builtin", "chat"): (True, False, False),
    ("builtin", "completion"): (True, False, False),
    # agenta:builtin:* — both evaluator and application
    ("builtin", "llm"): (True, True, False),
    # agenta:builtin:* — evaluator-only
    ("builtin", "match"): (False, True, False),
    ("builtin", "prompt"): (False, True, False),
    ("builtin", "agent"): (False, True, False),
    ("builtin", "echo"): (False, True, False),
    ("builtin", "human"): (False, True, False),
    ("builtin", "auto_exact_match"): (False, True, False),
    ("builtin", "auto_regex_test"): (False, True, False),
    ("builtin", "field_match_test"): (False, True, False),
    ("builtin", "json_multi_field_match"): (False, True, False),
    ("builtin", "auto_webhook_test"): (False, True, False),
    ("builtin", "auto_custom_code_run"): (False, True, False),
    ("builtin", "auto_ai_critique"): (False, True, False),
    ("builtin", "auto_starts_with"): (False, True, False),
    ("builtin", "auto_ends_with"): (False, True, False),
    ("builtin", "auto_contains"): (False, True, False),
    ("builtin", "auto_contains_any"): (False, True, False),
    ("builtin", "auto_contains_all"): (False, True, False),
    ("builtin", "auto_contains_json"): (False, True, False),
    ("builtin", "auto_json_diff"): (False, True, False),
    ("builtin", "auto_levenshtein_distance"): (False, True, False),
    ("builtin", "auto_similarity_match"): (False, True, False),
    ("builtin", "auto_semantic_similarity"): (False, True, False),
}


def _has_messages_input(inputs_schema: Optional[Dict[str, Any]]) -> bool:
    """Return True if any property in the inputs schema carries x-ag-type-ref messages/message."""
    if not isinstance(inputs_schema, dict):
        return False
    properties = inputs_schema.get("properties")
    if not isinstance(properties, dict):
        return False
    return any(
        isinstance(field, dict)
        and field.get("x-ag-type-ref") in {"messages", "message"}
        for field in properties.values()
    )


def infer_flags_from_data(
    *,
    flags: Optional[WorkflowFlags] = None,
    data: Optional[WorkflowRevisionData] = None,
    handler: Optional[Callable] = None,  # SDK only — from HANDLER_REGISTRY lookup
) -> WorkflowFlags:
    """Infer the full WorkflowFlags from revision data and caller-provided role overrides.

    Called at revision commit time in the core service layer.

    Args:
        flags: Caller-provided flags from the commit payload. is_evaluator, is_application,
               and is_snippet are taken directly from here when provided (flags is not None).
               All URI/interface flags are always re-inferred from data, ignoring any stored values.
        data: WorkflowRevisionData containing uri, url, script, and schemas.
        handler: In-process callable, if any (SDK only — None at the API layer).
    """
    uri = data.uri if data else None
    url = data.url if data else None
    script = data.script if data else None

    provider, kind, key, version = parse_uri(uri) if uri else (None, None, None, None)

    # topology
    is_custom = kind == "custom"
    is_managed = provider == "agenta"

    # key-based type flags
    is_llm = key == "llm"
    is_hook = key == "hook"
    is_code = key == "code"
    is_match = key == "match"
    is_feedback = key == "feedback"

    # schema-derived flags
    inputs_schema = (
        data.schemas.inputs if (data and data.schemas and data.schemas.inputs) else None
    )
    is_chat = key == "chat" or _has_messages_input(inputs_schema)

    # For managed URIs, infer URL from URI components if not explicitly provided
    if not url and is_managed and kind and key and version:
        url = infer_url_from_uri(uri)

    # interface
    has_url = bool(url)
    has_handler = bool(handler)
    has_script = bool(script)

    # role defaults from lookup table
    if kind and key:
        table_key = (kind, key)
        if is_managed and table_key not in _AGENTA_ROLE_TABLE:
            raise ValueError(
                f"Unknown agenta URI key ({kind!r}, {key!r}). "
                "Add it to _AGENTA_ROLE_TABLE with explicit (is_application, is_evaluator, is_snippet)."
            )
        default_application, default_evaluator, default_snippet = (
            _AGENTA_ROLE_TABLE.get(table_key, (False, False, False))
        )
    else:
        # no URI — default: evaluator, not application, not snippet
        default_application, default_evaluator, default_snippet = False, True, False

    # caller-provided role flags win over table defaults when flags object is present
    if flags is not None:
        is_application = flags.is_application
        is_evaluator = flags.is_evaluator
        is_snippet = flags.is_snippet
    else:
        is_application = default_application
        is_evaluator = default_evaluator
        is_snippet = default_snippet

    return WorkflowFlags(
        # uri-derived
        is_managed=is_managed,
        is_custom=is_custom,
        is_llm=is_llm,
        is_hook=is_hook,
        is_code=is_code,
        is_match=is_match,
        is_feedback=is_feedback,
        # schema-derived
        is_chat=is_chat,
        # interface-derived
        has_url=has_url,
        has_handler=has_handler,
        has_script=has_script,
        # user-defined
        is_evaluator=is_evaluator,
        is_application=is_application,
        is_snippet=is_snippet,
    )


# ---------------------------------------------------------------------------
# Outputs schema inference
# ---------------------------------------------------------------------------

_MATCH_RESULT_DEF: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "success": {"type": "boolean"},
        "score": {"type": "number"},
        "error": {"type": ["string", "null"]},
    },
    "required": ["success", "score"],
    "additionalProperties": {"$ref": "#/$defs/result"},
}


_MATCH_RESULT_BASE_PROPS: Dict[str, Any] = {
    "success": {"type": "boolean"},
    "score": {"type": "number"},
    "error": {"type": ["string", "null"]},
}
_MATCH_RESULT_BASE_REQUIRED: List[str] = ["success", "score", "error"]


def _build_match_result_schema(matcher: Dict[str, Any]) -> Dict[str, Any]:
    """Build a typed result schema for a single matcher node.

    Leaf nodes reference the generic result def. Parent nodes enumerate
    their child keys directly as properties (children are merged in, not nested).
    """
    child_matchers: List[Dict[str, Any]] = matcher.get("matchers") or []
    if not child_matchers:
        return {"$ref": "#/$defs/result"}

    extra_props: Dict[str, Any] = {}
    extra_required: List[str] = []
    for child in child_matchers:
        child_key = str(child.get("key", ""))
        if child_key:
            extra_props[child_key] = _build_match_result_schema(child)
            extra_required.append(child_key)

    return {
        "type": "object",
        "properties": {**_MATCH_RESULT_BASE_PROPS, **extra_props},
        "required": [*_MATCH_RESULT_BASE_REQUIRED, *extra_required],
        "additionalProperties": False,
    }


def _infer_match_v0_outputs(
    parameters: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    matchers: List[Dict[str, Any]] = (parameters or {}).get("matchers") or []
    if not matchers:
        return None

    # Root-level: score/success + one property per top-level matcher key
    props: Dict[str, Any] = {
        "score": {
            "type": "number",
            "description": "Weighted mean score across all root-level matchers.",
        },
        "success": {"type": "boolean"},
    }
    required: List[str] = ["score", "success"]
    for matcher in matchers:
        key = str(matcher.get("key", ""))
        if key:
            props[key] = _build_match_result_schema(matcher)
            required.append(key)

    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "title": "Match Outputs",
        "description": "Flat result dict: root-level matcher keys plus score/success.",
        "properties": props,
        "required": required,
        "$defs": {"result": _MATCH_RESULT_DEF},
        "additionalProperties": False,
    }


def _infer_llm_v0_outputs(
    parameters: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    response = (parameters or {}).get("response") or {}
    if response.get("format") != "json":
        return None
    schema = response.get("schema")
    if not schema or not isinstance(schema, dict):
        return None
    return schema


def _infer_completion_v0_outputs(
    parameters: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    prompt = (parameters or {}).get("prompt") or {}
    llm_config = prompt.get("llm_config") or {}
    response_format = llm_config.get("response_format") or {}
    if response_format.get("type") != "json_schema":
        return None
    json_schema = response_format.get("json_schema") or {}
    schema = json_schema.get("schema")
    if not schema or not isinstance(schema, dict):
        return None
    return schema


_OUTPUTS_INFERRERS: Dict[str, Callable] = {
    "agenta:builtin:match:v0": _infer_match_v0_outputs,
    "agenta:builtin:llm:v0": _infer_llm_v0_outputs,
    "agenta:builtin:completion:v0": _infer_completion_v0_outputs,
}


def infer_outputs_schema(
    uri: Optional[str],
    parameters: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """Infer a concrete outputs schema from a URI and its parameters.

    Returns a JSON Schema dict when inference succeeds, or None to fall back
    to the generic interface schema.
    """
    if not uri:
        return None
    inferrer = _OUTPUTS_INFERRERS.get(uri)
    if not inferrer:
        return None
    return inferrer(parameters)
