"""Markdown -> Telegram HTML.

The agent writes Markdown. Telegram renders a small HTML tag set with
``parse_mode=HTML``: ``b``, ``i``, ``s``, ``u``, ``code``, ``pre``, ``a`` and
``blockquote``. It has no headings, lists or tables. This module is the
render-layer port for that format: it turns the Markdown the agent wrote into
text Telegram displays as intended, and nothing else. It escapes every
character that is not one of its own tags, so a stray ``<`` in the answer can
never break a message.

Dependency-free on purpose: the shapes an agent answer uses (paragraphs,
headings, lists, fenced code, inline code, bold, italic, links, quotes,
tables) are a short list, and a full CommonMark parser would still need a
Telegram-specific serializer on top.
"""

import html
import re
from typing import List

# --- inline ------------------------------------------------------------------ #

_CODE_SPAN = re.compile(r"`([^`\n]+)`")
_LINK = re.compile(r"\[([^\]\n]+)\]\((https?://[^)\s]+)\)")
_BOLD = re.compile(r"(\*\*|__)(?=\S)(.+?)(?<=\S)\1")
_ITALIC = re.compile(r"(?<![\w*])(\*|_)(?=\S)(.+?)(?<=\S)\1(?![\w*])")
_STRIKE = re.compile(r"~~(?=\S)(.+?)(?<=\S)~~")
_PLACEHOLDER = "\x00{}\x00"


def render_inline(text: str) -> str:
    """One paragraph's worth of Markdown inline syntax to Telegram HTML.

    Code spans and links are lifted out first, so their contents are never
    re-interpreted as emphasis; the rest is escaped, then the emphasis markers
    (which contain no HTML-significant characters) become tags.
    """

    lifted: List[str] = []

    def lift(rendered: str) -> str:
        lifted.append(rendered)
        return _PLACEHOLDER.format(len(lifted) - 1)

    text = _CODE_SPAN.sub(
        lambda m: lift(f"<code>{html.escape(m.group(1), quote=False)}</code>"), text
    )
    text = _LINK.sub(
        lambda m: lift(
            f'<a href="{html.escape(m.group(2), quote=True)}">'
            f"{render_inline(m.group(1))}</a>"
        ),
        text,
    )

    text = html.escape(text, quote=False)
    text = _BOLD.sub(lambda m: f"<b>{m.group(2)}</b>", text)
    text = _STRIKE.sub(lambda m: f"<s>{m.group(1)}</s>", text)
    text = _ITALIC.sub(lambda m: f"<i>{m.group(2)}</i>", text)

    for index, rendered in enumerate(lifted):
        text = text.replace(_PLACEHOLDER.format(index), rendered)
    return text


# --- blocks ------------------------------------------------------------------ #

_FENCE = re.compile(r"^\s*```([\w+-]*)\s*$")
_HEADING = re.compile(r"^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$")
_BULLET = re.compile(r"^(\s*)[-*+]\s+(.*)$")
_NUMBERED = re.compile(r"^(\s*)(\d+)[.)]\s+(.*)$")
_QUOTE = re.compile(r"^\s{0,3}>\s?(.*)$")
_RULE = re.compile(r"^\s{0,3}([-*_])(\s*\1){2,}\s*$")
_TABLE_ROW = re.compile(r"^\s*\|.*\|\s*$")
_TABLE_SEPARATOR = re.compile(r"^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$")


def _code_block(lines: List[str], language: str) -> str:
    body = html.escape("\n".join(lines), quote=False)
    if language:
        return f'<pre><code class="language-{html.escape(language, quote=True)}">{body}</code></pre>'
    return f"<pre>{body}</pre>"


def render_blocks(text: str) -> List[str]:
    """Markdown -> a list of rendered HTML blocks, one per paragraph-level
    element, so a caller can pack them into messages without cutting a tag."""

    lines = text.replace("\r\n", "\n").split("\n")
    blocks: List[str] = []
    paragraph: List[str] = []
    quote: List[str] = []
    table: List[str] = []
    list_items: List[str] = []

    def flush_paragraph() -> None:
        if paragraph:
            blocks.append(render_inline(" ".join(part.strip() for part in paragraph)))
            paragraph.clear()

    def flush_quote() -> None:
        if quote:
            inner = "\n".join(render_inline(line) for line in quote)
            blocks.append(f"<blockquote>{inner}</blockquote>")
            quote.clear()

    def flush_table() -> None:
        if table:
            rows = [row.strip() for row in table if not _TABLE_SEPARATOR.match(row)]
            blocks.append(_code_block(rows, ""))
            table.clear()

    def flush_list() -> None:
        if list_items:
            blocks.append("\n".join(list_items))
            list_items.clear()

    def flush_all() -> None:
        flush_paragraph()
        flush_quote()
        flush_table()
        flush_list()

    index = 0
    while index < len(lines):
        line = lines[index]
        fence = _FENCE.match(line)
        if fence:
            flush_all()
            language = fence.group(1)
            code: List[str] = []
            index += 1
            while index < len(lines) and not _FENCE.match(lines[index]):
                code.append(lines[index])
                index += 1
            blocks.append(_code_block(code, language))
            index += 1  # the closing fence, when present
            continue

        if not line.strip():
            flush_all()
            index += 1
            continue

        heading = _HEADING.match(line)
        if heading:
            flush_all()
            blocks.append(f"<b>{render_inline(heading.group(2))}</b>")
            index += 1
            continue

        if _RULE.match(line):
            flush_all()
            blocks.append("———")
            index += 1
            continue

        if _TABLE_ROW.match(line) or (table and _TABLE_SEPARATOR.match(line)):
            flush_paragraph()
            flush_quote()
            flush_list()
            table.append(line)
            index += 1
            continue
        flush_table()

        quoted = _QUOTE.match(line)
        if quoted:
            flush_paragraph()
            flush_list()
            quote.append(quoted.group(1))
            index += 1
            continue
        flush_quote()

        bullet = _BULLET.match(line)
        numbered = _NUMBERED.match(line)
        if bullet or numbered:
            flush_paragraph()
            if bullet:
                depth = len(bullet.group(1).replace("\t", "  ")) // 2
                list_items.append(f"{'  ' * depth}• {render_inline(bullet.group(2))}")
            else:
                assert numbered is not None
                depth = len(numbered.group(1).replace("\t", "  ")) // 2
                list_items.append(
                    f"{'  ' * depth}{numbered.group(2)}. {render_inline(numbered.group(3))}"
                )
            index += 1
            continue
        if list_items and line.startswith((" ", "\t")):
            # a wrapped continuation line of the previous list item
            list_items[-1] += " " + render_inline(line.strip())
            index += 1
            continue
        flush_list()

        paragraph.append(line)
        index += 1

    flush_all()
    return blocks


def markdown_to_telegram_html(text: str) -> str:
    """The whole text as one HTML body: blocks separated by a blank line."""

    return "\n\n".join(render_blocks(text))


def _split_block(block: str, max_chars: int) -> List[str]:
    """A block longer than one message: split on line breaks, re-wrapping a
    code block's tags around each piece so no message holds a half tag."""

    pre_open, pre_close = "", ""
    body = block
    if block.startswith("<pre>") and block.endswith("</pre>"):
        pre_open, pre_close, body = "<pre>", "</pre>", block[5:-6]
    elif block.startswith("<pre><code") and block.endswith("</code></pre>"):
        close_tag = block.index(">") + 1
        pre_open, pre_close = block[:close_tag], "</code></pre>"
        body = block[close_tag : -len(pre_close)]
    budget = max(1, max_chars - len(pre_open) - len(pre_close))
    pieces: List[str] = []
    current = ""
    for line in body.split("\n"):
        while len(line) > budget:
            if current:
                pieces.append(current)
                current = ""
            pieces.append(line[:budget])
            line = line[budget:]
        candidate = line if not current else f"{current}\n{line}"
        if len(candidate) > budget:
            pieces.append(current)
            current = line
        else:
            current = candidate
    if current:
        pieces.append(current)
    return [f"{pre_open}{piece}{pre_close}" for piece in pieces]


def markdown_to_telegram_html_chunks(text: str, max_chars: int) -> List[str]:
    """Rendered HTML packed into messages of at most `max_chars`, cut only
    between blocks (or between lines inside an oversize block), never inside
    a tag. `max_chars <= 0` means no limit."""

    blocks = render_blocks(text)
    if max_chars <= 0:
        return ["\n\n".join(blocks)] if blocks else [""]
    chunks: List[str] = []
    current = ""
    for block in blocks:
        parts = [block] if len(block) <= max_chars else _split_block(block, max_chars)
        for part in parts:
            candidate = part if not current else f"{current}\n\n{part}"
            if len(candidate) <= max_chars:
                current = candidate
            else:
                if current:
                    chunks.append(current)
                current = part
    if current or not chunks:
        chunks.append(current)
    return chunks
