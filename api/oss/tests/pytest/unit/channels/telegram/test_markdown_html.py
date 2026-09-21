"""Markdown -> Telegram HTML: the shapes an agent answer uses, rendered into the
tag set Telegram accepts, with everything else escaped."""

from oss.src.core.channels.render.markdown_html import (
    markdown_to_telegram_html,
    markdown_to_telegram_html_chunks,
    render_inline,
)


def test_inline_bold_italic_strike_code_and_link():
    assert render_inline("**bold** and __bold__") == "<b>bold</b> and <b>bold</b>"
    assert render_inline("*em* and _em_") == "<i>em</i> and <i>em</i>"
    assert render_inline("~~gone~~") == "<s>gone</s>"
    assert render_inline("call `a < b`") == "call <code>a &lt; b</code>"
    assert (
        render_inline("see [the docs](https://x.y/z?a=1&b=2)")
        == 'see <a href="https://x.y/z?a=1&amp;b=2">the docs</a>'
    )


def test_plain_specials_are_escaped_and_underscores_in_words_stay():
    assert render_inline("a < b & c > d") == "a &lt; b &amp; c &gt; d"
    assert render_inline("snake_case_name stays") == "snake_case_name stays"
    assert render_inline("2 * 3 * 4") == "2 * 3 * 4"


def test_headings_lists_quotes_rules_and_code_blocks():
    text = (
        "# Title\n"
        "\n"
        "Intro line\n"
        "second line\n"
        "\n"
        "- one\n"
        "- two **strong**\n"
        "  - nested\n"
        "\n"
        "1. first\n"
        "2. second\n"
        "\n"
        "> quoted <text>\n"
        "\n"
        "---\n"
        "\n"
        "```python\n"
        "if a < b:\n"
        "    print('x')\n"
        "```\n"
    )
    assert markdown_to_telegram_html(text) == (
        "<b>Title</b>\n\n"
        "Intro line second line\n\n"
        "• one\n• two <b>strong</b>\n  • nested\n\n"
        "1. first\n2. second\n\n"
        "<blockquote>quoted &lt;text&gt;</blockquote>\n\n"
        "———\n\n"
        "<pre><code class=\"language-python\">if a &lt; b:\n    print('x')</code></pre>"
    )


def test_tables_become_a_code_block():
    text = "| a | b |\n|---|---|\n| 1 | 2 |\n"
    assert markdown_to_telegram_html(text) == "<pre>| a | b |\n| 1 | 2 |</pre>"


def test_unclosed_fence_still_renders_as_code():
    assert markdown_to_telegram_html("```\nx = 1") == "<pre>x = 1</pre>"


def test_chunks_cut_between_blocks_never_inside_a_tag():
    text = "\n\n".join(f"paragraph {i} with **bold**" for i in range(10))
    chunks = markdown_to_telegram_html_chunks(text, max_chars=80)
    assert len(chunks) > 1
    for chunk in chunks:
        assert len(chunk) <= 80
        assert chunk.count("<b>") == chunk.count("</b>")
    assert "\n\n".join(chunks) == markdown_to_telegram_html(text)


def test_an_oversize_code_block_splits_by_line_and_rewraps_the_tags():
    code = "\n".join(f"line {i}" for i in range(40))
    chunks = markdown_to_telegram_html_chunks(f"```\n{code}\n```", max_chars=100)
    assert len(chunks) > 1
    for chunk in chunks:
        assert chunk.startswith("<pre>") and chunk.endswith("</pre>")
        assert len(chunk) <= 100


def test_no_limit_and_empty_text():
    assert markdown_to_telegram_html_chunks("a\n\nb", max_chars=0) == ["a\n\nb"]
    assert markdown_to_telegram_html_chunks("", max_chars=10) == [""]
