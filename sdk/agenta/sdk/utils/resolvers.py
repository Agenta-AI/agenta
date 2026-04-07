"""Lightweight JSON Path / JSON Pointer / dot-notation resolution helpers.

These live in ``agenta.sdk.utils`` (not ``agenta.sdk.workflows.handlers``)
so that API-side code can import them without pulling in the full
``agenta`` package initialisation chain (which eagerly loads LiteLLM).
"""

from typing import Any, Dict

from agenta.sdk.utils.lazy import _load_jsonpath
from agenta.sdk.utils.logging import get_module_logger

log = get_module_logger(__name__)


# ========= Scheme detection =========


def detect_scheme(expr: str) -> str:
    """Return 'json-path', 'json-pointer', or 'dot-notation' based on the placeholder prefix."""
    if expr.startswith("$"):
        return "json-path"
    if expr.startswith("/"):
        return "json-pointer"
    return "dot-notation"


# ========= Resolvers =========


def resolve_dot_notation(expr: str, data: dict) -> object:
    if "[" in expr or "]" in expr:
        raise KeyError(f"Bracket syntax is not supported in dot-notation: {expr!r}")

    # First, check if the expression exists as a literal key (e.g., "topic.story" as a single key)
    # This allows users to use dots in their variable names without nested access
    if expr in data:
        return data[expr]

    # If not found as a literal key, try to parse as dot-notation path
    cur = data
    for token in (p for p in expr.split(".") if p):
        if isinstance(cur, list) and token.isdigit():
            cur = cur[int(token)]
        else:
            if not isinstance(cur, dict):
                raise KeyError(
                    f"Cannot access key {token!r} on non-dict while resolving {expr!r}"
                )
            if token not in cur:
                raise KeyError(f"Missing key {token!r} while resolving {expr!r}")
            cur = cur[token]
    return cur


def resolve_json_path(expr: str, data: dict) -> object:
    json_path, _ = _load_jsonpath()
    if json_path is None:
        raise ImportError("python-jsonpath is required for json-path ($...)")

    if not (expr == "$" or expr.startswith("$.") or expr.startswith("$[")):
        raise ValueError(
            f"Invalid json-path expression {expr!r}. "
            "Must start with '$', '$.' or '$[' (no implicit normalization)."
        )

    # Use package-level API
    results = json_path.findall(expr, data)  # always returns a list
    return results[0] if len(results) == 1 else results


def resolve_json_pointer(expr: str, data: Dict[str, Any]) -> Any:
    """Resolve a JSON Pointer; returns a single value."""
    _, json_pointer = _load_jsonpath()
    if json_pointer is None:
        raise ImportError("python-jsonpath is required for json-pointer (/...)")
    return json_pointer(expr).resolve(data)


def resolve_any(expr: str, data: Dict[str, Any]) -> Any:
    """Dispatch to the right resolver based on detected scheme."""
    scheme = detect_scheme(expr)
    if scheme == "json-path":
        return resolve_json_path(expr, data)
    if scheme == "json-pointer":
        return resolve_json_pointer(expr, data)
    return resolve_dot_notation(expr, data)


def resolve_json_selector(value: Any, data: Dict[str, Any]) -> Any:
    """Resolve a value that may be a JSON Path or JSON Pointer expression.

    - Strings starting with ``$`` are resolved as JSON Path against *data*.
    - Strings starting with ``/`` are resolved as JSON Pointer against *data*.
    - Everything else (plain strings, numbers, dicts, ...) is returned as-is.

    On resolution failure (missing library, invalid syntax, missing path, etc.),
    this helper returns ``None`` instead of raising, as expected by webhook
    callers and design spec.
    """
    if isinstance(value, str):
        try:
            if value.startswith("$"):
                return resolve_json_path(value, data)
            if value.startswith("/"):
                return resolve_json_pointer(value, data)
        except Exception as exc:
            log.debug("Failed to resolve JSON selector %r: %s", value, exc)
            return None
    return value
