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

JSONPath (``{{$...}}``) is handled uniformly across ``curly``, ``mustache``, and
``jinja2`` — resolved as inert data, with :class:`UnresolvedVariablesError` on
failure (see ``_render_with_jsonpath``).

Behavior:
- ``mustache``: real Mustache rendering through ``mystace`` (sections, inverted
  sections, dotted names, comments, unescaped variables), plus the shared
  ``{{$...}}`` JSONPath handling described above. Partials (``{{>...}}``) and
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
- ``jinja2``: full sandboxed Jinja2 (plus the shared ``{{$...}}`` JSONPath
  handling). Raises ``jinja2.TemplateError`` on native render failures (sandbox
  violations, template syntax errors, etc.). Callers decide whether to re-raise
  or fall back.
"""

import re
import json
from typing import Any, Callable, Mapping, Literal, Optional

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
    (``{{}}``), and normalized ``mystace`` parse errors. (JSONPath ``{{$...}}``
    resolution failures are reported as :class:`UnresolvedVariablesError`, the
    same as ``curly`` — see :func:`_render_with_jsonpath`.) Subclass of
    ``ValueError`` so existing ``except ValueError`` paths keep working.
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
    # ``$``-JSONPath is not valid Jinja2 syntax, so ``{{$...}}`` tags are resolved
    # around the Jinja2 engine the same way as for ``mustache`` / ``curly``:
    # shielded from the engine, then substituted last as inert data (never
    # re-parsed). Native Jinja2 tags (``{{ var }}``, ``{% %}``, ``{# #}``) are
    # rendered by the engine as before.
    SandboxedEnvironment, _TemplateError = _load_jinja2()
    env = SandboxedEnvironment()

    def _engine(masked: str) -> str:
        return env.from_string(masked).render(**context)

    return _render_with_jsonpath(template, context, engine=_engine)


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


# ---- Shared JSONPath ({{$...}}) resolution ----
# Resolve ``{{$...}}`` tags as inert data around the engine (curly/mustache/jinja2
# all behave the same). Design: docs/design/prompt-runtime-unification/wp-b3-mustache-rendering.
# NUL-delimited sentinel: cannot occur in prompt text and is inert in both engines.
_JSONPATH_SHIELD_RE = re.compile("\x00JP(\\d+)\x00")


def _render_with_jsonpath(
    template: str,
    context: Mapping[str, Any],
    *,
    engine: Callable[[str], str],
) -> str:
    """Resolve ``{{$...}}`` JSONPath tags as inert data around a template ``engine``.

    Shield tags from ``engine``, render, then substitute resolved values last so
    they are never re-parsed. Matches ``curly``: a failed ``{{$...}}`` raises
    :class:`UnresolvedVariablesError`; values use ``curly`` coercion.
    """

    shielded: list[str] = []

    def _shield(match: "re.Match[str]") -> str:
        shielded.append(match.group(1))
        return f"\x00JP{len(shielded) - 1}\x00"

    masked = _MUSTACHE_JSONPATH_TAG_RE.sub(_shield, template)
    rendered = engine(masked)
    if not shielded:
        return rendered

    unresolved: set = set()

    def _substitute(match: "re.Match[str]") -> str:
        expr = shielded[int(match.group(1))]
        try:
            return _coerce_to_str(resolve_json_path(expr, dict(context)))
        except Exception:
            # Match ``curly``: a failed ``$``-path is treated as an unresolved
            # placeholder rather than a distinct error. Leave the sentinel's
            # original tag text in place and report it at the end.
            unresolved.add(expr)
            return f"{{{{{expr}}}}}"

    result = _JSONPATH_SHIELD_RE.sub(_substitute, rendered)

    if unresolved:
        raise UnresolvedVariablesError(
            unresolved=unresolved,
            hint=_missing_lib_hint(unresolved),
        )

    return result


def _render_mustache(template: str, context: Mapping[str, Any]) -> str:
    """Render a template combining JSONPath ``{{$...}}`` resolution and ``mystace``.

    Unsupported tags (partials, empty placeholders) are rejected first. ``{{$...}}``
    tags are resolved via :func:`_render_with_jsonpath` (shielded, then substituted
    last), so a JSONPath value containing ``{{other}}`` is NOT rendered recursively
    — matching plain ``{{var}}`` and ``curly``.

    HTML escaping is disabled because prompt text is not HTML, and ``stringify``
    matches the ``curly`` coercion so whole-object insertion renders compact JSON.
    """

    _reject_unsupported_mustache_tags(template)

    render_from_template = _load_mystace()

    def _engine(masked: str) -> str:
        try:
            return render_from_template(
                masked,
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

    return _render_with_jsonpath(template, context, engine=_engine)


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
