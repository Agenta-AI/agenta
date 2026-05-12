"""Low-level rendering helper for prompt templates.

This module is the single place where the per-mode substitution logic lives.
Both ``PromptTemplate.format`` (chat/completion) and ``_format_with_template``
(LLM-as-a-judge) call into ``render_template`` so the substitution rules stay
identical across services.

The helper is intentionally narrow: it takes a template string, a mode, and a
context, and returns a rendered string. It does not know about messages,
response formats, providers, or any service-specific concern. That layering is
required for WP-B2 (message renderer + JSON-return renderer) and WP-B3
(``mustache`` mode) to build cleanly on top.

Behavior:
- ``curly``: ``{{var}}`` substitution with literal-key-first lookup, dot-notation,
  array indexing, JSONPath, and JSON Pointer support. Whole objects/arrays are
  rendered as compact JSON text. Raises :class:`UnresolvedVariablesError`
  (a :class:`ValueError` subclass that carries the unresolved set) when
  placeholders cannot be resolved.
- ``fstring``: Python ``str.format`` semantics. Raises ``KeyError``/``IndexError``
  on missing keys, like the standard library does.
- ``jinja2``: full sandboxed Jinja2. Raises ``jinja2.TemplateError`` on render
  failures (sandbox violations, template syntax errors, etc.). Callers decide
  whether to re-raise or fall back.
"""

import json
from typing import Any, Mapping, Literal, Optional

from agenta.sdk.utils.helpers import apply_replacements_with_tracking, _PLACEHOLDER_RE
from agenta.sdk.utils.lazy import _load_jinja2, _load_jsonpath
from agenta.sdk.utils.resolvers import resolve_any


TemplateMode = Literal["curly", "fstring", "jinja2"]


class UnresolvedVariablesError(ValueError):
    """Raised by ``curly`` rendering when one or more placeholders cannot be resolved.

    Carries the unresolved set so callers can format their preferred error
    message without re-parsing ``str(exc)``.
    """

    def __init__(self, unresolved: set, hint: Optional[str] = None) -> None:
        self.unresolved: set = set(unresolved)
        self.hint: Optional[str] = hint
        suffix = f" Hint: {hint}" if hint else ""
        super().__init__(
            f"Template variables not found or unresolved: "
            f"{', '.join(sorted(self.unresolved))}.{suffix}"
        )


# ---- Coercion ----


def _coerce_to_str(value: Any) -> str:
    """Stringify a resolved value for embedding in a string template.

    Dicts and lists become compact JSON; everything else falls through ``str()``.
    """

    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def _missing_lib_hint(unreplaced: set) -> Optional[str]:
    """Return a hint string when unresolved expressions need ``python-jsonpath``.

    Returns ``None`` when no hint applies so callers can suppress the suffix.
    """

    if any(expr.startswith("$") or expr.startswith("/") for expr in unreplaced):
        json_path, json_pointer = _load_jsonpath()
        if json_path is None or json_pointer is None:
            return (
                "Install python-jsonpath to enable json-path ($...) "
                "and json-pointer (/...)"
            )
    return None


# ---- Per-mode renderers ----


def _render_curly(template: str, context: Mapping[str, Any]) -> str:
    placeholders: set = set()
    for match in _PLACEHOLDER_RE.finditer(template):
        placeholders.add(match.group(1).strip())

    replacements: dict = {}
    for expr in placeholders:
        try:
            value = resolve_any(expr, context)
        except Exception:
            continue
        # ``apply_replacements_with_tracking`` calls ``re.sub`` with a function
        # callable, which uses the return value verbatim — no backslash-escape
        # processing — so the replacement string can be passed through as-is.
        replacements[expr] = _coerce_to_str(value)

    result, successfully_replaced = apply_replacements_with_tracking(
        template, replacements
    )

    truly_unreplaced = placeholders - successfully_replaced
    if truly_unreplaced:
        raise UnresolvedVariablesError(
            unresolved=truly_unreplaced,
            hint=_missing_lib_hint(truly_unreplaced),
        )

    return result


def _render_fstring(template: str, context: Mapping[str, Any]) -> str:
    return template.format(**context)


def _render_jinja2(template: str, context: Mapping[str, Any]) -> str:
    SandboxedEnvironment, _TemplateError = _load_jinja2()
    env = SandboxedEnvironment()
    return env.from_string(template).render(**context)


# ---- Public entry point ----


def render_template(
    *,
    template: str,
    mode: TemplateMode,
    context: Mapping[str, Any],
) -> str:
    """Render a template string against a context using the given substitution mode.

    Args:
        template: The raw template string.
        mode: One of ``"curly"``, ``"fstring"``, ``"jinja2"``.
        context: Variables available to the template. Native JSON values
            (dicts, lists) are preserved during traversal and only stringified
            at the substitution boundary.

    Returns:
        The rendered string.

    Raises:
        UnresolvedVariablesError: ``curly`` could not resolve all placeholders.
            Subclass of ``ValueError`` so existing ``except ValueError`` paths
            keep working.
        KeyError / IndexError: ``fstring`` references a missing key or index.
        jinja2.TemplateError: ``jinja2`` rendering failed (sandbox violation,
            syntax error, etc.). Callers decide whether to re-raise or fall back.
        ValueError: when ``mode`` is unsupported.
    """

    if mode == "curly":
        return _render_curly(template, context)
    if mode == "fstring":
        return _render_fstring(template, context)
    if mode == "jinja2":
        return _render_jinja2(template, context)
    raise ValueError(f"Unknown template format: {mode}")
