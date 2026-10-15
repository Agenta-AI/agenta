"""Preview fields come from Open Graph first, then Twitter cards, then plain HTML."""

from oss.src.core.links.parser import parse_link_preview
from oss.src.core.links.types import LinkPreview

BASE = "https://example.com/blog/post"


def test_open_graph_fields_win():
    html = """
    <html><head>
      <title>Plain title</title>
      <meta property="og:title" content="OG title">
      <meta name="twitter:title" content="Twitter title">
      <meta property="og:description" content="OG description">
      <meta name="description" content="Meta description">
      <meta property="og:image" content="/img/cover.png">
      <meta property="og:site_name" content="Example">
    </head><body></body></html>
    """
    assert parse_link_preview(url=BASE, html=html) == LinkPreview(
        url=BASE,
        domain="example.com",
        title="OG title",
        description="OG description",
        image="https://example.com/img/cover.png",
        site_name="Example",
    )


def test_twitter_then_plain_html_fill_the_gaps():
    html = """
    <head>
      <title>  Plain
         title </title>
      <meta name="twitter:description" content="Twitter description">
      <meta name="twitter:image" content="https://cdn.example.com/t.jpg">
    </head>
    """
    assert parse_link_preview(url=BASE, html=html) == LinkPreview(
        url=BASE,
        domain="example.com",
        title="Plain title",
        description="Twitter description",
        image="https://cdn.example.com/t.jpg",
    )


def test_meta_description_is_the_last_fallback():
    html = '<head><meta name="description" content="Just a description"></head>'
    assert parse_link_preview(url=BASE, html=html).description == "Just a description"


def test_an_image_that_is_not_http_is_dropped():
    html = '<head><meta property="og:image" content="javascript:alert(1)"></head>'
    assert parse_link_preview(url=BASE, html=html).image is None
    html = (
        '<head><meta property="og:image" content="data:image/png;base64,AAAA"></head>'
    )
    assert parse_link_preview(url=BASE, html=html).image is None


def test_a_protocol_relative_image_takes_the_page_scheme():
    html = '<head><meta property="og:image" content="//cdn.example.com/a.png"></head>'
    assert (
        parse_link_preview(url=BASE, html=html).image == "https://cdn.example.com/a.png"
    )


def test_entities_are_decoded_and_long_text_is_clipped():
    html = f'<head><meta property="og:title" content="A &amp; B {"x" * 400}"></head>'
    title = parse_link_preview(url=BASE, html=html).title
    assert title is not None
    assert title.startswith("A & B ")
    assert len(title) == 300
    assert title.endswith("…")


def test_tags_after_the_head_are_ignored():
    html = '<head><title>Real</title></head><body><meta property="og:title" content="Late"></body>'
    assert parse_link_preview(url=BASE, html=html).title == "Real"


def test_a_page_with_nothing_returns_empty_fields():
    assert parse_link_preview(
        url="https://www.example.com/", html="<html><body>hello</body></html>"
    ) == LinkPreview(url="https://www.example.com/", domain="example.com")


def test_malformed_markup_keeps_what_was_read():
    html = '<head><meta property="og:title" content="Kept"><title>unterminated'
    assert parse_link_preview(url=BASE, html=html).title == "Kept"


def test_tags_after_an_unclosed_head_and_an_opened_body_are_ignored():
    html = (
        '<title>Real</title><BODY class=\'x\'><meta property="og:title" content="Late">'
    )
    assert parse_link_preview(url=BASE, html=html).title == "Real"


def test_an_overlong_image_url_is_dropped():
    html = f'<head><meta property="og:image" content="/{"a" * 2100}.png"></head>'
    assert parse_link_preview(url=BASE, html=html).image is None
