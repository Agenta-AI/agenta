"""The render layer on an html channel: Markdown becomes Telegram HTML, the
indicator and the no-answer line stay plain (the adapter escapes them), and
the progress item carries the answer so far with a cursor."""

from oss.src.core.channels.adapters.telegram.capabilities import (
    fetch_telegram_capabilities,
)
from oss.src.core.channels.render.render import (
    INDICATOR_TEXT,
    NO_ANSWER_TEXT,
    render_indicator,
    render_no_answer,
    render_progress,
    render_thinking,
    render_turn_result,
)


def _folded(text: str):
    return {"messages": [{"role": "assistant", "content": text}], "stop_reason": None}


def test_html_channel_renders_markdown_into_telegram_html():
    caps = fetch_telegram_capabilities()
    items = render_turn_result(
        capabilities=caps, folded=_folded("# Hi\n\n**bold** & `x<y`")
    )
    assert len(items) == 1
    part = items[0].parts[0]
    assert part.format == "html"
    assert part.text == "<b>Hi</b>\n\n<b>bold</b> &amp; <code>x&lt;y</code>"


def test_html_channel_chunks_a_long_answer_between_blocks():
    caps = fetch_telegram_capabilities()
    text = "\n\n".join("paragraph " * 100 for _ in range(10))
    items = render_turn_result(capabilities=caps, folded=_folded(text))
    assert len(items) > 1
    assert all(
        len(item.parts[0].text) <= caps.rendering.text.max_chars for item in items
    )


def test_indicator_thinking_and_no_answer_stay_plain_on_an_html_channel():
    caps = fetch_telegram_capabilities()
    assert render_indicator(capabilities=caps).parts[0].format == "plain"
    assert render_indicator(capabilities=caps).parts[0].text == INDICATOR_TEXT
    assert render_thinking(capabilities=caps, tick=3).parts[0].text == "Thinking."
    assert render_thinking(capabilities=caps, tick=5).parts[0].text == "Thinking..."
    assert render_no_answer(capabilities=caps).parts[0].text == NO_ANSWER_TEXT


def test_progress_is_the_first_chunk_with_a_cursor():
    caps = fetch_telegram_capabilities()
    item = render_progress(capabilities=caps, text="so far **good**")
    assert item.parts[0].text == "so far <b>good</b> …"
    assert item.parts[0].format == "html"
