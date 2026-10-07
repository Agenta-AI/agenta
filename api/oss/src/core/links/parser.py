"""Read a page's preview fields from its `<head>`, with the standard library parser."""

from html.parser import HTMLParser
from typing import Optional
from urllib.parse import urljoin, urlparse

from pydantic import BaseModel

_TITLE_KEYS = ("og:title", "twitter:title")
_DESCRIPTION_KEYS = ("og:description", "twitter:description", "description")
_IMAGE_KEYS = (
    "og:image",
    "og:image:url",
    "og:image:secure_url",
    "twitter:image",
    "twitter:image:src",
)
_MAX_TEXT = 300


class LinkMeta(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    image: Optional[str] = None
    site_name: Optional[str] = None


class _HeadParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.meta: dict[str, str] = {}
        self.title = ""
        self._in_title = False
        self.done = False

    def handle_starttag(self, tag, attrs):
        if tag == "meta":
            values = {name.lower(): (value or "") for name, value in attrs}
            key = (values.get("property") or values.get("name") or "").strip().lower()
            content = values.get("content", "").strip()
            # The first value wins, as crawlers read them.
            if key and content and key not in self.meta:
                self.meta[key] = content
        elif tag == "title":
            self._in_title = True
        elif tag == "body":
            self.done = True

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        elif tag == "head":
            self.done = True

    def handle_data(self, data):
        if self._in_title:
            self.title += data


def _clean(text: Optional[str]) -> Optional[str]:
    if not text:
        return None
    text = " ".join(text.split())
    if not text:
        return None
    return text if len(text) <= _MAX_TEXT else f"{text[: _MAX_TEXT - 1].rstrip()}…"


def _first(meta: dict[str, str], keys: tuple[str, ...]) -> Optional[str]:
    return next((meta[key] for key in keys if meta.get(key)), None)


def _absolute_image(src: Optional[str], base_url: str) -> Optional[str]:
    if not src:
        return None
    absolute = urljoin(base_url, src.strip())
    return absolute if urlparse(absolute).scheme in ("http", "https") else None


def parse_link_meta(html: str, base_url: str) -> LinkMeta:
    parser = _HeadParser()
    try:
        # Fed in slices so a page with a huge body stops being read once `<head>` closes.
        for start in range(0, len(html), 16_384):
            parser.feed(html[start : start + 16_384])
            if parser.done:
                break
    except Exception:  # pylint: disable=broad-exception-caught
        pass  # malformed markup: keep whatever was read before it
    meta = parser.meta
    return LinkMeta(
        title=_clean(_first(meta, _TITLE_KEYS) or parser.title),
        description=_clean(_first(meta, _DESCRIPTION_KEYS)),
        image=_absolute_image(_first(meta, _IMAGE_KEYS), base_url),
        site_name=_clean(meta.get("og:site_name")),
    )
