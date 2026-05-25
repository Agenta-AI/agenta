"""Unit tests for the low-level rendering helper.

Covers each substitution mode (`curly`, `fstring`, `jinja2`) and pins the
behavior the call sites depend on. Organized by section:

1. Curly basics: top-level, nested, array, JSONPath, JSON Pointer, literal-key-first.
2. Curly placeholder syntax: whitespace, multiple, repeated, multi-line, unicode names.
3. Curly value coercion: dicts/lists, scalars (int/float/bool/None), unicode strings.
4. Curly value safety: backslashes, regex backrefs, placeholder-shaped values
   (no recursive re-rendering).
5. Curly error contract: unresolved set, hint suffix, empty placeholder, deep
   misses, mid-path scalars, list-of-lists indexing.
6. Curly placeholder regex edge cases: triple/quadruple braces, mismatched
   braces, embedded newlines.
7. Fstring: literal-brace escape, format specs, index access, attribute access,
   missing-key error, value safety.
8. Jinja2: raw blocks, filters, conditionals, undefined variables, sandbox
   violations, value safety.
9. Call-site preservation: ``PromptTemplate.format`` and the handlers'
   ``_format_with_template`` continue to produce the same outputs they did
   before the helper extraction.
"""

import pytest

from agenta.sdk.engines.running.handlers import _format_with_template
from agenta.sdk.types import PromptTemplate, TemplateFormatError
from agenta.sdk.utils.lazy import _load_jinja2
from agenta.sdk.utils.templating import (
    UnresolvedVariablesError,
    render_template,
)


# =============================================================================
# 1. Curly basics
# =============================================================================


def test_curly_resolves_top_level_keys():
    out = render_template(
        template="hello {{name}}",
        mode="curly",
        context={"name": "Ada"},
    )
    assert out == "hello Ada"


def test_curly_resolves_nested_dot_notation():
    out = render_template(
        template="profile.name={{profile.name}}",
        mode="curly",
        context={"profile": {"name": "Ada"}},
    )
    assert out == "profile.name=Ada"


def test_curly_resolves_deeply_nested_dot_notation():
    out = render_template(
        template="city={{user.address.city}}",
        mode="curly",
        context={"user": {"address": {"city": "Berlin"}}},
    )
    assert out == "city=Berlin"


def test_curly_resolves_array_index():
    out = render_template(
        template="first={{tags.0}}",
        mode="curly",
        context={"tags": ["alpha", "beta"]},
    )
    assert out == "first=alpha"


def test_curly_resolves_nested_array_index():
    out = render_template(
        template="name={{users.0.name}}",
        mode="curly",
        context={"users": [{"name": "Ada"}, {"name": "Bob"}]},
    )
    assert out == "name=Ada"


def test_curly_resolves_array_index_into_list_of_lists():
    out = render_template(
        template="cell={{matrix.1.0}}",
        mode="curly",
        context={"matrix": [[1, 2], [3, 4]]},
    )
    assert out == "cell=3"


def test_curly_resolves_json_path():
    out = render_template(
        template="name={{$.profile.name}}",
        mode="curly",
        context={"profile": {"name": "Ada"}},
    )
    assert out == "name=Ada"


def test_curly_resolves_json_path_root():
    out = render_template(
        template="data={{$}}",
        mode="curly",
        context={"a": 1},
    )
    assert out == 'data={"a": 1}'


def test_curly_resolves_json_pointer():
    out = render_template(
        template="name={{/profile/name}}",
        mode="curly",
        context={"profile": {"name": "Ada"}},
    )
    assert out == "name=Ada"


def test_curly_resolves_json_pointer_with_escaped_slash():
    """RFC 6901 escapes ``/`` as ``~1`` in pointer segments."""

    out = render_template(
        template="value={{/foo~1bar}}",
        mode="curly",
        context={"foo/bar": "ok"},
    )
    assert out == "value=ok"


def test_curly_literal_key_wins_over_nested_traversal():
    """A top-level key named ``foo.bar`` is preferred over ``foo`` -> ``bar``."""

    out = render_template(
        template="value={{foo.bar}}",
        mode="curly",
        context={"foo.bar": "literal", "foo": {"bar": "nested"}},
    )
    assert out == "value=literal"


# =============================================================================
# 2. Curly placeholder syntax
# =============================================================================


def test_curly_strips_inner_whitespace():
    out = render_template(
        template="hi {{ name }}",
        mode="curly",
        context={"name": "Ada"},
    )
    assert out == "hi Ada"


def test_curly_strips_extra_inner_whitespace():
    out = render_template(
        template="hi {{   name   }}",
        mode="curly",
        context={"name": "Ada"},
    )
    assert out == "hi Ada"


def test_curly_handles_asymmetric_inner_whitespace():
    out = render_template(
        template="a={{name }} b={{ name}}",
        mode="curly",
        context={"name": "Ada"},
    )
    assert out == "a=Ada b=Ada"


def test_curly_substitutes_multiple_distinct_variables():
    out = render_template(
        template="{{first}} {{last}}",
        mode="curly",
        context={"first": "Ada", "last": "Lovelace"},
    )
    assert out == "Ada Lovelace"


def test_curly_substitutes_repeated_occurrences_of_same_variable():
    out = render_template(
        template="{{x}}-{{x}}-{{x}}",
        mode="curly",
        context={"x": "a"},
    )
    assert out == "a-a-a"


def test_curly_substitutes_across_multiple_lines():
    template = "line1: {{a}}\nline2: {{b}}\nline3: {{c}}"
    out = render_template(
        template=template,
        mode="curly",
        context={"a": "1", "b": "2", "c": "3"},
    )
    assert out == "line1: 1\nline2: 2\nline3: 3"


def test_curly_renders_multiline_value():
    out = render_template(
        template="msg={{m}}",
        mode="curly",
        context={"m": "first\nsecond"},
    )
    assert out == "msg=first\nsecond"


def test_curly_supports_unicode_variable_names():
    out = render_template(
        template="hi {{naïve}}",
        mode="curly",
        context={"naïve": "ok"},
    )
    assert out == "hi ok"


def test_curly_supports_unicode_variable_values():
    out = render_template(
        template="hi {{name}}",
        mode="curly",
        context={"name": "Адам"},
    )
    assert out == "hi Адам"


# =============================================================================
# 3. Curly value coercion
# =============================================================================


def test_curly_renders_whole_object_as_compact_json():
    out = render_template(
        template="profile={{profile}}",
        mode="curly",
        context={"profile": {"name": "Ada", "tags": ["x", "y"]}},
    )
    assert out == 'profile={"name": "Ada", "tags": ["x", "y"]}'


def test_curly_renders_list_as_compact_json():
    out = render_template(
        template="tags={{tags}}",
        mode="curly",
        context={"tags": ["x", "y", 1]},
    )
    assert out == 'tags=["x", "y", 1]'


def test_curly_renders_nested_object_as_compact_json():
    out = render_template(
        template="data={{data}}",
        mode="curly",
        context={"data": {"a": [1, {"b": 2}]}},
    )
    assert out == 'data={"a": [1, {"b": 2}]}'


def test_curly_preserves_unicode_in_compact_json():
    """``ensure_ascii=False`` keeps non-ASCII characters readable."""

    out = render_template(
        template="profile={{profile}}",
        mode="curly",
        context={"profile": {"name": "Адам"}},
    )
    assert out == 'profile={"name": "Адам"}'


@pytest.mark.parametrize(
    "value,expected",
    [
        (42, "x=42"),
        (3.14, "x=3.14"),
        (True, "x=True"),
        (False, "x=False"),
        (None, "x=None"),
        (0, "x=0"),
        ("", "x="),
    ],
)
def test_curly_coerces_scalars_via_str(value, expected):
    out = render_template(
        template="x={{x}}",
        mode="curly",
        context={"x": value},
    )
    assert out == expected


# =============================================================================
# 4. Curly value safety
# =============================================================================


def test_curly_does_not_re_render_placeholder_in_value():
    """A variable VALUE that itself contains ``{{...}}`` is inserted verbatim
    — the substituted text is not re-scanned for placeholders.
    """

    out = render_template(
        template="said: {{q}}",
        mode="curly",
        context={"q": "I want {{name}} to know"},
    )
    assert out == "said: I want {{name}} to know"


def test_curly_does_not_re_render_value_when_other_var_is_present():
    """If a user named a variable ``q`` whose value happens to contain ``{{name}}``,
    the result keeps the literal ``{{name}}`` even when ``name`` is also bound.
    """

    out = render_template(
        template="{{q}}",
        mode="curly",
        context={"q": "{{name}}", "name": "Ada"},
    )
    assert out == "{{name}}"


def test_curly_preserves_single_backslash_in_value():
    """Regression for the ``replace('\\\\', '\\\\\\\\')`` doubling bug.

    ``re.sub`` with a function callable does not interpret backslashes in the
    return value, so they must be passed through as-is. A value of ``C:\\Users``
    must render as a single backslash, not two.
    """

    out = render_template(
        template="path={{p}}",
        mode="curly",
        context={"p": "C:\\Users"},
    )
    assert out == "path=C:\\Users"


def test_curly_preserves_regex_backreference_syntax_in_value():
    """A value that looks like a regex backreference (``\\1``) must round-trip."""

    out = render_template(
        template="x={{p}}",
        mode="curly",
        context={"p": "\\1\\2"},
    )
    assert out == "x=\\1\\2"


def test_curly_preserves_consecutive_backslashes_in_value():
    out = render_template(
        template="x={{p}}",
        mode="curly",
        context={"p": "\\\\\\\\"},
    )
    assert out == "x=\\\\\\\\"


# =============================================================================
# 5. Curly error contract
# =============================================================================


def test_curly_raises_on_unresolved_placeholder():
    with pytest.raises(UnresolvedVariablesError) as exc_info:
        render_template(
            template="hello {{missing}}",
            mode="curly",
            context={},
        )
    assert exc_info.value.unresolved == {"missing"}


def test_curly_unresolved_error_lists_all_missing_variables():
    with pytest.raises(UnresolvedVariablesError) as exc_info:
        render_template(
            template="{{a}} {{b}} {{c}}",
            mode="curly",
            context={"b": "ok"},
        )
    assert exc_info.value.unresolved == {"a", "c"}


def test_curly_unresolved_error_message_lists_names_alphabetically():
    with pytest.raises(UnresolvedVariablesError) as exc_info:
        render_template(
            template="{{zeta}} {{alpha}} {{mu}}",
            mode="curly",
            context={},
        )
    # Sorted in the message so logs and tests stay deterministic.
    assert "alpha, mu, zeta" in str(exc_info.value)


def test_curly_raises_when_nested_path_misses():
    """If neither the literal key nor the dotted path resolves, raise."""

    with pytest.raises(UnresolvedVariablesError) as exc_info:
        render_template(
            template="x={{user.address.city}}",
            mode="curly",
            context={"user": {"address": {}}},
        )
    assert exc_info.value.unresolved == {"user.address.city"}


def test_curly_raises_when_traversing_through_a_scalar():
    """``{{x.y}}`` against ``{"x": "scalar"}`` cannot continue past ``x``."""

    with pytest.raises(UnresolvedVariablesError):
        render_template(
            template="x={{x.y}}",
            mode="curly",
            context={"x": "scalar"},
        )


def test_curly_raises_on_array_index_out_of_range():
    with pytest.raises(UnresolvedVariablesError):
        render_template(
            template="x={{tags.5}}",
            mode="curly",
            context={"tags": ["a", "b"]},
        )


def test_curly_raises_on_empty_placeholder():
    """Regression: ``{{}}`` used to silently render the entire context dict
    (because ``resolve_dot_notation('', data)`` short-circuited to ``data``).
    It now raises ``UnresolvedVariablesError`` like any other unresolvable
    reference, so secrets/PII in the render context can't accidentally leak
    into a prompt.
    """

    with pytest.raises(UnresolvedVariablesError) as exc_info:
        render_template(
            template="hello {{}}",
            mode="curly",
            context={"secret": "do-not-leak", "x": 1},
        )
    assert exc_info.value.unresolved == {""}


def test_curly_raises_on_whitespace_only_placeholder():
    """``{{   }}`` is treated the same as ``{{}}`` after the inner ``.strip()``."""

    with pytest.raises(UnresolvedVariablesError):
        render_template(
            template="hello {{   }}",
            mode="curly",
            context={"x": 1},
        )


# =============================================================================
# 6. Curly placeholder regex edge cases
# =============================================================================


def test_curly_quadruple_braces_capture_inner_double_brace_as_name():
    """Pin the current behavior of the non-greedy regex on ``{{{{x}}}}``.

    The regex matches the first ``{{`` and the first ``}}``, so the captured
    name becomes ``{{x``. There is no escape mechanism in curly mode today;
    a future ``mustache`` mode (RFC WP-B3) is the natural place to add one.
    """

    with pytest.raises(UnresolvedVariablesError) as exc_info:
        render_template(
            template="literal: {{{{x}}}}",
            mode="curly",
            context={"x": "VAL"},
        )
    assert "{{x" in exc_info.value.unresolved


def test_curly_triple_left_brace_captures_inner_brace_as_name():
    """Pin the current behavior of the non-greedy regex on ``{{{x}}``.

    The regex matches at the *first* ``{{`` (positions 0–1 of the placeholder),
    so the captured name becomes ``{x`` — not the bare ``x`` a user might
    expect. There is no escape mechanism in curly mode today; revisit when
    ``mustache`` mode (RFC WP-B3) lands.
    """

    with pytest.raises(UnresolvedVariablesError) as exc_info:
        render_template(
            template="x={{{x}}",
            mode="curly",
            context={"x": "VAL"},
        )
    assert "{x" in exc_info.value.unresolved


def test_curly_triple_left_brace_with_matching_literal_key_resolves():
    """Companion to the regex pin: if the user genuinely has a key named
    ``{x`` in context, the placeholder resolves through literal-key-first
    lookup. Documents the surprising-but-consistent fallback path."""

    out = render_template(
        template="x={{{x}}",
        mode="curly",
        context={"{x": "VAL"},
    )
    assert out == "x=VAL"


def test_curly_unmatched_braces_pass_through_as_literal():
    """A bare ``{`` or ``}`` is not part of any placeholder and must survive."""

    out = render_template(
        template="alone: { and } here",
        mode="curly",
        context={},
    )
    assert out == "alone: { and } here"


def test_curly_single_braces_around_name_are_literal():
    """``{x}`` is fstring syntax, not curly. It must pass through unchanged."""

    out = render_template(
        template="literal {x}",
        mode="curly",
        context={"x": "ignored"},
    )
    assert out == "literal {x}"


def test_curly_newline_inside_placeholder_is_not_a_placeholder():
    """The non-greedy ``.*?`` does not match newlines by default, so a
    placeholder cannot span line breaks. The text passes through verbatim.
    """

    template = "x={{a\nb}}"
    out = render_template(
        template=template,
        mode="curly",
        context={"a\nb": "weird"},
    )
    assert out == template


def test_curly_unresolved_does_not_partially_substitute():
    """When some placeholders resolve and others don't, the helper must raise
    rather than emit a half-rendered string."""

    with pytest.raises(UnresolvedVariablesError):
        render_template(
            template="ok={{a}} bad={{b}}",
            mode="curly",
            context={"a": "1"},
        )


# =============================================================================
# 7. Fstring mode
# =============================================================================


def test_fstring_uses_str_format_semantics():
    out = render_template(
        template="hello {name}",
        mode="fstring",
        context={"name": "Ada"},
    )
    assert out == "hello Ada"


def test_fstring_double_brace_escapes_to_single_brace():
    """Standard ``str.format`` rule: ``{{`` -> ``{``, ``}}`` -> ``}``."""

    out = render_template(
        template="literal {{}} and {x}",
        mode="fstring",
        context={"x": "VAL"},
    )
    assert out == "literal {} and VAL"


def test_fstring_does_not_re_render_placeholder_in_value():
    """A value that looks like another fstring placeholder is inserted verbatim."""

    out = render_template(
        template="hello {x}",
        mode="fstring",
        context={"x": "{name}"},
    )
    assert out == "hello {name}"


def test_fstring_preserves_backslash_in_value():
    out = render_template(
        template="path={p}",
        mode="fstring",
        context={"p": "C:\\Users"},
    )
    assert out == "path=C:\\Users"


def test_fstring_supports_format_specs():
    """Pin existing ``str.format`` behavior: format specs work."""

    out = render_template(
        template="x={x:>5}",
        mode="fstring",
        context={"x": "hi"},
    )
    assert out == "x=   hi"


def test_fstring_supports_index_access():
    """Pin existing ``str.format`` behavior: ``{x[0]}`` indexes into the value."""

    out = render_template(
        template="x={x[0]}",
        mode="fstring",
        context={"x": [1, 2, 3]},
    )
    assert out == "x=1"


def test_fstring_substitutes_multiple_variables():
    out = render_template(
        template="{a} {b} {a}",
        mode="fstring",
        context={"a": "x", "b": "y"},
    )
    assert out == "x y x"


def test_fstring_raises_on_missing_key():
    with pytest.raises(KeyError):
        render_template(
            template="hello {missing}",
            mode="fstring",
            context={},
        )


# =============================================================================
# 8. Jinja2 mode
# =============================================================================


def test_jinja2_renders_safe_template():
    out = render_template(
        template="hello {{ name }}",
        mode="jinja2",
        context={"name": "Ada"},
    )
    assert out == "hello Ada"


def test_jinja2_raw_block_emits_literal_braces():
    out = render_template(
        template="literal: {% raw %}{{ x }}{% endraw %} actual: {{ x }}",
        mode="jinja2",
        context={"x": "VAL"},
    )
    assert out == "literal: {{ x }} actual: VAL"


def test_jinja2_filter_pipeline():
    out = render_template(
        template="upper: {{ name | upper }}",
        mode="jinja2",
        context={"name": "ada"},
    )
    assert out == "upper: ADA"


def test_jinja2_conditional():
    template = "{% if score >= 0.5 %}pass{% else %}fail{% endif %}"
    out_pass = render_template(template=template, mode="jinja2", context={"score": 0.7})
    out_fail = render_template(template=template, mode="jinja2", context={"score": 0.3})
    assert out_pass == "pass"
    assert out_fail == "fail"


def test_jinja2_for_loop_over_list():
    out = render_template(
        template="{% for t in tags %}{{ t }},{% endfor %}",
        mode="jinja2",
        context={"tags": ["a", "b", "c"]},
    )
    assert out == "a,b,c,"


def test_jinja2_undefined_variable_renders_empty_by_default():
    """Default Jinja2 ``Undefined`` stringifies as the empty string. We do not
    set a stricter undefined class today; pin so that contract is intentional.
    """

    out = render_template(
        template="hi {{ missing }}",
        mode="jinja2",
        context={},
    )
    assert out == "hi "


def test_jinja2_does_not_html_escape_by_default():
    """No ``autoescape`` is set, so HTML-special characters pass through.
    Prompts are sent to LLMs as text, not browsers — autoescape would corrupt them.
    """

    out = render_template(
        template="html: {{ x }}",
        mode="jinja2",
        context={"x": "<script>alert(1)</script>"},
    )
    assert out == "html: <script>alert(1)</script>"


def test_jinja2_raises_template_error_on_sandbox_violation():
    _, TemplateError = _load_jinja2()
    payload = "{{ lipsum.__globals__['os'].popen('id').read() }}"

    with pytest.raises(TemplateError):
        render_template(
            template=payload,
            mode="jinja2",
            context={},
        )


def test_jinja2_raises_template_error_on_subprocess_attempt():
    _, TemplateError = _load_jinja2()
    payload = "{{ ''.__class__.__mro__[1].__subclasses__() }}"

    with pytest.raises(TemplateError):
        render_template(
            template=payload,
            mode="jinja2",
            context={},
        )


def test_jinja2_preserves_backslash_in_value():
    out = render_template(
        template="path={{ p }}",
        mode="jinja2",
        context={"p": "C:\\Users"},
    )
    assert out == "path=C:\\Users"


# =============================================================================
# 9. Unknown mode
# =============================================================================


def test_unknown_mode_raises_value_error():
    with pytest.raises(ValueError, match="Unknown template format"):
        render_template(template="hi", mode="bogus", context={})


# =============================================================================
# 10. Call-site behavior preservation
# =============================================================================


def test_handlers_format_with_template_curly_preserves_behavior():
    """Judge handler ``_format_with_template`` keeps its existing behavior."""

    out = _format_with_template(
        content="profile={{profile}} | name={{profile.name}}",
        format="curly",
        kwargs={"profile": {"name": "Ada"}},
    )
    assert out == 'profile={"name": "Ada"} | name=Ada'


def test_handlers_format_with_template_curly_raises_on_unresolved():
    with pytest.raises(ValueError):
        _format_with_template(
            content="hi {{missing}}",
            format="curly",
            kwargs={},
        )


def test_handlers_format_with_template_jinja2_raises_on_sandbox_violation():
    payload = "{{ lipsum.__globals__['os'].popen('id').read() }}"
    _, TemplateError = _load_jinja2()
    with pytest.raises(TemplateError):
        _format_with_template(content=payload, format="jinja2", kwargs={})


def test_handlers_format_with_template_unknown_format_returns_content_unchanged():
    """Judge returns the content as-is when the template format is unrecognized
    rather than raising. Pinned so a future rewrite is intentional.
    """

    out = _format_with_template(
        content="hi {{name}}",
        format="not-a-real-format",
        kwargs={"name": "ignored"},
    )
    assert out == "hi {{name}}"


def test_prompt_template_curly_renders_with_helper():
    """Chat/completion ``PromptTemplate`` uses the helper transparently."""

    template = PromptTemplate(
        template_format="curly",
        messages=[
            {"role": "system", "content": "context={{profile}}"},
            {"role": "user", "content": "hi {{profile.name}}"},
        ],
    )

    formatted = template.format(profile={"name": "Ada"})

    assert formatted.messages[0].content == 'context={"name": "Ada"}'
    assert formatted.messages[1].content == "hi Ada"


def test_prompt_template_jinja2_raises_template_format_error_on_sandbox_violation():
    """Chat/completion keeps the raise-on-jinja-error behavior."""

    payload = "{{ lipsum.__globals__['os'].popen('id').read() }}"
    template = PromptTemplate(
        template_format="jinja2",
        messages=[{"role": "user", "content": payload}],
    )

    with pytest.raises(TemplateFormatError):
        template.format()


def test_prompt_template_curly_wraps_unresolved_as_template_format_error():
    template = PromptTemplate(
        template_format="curly",
        messages=[{"role": "user", "content": "hi {{missing}}"}],
    )
    with pytest.raises(TemplateFormatError) as exc_info:
        template.format()
    # Pin the legacy message text so chat/completion callers parsing the
    # exception keep working. The list-repr (``['missing']``) and trailing
    # period match the pre-WP-B1 wording.
    assert "Unreplaced variables in curly template: ['missing']." in str(exc_info.value)


def test_handlers_format_with_template_curly_unresolved_message_unchanged():
    """The judge's curly ValueError text is unchanged from pre-WP-B1."""

    with pytest.raises(ValueError) as exc_info:
        _format_with_template(content="hi {{missing}}", format="curly", kwargs={})
    assert "Template variables not found or unresolved: missing." in str(exc_info.value)


def test_prompt_template_fstring_missing_key_raises_template_format_error():
    template = PromptTemplate(
        template_format="fstring",
        messages=[{"role": "user", "content": "hi {missing}"}],
    )
    with pytest.raises(TemplateFormatError):
        template.format()


def test_prompt_template_curly_preserves_backslash_in_user_value():
    """Regression pin for the backslash-doubling bug: a Windows-style path in
    a user-supplied value must reach the LLM with a single backslash.
    """

    template = PromptTemplate(
        template_format="curly",
        messages=[{"role": "user", "content": "path={{p}}"}],
    )
    formatted = template.format(p="C:\\Users\\Ada")
    assert formatted.messages[0].content == "path=C:\\Users\\Ada"


def test_prompt_template_curly_empty_placeholder_raises():
    """Regression pin for the empty-placeholder bug: ``{{}}`` no longer leaks
    the entire render context."""

    template = PromptTemplate(
        template_format="curly",
        messages=[{"role": "user", "content": "hi {{}}"}],
    )
    with pytest.raises(TemplateFormatError):
        template.format(secret="do-not-leak", name="Ada")
