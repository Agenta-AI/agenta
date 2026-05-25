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
    # ``{{$...}}`` JSONPath is resolved around the engine (see _render_with_jsonpath);
    # ``skip`` leaves tags inside ``{% raw %}`` / ``{# #}`` to Jinja2.
    SandboxedEnvironment, _TemplateError = _load_jinja2()
    env = SandboxedEnvironment()

    def _engine(masked: str) -> str:
        return env.from_string(masked).render(**context)

    return _render_with_jsonpath(template, context, engine=_engine, skip=_JINJA2_RAW_RE)


# A Mustache tag: ``{{`` then an optional sigil and body, then ``}}``. The body
# is captured non-greedily so adjacent tags do not merge. ``{{{...}}}`` triple
# tags are matched too because the inner ``{...}`` is absorbed by the body.
_MUSTACHE_TAG_RE = re.compile(r"\{\{\{?\s*([^{}]*?)\s*\}?\}\}")

# A JSONPath pre-render tag: ``{{$...}}`` or ``{{{$...}}}``. The body starts
# with ``$`` after optional inner whitespace.
_MUSTACHE_JSONPATH_TAG_RE = re.compile(r"\{\{\{?\s*(\$[^{}]*?)\s*\}?\}\}")


def _reject_unsupported_mustache_tags(template: str) -> None:
    """Reject tags unsupported in ``mustache`` (partials, empty placeholders, JSON
    Pointer) with a stable product error instead of an opaque ``mystace`` one."""

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
        # ``{{/seg/seg}}`` is a JSON Pointer (unsupported in mustache per RFC);
        # a bare ``{{/x}}`` section close (no inner ``/``) is left to the engine.
        if body.startswith("/") and "/" in body[1:]:
            raise MustacheTemplateError(
                f"JSON Pointer is not supported in mustache templates: {match.group(0)!r}. "
                "Use a '{{$...}}' JSONPath tag, or the curly format."
            )


# ---- Shared JSONPath ({{$...}}) resolution ----
# Design: docs/design/prompt-runtime-unification/wp-b3-mustache-rendering.
_JSONPATH_SHIELD_RE = re.compile("\x00JP(\\d+)\x00")

# Jinja2 ``{% raw %}`` / ``{# #}`` spans: ``{{$...}}`` inside them is left to the
# engine (raw-block escape contract), not JSONPath-resolved.
_JINJA2_RAW_RE = re.compile(
    r"\{%-?\s*raw\s*-?%\}.*?\{%-?\s*endraw\s*-?%\}|\{#.*?#\}",
    re.DOTALL,
)


def _render_with_jsonpath(
    template: str,
    context: Mapping[str, Any],
    *,
    engine: Callable[[str], str],
    skip: Optional["re.Pattern[str]"] = None,
) -> str:
    """Resolve ``{{$...}}`` JSONPath tags as inert data around a template ``engine``.

    Shield tags, render, then substitute resolved values last (never re-parsed).
    Matches ``curly``: a failed tag raises :class:`UnresolvedVariablesError`.
    ``skip`` marks spans whose ``{{$...}}`` tags are left to the engine.
    """

    # NUL would collide with the shield sentinel; it cannot occur in a real prompt.
    # Mode-agnostic here (the helper is shared by mustache + jinja2); the mustache
    # entrypoint maps it to MustacheTemplateError.
    if "\x00" in template:
        raise ValueError("Template contains a NUL byte (\\x00), which is not allowed.")

    shielded: list[str] = []

    def _shield(match: "re.Match[str]") -> str:
        shielded.append(match.group(1))
        return f"\x00JP{len(shielded) - 1}\x00"

    if skip is None:
        masked = _MUSTACHE_JSONPATH_TAG_RE.sub(_shield, template)
    else:
        # Shield ``{{$...}}`` only outside the skipped spans.
        pos = 0
        parts: list[str] = []
        for region in skip.finditer(template):
            parts.append(
                _MUSTACHE_JSONPATH_TAG_RE.sub(_shield, template[pos : region.start()])
            )
            parts.append(region.group(0))
            pos = region.end()
        parts.append(_MUSTACHE_JSONPATH_TAG_RE.sub(_shield, template[pos:]))
        masked = "".join(parts)

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
    """Render via ``mystace`` with shared ``{{$...}}`` JSONPath handling.

    Rejects unsupported tags first. HTML escaping is off (prompt text is not HTML)
    and ``stringify`` matches ``curly`` coercion (whole objects -> compact JSON).
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

    try:
        return _render_with_jsonpath(template, context, engine=_engine)
    except UnresolvedVariablesError:
        raise
    except MustacheTemplateError:
        raise
    except ValueError as exc:
        # Mode-agnostic helper errors (e.g. the NUL-byte guard) surface as
        # MustacheTemplateError on the mustache path.
        raise MustacheTemplateError(str(exc)) from exc


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
            placeholder, a JSON Pointer tag, a NUL byte, or a ``mystace`` parse
            error. Subclass of ``ValueError``.
        UnresolvedVariablesError: ``curly`` could not resolve all placeholders, or
            a ``{{$...}}`` JSONPath tag failed to resolve in ``mustache`` /
            ``jinja2`` / ``curly`` (missing or malformed). Subclass of
            ``ValueError`` so existing ``except ValueError`` paths keep working.
        KeyError / IndexError: ``fstring`` references a missing key or index.
        jinja2.TemplateError: ``jinja2`` rendering failed (sandbox violation,
            syntax error, etc.). Callers decide whether to re-raise or fall back.
        ValueError: when ``mode`` is unsupported, or ``jinja2`` is given a template
            containing a NUL byte.
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
