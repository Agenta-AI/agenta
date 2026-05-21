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
- ``mustache``: real Mustache rendering through ``mystace`` (sections, inverted
  sections, dotted names, comments, unescaped variables), with one Agenta
  extension: tags that start with ``{{$`` are pre-rendered as JSONPath
  expressions against the context before the Mustache render runs. Whole
  objects/arrays are rendered as compact JSON text. Partials (``{{>...}}``) and
  empty placeholders (``{{}}``) are unsupported and raise
  :class:`MustacheTemplateError`. This is the default format for newly created
  apps / prompt configs.
- ``curly``: ``{{var}}`` substitution with literal-key-first lookup, dot-notation,
  array indexing, JSONPath, and JSON Pointer support. Whole objects/arrays are
  rendered as compact JSON text. Raises :class:`UnresolvedVariablesError`
  (a :class:`ValueError` subclass that carries the unresolved set) when
  placeholders cannot be resolved. Legacy compatibility mode for existing apps.
- ``fstring``: Python ``str.format`` semantics. Raises ``KeyError``/``IndexError``
  on missing keys, like the standard library does.
- ``jinja2``: full sandboxed Jinja2. Raises ``jinja2.TemplateError`` on render
  failures (sandbox violations, template syntax errors, etc.). Callers decide
  whether to re-raise or fall back.
"""

import re
import json
from typing import Any, Mapping, Literal, Optional

from agenta.sdk.utils.helpers import apply_replacements_with_tracking, _PLACEHOLDER_RE
from agenta.sdk.utils.lazy import _load_jinja2, _load_jsonpath, _load_mystace
from agenta.sdk.utils.resolvers import resolve_any, resolve_json_path


TemplateMode = Literal["mustache", "curly", "fstring", "jinja2"]


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


class MustacheTemplateError(ValueError):
    """Raised by ``mustache`` rendering for product-authored formatting failures.

    Covers the cases Agenta rejects deliberately rather than delegating to the
    Mustache engine: unsupported partials (``{{>...}}``), empty placeholders
    (``{{}}``), JSONPath pre-render failures, and normalized ``mystace`` parse
    errors. Subclass of ``ValueError`` so existing ``except ValueError`` paths
    keep working.
    """


class MustacheInvalidJsonPathError(MustacheTemplateError):
    """Raised when a ``{{$...}}`` tag is not a syntactically valid JSONPath.

    In ``mustache`` every tag whose body starts with ``$`` is reserved for the
    JSONPath pre-render pass (strict contract: a ``$``-prefixed name is never
    treated as a plain Mustache variable). When the body after ``$`` is not a
    valid JSONPath expression (anything not ``$``, ``$.`` or ``$[``), this is an
    authoring mistake, not missing data, so it is surfaced as its own error
    distinct from the generic "matched no values" pre-render failure. Subclass
    of :class:`MustacheTemplateError` so broad ``except`` paths still catch it.
    """


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


# A Mustache tag: ``{{`` then an optional sigil and body, then ``}}``. The body
# is captured non-greedily so adjacent tags do not merge. ``{{{...}}}`` triple
# tags are matched too because the inner ``{...}`` is absorbed by the body.
_MUSTACHE_TAG_RE = re.compile(r"\{\{\{?\s*([^{}]*?)\s*\}?\}\}")

# A JSONPath pre-render tag: ``{{$...}}`` or ``{{{$...}}}``. The body starts
# with ``$`` after optional inner whitespace.
_MUSTACHE_JSONPATH_TAG_RE = re.compile(r"\{\{\{?\s*(\$[^{}]*?)\s*\}?\}\}")


def _reject_unsupported_mustache_tags(template: str) -> None:
    """Raise a deterministic error for tags Agenta does not support in ``mustache``.

    Partials (``{{>name}}``) have no registry or template loader in the runtime,
    and ``mystace`` would silently render them as empty text. Empty / whitespace
    only placeholders (``{{}}``) are almost always authoring mistakes. Both are
    rejected before the engine runs so product errors are stable and do not
    depend on library wording.
    """

    for match in _MUSTACHE_TAG_RE.finditer(template):
        body = match.group(1)
        if body.startswith(">"):
            raise MustacheTemplateError(
                "Partials are not supported in mustache templates. "
                f"Remove the partial tag {match.group(0)!r}."
            )
        if body == "":
            raise MustacheTemplateError(
                "Empty placeholder is not allowed in mustache templates "
                "(e.g. '{{}}' or '{{   }}')."
            )


def _prerender_jsonpath_tags(template: str, context: Mapping[str, Any]) -> str:
    """Resolve ``{{$...}}`` tags as JSONPath, leaving all other tags untouched.

    This is a separate substitution pass run *before* the Mustache engine, not a
    name resolver inside Mustache. Resolved values follow the same coercion as
    ``curly``: dict/list become compact JSON text, everything else uses ``str``.
    """

    def _replace(match: "re.Match[str]") -> str:
        expr = match.group(1)
        try:
            value = resolve_json_path(expr, dict(context))
        except ValueError as exc:
            # ``resolve_json_path`` raises ``ValueError`` only for malformed
            # JSONPath syntax (not for valid-but-unmatched expressions, which
            # raise ``KeyError``). A ``$``-prefixed tag that is not valid
            # JSONPath is an authoring mistake under the strict contract.
            raise MustacheInvalidJsonPathError(
                f"Invalid JSONPath expression {expr!r} in a mustache '{{{{$...}}}}' tag. "
                "Tags starting with '$' are always resolved as JSONPath and must "
                "start with '$', '$.' or '$[' (a '$'-prefixed plain variable is "
                "not supported)."
            ) from exc
        except Exception as exc:
            raise MustacheTemplateError(
                f"Could not resolve JSONPath expression {expr!r}: {exc}"
            ) from exc
        return _coerce_to_str(value)

    return _MUSTACHE_JSONPATH_TAG_RE.sub(_replace, template)


def _render_mustache(template: str, context: Mapping[str, Any]) -> str:
    """Render a template using JSONPath pre-rendering then ``mystace``.

    Stages:

    1. reject unsupported tags (partials, empty placeholders)
    2. pre-render ``{{$...}}`` tags through JSONPath
    3. render the resulting template with ``mystace``

    HTML escaping is disabled because prompt text is not HTML, and ``stringify``
    matches the ``curly`` coercion so whole-object insertion renders compact
    JSON. Variable values are treated as data, not templates, so a value that
    contains ``{{other}}`` is not rendered recursively.
    """

    _reject_unsupported_mustache_tags(template)

    prerendered = _prerender_jsonpath_tags(template, context)

    render_from_template = _load_mystace()

    try:
        return render_from_template(
            prerendered,
            dict(context),
            stringify=_coerce_to_str,
            html_escape_fn=lambda text: text,
        )
    except MustacheTemplateError:
        raise
    except Exception as exc:
        raise MustacheTemplateError(
            f"Mustache template error in content: '{template}'. Error: {exc}"
        ) from exc


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
        mode: One of ``"mustache"``, ``"curly"``, ``"fstring"``, ``"jinja2"``.
        context: Variables available to the template. Native JSON values
            (dicts, lists) are preserved during traversal and only stringified
            at the substitution boundary.

    Returns:
        The rendered string.

    Raises:
        MustacheTemplateError: ``mustache`` hit an unsupported partial, an empty
            placeholder, an unresolved JSONPath pre-render tag, or a ``mystace``
            parse error. Subclass of ``ValueError``.
        UnresolvedVariablesError: ``curly`` could not resolve all placeholders.
            Subclass of ``ValueError`` so existing ``except ValueError`` paths
            keep working.
        KeyError / IndexError: ``fstring`` references a missing key or index.
        jinja2.TemplateError: ``jinja2`` rendering failed (sandbox violation,
            syntax error, etc.). Callers decide whether to re-raise or fall back.
        ValueError: when ``mode`` is unsupported.
    """

    if mode == "mustache":
        return _render_mustache(template, context)
    if mode == "curly":
        return _render_curly(template, context)
    if mode == "fstring":
        return _render_fstring(template, context)
    if mode == "jinja2":
        return _render_jinja2(template, context)
    raise ValueError(f"Unknown template format: {mode}")
